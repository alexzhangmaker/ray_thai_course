import express from 'express';
import fs from 'fs/promises';
import fsSync from 'fs';
import cors from 'cors';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import {
  initDb,
  run,
  get,
  all
} from './db.js';
import {
  WeightedScoreEngine,
  SM2Strategy,
  PimsleurStrategy,
  HighFreqSessionManager,
  activeSessions
} from './scheduler.js';
import { calculateSM2 } from './dictationSM2.js';
import { calculateSentenceSM2 } from './sentenceSM2.js';



const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const parentDir = path.resolve(__dirname, '..');

const app = express();
let PORT = process.env.PORT;
if (!PORT) {
  try {
    const portsConfigPath = '/home/alexszhang/svcPortMan/svcPorts.json';
    const portsConfig = JSON.parse(fsSync.readFileSync(portsConfigPath, 'utf8'));
    if (portsConfig['vCourse.ThaiNotes'] && portsConfig['vCourse.ThaiNotes'].Port) {
      PORT = portsConfig['vCourse.ThaiNotes'].Port;
    }
  } catch (err) {
    console.error('Failed to read port from svcPorts.json:', err);
  }
}
if (!PORT) {
  PORT = 3002;
}

app.use(cors());
app.use(express.json({ limit: '100mb' }));

// Helper to sanitize and format vocabulary object
const formatVocabularyRow = (row) => {
  if (!row) return null;
  try {
    const data = JSON.parse(row.data_json);
    // Sync critical columns back to data just in case they were updated individually
    data.id = row.id;
    data.lessonId = row.lesson_id;
    data.order = row.sort_order;
    data.headword = row.headword;
    data.pos = row.pos;
    data.meaning = row.meaning;
    return data;
  } catch (err) {
    console.error(`Failed to parse data_json for ID ${row.id}:`, err);
    return {
      id: row.id,
      lessonId: row.lesson_id,
      order: row.sort_order,
      headword: row.headword,
      pos: row.pos,
      meaning: row.meaning,
      error: "Malformed data_json"
    };
  }
};

// Helper to sanitize and format grammar note object
const formatGrammarRow = (row) => {
  if (!row) return null;
  try {
    const data = JSON.parse(row.data_json);
    data.id = row.id;
    data.lessonId = row.lesson_id;
    data.order = row.sort_order;
    data.title = row.title;
    data.category = row.category;
    data.summary = row.summary;
    return data;
  } catch (err) {
    console.error(`Failed to parse data_json for ID ${row.id}:`, err);
    return {
      id: row.id,
      lessonId: row.lesson_id,
      order: row.sort_order,
      title: row.title,
      category: row.category,
      summary: row.summary,
      error: "Malformed data_json"
    };
  }
};


// 1. GET /api/vocabulary - Retrieve all vocabulary (supports lessonId and search filters)
app.get('/api/vocabulary', async (req, res) => {
  const { lessonId, search } = req.query;
  let sql = `SELECT * FROM vocabulary WHERE 1=1`;
  const params = [];

  if (lessonId) {
    // Check if the lesson has referenced vocabulary ids
    const lesson = await get(`SELECT content_json FROM course_lessons WHERE id = ?`, [lessonId]);
    let refIds = [];
    if (lesson) {
      try {
        const content = JSON.parse(lesson.content_json);
        refIds = content.vocabularyIds || [];
      } catch (err) {
        console.error("Failed to parse lesson content_json:", err);
      }
    }

    if (refIds.length > 0) {
      const placeholders = refIds.map(() => '?').join(',');
      sql += ` AND (lesson_id = ? OR id IN (${placeholders}))`;
      params.push(lessonId, ...refIds);
    } else {
      sql += ` AND lesson_id = ?`;
      params.push(lessonId);
    }
  }

  if (search) {
    sql += ` AND (headword LIKE ? OR meaning LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`);
  }

  sql += ` ORDER BY lesson_id ASC, sort_order ASC`;

  try {
    const rows = await all(sql, params);
    const result = rows.map(formatVocabularyRow);
    res.json(result);
  } catch (err) {
    console.error('Failed to query vocabulary list:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. GET /api/vocabulary/:id - Retrieve single vocabulary item by ID
app.get('/api/vocabulary/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const row = await get(`SELECT * FROM vocabulary WHERE id = ?`, [id]);
    if (!row) {
      return res.status(404).json({ error: `Vocabulary item with ID '${id}' not found` });
    }
    res.json(formatVocabularyRow(row));
  } catch (err) {
    console.error(`Failed to query vocabulary ID '${id}':`, err);
    res.status(500).json({ error: err.message });
  }
});

// 3. POST /api/vocabulary - Create a new vocabulary item
app.post('/api/vocabulary', async (req, res) => {
  const body = req.body;
  const { id, lessonId = null, order = null, headword, pos, meaning } = body;

  // Basic validation
  if (!id || !headword || !pos || !meaning) {
    return res.status(400).json({
      error: "Missing required fields. Needs: id, headword, pos, meaning."
    });
  }

  try {
    // Check if ID already exists
    const existing = await get(`SELECT id FROM vocabulary WHERE id = ?`, [id]);
    if (existing) {
      return res.status(400).json({ error: `Vocabulary item with ID '${id}' already exists` });
    }

    // Insert into database
    await run(
      `INSERT INTO vocabulary (id, lesson_id, sort_order, headword, pos, meaning, data_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, lessonId, order, headword, pos, meaning, JSON.stringify(body)]
    );

    // Return the created item
    const createdRow = await get(`SELECT * FROM vocabulary WHERE id = ?`, [id]);
    res.status(201).json(formatVocabularyRow(createdRow));
  } catch (err) {
    console.error('Failed to create vocabulary item:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. PUT /api/vocabulary/:id - Update an existing vocabulary item
app.put('/api/vocabulary/:id', async (req, res) => {
  const { id } = req.params;
  const body = req.body;
  const { lessonId = null, order = null, headword, pos, meaning } = body;

  // Basic validation
  if (!headword || !pos || !meaning) {
    return res.status(400).json({
      error: "Missing required fields. Needs: headword, pos, meaning."
    });
  }

  try {
    const existing = await get(`SELECT id FROM vocabulary WHERE id = ?`, [id]);
    if (!existing) {
      return res.status(404).json({ error: `Vocabulary item with ID '${id}' not found` });
    }

    // Set matching ID in payload body to maintain consistency
    body.id = id;

    // Update in database
    await run(
      `UPDATE vocabulary 
       SET lesson_id = ?, sort_order = ?, headword = ?, pos = ?, meaning = ?, data_json = ?, updated_at = datetime('now', 'localtime') 
       WHERE id = ?`,
      [lessonId, order, headword, pos, meaning, JSON.stringify(body), id]
    );

    const updatedRow = await get(`SELECT * FROM vocabulary WHERE id = ?`, [id]);
    res.json(formatVocabularyRow(updatedRow));
  } catch (err) {
    console.error(`Failed to update vocabulary item '${id}':`, err);
    res.status(500).json({ error: err.message });
  }
});

// 5. DELETE /api/vocabulary/:id - Delete a vocabulary item
app.delete('/api/vocabulary/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await get(`SELECT id FROM vocabulary WHERE id = ?`, [id]);
    if (!existing) {
      return res.status(404).json({ error: `Vocabulary item with ID '${id}' not found` });
    }

    await run(`DELETE FROM vocabulary WHERE id = ?`, [id]);
    res.json({ success: true, message: `Vocabulary item with ID '${id}' successfully deleted` });
  } catch (err) {
    console.error(`Failed to delete vocabulary item '${id}':`, err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// Grammar Notes APIs
// ==========================================

// 1. GET /api/grammar - Retrieve all grammar notes
app.get('/api/grammar', async (req, res) => {
  const { lessonId, search, category } = req.query;
  let sql = `SELECT * FROM grammar_notes WHERE 1=1`;
  const params = [];

  if (lessonId) {
    // Check if the lesson has referenced grammar note ids
    const lesson = await get(`SELECT content_json FROM course_lessons WHERE id = ?`, [lessonId]);
    let refIds = [];
    if (lesson) {
      try {
        const content = JSON.parse(lesson.content_json);
        refIds = content.grammarNoteIds || [];
      } catch (err) {
        console.error("Failed to parse lesson content_json:", err);
      }
    }

    if (refIds.length > 0) {
      const placeholders = refIds.map(() => '?').join(',');
      sql += ` AND (lesson_id = ? OR id IN (${placeholders}))`;
      params.push(lessonId, ...refIds);
    } else {
      sql += ` AND lesson_id = ?`;
      params.push(lessonId);
    }
  }

  if (category) {
    sql += ` AND category = ?`;
    params.push(category);
  }

  if (search) {
    sql += ` AND (title LIKE ? OR summary LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`);
  }

  sql += ` ORDER BY lesson_id ASC, sort_order ASC`;

  try {
    const rows = await all(sql, params);
    const result = rows.map(formatGrammarRow);
    res.json(result);
  } catch (err) {
    console.error('Failed to query grammar list:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. GET /api/grammar/:id - Retrieve single grammar item
app.get('/api/grammar/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const row = await get(`SELECT * FROM grammar_notes WHERE id = ?`, [id]);
    if (!row) {
      return res.status(404).json({ error: `Grammar note with ID '${id}' not found` });
    }
    res.json(formatGrammarRow(row));
  } catch (err) {
    console.error(`Failed to query grammar ID '${id}':`, err);
    res.status(500).json({ error: err.message });
  }
});

// 3. POST /api/grammar - Create a new grammar item
app.post('/api/grammar', async (req, res) => {
  const body = req.body;
  const { id, lessonId = null, order = null, title, category, summary } = body;

  if (!id || !title || !category || !summary) {
    return res.status(400).json({
      error: "Missing required fields. Needs: id, title, category, summary."
    });
  }

  try {
    const existing = await get(`SELECT id FROM grammar_notes WHERE id = ?`, [id]);
    if (existing) {
      return res.status(400).json({ error: `Grammar note with ID '${id}' already exists` });
    }

    await run(
      `INSERT INTO grammar_notes (id, lesson_id, sort_order, title, category, summary, data_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, lessonId, order, title, category, summary, JSON.stringify(body)]
    );

    const createdRow = await get(`SELECT * FROM grammar_notes WHERE id = ?`, [id]);
    res.status(201).json(formatGrammarRow(createdRow));
  } catch (err) {
    console.error('Failed to create grammar item:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. PUT /api/grammar/:id - Update an existing grammar item
app.put('/api/grammar/:id', async (req, res) => {
  const { id } = req.params;
  const body = req.body;
  const { lessonId = null, order = null, title, category, summary } = body;

  if (!title || !category || !summary) {
    return res.status(400).json({
      error: "Missing required fields. Needs: title, category, summary."
    });
  }

  try {
    const existing = await get(`SELECT id FROM grammar_notes WHERE id = ?`, [id]);
    if (!existing) {
      return res.status(404).json({ error: `Grammar note with ID '${id}' not found` });
    }

    body.id = id;

    await run(
      `UPDATE grammar_notes 
       SET lesson_id = ?, sort_order = ?, title = ?, category = ?, summary = ?, data_json = ?, updated_at = datetime('now', 'localtime') 
       WHERE id = ?`,
      [lessonId, order, title, category, summary, JSON.stringify(body), id]
    );

    const updatedRow = await get(`SELECT * FROM grammar_notes WHERE id = ?`, [id]);
    res.json(formatGrammarRow(updatedRow));
  } catch (err) {
    console.error(`Failed to update grammar item '${id}':`, err);
    res.status(500).json({ error: err.message });
  }
});

// 5. DELETE /api/grammar/:id - Delete a grammar item
app.delete('/api/grammar/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await get(`SELECT id FROM grammar_notes WHERE id = ?`, [id]);
    if (!existing) {
      return res.status(404).json({ error: `Grammar note with ID '${id}' not found` });
    }

    await run(`DELETE FROM grammar_notes WHERE id = ?`, [id]);
    res.json({ success: true, message: `Grammar note with ID '${id}' successfully deleted` });
  } catch (err) {
    console.error(`Failed to delete grammar item '${id}':`, err);
    res.status(500).json({ error: err.message });
  }
});


// ==========================================
// Prompt Markdown Read/Write APIs
// ==========================================
app.get('/api/prompt', async (req, res) => {
  try {
    let typeName = 'Keyword';
    let fileName = '';
    if (req.query.type === 'grammar') {
      typeName = 'Grammar';
    } else if (req.query.type === 'grammar_text') {
      typeName = 'Grammar_Text';
    } else if (req.query.type === 'high_freq') {
      typeName = 'HighFreq';
    } else if (req.query.type === 'vocab_list') {
      typeName = 'Vocab_List';
    } else if (req.query.type === 'reading_coach') {
      fileName = 'appReadingCoach.md';
    } else if (req.query.type === 'memorize_notes') {
      fileName = 'appMemorizeNotes.md';
    } else if (req.query.type === 'translate') {
      fileName = 'appTranslate.md';
    } else if (req.query.type === 'sentence') {
      typeName = 'Sentence_Review';
    } else if (req.query.type === 'courseware_studio' || req.query.type === 'courseware') {
      fileName = 'consoleCourseStudio.md';
    }
    const promptPath = fileName 
      ? path.join(parentDir, 'PromptMD', fileName)
      : path.join(parentDir, 'PromptMD', `Prompt_Thai_${typeName}.md`);
    const content = await fs.readFile(promptPath, 'utf-8');
    res.json({ content });
  } catch (err) {
    console.error('Failed to read prompt markdown:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/prompt', async (req, res) => {
  const { content } = req.body;
  let typeName = 'Keyword';
  let fileName = '';
  if (req.query.type === 'grammar') {
    typeName = 'Grammar';
  } else if (req.query.type === 'grammar_text') {
    typeName = 'Grammar_Text';
  } else if (req.query.type === 'high_freq') {
    typeName = 'HighFreq';
  } else if (req.query.type === 'vocab_list') {
    typeName = 'Vocab_List';
  } else if (req.query.type === 'reading_coach') {
    fileName = 'appReadingCoach.md';
  } else if (req.query.type === 'memorize_notes') {
    fileName = 'appMemorizeNotes.md';
  } else if (req.query.type === 'translate') {
    fileName = 'appTranslate.md';
  } else if (req.query.type === 'sentence') {
    typeName = 'Sentence_Review';
  } else if (req.query.type === 'courseware_studio' || req.query.type === 'courseware') {
    fileName = 'consoleCourseStudio.md';
  }
  
  if (content === undefined) {
    return res.status(400).json({ error: 'Content is required' });
  }
  try {
    const promptPath = fileName 
      ? path.join(parentDir, 'PromptMD', fileName)
      : path.join(parentDir, 'PromptMD', `Prompt_Thai_${typeName}.md`);
    await fs.writeFile(promptPath, content, 'utf-8');
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to save prompt markdown:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// Courses & Course Lessons APIs
// ==========================================

// Courses CRUD
app.get('/api/courses', async (req, res) => {
  try {
    const rows = await all(`SELECT * FROM courses ORDER BY name ASC`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/courses/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const row = await get(`SELECT * FROM courses WHERE id = ?`, [id]);
    if (!row) {
      return res.status(404).json({ error: `Course '${id}' not found` });
    }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/courses', async (req, res) => {
  const { id, name, description = "" } = req.body;
  if (!id || !name) {
    return res.status(400).json({ error: "Missing required fields: id, name" });
  }
  try {
    const existing = await get(`SELECT id FROM courses WHERE id = ?`, [id]);
    if (existing) {
      return res.status(400).json({ error: `Course '${id}' already exists` });
    }
    await run(`INSERT INTO courses (id, name, description) VALUES (?, ?, ?)`, [id, name, description]);
    const created = await get(`SELECT * FROM courses WHERE id = ?`, [id]);
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/courses/:id', async (req, res) => {
  const { id } = req.params;
  const { name, description = "" } = req.body;
  if (!name) {
    return res.status(400).json({ error: "Missing required field: name" });
  }
  try {
    const existing = await get(`SELECT id FROM courses WHERE id = ?`, [id]);
    if (!existing) {
      return res.status(404).json({ error: `Course '${id}' not found` });
    }
    await run(`UPDATE courses SET name = ?, description = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`, [name, description, id]);
    const updated = await get(`SELECT * FROM courses WHERE id = ?`, [id]);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/courses/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await get(`SELECT id FROM courses WHERE id = ?`, [id]);
    if (!existing) {
      return res.status(404).json({ error: `Course '${id}' not found` });
    }
    await run(`DELETE FROM courses WHERE id = ?`, [id]);
    res.json({ success: true, message: `Course '${id}' deleted` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lessons CRUD
app.get('/api/lessons', async (req, res) => {
  const { courseId } = req.query;
  let sql = `SELECT * FROM course_lessons WHERE 1=1`;
  const params = [];
  if (courseId) {
    sql += ` AND course_id = ?`;
    params.push(courseId);
  }
  sql += ` ORDER BY course_id ASC, sort_order ASC`;
  try {
    const rows = await all(sql, params);
    const result = rows.map(row => {
      try {
        row.content = JSON.parse(row.content_json);
      } catch (err) {
        row.content = { vocabularyIds: [], grammarNoteIds: [] };
      }
      return row;
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/lessons/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const row = await get(`SELECT * FROM course_lessons WHERE id = ?`, [id]);
    if (!row) {
      return res.status(404).json({ error: `Lesson '${id}' not found` });
    }
    try {
      row.content = JSON.parse(row.content_json);
    } catch (err) {
      row.content = { vocabularyIds: [], grammarNoteIds: [] };
    }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/lessons', async (req, res) => {
  const { id, courseId, sortOrder, title, content, sentenceIds } = req.body;
  if (!id || !courseId || sortOrder === undefined || !title || !content) {
    return res.status(400).json({ error: "Missing required fields: id, courseId, sortOrder, title, content" });
  }
  try {
    const existing = await get(`SELECT id FROM course_lessons WHERE id = ?`, [id]);
    if (existing) {
      return res.status(400).json({ error: `Lesson '${id}' already exists` });
    }
    await run(
      `INSERT INTO course_lessons (id, course_id, sort_order, title, content_json) VALUES (?, ?, ?, ?, ?)`,
      [id, courseId, sortOrder, title, JSON.stringify(content)]
    );

    if (sentenceIds && Array.isArray(sentenceIds)) {
      for (const sentenceId of sentenceIds) {
        await run(
          `INSERT INTO tblCourseReviewSentence (course_id, lesson_id, sentence_id) VALUES (?, ?, ?)`,
          [courseId, id, sentenceId]
        );
      }
    }

    const created = await get(`SELECT * FROM course_lessons WHERE id = ?`, [id]);
    created.content = content;
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/lessons/:id', async (req, res) => {
  const { id } = req.params;
  const { courseId, sortOrder, title, content, sentenceIds } = req.body;
  if (!courseId || sortOrder === undefined || !title || !content) {
    return res.status(400).json({ error: "Missing required fields: courseId, sortOrder, title, content" });
  }
  try {
    const existing = await get(`SELECT id FROM course_lessons WHERE id = ?`, [id]);
    if (!existing) {
      return res.status(404).json({ error: `Lesson '${id}' not found` });
    }
    await run(
      `UPDATE course_lessons 
       SET course_id = ?, sort_order = ?, title = ?, content_json = ?, updated_at = datetime('now', 'localtime') 
       WHERE id = ?`,
      [courseId, sortOrder, title, JSON.stringify(content), id]
    );

    if (sentenceIds && Array.isArray(sentenceIds)) {
      await run(`DELETE FROM tblCourseReviewSentence WHERE lesson_id = ?`, [id]);
      for (const sentenceId of sentenceIds) {
        await run(
          `INSERT INTO tblCourseReviewSentence (course_id, lesson_id, sentence_id) VALUES (?, ?, ?)`,
          [courseId, id, sentenceId]
        );
      }
    }

    const updated = await get(`SELECT * FROM course_lessons WHERE id = ?`, [id]);
    updated.content = content;
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/lessons/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await get(`SELECT id FROM course_lessons WHERE id = ?`, [id]);
    if (!existing) {
      return res.status(404).json({ error: `Lesson '${id}' not found` });
    }
    await run(`DELETE FROM course_lessons WHERE id = ?`, [id]);
    res.json({ success: true, message: `Lesson '${id}' deleted` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ==========================================
// Spaced Repetition Review & Streak APIs
// ==========================================

// Helper function to update daily streak stats
async function updateStreak(userId, sessionType, itemsCompleted) {
  const formatToday = () => {
    const d = new Date();
    // Adjust to +7 timezone (Bangkok/Jakarta/Indochina Time)
    const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
    const localD = new Date(utc + (3600000 * 7));
    const year = localD.getFullYear();
    const month = String(localD.getMonth() + 1).padStart(2, '0');
    const day = String(localD.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  const bkkToday = formatToday();

  // Get current stats
  let stats = await get(`SELECT * FROM user_streak_stats WHERE user_id = ? AND session_type = ?`, [userId, sessionType]);
  if (!stats) {
    const target = sessionType === 'high_freq_speed' ? 15 : 10;
    await run(
      `INSERT INTO user_streak_stats (user_id, session_type, current_streak_days, max_streak_days, last_streak_date, session_target_count, completed_streaks_today, current_session_completed, last_active_date)
       VALUES (?, ?, 0, 0, NULL, ?, 0, 0, NULL)`,
      [userId, sessionType, target]
    );
    stats = await get(`SELECT * FROM user_streak_stats WHERE user_id = ? AND session_type = ?`, [userId, sessionType]);
  }

  let {
    current_streak_days,
    max_streak_days,
    last_streak_date,
    session_target_count,
    completed_streaks_today,
    current_session_completed,
    last_active_date
  } = stats;

  // New day reset
  if (last_active_date !== bkkToday) {
    completed_streaks_today = 0;
    current_session_completed = 0;
    last_active_date = bkkToday;
  }

  // Increment progress
  current_session_completed += itemsCompleted;

  let sessionCompleted = false;
  if (current_session_completed >= session_target_count) {
    sessionCompleted = true;
    completed_streaks_today += 1;
    current_session_completed = 0; // Reset for next session

    // Calculate yesterday in +7 timezone
    const getYesterday = () => {
      const d = new Date();
      const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
      const localD = new Date(utc + (3600000 * 7) - (24 * 60 * 60 * 1000));
      const year = localD.getFullYear();
      const month = String(localD.getMonth() + 1).padStart(2, '0');
      const day = String(localD.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    const bkkYesterday = getYesterday();

    if (last_streak_date !== bkkToday) {
      if (last_streak_date === bkkYesterday) {
        current_streak_days += 1;
      } else {
        current_streak_days = 1;
      }
      max_streak_days = Math.max(max_streak_days, current_streak_days);
      last_streak_date = bkkToday;
    }
  }

  await run(
    `UPDATE user_streak_stats
     SET current_streak_days = ?, max_streak_days = ?, last_streak_date = ?, completed_streaks_today = ?, current_session_completed = ?, last_active_date = ?
     WHERE user_id = ? AND session_type = ?`,
    [current_streak_days, max_streak_days, last_streak_date, completed_streaks_today, current_session_completed, last_active_date, userId, sessionType]
  );

  return {
    completedStreaksToday: completed_streaks_today,
    currentStreakDays: current_streak_days,
    maxStreakDays: max_streak_days,
    sessionCompleted,
    sessionProgress: `${current_session_completed}/${session_target_count}`
  };
}

// 1. GET /api/reviews/due - Retrieve due items for a user
app.get('/api/reviews/due', async (req, res) => {
  const { userId, itemType, limit = 20 } = req.query;
  if (!userId) {
    return res.status(400).json({ error: "Missing userId parameter" });
  }

  try {
    let sql = `
      SELECT ur.*, 
             CASE 
               WHEN ur.item_type = 'vocab' THEN v.data_json
               WHEN ur.item_type = 'grammar' THEN g.data_json
             END as detail_json
      FROM user_reviews ur
      LEFT JOIN vocabulary v ON ur.item_id = v.id AND ur.item_type = 'vocab'
      LEFT JOIN grammar_notes g ON ur.item_id = g.id AND ur.item_type = 'grammar'
      WHERE ur.user_id = ? AND ur.next_review_at <= datetime('now', 'utc')
    `;
    const params = [userId];

    if (itemType) {
      sql += ` AND ur.item_type = ?`;
      params.push(itemType);
    }

    sql += ` ORDER BY ur.next_review_at ASC LIMIT ?`;
    params.push(parseInt(limit));

    const rows = await all(sql, params);
    
    // Parse detail_json back to JS object
    const result = rows.map(row => {
      let details = null;
      try {
        if (row.detail_json) details = JSON.parse(row.detail_json);
      } catch (e) {
        console.error("Error parsing detail_json:", e);
      }
      return {
        id: row.id,
        itemId: row.item_id,
        itemType: row.item_type,
        schedulerType: row.scheduler_type,
        intervalMinutes: row.interval_minutes,
        repetitions: row.repetitions,
        nextReviewAt: row.next_review_at,
        details: details
      };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. GET /api/reviews/streak - Fetch current streak progress
app.get('/api/reviews/streak', async (req, res) => {
  const { userId, sessionType } = req.query;
  if (!userId || !sessionType) {
    return res.status(400).json({ error: "Missing userId or sessionType parameter" });
  }
  try {
    let stats = await get(`SELECT * FROM user_streak_stats WHERE user_id = ? AND session_type = ?`, [userId, sessionType]);
    if (!stats) {
      const target = sessionType === 'high_freq_speed' ? 15 : 10;
      stats = {
        completed_streaks_today: 0,
        current_streak_days: 0,
        max_streak_days: 0,
        current_session_completed: 0,
        session_target_count: target
      };
    }
    res.json({
      completedStreaksToday: stats.completed_streaks_today,
      currentStreakDays: stats.current_streak_days,
      maxStreakDays: stats.max_streak_days,
      sessionProgress: `${stats.current_session_completed}/${stats.session_target_count}`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. POST /api/reviews/session/start - Start high-frequency session
app.post('/api/reviews/session/start', async (req, res) => {
  const { userId, type } = req.body;
  if (!userId || type !== 'high_freq') {
    return res.status(400).json({ error: "Invalid parameters. Support type='high_freq'" });
  }

  try {
    const manager = new HighFreqSessionManager(userId);
    const firstCard = await manager.initializeSession();
    activeSessions.set(userId, manager);
    res.json({
      firstCard,
      sessionStarted: true,
      activeQueue: manager.activeQueue.map(q => ({
        id: q.item.id || q.item.item_id,
        word: q.item.word,
        meaning: q.item.meaning,
        type: q.type
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. POST /api/reviews/session/submit - Submit review log or session answer
app.post('/api/reviews/session/submit', async (req, res) => {
  const { userId, itemType, itemId, sessionType, attempts, singleAttempt } = req.body;
  if (!userId || !itemType || !itemId || !sessionType) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    // A. High-Frequency speed brush session
    if (sessionType === 'high_freq_speed') {
      const manager = activeSessions.get(userId);
      if (!manager) {
        return res.status(400).json({ error: "Active session not found. Please start a session first." });
      }

      if (!singleAttempt) {
        return res.status(400).json({ error: "Missing singleAttempt parameter for high_freq_speed" });
      }

      const nextCard = await manager.handleAnswer(singleAttempt.correct);
      const isCompleted = nextCard === null;

      let streakStats = null;
      if (isCompleted) {
        streakStats = await updateStreak(userId, sessionType, manager.sessionTarget);
        activeSessions.delete(userId);
      } else {
        streakStats = await updateStreak(userId, sessionType, 0);
      }

      return res.json({
        nextCard,
        sessionCompleted: isCompleted,
        streakStats
      });
    }

    // B. Lesson-based review (vocab/grammar) via SM-2
    if (sessionType === 'lesson_review') {
      if (!attempts || attempts.length === 0) {
        return res.status(400).json({ error: "Missing attempts parameter for lesson_review" });
      }

      // 1. Calculate q via WeightedScoreEngine
      const q = WeightedScoreEngine.calculateQualityRating(attempts);

      // 2. Query user_reviews state
      const reviewId = `${userId}_${itemType}_${itemId}`;
      let reviewState = await get(`SELECT * FROM user_reviews WHERE id = ?`, [reviewId]);
      if (!reviewState) {
        reviewState = { repetitions: 0, interval_minutes: 1440, ease_factor: 2.5 };
      }

      // 3. Run SM-2 Strategy
      const sm2 = new SM2Strategy();
      const newState = sm2.calculateNext(reviewState, q);

      // 4. Update Database
      if (reviewState.id) {
        await run(
          `UPDATE user_reviews
           SET repetitions = ?, interval_minutes = ?, next_review_at = ?, ease_factor = ?, last_reviewed_at = datetime('now', 'utc'), updated_at = datetime('now', 'utc')
           WHERE id = ?`,
          [newState.repetitions, newState.interval_minutes, newState.next_review_at, newState.ease_factor, reviewId]
        );
      } else {
        await run(
          `INSERT INTO user_reviews (id, user_id, item_type, item_id, scheduler_type, interval_minutes, repetitions, next_review_at, ease_factor, last_reviewed_at)
           VALUES (?, ?, ?, ?, 'sm2', ?, ?, ?, ?, datetime('now', 'utc'))`,
          [reviewId, userId, itemType, itemId, newState.interval_minutes, newState.repetitions, newState.next_review_at, newState.ease_factor]
        );
      }

      // 5. Audit log
      await run(
        `INSERT INTO user_review_logs (user_id, item_type, item_id, reviewed_at, rating, prev_interval, new_interval, prev_ease_factor, new_ease_factor)
         VALUES (?, ?, ?, datetime('now', 'utc'), ?, ?, ?, ?, ?)`,
        [userId, itemType, itemId, q, reviewState.interval_minutes || 0, newState.interval_minutes, reviewState.ease_factor || 2.5, newState.ease_factor]
      );

      // 6. Update Streak Progress (Lesson review counts as 1 item completed)
      const streakStats = await updateStreak(userId, sessionType, 1);

      return res.json({
        success: true,
        qualityRating: q,
        nextReviewAt: newState.next_review_at,
        streakStats
      });
    }

    res.status(400).json({ error: "Unsupported sessionType: " + sessionType });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. POST /api/reviews/algo-debug/log - Write algorithm debug log to SQLite
app.post('/api/reviews/algo-debug/log', async (req, res) => {
  const {
    sessionId,
    userId,
    totalWords,
    oldWordsCount,
    newWordsCount,
    totalAttempts,
    correctAttempts,
    accuracy,
    durationSeconds,
    queueLogJson
  } = req.body;

  if (!sessionId || !userId) {
    return res.status(400).json({ error: "Missing required fields: sessionId, userId" });
  }

  try {
    await run(
      `INSERT INTO tblAlgoDebugLog (
        session_id, user_id, total_words, old_words_count, new_words_count,
        total_attempts, correct_attempts, accuracy, duration_seconds, queue_log_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        userId,
        totalWords || 0,
        oldWordsCount || 0,
        newWordsCount || 0,
        totalAttempts || 0,
        correctAttempts || 0,
        accuracy || 0,
        durationSeconds || 0,
        queueLogJson || ''
      ]
    );
    res.json({ success: true, message: "Algorithm debug log written to SQLite successfully" });
  } catch (err) {
    console.error("Failed to write algorithm debug log to SQLite", err);
    res.status(500).json({ error: err.message });
  }
});

// 6. GET /api/high-frequency-words/stats - Fetch stats for algorithm debugging
app.get('/api/high-frequency-words/stats', async (req, res) => {
  const { userId } = req.query;
  const targetUser = userId || 'default_user';

  try {
    const totalWordsRow = await get(`SELECT COUNT(*) as count FROM high_frequency_words`);
    const remainingNewRow = await get(
      `SELECT COUNT(*) as count FROM high_frequency_words 
       WHERE id NOT IN (
         SELECT item_id FROM user_reviews WHERE user_id = ? AND item_type = 'high_freq'
       )`,
      [targetUser]
    );

    res.json({
      success: true,
      totalWords: totalWordsRow ? totalWordsRow.count : 0,
      remainingNewWords: remainingNewRow ? remainingNewRow.count : 0
    });
  } catch (err) {
    console.error("Failed to fetch high-frequency words stats", err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// High Frequency Words APIs
// ==========================================

// Helper function to format row
function formatHighFreqRow(row) {
  let options = [];
  try {
    options = JSON.parse(row.options_json);
  } catch (e) {
    options = [row.meaning, "选项 B", "选项 C", "选项 D"];
  }
  let examples = [];
  try {
    examples = row.examples_json ? JSON.parse(row.examples_json) : [];
  } catch (e) {
    examples = [];
  }
  return {
    id: row.id,
    word: row.word,
    ipa: row.ipa || "",
    meaning: row.meaning,
    options: options,
    examples: examples,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

// 1. GET /api/high-frequency-words - List all high-frequency words
app.get('/api/high-frequency-words', async (req, res) => {
  const { search } = req.query;
  let sql = `SELECT * FROM high_frequency_words WHERE 1=1`;
  const params = [];

  if (search) {
    sql += ` AND (word LIKE ? OR meaning LIKE ? OR ipa LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  sql += ` ORDER BY id ASC`;

  try {
    const rows = await all(sql, params);
    const result = rows.map(formatHighFreqRow);
    res.json(result);
  } catch (err) {
    console.error('Failed to query high-frequency words:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. GET /api/high-frequency-words/:id - Get a single high-frequency word by ID
app.get('/api/high-frequency-words/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const row = await get(`SELECT * FROM high_frequency_words WHERE id = ?`, [id]);
    if (!row) {
      return res.status(404).json({ error: `High frequency word with ID '${id}' not found` });
    }
    res.json(formatHighFreqRow(row));
  } catch (err) {
    console.error(`Failed to query high-frequency word ID '${id}':`, err);
    res.status(500).json({ error: err.message });
  }
});

// 3. POST /api/high-frequency-words - Add a new high-frequency word
app.post('/api/high-frequency-words', async (req, res) => {
  const body = req.body;
  const { id, word, ipa = "", meaning, options = [], examples = [] } = body;

  if (!id || !word || !meaning) {
    return res.status(400).json({
      error: "Missing required fields. Needs: id, word, meaning."
    });
  }

  // Ensure options has meaning as the first element if empty or invalid
  let optionsArray = options;
  if (!Array.isArray(optionsArray) || optionsArray.length === 0) {
    optionsArray = [meaning, "选项 B", "选项 C", "选项 D"];
  } else {
    optionsArray[0] = meaning;
  }

  try {
    const existing = await get(`SELECT id FROM high_frequency_words WHERE id = ?`, [id]);
    if (existing) {
      return res.status(400).json({ error: `High frequency word with ID '${id}' already exists` });
    }

    await run(
      `INSERT INTO high_frequency_words (id, word, ipa, meaning, options_json, examples_json) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, word, ipa, meaning, JSON.stringify(optionsArray), JSON.stringify(examples)]
    );

    const createdRow = await get(`SELECT * FROM high_frequency_words WHERE id = ?`, [id]);
    res.status(201).json(formatHighFreqRow(createdRow));
  } catch (err) {
    console.error('Failed to create high-frequency word:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. PUT /api/high-frequency-words/:id - Update an existing high-frequency word
app.put('/api/high-frequency-words/:id', async (req, res) => {
  const { id } = req.params;
  const body = req.body;
  const { word, ipa = "", meaning, options = [], examples = [] } = body;

  if (!word || !meaning) {
    return res.status(400).json({
      error: "Missing required fields. Needs: word, meaning."
    });
  }

  // Ensure options has meaning as the first element
  let optionsArray = options;
  if (!Array.isArray(optionsArray) || optionsArray.length === 0) {
    optionsArray = [meaning, "选项 B", "选项 C", "选项 D"];
  } else {
    optionsArray[0] = meaning;
  }

  try {
    const existing = await get(`SELECT id FROM high_frequency_words WHERE id = ?`, [id]);
    if (!existing) {
      return res.status(404).json({ error: `High frequency word with ID '${id}' not found` });
    }

    await run(
      `UPDATE high_frequency_words 
       SET word = ?, ipa = ?, meaning = ?, options_json = ?, examples_json = ?, updated_at = datetime('now', 'localtime') 
       WHERE id = ?`,
      [word, ipa, meaning, JSON.stringify(optionsArray), JSON.stringify(examples), id]
    );

    const updatedRow = await get(`SELECT * FROM high_frequency_words WHERE id = ?`, [id]);
    res.json(formatHighFreqRow(updatedRow));
  } catch (err) {
    console.error(`Failed to update high-frequency word '${id}':`, err);
    res.status(500).json({ error: err.message });
  }
});

// 5. DELETE /api/high-frequency-words/:id - Delete a high-frequency word
app.delete('/api/high-frequency-words/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await get(`SELECT id FROM high_frequency_words WHERE id = ?`, [id]);
    if (!existing) {
      return res.status(404).json({ error: `High frequency word with ID '${id}' not found` });
    }

    await run(`DELETE FROM high_frequency_words WHERE id = ?`, [id]);
    res.json({ success: true, message: `High frequency word '${id}' successfully deleted` });
  } catch (err) {
    console.error(`Failed to delete high-frequency word '${id}':`, err);
    res.status(500).json({ error: err.message });
  }
});

// 6. POST /api/high-frequency-words/import - Bulk import high-frequency words
app.post('/api/high-frequency-words/import', async (req, res) => {
  const { words } = req.body;
  if (!Array.isArray(words)) {
    return res.status(400).json({ error: "Invalid data. 'words' must be an array of objects." });
  }

  try {
    let importedList = [];
    let ignoredList = [];

    for (const w of words) {
      const { id, word, ipa = "", meaning, options = [], examples = [] } = w;
      if (!id || !word || !meaning) continue;

      let optionsArray = options;
      if (!Array.isArray(optionsArray) || optionsArray.length === 0) {
        optionsArray = [meaning, "选项 B", "选项 C", "选项 D"];
      } else {
        optionsArray[0] = meaning;
      }

      const existing = await get(`SELECT id, word, meaning FROM high_frequency_words WHERE id = ?`, [id]);
      if (existing) {
        ignoredList.push({ id, word, meaning });
      } else {
        await run(
          `INSERT INTO high_frequency_words (id, word, ipa, meaning, options_json, examples_json) VALUES (?, ?, ?, ?, ?, ?)`,
          [id, word, ipa, meaning, JSON.stringify(optionsArray), JSON.stringify(examples)]
        );
        importedList.push({ id, word, meaning });
      }
    }

    res.json({
      success: true,
      importedCount: importedList.length,
      ignoredCount: ignoredList.length,
      importedList,
      ignoredList
    });
  } catch (err) {
    console.error('Failed to import high-frequency words:', err);
    res.status(500).json({ error: err.message });
  }
});
// ==========================================
// Assignments CRUD APIs
// ==========================================
app.get('/api/assignments', async (req, res) => {
  try {
    const rows = await all(`SELECT uuid, title, date, created_at FROM tblAssignments ORDER BY date DESC, created_at DESC`);
    res.json(rows);
  } catch (err) {
    console.error('Failed to query assignments:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/assignments/:uuid', async (req, res) => {
  const { uuid } = req.params;
  try {
    const row = await get(`SELECT * FROM tblAssignments WHERE uuid = ?`, [uuid]);
    if (!row) {
      return res.status(404).json({ error: `Assignment with UUID '${uuid}' not found` });
    }
    try {
      row.assignment = JSON.parse(row.assignment_json);
    } catch (e) {
      row.assignment = { worksheet_number: "", exercises: [] };
    }
    res.json(row);
  } catch (err) {
    console.error('Failed to query assignment details:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/assignments', async (req, res) => {
  const { uuid, title, date, assignment } = req.body;
  if (!title || !date || !assignment) {
    return res.status(400).json({ error: 'Missing title, date or assignment content' });
  }
  const targetUuid = uuid || crypto.randomUUID();
  const assignmentJsonStr = typeof assignment === 'string' ? assignment : JSON.stringify(assignment);
  try {
    const existing = await get(`SELECT uuid FROM tblAssignments WHERE uuid = ?`, [targetUuid]);
    if (existing) {
      await run(
        `UPDATE tblAssignments SET title = ?, date = ?, assignment_json = ?, updated_at = datetime('now', 'localtime') WHERE uuid = ?`,
        [title, date, assignmentJsonStr, targetUuid]
      );
    } else {
      await run(
        `INSERT INTO tblAssignments (uuid, title, date, assignment_json) VALUES (?, ?, ?, ?)`,
        [targetUuid, title, date, assignmentJsonStr]
      );
    }
    res.json({ success: true, uuid: targetUuid });
  } catch (err) {
    console.error('Failed to save assignment:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/assignments/:uuid', async (req, res) => {
  const { uuid } = req.params;
  try {
    const existing = await get(`SELECT uuid FROM tblAssignments WHERE uuid = ?`, [uuid]);
    if (!existing) {
      return res.status(404).json({ error: `Assignment with UUID '${uuid}' not found` });
    }
    await run(`DELETE FROM tblAssignments WHERE uuid = ?`, [uuid]);
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to delete assignment:', err);
    res.status(500).json({ error: err.message });
  }
});


// ==========================================
// Reading Cache (Reading Coach) CRUD APIs
// ==========================================
app.get('/api/readings', async (req, res) => {
  const { search, subject, courseId, lessonId } = req.query;
  let sql = `SELECT DISTINCT r.uuid, r.title, r.subject, r.difficulty, r.word_count, r.created_at FROM tblReadingCache r`;
  const params = [];
  const joins = [];
  const whereClauses = [];

  if (courseId || lessonId) {
    joins.push(`JOIN tblCourseReading cr ON r.uuid = cr.reading_uuid`);
    if (courseId) {
      whereClauses.push(`cr.course_id = ?`);
      params.push(courseId);
    }
    if (lessonId) {
      whereClauses.push(`cr.lesson_id = ?`);
      params.push(lessonId);
    }
  }

  if (search) {
    whereClauses.push(`r.title LIKE ?`);
    params.push(`%${search}%`);
  }
  if (subject) {
    whereClauses.push(`r.subject = ?`);
    params.push(subject);
  }

  if (joins.length > 0) {
    sql += ` ` + joins.join(` `);
  }
  if (whereClauses.length > 0) {
    sql += ` WHERE ` + whereClauses.join(` AND `);
  }

  sql += ` ORDER BY r.created_at DESC`;

  try {
    const rows = await all(sql, params);
    const result = [];
    for (const row of rows) {
      const associations = await all(`SELECT course_id, lesson_id FROM tblCourseReading WHERE reading_uuid = ?`, [row.uuid]);
      result.push({
        uuid: row.uuid,
        title: row.title,
        subject: row.subject,
        difficulty: row.difficulty,
        word_count: row.word_count,
        created_at: row.created_at,
        courses: associations.map(a => ({ courseId: a.course_id, lessonId: a.lesson_id }))
      });
    }
    res.json(result);
  } catch (err) {
    console.error('Failed to query readings:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/readings/:uuid', async (req, res) => {
  const { uuid } = req.params;
  try {
    const row = await get(`SELECT * FROM tblReadingCache WHERE uuid = ?`, [uuid]);
    if (!row) {
      return res.status(404).json({ error: `Reading article with UUID '${uuid}' not found` });
    }
    // Parse content_json
    try {
      row.content = JSON.parse(row.content_json);
    } catch (e) {
      row.content = {};
    }
    const associations = await all(`SELECT course_id, lesson_id FROM tblCourseReading WHERE reading_uuid = ?`, [uuid]);
    row.courses = associations.map(a => ({ courseId: a.course_id, lessonId: a.lesson_id }));
    res.json(row);
  } catch (err) {
    console.error(`Failed to query reading UUID '${uuid}':`, err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/readings', async (req, res) => {
  const { uuid, title, subject, difficulty, word_count, content, courses } = req.body;
  if (!title || !content) {
    return res.status(400).json({ error: "Title and content are required" });
  }

  const finalUuid = uuid || 'read_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
  const contentJson = typeof content === 'string' ? content : JSON.stringify(content);

  try {
    await run(
      `INSERT INTO tblReadingCache (uuid, title, subject, difficulty, word_count, content_json) VALUES (?, ?, ?, ?, ?, ?)`,
      [finalUuid, title, subject || null, difficulty || 1.0, word_count || 0, contentJson]
    );

    if (courses && Array.isArray(courses)) {
      for (const assoc of courses) {
        const { courseId, lessonId } = assoc;
        if (courseId && lessonId) {
          await run(
            `INSERT INTO tblCourseReading (course_id, lesson_id, reading_uuid) VALUES (?, ?, ?)`,
            [courseId, lessonId, finalUuid]
          );
        }
      }
    }

    res.status(201).json({ uuid: finalUuid, success: true });
  } catch (err) {
    console.error('Failed to create reading:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/readings/:uuid', async (req, res) => {
  const { uuid } = req.params;
  const { title, subject, difficulty, word_count, content, courses } = req.body;

  if (!title || !content) {
    return res.status(400).json({ error: "Title and content are required" });
  }

  const contentJson = typeof content === 'string' ? content : JSON.stringify(content);

  try {
    const existing = await get(`SELECT uuid FROM tblReadingCache WHERE uuid = ?`, [uuid]);
    if (!existing) {
      return res.status(404).json({ error: `Reading article with UUID '${uuid}' not found` });
    }

    await run(
      `UPDATE tblReadingCache 
       SET title = ?, subject = ?, difficulty = ?, word_count = ?, content_json = ?
       WHERE uuid = ?`,
      [title, subject || null, difficulty || 1.0, word_count || 0, contentJson, uuid]
    );

    if (courses !== undefined && Array.isArray(courses)) {
      await run(`DELETE FROM tblCourseReading WHERE reading_uuid = ?`, [uuid]);
      for (const assoc of courses) {
        const { courseId, lessonId } = assoc;
        if (courseId && lessonId) {
          await run(
            `INSERT INTO tblCourseReading (course_id, lesson_id, reading_uuid) VALUES (?, ?, ?)`,
            [courseId, lessonId, uuid]
          );
        }
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error(`Failed to update reading UUID '${uuid}':`, err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/readings/:uuid', async (req, res) => {
  const { uuid } = req.params;
  try {
    const existing = await get(`SELECT uuid FROM tblReadingCache WHERE uuid = ?`, [uuid]);
    if (!existing) {
      return res.status(404).json({ error: `Reading article with UUID '${uuid}' not found` });
    }
    await run(`DELETE FROM tblReadingCache WHERE uuid = ?`, [uuid]);
    await run(`DELETE FROM tblCourseReading WHERE reading_uuid = ?`, [uuid]);
    res.json({ success: true });
  } catch (err) {
    console.error(`Failed to delete reading UUID '${uuid}':`, err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// COURSEWARE MANAGEMENT API
// ==========================================

app.get('/api/coursewares', async (req, res) => {
  const { search, courseId, lessonId } = req.query;
  let sql = `SELECT DISTINCT cw.uuid, cw.title, cw.tags, cw.coursewareURI, cw.studyGuide, cw.pageMarkdowns, cw.quizCheck, cw.created_at FROM tblCourseware cw`;
  const params = [];
  const joins = [];
  const whereClauses = [];

  if (courseId || lessonId) {
    joins.push(`JOIN tblCourseCourseware ccw ON cw.uuid = ccw.courseware_uuid`);
    if (courseId) {
      whereClauses.push(`ccw.course_id = ?`);
      params.push(courseId);
    }
    if (lessonId) {
      whereClauses.push(`ccw.lesson_id = ?`);
      params.push(lessonId);
    }
  }

  if (search) {
    whereClauses.push(`(cw.title LIKE ? OR cw.tags LIKE ?)`);
    params.push(`%${search}%`);
    params.push(`%${search}%`);
  }

  if (joins.length > 0) {
    sql += ` ` + joins.join(` `);
  }
  if (whereClauses.length > 0) {
    sql += ` WHERE ` + whereClauses.join(` AND `);
  }

  sql += ` ORDER BY cw.created_at DESC`;

  try {
    const rows = await all(sql, params);
    const result = [];
    for (const row of rows) {
      const associations = await all(`SELECT course_id, lesson_id FROM tblCourseCourseware WHERE courseware_uuid = ?`, [row.uuid]);
      
      let studyGuide = {};
      try {
        studyGuide = row.studyGuide ? JSON.parse(row.studyGuide) : {};
      } catch (e) {}
      
      let pageMarkdowns = {};
      try {
        pageMarkdowns = row.pageMarkdowns ? JSON.parse(row.pageMarkdowns) : {};
      } catch (e) {}
      
      let quizCheck = {};
      try {
        quizCheck = row.quizCheck ? JSON.parse(row.quizCheck) : {};
      } catch (e) {}

      result.push({
        uuid: row.uuid,
        title: row.title,
        tags: row.tags,
        coursewareURI: row.coursewareURI,
        studyGuide,
        pageMarkdowns,
        quizCheck,
        created_at: row.created_at,
        courses: associations.map(a => ({ courseId: a.course_id, lessonId: a.lesson_id }))
      });
    }
    res.json(result);
  } catch (err) {
    console.error('Failed to query coursewares:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET per-page AI notes for a courseware
app.get('/api/coursewares/:uuid/page-notes', async (req, res) => {
  const { uuid } = req.params;
  try {
    const rows = await all(`SELECT * FROM tblCoursewarePageNotes WHERE courseware_uuid = ? ORDER BY page_num ASC`, [uuid]);
    const pageNotes = rows.map(r => {
      let core_points = [];
      let vocabulary = [];
      let flashcards = [];
      let data_json = {};
      try { core_points = r.core_points_json ? JSON.parse(r.core_points_json) : []; } catch (e) {}
      try { vocabulary = r.vocabulary_json ? JSON.parse(r.vocabulary_json) : []; } catch (e) {}
      try { flashcards = r.flashcards_json ? JSON.parse(r.flashcards_json) : []; } catch (e) {}
      try { data_json = r.data_json ? JSON.parse(r.data_json) : {}; } catch (e) {}

      return {
        id: r.id,
        courseware_uuid: r.courseware_uuid,
        slide_number: r.page_num,
        page_num: r.page_num,
        title: {
          original: r.title_original || '',
          translation_cn: r.title_cn || ''
        },
        summary: r.summary || '',
        core_points,
        vocabulary,
        flashcards,
        data_json,
        updated_at: r.updated_at
      };
    });
    res.json(pageNotes);
  } catch (err) {
    console.error(`Failed to query page-notes for UUID '${uuid}':`, err);
    res.status(500).json({ error: err.message });
  }
});

// POST bulk import/save AI page notes for a courseware
app.post('/api/coursewares/:uuid/page-notes', async (req, res) => {
  const { uuid } = req.params;
  const { pageNotes, slides } = req.body;
  const list = pageNotes || slides || (Array.isArray(req.body) ? req.body : []);

  if (!Array.isArray(list)) {
    return res.status(400).json({ error: "pageNotes array is required" });
  }

  try {
    for (let idx = 0; idx < list.length; idx++) {
      const item = list[idx];
      const pageNum = parseInt(item.slide_number || item.page_num || (idx + 1), 10);
      if (isNaN(pageNum)) continue;

      let titleOrig = '';
      let titleCn = '';
      if (item.title) {
        if (typeof item.title === 'object') {
          titleOrig = item.title.original || '';
          titleCn = item.title.translation_cn || '';
        } else {
          titleOrig = String(item.title);
        }
      }

      const summary = item.summary || '';
      const corePointsStr = JSON.stringify(item.core_points || []);
      const vocabStr = JSON.stringify(item.vocabulary || []);
      const flashcardsStr = JSON.stringify(item.flashcards || []);
      const fullDataStr = JSON.stringify(item);
      const id = `cwpn_${uuid}_${pageNum}`;

      await run(
        `INSERT INTO tblCoursewarePageNotes
         (id, courseware_uuid, page_num, title_original, title_cn, summary, core_points_json, vocabulary_json, flashcards_json, data_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
         ON CONFLICT(courseware_uuid, page_num) DO UPDATE SET
           title_original = excluded.title_original,
           title_cn = excluded.title_cn,
           summary = excluded.summary,
           core_points_json = excluded.core_points_json,
           vocabulary_json = excluded.vocabulary_json,
           flashcards_json = excluded.flashcards_json,
           data_json = excluded.data_json,
           updated_at = datetime('now', 'localtime')`,
        [id, uuid, pageNum, titleOrig, titleCn, summary, corePointsStr, vocabStr, flashcardsStr, fullDataStr]
      );
    }

    res.json({ success: true, count: list.length });
  } catch (err) {
    console.error(`Failed to bulk save page-notes for UUID '${uuid}':`, err);
    res.status(500).json({ error: err.message });
  }
});

// PUT update single page AI note
app.put('/api/coursewares/:uuid/page-notes/:pageNum', async (req, res) => {
  const { uuid, pageNum } = req.params;
  const item = req.body;
  const pageInt = parseInt(pageNum, 10);

  if (isNaN(pageInt)) {
    return res.status(400).json({ error: "Invalid pageNum" });
  }

  let titleOrig = '';
  let titleCn = '';
  if (item.title) {
    if (typeof item.title === 'object') {
      titleOrig = item.title.original || '';
      titleCn = item.title.translation_cn || '';
    } else {
      titleOrig = String(item.title);
    }
  }

  const summary = item.summary || '';
  const corePointsStr = JSON.stringify(item.core_points || []);
  const vocabStr = JSON.stringify(item.vocabulary || []);
  const flashcardsStr = JSON.stringify(item.flashcards || []);
  const fullDataStr = JSON.stringify(item);
  const id = `cwpn_${uuid}_${pageInt}`;

  try {
    await run(
      `INSERT INTO tblCoursewarePageNotes
       (id, courseware_uuid, page_num, title_original, title_cn, summary, core_points_json, vocabulary_json, flashcards_json, data_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
       ON CONFLICT(courseware_uuid, page_num) DO UPDATE SET
         title_original = excluded.title_original,
         title_cn = excluded.title_cn,
         summary = excluded.summary,
         core_points_json = excluded.core_points_json,
         vocabulary_json = excluded.vocabulary_json,
         flashcards_json = excluded.flashcards_json,
         data_json = excluded.data_json,
         updated_at = datetime('now', 'localtime')`,
      [id, uuid, pageInt, titleOrig, titleCn, summary, corePointsStr, vocabStr, flashcardsStr, fullDataStr]
    );

    res.json({ success: true, page_num: pageInt });
  } catch (err) {
    console.error(`Failed to update page-note P${pageInt} for UUID '${uuid}':`, err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/coursewares/:uuid', async (req, res) => {
  const { uuid } = req.params;
  try {
    const row = await get(`SELECT * FROM tblCourseware WHERE uuid = ?`, [uuid]);
    if (!row) {
      return res.status(404).json({ error: `Courseware with UUID '${uuid}' not found` });
    }
    
    // Parse JSON fields
    try {
      row.studyGuide = row.studyGuide ? JSON.parse(row.studyGuide) : {};
    } catch (e) {
      row.studyGuide = {};
    }
    try {
      row.pageMarkdowns = row.pageMarkdowns ? JSON.parse(row.pageMarkdowns) : {};
    } catch (e) {
      row.pageMarkdowns = {};
    }
    try {
      row.quizCheck = row.quizCheck ? JSON.parse(row.quizCheck) : {};
    } catch (e) {
      row.quizCheck = {};
    }

    const associations = await all(`SELECT course_id, lesson_id FROM tblCourseCourseware WHERE courseware_uuid = ?`, [uuid]);
    row.courses = associations.map(a => ({ courseId: a.course_id, lessonId: a.lesson_id }));

    // Query per-page AI notes from tblCoursewarePageNotes
    try {
      const pageNoteRows = await all(`SELECT * FROM tblCoursewarePageNotes WHERE courseware_uuid = ? ORDER BY page_num ASC`, [uuid]);
      if (pageNoteRows && pageNoteRows.length > 0) {
        row.pageNotes = pageNoteRows.map(r => {
          let core_points = [];
          let vocabulary = [];
          let flashcards = [];
          let data_json = {};
          try { core_points = r.core_points_json ? JSON.parse(r.core_points_json) : []; } catch (e) {}
          try { vocabulary = r.vocabulary_json ? JSON.parse(r.vocabulary_json) : []; } catch (e) {}
          try { flashcards = r.flashcards_json ? JSON.parse(r.flashcards_json) : []; } catch (e) {}
          try { data_json = r.data_json ? JSON.parse(r.data_json) : {}; } catch (e) {}

          return {
            id: r.id,
            courseware_uuid: r.courseware_uuid,
            slide_number: r.page_num,
            page_num: r.page_num,
            title: {
              original: r.title_original || '',
              translation_cn: r.title_cn || ''
            },
            summary: r.summary || '',
            core_points,
            vocabulary,
            flashcards,
            data_json,
            updated_at: r.updated_at
          };
        });
        row.slideNotes = row.pageNotes;
      }
    } catch (pnErr) {
      console.error(`Failed to fetch pageNotes for UUID '${uuid}':`, pnErr);
    }

    res.json(row);
  } catch (err) {
    console.error(`Failed to query courseware UUID '${uuid}':`, err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/upload-pdf', async (req, res) => {
  const { fileName, base64Data } = req.body;
  if (!fileName || !base64Data) {
    return res.status(400).json({ error: "Missing fileName or base64Data" });
  }

  try {
    const buffer = Buffer.from(base64Data, 'base64');
    const destDir = path.join(parentDir, 'Pages', 'coursewares');
    
    // Ensure directory exists
    await fs.mkdir(destDir, { recursive: true });
    
    const destPath = path.join(destDir, fileName);
    await fs.writeFile(destPath, buffer);
    
    const relativeURI = `coursewares/${fileName}`;
    res.json({ success: true, uri: relativeURI });
  } catch (err) {
    console.error("PDF upload error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/coursewares', async (req, res) => {
  const { uuid, title, tags, coursewareURI, studyGuide, pageMarkdowns, quizCheck, courses } = req.body;
  if (!title) {
    return res.status(400).json({ error: "Title is required" });
  }

  const finalUuid = uuid || 'cw_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
  
  const studyGuideStr = typeof studyGuide === 'string' ? studyGuide : JSON.stringify(studyGuide || {});
  const pageMarkdownsStr = typeof pageMarkdowns === 'string' ? pageMarkdowns : JSON.stringify(pageMarkdowns || {});
  const quizCheckStr = typeof quizCheck === 'string' ? quizCheck : JSON.stringify(quizCheck || {});

  try {
    await run(
      `INSERT INTO tblCourseware (uuid, title, tags, coursewareURI, studyGuide, pageMarkdowns, quizCheck) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [finalUuid, title, tags || null, coursewareURI || null, studyGuideStr, pageMarkdownsStr, quizCheckStr]
    );

    if (courses && Array.isArray(courses)) {
      for (const assoc of courses) {
        const { courseId, lessonId } = assoc;
        if (courseId && lessonId) {
          await run(
            `INSERT INTO tblCourseCourseware (course_id, lesson_id, courseware_uuid) VALUES (?, ?, ?)`,
            [courseId, lessonId, finalUuid]
          );
        }
      }
    }

    res.status(201).json({ uuid: finalUuid, success: true });
  } catch (err) {
    console.error('Failed to create courseware:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/coursewares/:uuid', async (req, res) => {
  const { uuid } = req.params;
  const { title, tags, coursewareURI, studyGuide, pageMarkdowns, quizCheck, courses } = req.body;

  if (!title) {
    return res.status(400).json({ error: "Title is required" });
  }

  const studyGuideStr = typeof studyGuide === 'string' ? studyGuide : JSON.stringify(studyGuide || {});
  const pageMarkdownsStr = typeof pageMarkdowns === 'string' ? pageMarkdowns : JSON.stringify(pageMarkdowns || {});
  const quizCheckStr = typeof quizCheck === 'string' ? quizCheck : JSON.stringify(quizCheck || {});

  try {
    const existing = await get(`SELECT uuid FROM tblCourseware WHERE uuid = ?`, [uuid]);
    if (!existing) {
      return res.status(404).json({ error: `Courseware with UUID '${uuid}' not found` });
    }

    await run(
      `UPDATE tblCourseware 
       SET title = ?, tags = ?, coursewareURI = ?, studyGuide = ?, pageMarkdowns = ?, quizCheck = ?
       WHERE uuid = ?`,
      [title, tags || null, coursewareURI || null, studyGuideStr, pageMarkdownsStr, quizCheckStr, uuid]
    );

    if (courses !== undefined && Array.isArray(courses)) {
      await run(`DELETE FROM tblCourseCourseware WHERE courseware_uuid = ?`, [uuid]);
      for (const assoc of courses) {
        const { courseId, lessonId } = assoc;
        if (courseId && lessonId) {
          await run(
            `INSERT INTO tblCourseCourseware (course_id, lesson_id, courseware_uuid) VALUES (?, ?, ?)`,
            [courseId, lessonId, uuid]
          );
        }
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error(`Failed to update courseware UUID '${uuid}':`, err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/coursewares/:uuid', async (req, res) => {
  const { uuid } = req.params;
  try {
    const existing = await get(`SELECT uuid FROM tblCourseware WHERE uuid = ?`, [uuid]);
    if (!existing) {
      return res.status(404).json({ error: `Courseware with UUID '${uuid}' not found` });
    }
    await run(`DELETE FROM tblCourseware WHERE uuid = ?`, [uuid]);
    await run(`DELETE FROM tblCourseCourseware WHERE courseware_uuid = ?`, [uuid]);
    res.json({ success: true });
  } catch (err) {
    console.error(`Failed to delete courseware UUID '${uuid}':`, err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/user_reviews - Retrieve all review states for a specific user
app.get('/api/user_reviews', async (req, res) => {
  const { userId } = req.query;
  if (!userId) {
    return res.status(400).json({ error: "Missing userId parameter" });
  }
  try {
    const rows = await all('SELECT * FROM user_reviews WHERE user_id = ?', [userId]);
    // Map database columns to client camelCase format
    const result = rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      itemId: row.item_id,
      itemType: row.item_type,
      schedulerType: row.scheduler_type,
      interval: Math.round((row.interval_minutes || 1440) / 1440), // minutes to days
      repetitions: row.repetitions,
      nextReview: row.next_review_at,
      easeFactor: row.ease_factor
    }));
    res.json(result);
  } catch (err) {
    console.error(`Failed to retrieve reviews for user '${userId}':`, err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/user_reviews - Upsert user review state
app.post('/api/user_reviews', async (req, res) => {
  const { userId, itemType, itemId, schedulerType, interval, repetitions, nextReview, easeFactor } = req.body;
  if (!userId || !itemType || !itemId) {
    return res.status(400).json({ error: "Missing required parameters" });
  }
  try {
    const reviewId = `${userId}_${itemType}_${itemId}`;
    const intervalMinutes = (interval || 1) * 1440;
    const existing = await get('SELECT id FROM user_reviews WHERE id = ?', [reviewId]);
    if (existing) {
      await run(
        `UPDATE user_reviews 
         SET scheduler_type = ?, interval_minutes = ?, repetitions = ?, next_review_at = ?, ease_factor = ?, last_reviewed_at = datetime('now', 'utc'), updated_at = datetime('now', 'utc') 
         WHERE id = ?`,
         [schedulerType || 'spaced-repetition', intervalMinutes, repetitions || 0, nextReview, easeFactor || 2.5, reviewId]
      );
    } else {
      await run(
        `INSERT INTO user_reviews (id, user_id, item_type, item_id, scheduler_type, interval_minutes, repetitions, next_review_at, ease_factor, last_reviewed_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'utc'))`,
        [reviewId, userId, itemType, itemId, schedulerType || 'spaced-repetition', intervalMinutes, repetitions || 0, nextReview, easeFactor || 2.5]
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error(`Failed to upsert review for user '${userId}', item '${itemId}':`, err);
    res.status(500).json({ error: err.message });
  }
});


// ==========================================
// Course Notes APIs (tblNotes & tblCourseNot)
// ==========================================

// 1. GET /api/notes - Retrieve all notes (with optional filtering and course associations)
app.get('/api/notes', async (req, res) => {
  const { courseId, lessonId, tag, search } = req.query;
  let sql = `SELECT DISTINCT n.* FROM tblNotes n`;
  const params = [];
  const joins = [];
  const whereClauses = [];

  if (courseId || lessonId) {
    joins.push(`JOIN tblCourseNot cn ON n.uuid = cn.note_uuid`);
    if (courseId) {
      whereClauses.push(`cn.course_id = ?`);
      params.push(courseId);
    }
    if (lessonId) {
      whereClauses.push(`cn.lesson_id = ?`);
      params.push(lessonId);
    }
  }

  if (tag) {
    whereClauses.push(`(n.tags LIKE ? OR n.tags LIKE ? OR n.tags LIKE ? OR n.tags = ?)`);
    params.push(`${tag},%`, `%,${tag},%`, `%,${tag}`, tag);
  }

  if (search) {
    whereClauses.push(`(n.topic LIKE ? OR n.noteContent LIKE ?)`);
    params.push(`%${search}%`, `%${search}%`);
  }

  if (joins.length > 0) {
    sql += ` ` + joins.join(` `);
  }
  if (whereClauses.length > 0) {
    sql += ` WHERE ` + whereClauses.join(` AND `);
  }

  sql += ` ORDER BY n.created_at DESC`;

  try {
    const rows = await all(sql, params);
    const result = [];
    for (const row of rows) {
      const associations = await all(`SELECT course_id, lesson_id FROM tblCourseNot WHERE note_uuid = ?`, [row.uuid]);
      result.push({
        uuid: row.uuid,
        topic: row.topic,
        tags: row.tags ? row.tags.split(',') : [],
        created_at: row.created_at,
        noteContent: JSON.parse(row.noteContent),
        courses: associations.map(a => ({ courseId: a.course_id, lessonId: a.lesson_id }))
      });
    }
    res.json(result);
  } catch (err) {
    console.error('Failed to get notes:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. GET /api/notes/:uuid - Retrieve a single note by UUID
app.get('/api/notes/:uuid', async (req, res) => {
  const { uuid } = req.params;
  try {
    const row = await get(`SELECT * FROM tblNotes WHERE uuid = ?`, [uuid]);
    if (!row) {
      return res.status(404).json({ error: `Note with UUID ${uuid} not found` });
    }
    const associations = await all(`SELECT course_id, lesson_id FROM tblCourseNot WHERE note_uuid = ?`, [uuid]);
    res.json({
      uuid: row.uuid,
      topic: row.topic,
      tags: row.tags ? row.tags.split(',') : [],
      created_at: row.created_at,
      noteContent: JSON.parse(row.noteContent),
      courses: associations.map(a => ({ courseId: a.course_id, lessonId: a.lesson_id }))
    });
  } catch (err) {
    console.error(`Failed to get note ${uuid}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// 3. POST /api/notes - Create a new note
app.post('/api/notes', async (req, res) => {
  const { uuid, topic, tags, noteContent, courses } = req.body;
  if (!noteContent) {
    return res.status(400).json({ error: "Missing required field: noteContent" });
  }

  const noteUuid = uuid || crypto.randomUUID();
  const noteTopic = topic || (typeof noteContent === 'object' ? noteContent.topic : '') || '';
  const noteTagsStr = Array.isArray(tags) ? tags.join(',') : (tags || '');
  const contentStr = typeof noteContent === 'object' ? JSON.stringify(noteContent) : noteContent;

  try {
    await run(
      `INSERT INTO tblNotes (uuid, topic, tags, noteContent) VALUES (?, ?, ?, ?)`,
      [noteUuid, noteTopic, noteTagsStr, contentStr]
    );

    if (courses && Array.isArray(courses)) {
      for (const assoc of courses) {
        const { courseId, lessonId } = assoc;
        if (courseId && lessonId) {
          await run(
            `INSERT INTO tblCourseNot (course_id, lesson_id, note_uuid) VALUES (?, ?, ?)`,
            [courseId, lessonId, noteUuid]
          );
        }
      }
    }

    const row = await get(`SELECT * FROM tblNotes WHERE uuid = ?`, [noteUuid]);
    const associations = await all(`SELECT course_id, lesson_id FROM tblCourseNot WHERE note_uuid = ?`, [noteUuid]);
    res.status(201).json({
      uuid: row.uuid,
      topic: row.topic,
      tags: row.tags ? row.tags.split(',') : [],
      created_at: row.created_at,
      noteContent: JSON.parse(row.noteContent),
      courses: associations.map(a => ({ courseId: a.course_id, lessonId: a.lesson_id }))
    });
  } catch (err) {
    console.error('Failed to create note:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. PUT /api/notes/:uuid - Update an existing note
app.put('/api/notes/:uuid', async (req, res) => {
  const { uuid } = req.params;
  const { topic, tags, noteContent, courses } = req.body;

  try {
    const existing = await get(`SELECT uuid FROM tblNotes WHERE uuid = ?`, [uuid]);
    if (!existing) {
      return res.status(404).json({ error: `Note with UUID ${uuid} not found` });
    }

    const noteTopic = topic !== undefined ? topic : (noteContent && typeof noteContent === 'object' ? noteContent.topic : undefined);
    const noteTagsStr = Array.isArray(tags) ? tags.join(',') : tags;
    const contentStr = noteContent !== undefined ? (typeof noteContent === 'object' ? JSON.stringify(noteContent) : noteContent) : undefined;

    const fields = [];
    const params = [];
    if (noteTopic !== undefined) {
      fields.push(`topic = ?`);
      params.push(noteTopic);
    }
    if (noteTagsStr !== undefined) {
      fields.push(`tags = ?`);
      params.push(noteTagsStr);
    }
    if (contentStr !== undefined) {
      fields.push(`noteContent = ?`);
      params.push(contentStr);
    }

    if (fields.length > 0) {
      params.push(uuid);
      await run(`UPDATE tblNotes SET ${fields.join(', ')} WHERE uuid = ?`, params);
    }

    if (courses !== undefined && Array.isArray(courses)) {
      await run(`DELETE FROM tblCourseNot WHERE note_uuid = ?`, [uuid]);
      for (const assoc of courses) {
        const { courseId, lessonId } = assoc;
        if (courseId && lessonId) {
          await run(
            `INSERT INTO tblCourseNot (course_id, lesson_id, note_uuid) VALUES (?, ?, ?)`,
            [courseId, lessonId, uuid]
          );
        }
      }
    }

    const row = await get(`SELECT * FROM tblNotes WHERE uuid = ?`, [uuid]);
    const associations = await all(`SELECT course_id, lesson_id FROM tblCourseNot WHERE note_uuid = ?`, [uuid]);
    res.json({
      uuid: row.uuid,
      topic: row.topic,
      tags: row.tags ? row.tags.split(',') : [],
      created_at: row.created_at,
      noteContent: JSON.parse(row.noteContent),
      courses: associations.map(a => ({ courseId: a.course_id, lessonId: a.lesson_id }))
    });
  } catch (err) {
    console.error(`Failed to update note ${uuid}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// 5. DELETE /api/notes/:uuid - Delete a note by UUID
app.delete('/api/notes/:uuid', async (req, res) => {
  const { uuid } = req.params;
  try {
    const existing = await get(`SELECT uuid FROM tblNotes WHERE uuid = ?`, [uuid]);
    if (!existing) {
      return res.status(404).json({ error: `Note with UUID ${uuid} not found` });
    }
    await run(`DELETE FROM tblNotes WHERE uuid = ?`, [uuid]);
    await run(`DELETE FROM tblCourseNot WHERE note_uuid = ?`, [uuid]);
    res.json({ success: true, message: `Note with UUID ${uuid} and its associations deleted successfully.` });
  } catch (err) {
    console.error(`Failed to delete note ${uuid}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// 6. GET /api/course_notes - Get all course-note associations
app.get('/api/course_notes', async (req, res) => {
  const { courseId, lessonId, noteUuid } = req.query;
  let sql = `SELECT * FROM tblCourseNot WHERE 1=1`;
  const params = [];
  if (courseId) {
    sql += ` AND course_id = ?`;
    params.push(courseId);
  }
  if (lessonId) {
    sql += ` AND lesson_id = ?`;
    params.push(lessonId);
  }
  if (noteUuid) {
    sql += ` AND note_uuid = ?`;
    params.push(noteUuid);
  }
  try {
    const rows = await all(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Failed to get course notes:', err);
    res.status(500).json({ error: err.message });
  }
});

// 7. POST /api/course_notes - Associate a note with a course/lesson
app.post('/api/course_notes', async (req, res) => {
  const { courseId, lessonId, noteUuid } = req.body;
  if (!courseId || !lessonId || !noteUuid) {
    return res.status(400).json({ error: "Missing required fields: courseId, lessonId, noteUuid" });
  }
  try {
    const existing = await get(
      `SELECT id FROM tblCourseNot WHERE course_id = ? AND lesson_id = ? AND note_uuid = ?`,
      [courseId, lessonId, noteUuid]
    );
    if (existing) {
      return res.status(200).json({ success: true, message: "Association already exists", id: existing.id });
    }
    const result = await run(
      `INSERT INTO tblCourseNot (course_id, lesson_id, note_uuid) VALUES (?, ?, ?)`,
      [courseId, lessonId, noteUuid]
    );
    res.status(201).json({ success: true, id: result.lastID });
  } catch (err) {
    console.error('Failed to create association:', err);
    res.status(500).json({ error: err.message });
  }
});

// 8. DELETE /api/course_notes - Remove association
app.delete('/api/course_notes', async (req, res) => {
  const { courseId, lessonId, noteUuid } = { ...req.query, ...req.body };
  if (!courseId || !lessonId || !noteUuid) {
    return res.status(400).json({ error: "Missing required parameters: courseId, lessonId, noteUuid" });
  }
  try {
    await run(
      `DELETE FROM tblCourseNot WHERE course_id = ? AND lesson_id = ? AND note_uuid = ?`,
      [courseId, lessonId, noteUuid]
    );
    res.json({ success: true, message: "Association deleted successfully." });
  } catch (err) {
    console.error('Failed to delete association:', err);
    res.status(500).json({ error: err.message });
  }
});


// ==========================================
// Daily Anki Errors APIs (tblDailyAnkiError)
// ==========================================

// 1. GET /api/anki_errors - Retrieve all daily anki errors (with optional date filtering)
app.get('/api/anki_errors', async (req, res) => {
  const { date } = req.query;
  let sql = `SELECT * FROM tblDailyAnkiError`;
  const params = [];
  if (date) {
    sql += ` WHERE date = ?`;
    params.push(date);
  }
  sql += ` ORDER BY date DESC, created_at DESC`;
  try {
    const rows = await all(sql, params);
    const result = rows.map(row => {
      try {
        return {
          uuid: row.uuid,
          date: row.date,
          errorWords: JSON.parse(row.errorWords),
          created_at: row.created_at
        };
      } catch (err) {
        console.error(`Failed to parse errorWords for UUID ${row.uuid}:`, err);
        return {
          uuid: row.uuid,
          date: row.date,
          errorWords: [],
          created_at: row.created_at
        };
      }
    });
    res.json(result);
  } catch (err) {
    console.error('Failed to get daily anki errors:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. GET /api/anki_errors/:uuid - Retrieve single record by UUID
app.get('/api/anki_errors/:uuid', async (req, res) => {
  const { uuid } = req.params;
  try {
    const row = await get(`SELECT * FROM tblDailyAnkiError WHERE uuid = ?`, [uuid]);
    if (!row) {
      return res.status(404).json({ error: `Anki error report with UUID ${uuid} not found` });
    }
    res.json({
      uuid: row.uuid,
      date: row.date,
      errorWords: JSON.parse(row.errorWords),
      created_at: row.created_at
    });
  } catch (err) {
    console.error(`Failed to get anki error report ${uuid}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// 3. POST /api/anki_errors - Create daily anki error report
app.post('/api/anki_errors', async (req, res) => {
  const { uuid, date, errorWords } = req.body;
  if (!date || !errorWords) {
    return res.status(400).json({ error: "Missing required fields: date, errorWords" });
  }
  const reportUuid = uuid || crypto.randomUUID();
  const wordsStr = typeof errorWords === 'object' ? JSON.stringify(errorWords) : errorWords;
  try {
    await run(
      `INSERT INTO tblDailyAnkiError (uuid, date, errorWords) VALUES (?, ?, ?)`,
      [reportUuid, date, wordsStr]
    );
    const row = await get(`SELECT * FROM tblDailyAnkiError WHERE uuid = ?`, [reportUuid]);
    res.status(201).json({
      uuid: row.uuid,
      date: row.date,
      errorWords: JSON.parse(row.errorWords),
      created_at: row.created_at
    });
  } catch (err) {
    console.error('Failed to create daily anki error report:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. PUT /api/anki_errors/:uuid - Update daily anki error report
app.put('/api/anki_errors/:uuid', async (req, res) => {
  const { uuid } = req.params;
  const { date, errorWords } = req.body;
  try {
    const existing = await get(`SELECT uuid FROM tblDailyAnkiError WHERE uuid = ?`, [uuid]);
    if (!existing) {
      return res.status(404).json({ error: `Anki error report with UUID ${uuid} not found` });
    }
    const fields = [];
    const params = [];
    if (date !== undefined) {
      fields.push(`date = ?`);
      params.push(date);
    }
    if (errorWords !== undefined) {
      const wordsStr = typeof errorWords === 'object' ? JSON.stringify(errorWords) : errorWords;
      fields.push(`errorWords = ?`);
      params.push(wordsStr);
    }
    if (fields.length > 0) {
      params.push(uuid);
      await run(`UPDATE tblDailyAnkiError SET ${fields.join(', ')} WHERE uuid = ?`, params);
    }
    const row = await get(`SELECT * FROM tblDailyAnkiError WHERE uuid = ?`, [uuid]);
    res.json({
      uuid: row.uuid,
      date: row.date,
      errorWords: JSON.parse(row.errorWords),
      created_at: row.created_at
    });
  } catch (err) {
    console.error(`Failed to update anki error report ${uuid}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// 5. DELETE /api/anki_errors/:uuid - Delete daily anki error report
app.delete('/api/anki_errors/:uuid', async (req, res) => {
  const { uuid } = req.params;
  try {
    const existing = await get(`SELECT uuid FROM tblDailyAnkiError WHERE uuid = ?`, [uuid]);
    if (!existing) {
      return res.status(404).json({ error: `Anki error report with UUID ${uuid} not found` });
    }
    await run(`DELETE FROM tblDailyAnkiError WHERE uuid = ?`, [uuid]);
    res.json({ success: true, message: `Anki error report with UUID ${uuid} deleted successfully.` });
  } catch (err) {
    console.error(`Failed to delete anki error report ${uuid}:`, err);
    res.status(500).json({ error: err.message });
  }
});


// ==========================================
// Word Sets APIs (tblWordset)
// ==========================================

// 1. GET /api/wordsets - Retrieve all wordsets (with optional tag and search filtering)
app.get('/api/wordsets', async (req, res) => {
  const { tag, search } = req.query;
  let sql = `SELECT * FROM tblWordset`;
  const params = [];
  const conditions = [];

  if (tag) {
    conditions.push(`tags LIKE ?`);
    params.push(`%${tag}%`);
  }
  if (search) {
    conditions.push(`(title LIKE ? OR tags LIKE ?)`);
    params.push(`%${search}%`, `%${search}%`);
  }

  if (conditions.length > 0) {
    sql += ` WHERE ` + conditions.join(' AND ');
  }
  sql += ` ORDER BY created_at DESC`;

  try {
    const rows = await all(sql, params);
    const result = rows.map(row => {
      try {
        return {
          uuid: row.uuid,
          title: row.title,
          tags: row.tags || '',
          words: JSON.parse(row.words),
          created_at: row.created_at
        };
      } catch (err) {
        console.error(`Failed to parse words for Wordset UUID ${row.uuid}:`, err);
        return {
          uuid: row.uuid,
          title: row.title,
          tags: row.tags || '',
          words: [],
          created_at: row.created_at
        };
      }
    });
    res.json(result);
  } catch (err) {
    console.error('Failed to get wordsets:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. GET /api/wordsets/:uuid - Retrieve single record by UUID
app.get('/api/wordsets/:uuid', async (req, res) => {
  const { uuid } = req.params;
  try {
    const row = await get(`SELECT * FROM tblWordset WHERE uuid = ?`, [uuid]);
    if (!row) {
      return res.status(404).json({ error: `Wordset with UUID ${uuid} not found` });
    }
    try {
      row.words = JSON.parse(row.words);
    } catch (e) {
      row.words = [];
    }
    res.json(row);
  } catch (err) {
    console.error(`Failed to get wordset ${uuid}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// 3. POST /api/wordsets - Create wordset
app.post('/api/wordsets', async (req, res) => {
  const { uuid, title, tags, words } = req.body;
  if (!title || !words) {
    return res.status(400).json({ error: "Title and words array are required" });
  }

  const wordsetUuid = uuid || 'ws_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
  const wordsJson = typeof words === 'string' ? words : JSON.stringify(words);

  try {
    await run(
      `INSERT INTO tblWordset (uuid, title, tags, words) VALUES (?, ?, ?, ?)`,
      [wordsetUuid, title, tags || '', wordsJson]
    );

    const row = await get(`SELECT * FROM tblWordset WHERE uuid = ?`, [wordsetUuid]);
    try {
      row.words = JSON.parse(row.words);
    } catch (e) {
      row.words = [];
    }
    res.status(201).json(row);
  } catch (err) {
    console.error('Failed to create wordset:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. PUT /api/wordsets/:uuid - Update wordset
app.put('/api/wordsets/:uuid', async (req, res) => {
  const { uuid } = req.params;
  const { title, tags, words } = req.body;

  try {
    const existing = await get(`SELECT uuid FROM tblWordset WHERE uuid = ?`, [uuid]);
    if (!existing) {
      return res.status(404).json({ error: `Wordset with UUID ${uuid} not found` });
    }

    const fields = [];
    const params = [];

    if (title !== undefined) {
      fields.push(`title = ?`);
      params.push(title);
    }
    if (tags !== undefined) {
      fields.push(`tags = ?`);
      params.push(tags);
    }
    if (words !== undefined) {
      fields.push(`words = ?`);
      params.push(typeof words === 'string' ? words : JSON.stringify(words));
    }

    if (fields.length > 0) {
      params.push(uuid);
      await run(`UPDATE tblWordset SET ${fields.join(', ')} WHERE uuid = ?`, params);
    }

    const row = await get(`SELECT * FROM tblWordset WHERE uuid = ?`, [uuid]);
    try {
      row.words = JSON.parse(row.words);
    } catch (e) {
      row.words = [];
    }
    res.json(row);
  } catch (err) {
    console.error(`Failed to update wordset ${uuid}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// 5. DELETE /api/wordsets/:uuid - Delete wordset
app.delete('/api/wordsets/:uuid', async (req, res) => {
  const { uuid } = req.params;
  try {
    const existing = await get(`SELECT uuid FROM tblWordset WHERE uuid = ?`, [uuid]);
    if (!existing) {
      return res.status(404).json({ error: `Wordset with UUID ${uuid} not found` });
    }
    await run(`DELETE FROM tblWordset WHERE uuid = ?`, [uuid]);
    res.json({ success: true, message: `Wordset with UUID ${uuid} deleted successfully.` });
  } catch (err) {
    console.error(`Failed to delete wordset ${uuid}:`, err);
    res.status(500).json({ error: err.message });
  }
});


// ==========================================
// Important Words APIs (tblImportantWords)
// ==========================================

// 1. GET /api/important_words - Retrieve all important word sets (with optional tag and search filtering)
async function handleGetImportantWords(req, res) {
  const { tag, search } = req.query;
  let sql = `SELECT * FROM tblImportantWords`;
  const params = [];
  const conditions = [];

  if (tag) {
    conditions.push(`tags LIKE ?`);
    params.push(`%${tag}%`);
  }
  if (search) {
    conditions.push(`(title LIKE ? OR tags LIKE ?)`);
    params.push(`%${search}%`, `%${search}%`);
  }

  if (conditions.length > 0) {
    sql += ` WHERE ` + conditions.join(' AND ');
  }
  sql += ` ORDER BY created_at DESC`;

  try {
    const rows = await all(sql, params);
    const result = rows.map(row => {
      try {
        return {
          uuid: row.uuid,
          title: row.title,
          tags: row.tags || '',
          words: JSON.parse(row.words),
          created_at: row.created_at
        };
      } catch (err) {
        console.error(`Failed to parse words for ImportantWords UUID ${row.uuid}:`, err);
        return {
          uuid: row.uuid,
          title: row.title,
          tags: row.tags || '',
          words: [],
          created_at: row.created_at
        };
      }
    });
    res.json(result);
  } catch (err) {
    console.error('Failed to get important words:', err);
    res.status(500).json({ error: err.message });
  }
}
app.get('/api/important_words', handleGetImportantWords);
app.get('/api/important-words', handleGetImportantWords);

// 2. GET /api/important_words/:uuid - Retrieve single record by UUID
async function handleGetImportantWordByUuid(req, res) {
  const { uuid } = req.params;
  try {
    const row = await get(`SELECT * FROM tblImportantWords WHERE uuid = ?`, [uuid]);
    if (!row) {
      return res.status(404).json({ error: `Important words set with UUID ${uuid} not found` });
    }
    try {
      row.words = JSON.parse(row.words);
    } catch (e) {
      row.words = [];
    }
    res.json(row);
  } catch (err) {
    console.error(`Failed to get important words ${uuid}:`, err);
    res.status(500).json({ error: err.message });
  }
}
app.get('/api/important_words/:uuid', handleGetImportantWordByUuid);
app.get('/api/important-words/:uuid', handleGetImportantWordByUuid);

// 3. POST /api/important_words - Create important words set
async function handlePostImportantWords(req, res) {
  const { uuid, title, tags, words } = req.body;
  if (!title || !words) {
    return res.status(400).json({ error: "Title and words array are required" });
  }

  const impUuid = uuid || 'imp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
  const wordsJson = typeof words === 'string' ? words : JSON.stringify(words);

  try {
    await run(
      `INSERT INTO tblImportantWords (uuid, title, tags, words) VALUES (?, ?, ?, ?)`,
      [impUuid, title, tags || '', wordsJson]
    );

    const row = await get(`SELECT * FROM tblImportantWords WHERE uuid = ?`, [impUuid]);
    try {
      row.words = JSON.parse(row.words);
    } catch (e) {
      row.words = [];
    }
    res.status(201).json(row);
  } catch (err) {
    console.error('Failed to create important words set:', err);
    res.status(500).json({ error: err.message });
  }
}
app.post('/api/important_words', handlePostImportantWords);
app.post('/api/important-words', handlePostImportantWords);

// 4. PUT /api/important_words/:uuid - Update important words set
async function handlePutImportantWords(req, res) {
  const { uuid } = req.params;
  const { title, tags, words } = req.body;

  try {
    const existing = await get(`SELECT uuid FROM tblImportantWords WHERE uuid = ?`, [uuid]);
    if (!existing) {
      return res.status(404).json({ error: `Important words set with UUID ${uuid} not found` });
    }

    const fields = [];
    const params = [];

    if (title !== undefined) {
      fields.push(`title = ?`);
      params.push(title);
    }
    if (tags !== undefined) {
      fields.push(`tags = ?`);
      params.push(tags);
    }
    if (words !== undefined) {
      fields.push(`words = ?`);
      params.push(typeof words === 'string' ? words : JSON.stringify(words));
    }

    if (fields.length > 0) {
      params.push(uuid);
      await run(`UPDATE tblImportantWords SET ${fields.join(', ')} WHERE uuid = ?`, params);
    }

    const row = await get(`SELECT * FROM tblImportantWords WHERE uuid = ?`, [uuid]);
    try {
      row.words = JSON.parse(row.words);
    } catch (e) {
      row.words = [];
    }
    res.json(row);
  } catch (err) {
    console.error(`Failed to update important words set ${uuid}:`, err);
    res.status(500).json({ error: err.message });
  }
}
app.put('/api/important_words/:uuid', handlePutImportantWords);
app.put('/api/important-words/:uuid', handlePutImportantWords);

// 5. DELETE /api/important_words/:uuid - Delete important words set
async function handleDeleteImportantWords(req, res) {
  const { uuid } = req.params;
  try {
    const existing = await get(`SELECT uuid FROM tblImportantWords WHERE uuid = ?`, [uuid]);
    if (!existing) {
      return res.status(404).json({ error: `Important words set with UUID ${uuid} not found` });
    }
    await run(`DELETE FROM tblImportantWords WHERE uuid = ?`, [uuid]);
    res.json({ success: true, message: `Important words set with UUID ${uuid} deleted successfully.` });
  } catch (err) {
    console.error(`Failed to delete important words set ${uuid}:`, err);
    res.status(500).json({ error: err.message });
  }
}
app.delete('/api/important_words/:uuid', handleDeleteImportantWords);
app.delete('/api/important-words/:uuid', handleDeleteImportantWords);


// ==========================================
// Sentence Patterns APIs (tblSentencePattern)
// ==========================================

// 1. GET /api/sentence_patterns - Retrieve all sentence patterns (with optional tag and search filtering)
app.get('/api/sentence_patterns', async (req, res) => {
  const { courseId, lessonId, tag, search } = req.query;
  let sql = `SELECT DISTINCT sp.* FROM tblSentencePattern sp`;
  const params = [];
  const joins = [];
  const whereClauses = [];

  if (courseId || lessonId) {
    joins.push(`JOIN tblCourseSentencePattern csp ON sp.uuid = csp.pattern_uuid`);
    if (courseId) {
      whereClauses.push(`csp.course_id = ?`);
      params.push(courseId);
    }
    if (lessonId) {
      whereClauses.push(`csp.lesson_id = ?`);
      params.push(lessonId);
    }
  }

  if (tag) {
    whereClauses.push(`(sp.tags LIKE ? OR sp.tags LIKE ? OR sp.tags LIKE ? OR sp.tags = ?)`);
    params.push(`${tag},%`, `%,${tag},%`, `%,${tag}`, tag);
  }

  if (search) {
    whereClauses.push(`(sp.patternContent LIKE ?)`);
    params.push(`%${search}%`);
  }

  if (joins.length > 0) {
    sql += ` ` + joins.join(` `);
  }
  if (whereClauses.length > 0) {
    sql += ` WHERE ` + whereClauses.join(` AND `);
  }

  sql += ` ORDER BY sp.created_at DESC`;

  try {
    const rows = await all(sql, params);
    const result = [];
    for (const row of rows) {
      const associations = await all(`SELECT course_id, lesson_id FROM tblCourseSentencePattern WHERE pattern_uuid = ?`, [row.uuid]);
      result.push({
        uuid: row.uuid,
        tags: row.tags ? row.tags.split(',') : [],
        patternContent: JSON.parse(row.patternContent),
        created_at: row.created_at,
        courses: associations.map(a => ({ courseId: a.course_id, lessonId: a.lesson_id }))
      });
    }
    res.json(result);
  } catch (err) {
    console.error('Failed to get sentence patterns:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. GET /api/sentence_patterns/:uuid - Retrieve single record by UUID
app.get('/api/sentence_patterns/:uuid', async (req, res) => {
  const { uuid } = req.params;
  try {
    const row = await get(`SELECT * FROM tblSentencePattern WHERE uuid = ?`, [uuid]);
    if (!row) {
      return res.status(404).json({ error: `Sentence pattern with UUID ${uuid} not found` });
    }
    const associations = await all(`SELECT course_id, lesson_id FROM tblCourseSentencePattern WHERE pattern_uuid = ?`, [uuid]);
    res.json({
      uuid: row.uuid,
      tags: row.tags ? row.tags.split(',') : [],
      patternContent: JSON.parse(row.patternContent),
      created_at: row.created_at,
      courses: associations.map(a => ({ courseId: a.course_id, lessonId: a.lesson_id }))
    });
  } catch (err) {
    console.error(`Failed to get sentence pattern ${uuid}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// 3. POST /api/sentence_patterns - Create a new sentence pattern
app.post('/api/sentence_patterns', async (req, res) => {
  const { uuid, tags, patternContent, courses } = req.body;
  if (!patternContent) {
    return res.status(400).json({ error: "Missing required field: patternContent" });
  }
  
  // Extract id from patternContent if uuid not provided
  let patternUuid = uuid;
  if (!patternUuid && typeof patternContent === 'object' && patternContent.id) {
    patternUuid = patternContent.id;
  }
  if (!patternUuid) {
    patternUuid = crypto.randomUUID();
  }

  // Extract tags from patternContent metadata if tags not provided
  let patternTags = tags;
  if (!patternTags && typeof patternContent === 'object' && patternContent.metadata && Array.isArray(patternContent.metadata.tags)) {
    patternTags = patternContent.metadata.tags;
  }

  const tagsStr = Array.isArray(patternTags) ? patternTags.join(',') : (patternTags || '');
  const contentStr = typeof patternContent === 'object' ? JSON.stringify(patternContent) : patternContent;

  try {
    await run(
      `INSERT INTO tblSentencePattern (uuid, tags, patternContent) VALUES (?, ?, ?)`,
      [patternUuid, tagsStr, contentStr]
    );

    if (courses && Array.isArray(courses)) {
      for (const assoc of courses) {
        const { courseId, lessonId } = assoc;
        if (courseId && lessonId) {
          await run(
            `INSERT INTO tblCourseSentencePattern (course_id, lesson_id, pattern_uuid) VALUES (?, ?, ?)`,
            [courseId, lessonId, patternUuid]
          );
        }
      }
    }

    const row = await get(`SELECT * FROM tblSentencePattern WHERE uuid = ?`, [patternUuid]);
    const associations = await all(`SELECT course_id, lesson_id FROM tblCourseSentencePattern WHERE pattern_uuid = ?`, [patternUuid]);
    res.status(201).json({
      uuid: row.uuid,
      tags: row.tags ? row.tags.split(',') : [],
      patternContent: JSON.parse(row.patternContent),
      created_at: row.created_at,
      courses: associations.map(a => ({ courseId: a.course_id, lessonId: a.lesson_id }))
    });
  } catch (err) {
    console.error('Failed to create sentence pattern:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. PUT /api/sentence_patterns/:uuid - Update an existing sentence pattern
app.put('/api/sentence_patterns/:uuid', async (req, res) => {
  const { uuid } = req.params;
  const { tags, patternContent, courses } = req.body;
  try {
    const existing = await get(`SELECT uuid FROM tblSentencePattern WHERE uuid = ?`, [uuid]);
    if (!existing) {
      return res.status(404).json({ error: `Sentence pattern with UUID ${uuid} not found` });
    }
    const fields = [];
    const params = [];
    
    if (tags !== undefined) {
      const tagsStr = Array.isArray(tags) ? tags.join(',') : tags;
      fields.push(`tags = ?`);
      params.push(tagsStr);
    }
    if (patternContent !== undefined) {
      const contentStr = typeof patternContent === 'object' ? JSON.stringify(patternContent) : patternContent;
      fields.push(`patternContent = ?`);
      params.push(contentStr);
    }

    if (fields.length > 0) {
      params.push(uuid);
      await run(`UPDATE tblSentencePattern SET ${fields.join(', ')} WHERE uuid = ?`, params);
    }

    if (courses !== undefined && Array.isArray(courses)) {
      await run(`DELETE FROM tblCourseSentencePattern WHERE pattern_uuid = ?`, [uuid]);
      for (const assoc of courses) {
        const { courseId, lessonId } = assoc;
        if (courseId && lessonId) {
          await run(
            `INSERT INTO tblCourseSentencePattern (course_id, lesson_id, pattern_uuid) VALUES (?, ?, ?)`,
            [courseId, lessonId, uuid]
          );
        }
      }
    }

    const row = await get(`SELECT * FROM tblSentencePattern WHERE uuid = ?`, [uuid]);
    const associations = await all(`SELECT course_id, lesson_id FROM tblCourseSentencePattern WHERE pattern_uuid = ?`, [uuid]);
    res.json({
      uuid: row.uuid,
      tags: row.tags ? row.tags.split(',') : [],
      patternContent: JSON.parse(row.patternContent),
      created_at: row.created_at,
      courses: associations.map(a => ({ courseId: a.course_id, lessonId: a.lesson_id }))
    });
  } catch (err) {
    console.error(`Failed to update sentence pattern ${uuid}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// 5. DELETE /api/sentence_patterns/:uuid - Delete a sentence pattern by UUID
app.delete('/api/sentence_patterns/:uuid', async (req, res) => {
  const { uuid } = req.params;
  try {
    const existing = await get(`SELECT uuid FROM tblSentencePattern WHERE uuid = ?`, [uuid]);
    if (!existing) {
      return res.status(404).json({ error: `Sentence pattern with UUID ${uuid} not found` });
    }
    await run(`DELETE FROM tblSentencePattern WHERE uuid = ?`, [uuid]);
    await run(`DELETE FROM tblCourseSentencePattern WHERE pattern_uuid = ?`, [uuid]);
    res.json({ success: true, message: `Sentence pattern with UUID ${uuid} and its course associations deleted successfully.` });
  } catch (err) {
    console.error(`Failed to delete sentence pattern ${uuid}:`, err);
    res.status(500).json({ error: err.message });
  }
});


// ========================================================
// Course Sentence Pattern Associations (tblCourseSentencePattern)
// ========================================================

// 6. GET /api/course_sentence_patterns - Retrieve associations
app.get('/api/course_sentence_patterns', async (req, res) => {
  const { courseId, lessonId, patternUuid } = req.query;
  let sql = `SELECT * FROM tblCourseSentencePattern WHERE 1=1`;
  const params = [];
  if (courseId) {
    sql += ` AND course_id = ?`;
    params.push(courseId);
  }
  if (lessonId) {
    sql += ` AND lesson_id = ?`;
    params.push(lessonId);
  }
  if (patternUuid) {
    sql += ` AND pattern_uuid = ?`;
    params.push(patternUuid);
  }
  try {
    const rows = await all(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Failed to get course sentence patterns:', err);
    res.status(500).json({ error: err.message });
  }
});

// 7. POST /api/course_sentence_patterns - Associate a sentence pattern with a course/lesson
app.post('/api/course_sentence_patterns', async (req, res) => {
  const { courseId, lessonId, patternUuid } = req.body;
  if (!courseId || !lessonId || !patternUuid) {
    return res.status(400).json({ error: "Missing required fields: courseId, lessonId, patternUuid" });
  }
  try {
    const existing = await get(
      `SELECT id FROM tblCourseSentencePattern WHERE course_id = ? AND lesson_id = ? AND pattern_uuid = ?`,
      [courseId, lessonId, patternUuid]
    );
    if (existing) {
      return res.status(200).json({ success: true, message: "Association already exists", id: existing.id });
    }
    const result = await run(
      `INSERT INTO tblCourseSentencePattern (course_id, lesson_id, pattern_uuid) VALUES (?, ?, ?)`,
      [courseId, lessonId, patternUuid]
    );
    res.status(201).json({ success: true, id: result.lastID });
  } catch (err) {
    console.error('Failed to create association:', err);
    res.status(500).json({ error: err.message });
  }
});

// 8. DELETE /api/course_sentence_patterns - Remove association
app.delete('/api/course_sentence_patterns', async (req, res) => {
  const { courseId, lessonId, patternUuid } = { ...req.query, ...req.body };
  if (!courseId || !lessonId || !patternUuid) {
    return res.status(400).json({ error: "Missing required parameters: courseId, lessonId, patternUuid" });
  }
  try {
    await run(
      `DELETE FROM tblCourseSentencePattern WHERE course_id = ? AND lesson_id = ? AND pattern_uuid = ?`,
      [courseId, lessonId, patternUuid]
    );
    res.json({ success: true, message: "Association deleted successfully." });
  } catch (err) {
    console.error('Failed to delete association:', err);
    res.status(500).json({ error: err.message });
  }
});


// ========================================================
// Translate Sentences APIs (tblTranslateSentence)
// ========================================================

// 1. GET /api/translate_sentences - Retrieve all translate sentences (with optional tag, search, course, and lesson filtering)
app.get('/api/translate_sentences', async (req, res) => {
  const { courseId, lessonId, tag, search } = req.query;
  let sql = `SELECT DISTINCT ts.* FROM tblTranslateSentence ts`;
  const params = [];
  const joins = [];
  const whereClauses = [];

  if (courseId || lessonId) {
    joins.push(`JOIN tblCourseTranslateSentence cts ON ts.uuid = cts.sentence_uuid`);
    if (courseId) {
      whereClauses.push(`cts.course_id = ?`);
      params.push(courseId);
    }
    if (lessonId) {
      whereClauses.push(`cts.lesson_id = ?`);
      params.push(lessonId);
    }
  }

  if (tag) {
    whereClauses.push(`(ts.tags LIKE ? OR ts.tags LIKE ? OR ts.tags LIKE ? OR ts.tags = ?)`);
    params.push(`${tag},%`, `%,${tag},%`, `%,${tag}`, tag);
  }

  if (search) {
    whereClauses.push(`(ts.jsonContent LIKE ? OR ts.tags LIKE ?)`);
    params.push(`%${search}%`, `%${search}%`);
  }

  if (joins.length > 0) {
    sql += ` ` + joins.join(` `);
  }
  if (whereClauses.length > 0) {
    sql += ` WHERE ` + whereClauses.join(` AND `);
  }

  if (courseId || lessonId) {
    sql += ` ORDER BY CAST(json_extract(ts.jsonContent, '$.order') AS INTEGER) ASC, cts.id ASC`;
  } else {
    sql += ` ORDER BY CAST(json_extract(ts.jsonContent, '$.order') AS INTEGER) ASC, ts.rowid ASC`;
  }

  try {
    const rows = await all(sql, params);
    const result = [];
    for (const row of rows) {
      const associations = await all(`SELECT course_id, lesson_id FROM tblCourseTranslateSentence WHERE sentence_uuid = ?`, [row.uuid]);
      result.push({
        uuid: row.uuid,
        tags: row.tags ? row.tags.split(',') : [],
        jsonContent: JSON.parse(row.jsonContent),
        created_at: row.created_at,
        courses: associations.map(a => ({ courseId: a.course_id, lessonId: a.lesson_id }))
      });
    }
    res.json(result);
  } catch (err) {
    console.error('Failed to get translate sentences:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. GET /api/translate_sentences/:uuid - Retrieve single record by UUID
app.get('/api/translate_sentences/:uuid', async (req, res) => {
  const { uuid } = req.params;
  try {
    const row = await get(`SELECT * FROM tblTranslateSentence WHERE uuid = ?`, [uuid]);
    if (!row) {
      return res.status(404).json({ error: `Translate sentence with UUID ${uuid} not found` });
    }
    const associations = await all(`SELECT course_id, lesson_id FROM tblCourseTranslateSentence WHERE sentence_uuid = ?`, [uuid]);
    res.json({
      uuid: row.uuid,
      tags: row.tags ? row.tags.split(',') : [],
      jsonContent: JSON.parse(row.jsonContent),
      created_at: row.created_at,
      courses: associations.map(a => ({ courseId: a.course_id, lessonId: a.lesson_id }))
    });
  } catch (err) {
    console.error(`Failed to get translate sentence ${uuid}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// 3. POST /api/translate_sentences - Create a new translate sentence
app.post('/api/translate_sentences', async (req, res) => {
  const { uuid, tags, jsonContent, courses } = req.body;
  if (!jsonContent) {
    return res.status(400).json({ error: "Missing required field: jsonContent" });
  }

  let sentenceUuid = uuid;
  if (!sentenceUuid && typeof jsonContent === 'object' && jsonContent.id) {
    sentenceUuid = jsonContent.id;
  }
  if (!sentenceUuid) {
    sentenceUuid = crypto.randomUUID();
  }

  let sentenceTags = tags;
  if (!sentenceTags && typeof jsonContent === 'object' && Array.isArray(jsonContent.tags)) {
    sentenceTags = jsonContent.tags;
  }

  const tagsStr = Array.isArray(sentenceTags) ? sentenceTags.join(',') : (sentenceTags || '');
  const contentStr = typeof jsonContent === 'object' ? JSON.stringify(jsonContent) : jsonContent;

  try {
    const existing = await get(`SELECT uuid FROM tblTranslateSentence WHERE uuid = ?`, [sentenceUuid]);
    if (existing) {
      return res.status(400).json({ error: `Translate sentence with UUID ${sentenceUuid} already exists` });
    }

    await run(
      `INSERT INTO tblTranslateSentence (uuid, tags, jsonContent) VALUES (?, ?, ?)`,
      [sentenceUuid, tagsStr, contentStr]
    );

    if (courses && Array.isArray(courses)) {
      for (const assoc of courses) {
        const { courseId, lessonId } = assoc;
        if (courseId && lessonId) {
          await run(
            `INSERT INTO tblCourseTranslateSentence (course_id, lesson_id, sentence_uuid) VALUES (?, ?, ?)`,
            [courseId, lessonId, sentenceUuid]
          );
        }
      }
    }

    const row = await get(`SELECT * FROM tblTranslateSentence WHERE uuid = ?`, [sentenceUuid]);
    const associations = await all(`SELECT course_id, lesson_id FROM tblCourseTranslateSentence WHERE sentence_uuid = ?`, [sentenceUuid]);
    res.status(201).json({
      uuid: row.uuid,
      tags: row.tags ? row.tags.split(',') : [],
      jsonContent: JSON.parse(row.jsonContent),
      created_at: row.created_at,
      courses: associations.map(a => ({ courseId: a.course_id, lessonId: a.lesson_id }))
    });
  } catch (err) {
    console.error('Failed to create translate sentence:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. PUT /api/translate_sentences/:uuid - Update an existing translate sentence
app.put('/api/translate_sentences/:uuid', async (req, res) => {
  const { uuid } = req.params;
  const { tags, jsonContent, courses } = req.body;
  try {
    const existing = await get(`SELECT uuid FROM tblTranslateSentence WHERE uuid = ?`, [uuid]);
    if (!existing) {
      return res.status(404).json({ error: `Translate sentence with UUID ${uuid} not found` });
    }
    const fields = [];
    const params = [];
    
    if (tags !== undefined) {
      const tagsStr = Array.isArray(tags) ? tags.join(',') : tags;
      fields.push(`tags = ?`);
      params.push(tagsStr);
    }
    if (jsonContent !== undefined) {
      const contentStr = typeof jsonContent === 'object' ? JSON.stringify(jsonContent) : jsonContent;
      fields.push(`jsonContent = ?`);
      params.push(contentStr);
    }

    if (fields.length > 0) {
      params.push(uuid);
      await run(`UPDATE tblTranslateSentence SET ${fields.join(', ')} WHERE uuid = ?`, params);
    }

    if (courses !== undefined && Array.isArray(courses)) {
      await run(`DELETE FROM tblCourseTranslateSentence WHERE sentence_uuid = ?`, [uuid]);
      for (const assoc of courses) {
        const { courseId, lessonId } = assoc;
        if (courseId && lessonId) {
          await run(
            `INSERT INTO tblCourseTranslateSentence (course_id, lesson_id, sentence_uuid) VALUES (?, ?, ?)`,
            [courseId, lessonId, uuid]
          );
        }
      }
    }

    const row = await get(`SELECT * FROM tblTranslateSentence WHERE uuid = ?`, [uuid]);
    const associations = await all(`SELECT course_id, lesson_id FROM tblCourseTranslateSentence WHERE sentence_uuid = ?`, [uuid]);
    res.json({
      uuid: row.uuid,
      tags: row.tags ? row.tags.split(',') : [],
      jsonContent: JSON.parse(row.jsonContent),
      created_at: row.created_at,
      courses: associations.map(a => ({ courseId: a.course_id, lessonId: a.lesson_id }))
    });
  } catch (err) {
    console.error(`Failed to update translate sentence ${uuid}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// 5. DELETE /api/translate_sentences/:uuid - Delete a translate sentence by UUID
app.delete('/api/translate_sentences/:uuid', async (req, res) => {
  const { uuid } = req.params;
  try {
    const existing = await get(`SELECT uuid FROM tblTranslateSentence WHERE uuid = ?`, [uuid]);
    if (!existing) {
      return res.status(404).json({ error: `Translate sentence with UUID ${uuid} not found` });
    }
    await run(`DELETE FROM tblTranslateSentence WHERE uuid = ?`, [uuid]);
    await run(`DELETE FROM tblCourseTranslateSentence WHERE sentence_uuid = ?`, [uuid]);
    res.json({ success: true, message: `Translate sentence with UUID ${uuid} and its course associations deleted successfully.` });
  } catch (err) {
    console.error(`Failed to delete translate sentence ${uuid}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// 6. POST /api/translate_sentences/import - Bulk import translate sentences
app.post(['/api/translate_sentences/import', '/api/translate-sentences/import'], async (req, res) => {
  try {
    const body = req.body;
    let items = [];
    let courseId = req.query.courseId || null;
    let lessonId = req.query.lessonId || null;
    let replaceLesson = false;

    if (Array.isArray(body)) {
      items = body;
    } else if (body && typeof body === 'object') {
      items = Array.isArray(body.sentences) ? body.sentences :
              (Array.isArray(body.data) ? body.data :
              (Array.isArray(body.items) ? body.items : [body]));
      if (body.courseId || body.course_id) courseId = body.courseId || body.course_id;
      if (body.lessonId || body.lesson_id) lessonId = body.lessonId || body.lesson_id;
      if (body.replaceLesson !== undefined) replaceLesson = Boolean(body.replaceLesson);
    }

    if (!items || items.length === 0) {
      return res.status(400).json({ error: "未提供任何待导入的翻译句子数据" });
    }

    // If replaceLesson is true and lessonId is specified, remove existing associations for this lesson
    if (replaceLesson && lessonId) {
      await run(`DELETE FROM tblCourseTranslateSentence WHERE lesson_id = ?`, [lessonId]);
    }

    let startIndex = 0;
    if (lessonId && !replaceLesson) {
      const countRow = await get(
        `SELECT COUNT(*) as count FROM tblCourseTranslateSentence WHERE lesson_id = ?`,
        [lessonId]
      );
      startIndex = (countRow && countRow.count) ? Number(countRow.count) : 0;
    }

    let insertedCount = 0;
    let updatedCount = 0;
    const importedUuids = [];

    for (let i = 0; i < items.length; i++) {
      let item = items[i];
      if (!item) continue;

      let rawJson = item.jsonContent || item;
      const thai = (rawJson.thai || '').trim();
      const chinese = (rawJson.chinese || '').trim();
      if (!thai && !chinese) continue;

      const thaiSpaced = (rawJson.thai_spaced || rawJson.thai || '').trim();
      const english = (rawJson.english || '').trim();
      const direction = rawJson.direction || 'th2zh';
      const category = rawJson.category || '日常生活';
      const difficulty = parseInt(rawJson.difficulty, 10) || 3;
      let tokens = Array.isArray(rawJson.tokens) ? rawJson.tokens : [];
      let glossary = Array.isArray(rawJson.glossary) ? rawJson.glossary : [];

      // Auto-tokenize from thai_spaced if tokens is empty
      if (tokens.length === 0 && thai && thaiSpaced) {
        const words = thaiSpaced.split(/\s+/).filter(Boolean);
        let sIdx = 0;
        for (const w of words) {
          const foundIdx = thai.indexOf(w, sIdx);
          if (foundIdx !== -1) {
            tokens.push({
              thai: w,
              meaning: "",
              start: foundIdx,
              end: foundIdx + w.length,
              importance: 2
            });
            sIdx = foundIdx + w.length;
          }
        }
      }

      // Re-index tokens for combining characters
      if (tokens.length > 0 && thai) {
        let searchIndex = 0;
        tokens = tokens.map(token => {
          if (!token || !token.thai) return null;
          const idx = thai.indexOf(token.thai, searchIndex);
          if (idx !== -1) {
            token.start = idx;
            token.end = idx + token.thai.length;
            searchIndex = token.end;
          } else {
            const fallbackIdx = thai.indexOf(token.thai);
            if (fallbackIdx !== -1) {
              token.start = fallbackIdx;
              token.end = fallbackIdx + token.thai.length;
              searchIndex = token.end;
            }
          }
          return token;
        }).filter(Boolean);
        tokens.sort((a, b) => a.start - b.start);
      }

      // If glossary empty, pick importance === 3 from tokens
      if (glossary.length === 0 && tokens.length > 0) {
        glossary = tokens
          .filter(t => t.importance === 3 && t.meaning)
          .map(t => ({ thai: t.thai, meaning: t.meaning, importance: 3 }))
          .slice(0, 5);
      }

      // Determine sequential sortOrder (1, 2, 3...)
      const sortOrder = (item.order !== undefined && item.order !== null)
        ? Number(item.order)
        : (rawJson.order !== undefined && rawJson.order !== null)
        ? Number(rawJson.order)
        : (startIndex + i + 1);

      // Determine sequential UUID
      let candidateUuid;
      const cleanLessonId = lessonId ? lessonId.replace(/[^a-zA-Z0-9_-]/g, '') : '';
      if (cleanLessonId) {
        candidateUuid = `s_${cleanLessonId}_${String(sortOrder).padStart(3, '0')}`;
      } else {
        candidateUuid = item.uuid || rawJson.id || `s_${Date.now().toString(36)}_${String(sortOrder).padStart(3, '0')}`;
      }

      const existing = await get(`SELECT uuid FROM tblTranslateSentence WHERE uuid = ?`, [candidateUuid]);
      const isExisting = Boolean(existing);

      // Build structured jsonContent
      const jsonContent = {
        id: candidateUuid,
        order: sortOrder,
        chinese,
        thai,
        thai_spaced: thaiSpaced,
        english,
        direction,
        tokens,
        glossary,
        category,
        difficulty
      };

      // Tags
      let sentenceTags = item.tags || rawJson.tags;
      if (!sentenceTags) {
        sentenceTags = [category];
      }
      const tagsStr = Array.isArray(sentenceTags) ? sentenceTags.join(',') : (sentenceTags || category);

      if (isExisting) {
        await run(
          `UPDATE tblTranslateSentence SET tags = ?, jsonContent = ? WHERE uuid = ?`,
          [tagsStr, JSON.stringify(jsonContent), candidateUuid]
        );
        updatedCount++;
      } else {
        await run(
          `INSERT INTO tblTranslateSentence (uuid, tags, jsonContent) VALUES (?, ?, ?)`,
          [candidateUuid, tagsStr, JSON.stringify(jsonContent)]
        );
        insertedCount++;
      }

      // Link course association
      const targetCourseId = courseId || (item.courses && item.courses[0] && item.courses[0].courseId);
      const targetLessonId = lessonId || (item.courses && item.courses[0] && item.courses[0].lessonId);

      if (targetCourseId && targetLessonId) {
        const hasAssoc = await get(
          `SELECT id FROM tblCourseTranslateSentence WHERE course_id = ? AND lesson_id = ? AND sentence_uuid = ?`,
          [targetCourseId, targetLessonId, candidateUuid]
        );
        if (!hasAssoc) {
          await run(
            `INSERT INTO tblCourseTranslateSentence (course_id, lesson_id, sentence_uuid) VALUES (?, ?, ?)`,
            [targetCourseId, targetLessonId, candidateUuid]
          );
        }
      }

      // Also process any additional courses in item.courses
      if (Array.isArray(item.courses)) {
        for (const extraAssoc of item.courses) {
          if (extraAssoc.courseId && extraAssoc.lessonId) {
            const hasExtra = await get(
              `SELECT id FROM tblCourseTranslateSentence WHERE course_id = ? AND lesson_id = ? AND sentence_uuid = ?`,
              [extraAssoc.courseId, extraAssoc.lessonId, candidateUuid]
            );
            if (!hasExtra) {
              await run(
                `INSERT INTO tblCourseTranslateSentence (course_id, lesson_id, sentence_uuid) VALUES (?, ?, ?)`,
                [extraAssoc.courseId, extraAssoc.lessonId, candidateUuid]
              );
            }
          }
        }
      }

      importedUuids.push(candidateUuid);
    }

    res.json({
      success: true,
      message: `成功导入 ${importedUuids.length} 条翻译句子（新增: ${insertedCount}, 更新: ${updatedCount}）`,
      total: importedUuids.length,
      insertedCount,
      updatedCount,
      importedUuids,
      courseId,
      lessonId
    });
  } catch (err) {
    console.error('Failed to bulk import translate sentences:', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================================================
// Review Sentences APIs (tblReviewSentences)
// ========================================================

// 1. GET /api/review-sentences - Retrieve all review sentences (with optional course, lesson, and search filtering)
app.get('/api/review-sentences', async (req, res) => {
  const { courseId, lessonId, search } = req.query;
  let sql = `SELECT DISTINCT rs.* FROM tblReviewSentences rs`;
  const params = [];
  const joins = [];
  const whereClauses = [];

  if (courseId || lessonId) {
    joins.push(`JOIN tblCourseReviewSentence crs ON rs.id = crs.sentence_id`);
    if (courseId) {
      whereClauses.push(`crs.course_id = ?`);
      params.push(courseId);
    }
    if (lessonId) {
      whereClauses.push(`crs.lesson_id = ?`);
      params.push(lessonId);
    }
  }

  if (search) {
    whereClauses.push(`(rs.id LIKE ? OR rs.thai_sentence LIKE ? OR rs.translation_zh LIKE ? OR rs.data_json LIKE ?)`);
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  if (joins.length > 0) {
    sql += ` ` + joins.join(` `);
  }
  if (whereClauses.length > 0) {
    sql += ` WHERE ` + whereClauses.join(` AND `);
  }

  sql += ` ORDER BY rs.created_at DESC`;

  try {
    const rows = await all(sql, params);
    const result = [];
    for (const row of rows) {
      const associations = await all(`SELECT course_id, lesson_id FROM tblCourseReviewSentence WHERE sentence_id = ?`, [row.id]);
      result.push({
        id: row.id,
        thai_sentence: row.thai_sentence,
        translation_zh: row.translation_zh,
        data_json: JSON.parse(row.data_json),
        created_at: row.created_at,
        updated_at: row.updated_at,
        courses: associations.map(a => ({ courseId: a.course_id, lessonId: a.lesson_id }))
      });
    }
    res.json(result);
  } catch (err) {
    console.error('Failed to get review sentences:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. GET /api/review-sentences/:id - Retrieve single review sentence by ID
app.get('/api/review-sentences/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const row = await get(`SELECT * FROM tblReviewSentences WHERE id = ?`, [id]);
    if (!row) {
      return res.status(404).json({ error: `Review sentence with ID ${id} not found` });
    }
    const associations = await all(`SELECT course_id, lesson_id FROM tblCourseReviewSentence WHERE sentence_id = ?`, [id]);
    res.json({
      id: row.id,
      thai_sentence: row.thai_sentence,
      translation_zh: row.translation_zh,
      data_json: JSON.parse(row.data_json),
      created_at: row.created_at,
      updated_at: row.updated_at,
      courses: associations.map(a => ({ courseId: a.course_id, lessonId: a.lesson_id }))
    });
  } catch (err) {
    console.error(`Failed to get review sentence ${id}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// 3. POST /api/review-sentences - Create a new review sentence
app.post('/api/review-sentences', async (req, res) => {
  const { id, thai_sentence, translation_zh, data_json, courses } = req.body;
  if (!thai_sentence || !translation_zh || !data_json) {
    return res.status(400).json({ error: "Missing required fields: thai_sentence, translation_zh, data_json" });
  }

  let sentenceId = id;
  if (!sentenceId && typeof data_json === 'object' && data_json.id) {
    sentenceId = data_json.id;
  }
  if (!sentenceId) {
    return res.status(400).json({ error: "Missing required field: id" });
  }

  const contentStr = typeof data_json === 'object' ? JSON.stringify(data_json) : data_json;

  try {
    const existing = await get(`SELECT id FROM tblReviewSentences WHERE id = ?`, [sentenceId]);
    if (existing) {
      return res.status(400).json({ error: `Review sentence with ID ${sentenceId} already exists` });
    }

    await run(
      `INSERT INTO tblReviewSentences (id, thai_sentence, translation_zh, data_json) VALUES (?, ?, ?, ?)`,
      [sentenceId, thai_sentence, translation_zh, contentStr]
    );

    if (courses && Array.isArray(courses)) {
      for (const assoc of courses) {
        const { courseId, lessonId } = assoc;
        if (courseId && lessonId) {
          await run(
            `INSERT INTO tblCourseReviewSentence (course_id, lesson_id, sentence_id) VALUES (?, ?, ?)`,
            [courseId, lessonId, sentenceId]
          );
        }
      }
    }

    const row = await get(`SELECT * FROM tblReviewSentences WHERE id = ?`, [sentenceId]);
    const associations = await all(`SELECT course_id, lesson_id FROM tblCourseReviewSentence WHERE sentence_id = ?`, [sentenceId]);
    res.status(201).json({
      id: row.id,
      thai_sentence: row.thai_sentence,
      translation_zh: row.translation_zh,
      data_json: JSON.parse(row.data_json),
      created_at: row.created_at,
      updated_at: row.updated_at,
      courses: associations.map(a => ({ courseId: a.course_id, lessonId: a.lesson_id }))
    });
  } catch (err) {
    console.error('Failed to create review sentence:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. PUT /api/review-sentences/:id - Update an existing review sentence
app.put('/api/review-sentences/:id', async (req, res) => {
  const { id } = req.params;
  const { thai_sentence, translation_zh, data_json, courses } = req.body;
  try {
    const existing = await get(`SELECT id FROM tblReviewSentences WHERE id = ?`, [id]);
    if (!existing) {
      return res.status(404).json({ error: `Review sentence with ID ${id} not found` });
    }
    const fields = [];
    const params = [];
    
    if (thai_sentence !== undefined) {
      fields.push(`thai_sentence = ?`);
      params.push(thai_sentence);
    }
    if (translation_zh !== undefined) {
      fields.push(`translation_zh = ?`);
      params.push(translation_zh);
    }
    if (data_json !== undefined) {
      const contentStr = typeof data_json === 'object' ? JSON.stringify(data_json) : data_json;
      fields.push(`data_json = ?`);
      params.push(contentStr);
    }

    fields.push(`updated_at = datetime('now', 'localtime')`);

    if (fields.length > 0) {
      params.push(id);
      await run(`UPDATE tblReviewSentences SET ${fields.join(', ')} WHERE id = ?`, params);
    }

    if (courses !== undefined && Array.isArray(courses)) {
      await run(`DELETE FROM tblCourseReviewSentence WHERE sentence_id = ?`, [id]);
      for (const assoc of courses) {
        const { courseId, lessonId } = assoc;
        if (courseId && lessonId) {
          await run(
            `INSERT INTO tblCourseReviewSentence (course_id, lesson_id, sentence_id) VALUES (?, ?, ?)`,
            [courseId, lessonId, id]
          );
        }
      }
    }

    const row = await get(`SELECT * FROM tblReviewSentences WHERE id = ?`, [id]);
    const associations = await all(`SELECT course_id, lesson_id FROM tblCourseReviewSentence WHERE sentence_id = ?`, [id]);
    res.json({
      id: row.id,
      thai_sentence: row.thai_sentence,
      translation_zh: row.translation_zh,
      data_json: JSON.parse(row.data_json),
      created_at: row.created_at,
      updated_at: row.updated_at,
      courses: associations.map(a => ({ courseId: a.course_id, lessonId: a.lesson_id }))
    });
  } catch (err) {
    console.error(`Failed to update review sentence ${id}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// 5. DELETE /api/review-sentences/:id - Delete a review sentence by ID
app.delete('/api/review-sentences/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await get(`SELECT id FROM tblReviewSentences WHERE id = ?`, [id]);
    if (!existing) {
      return res.status(404).json({ error: `Review sentence with ID ${id} not found` });
    }
    await run(`DELETE FROM tblReviewSentences WHERE id = ?`, [id]);
    res.json({ success: true, message: `Review sentence with ID ${id} and its course associations deleted successfully.` });
  } catch (err) {
    console.error(`Failed to delete review sentence ${id}:`, err);
    res.status(500).json({ error: err.message });
  }
});


// ==========================================
// Quiz CRUD APIs (tblQuiz)
// ==========================================

// 1. GET /api/quizzes - List all quizzes
app.get('/api/quizzes', async (req, res) => {
  const { search, status, tag } = req.query;
  let sql = `
    SELECT q.uuid, q.title, q.tags, q.status, q.created_at, q.updated_at, q.quiz_data,
           COUNT(s.id) as submission_count,
           ROUND(AVG(s.score_percent)) as avg_score,
           MAX(s.score_percent) as max_score
    FROM tblQuiz q
    LEFT JOIN tblQuizSubmission s ON q.uuid = s.quiz_uuid
  `;
  const params = [];
  const whereClauses = [];

  if (search) {
    whereClauses.push(`(q.title LIKE ? OR q.tags LIKE ?)`);
    params.push(`%${search}%`, `%${search}%`);
  }
  if (status) {
    whereClauses.push(`q.status = ?`);
    params.push(status);
  }
  if (tag) {
    whereClauses.push(`q.tags LIKE ?`);
    params.push(`%${tag}%`);
  }

  if (whereClauses.length > 0) {
    sql += ` WHERE ` + whereClauses.join(` AND `);
  }
  sql += ` GROUP BY q.uuid ORDER BY q.created_at DESC`;

  try {
    const rows = await all(sql, params);
    const result = rows.map(row => {
      let parsed = {};
      try {
        parsed = JSON.parse(row.quiz_data || '{}');
      } catch (e) {
        parsed = {};
      }
      const questions = parsed.questions || [];
      return {
        uuid: row.uuid,
        title: row.title,
        tags: row.tags ? row.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
        raw_tags: row.tags || '',
        status: row.status,
        question_count: parsed.total_questions || questions.length || 0,
        submission_count: Number(row.submission_count || 0),
        avg_score: row.avg_score !== null ? Number(row.avg_score) : null,
        max_score: row.max_score !== null ? Number(row.max_score) : null,
        quiz_data: parsed,
        created_at: row.created_at,
        updated_at: row.updated_at
      };
    });
    res.json(result);
  } catch (err) {
    console.error('Failed to query quizzes:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. GET /api/quizzes/:uuid - Get single quiz detail
app.get('/api/quizzes/:uuid', async (req, res) => {
  const { uuid } = req.params;
  try {
    const row = await get(`SELECT * FROM tblQuiz WHERE uuid = ?`, [uuid]);
    if (!row) {
      return res.status(404).json({ error: `Quiz with UUID '${uuid}' not found` });
    }
    let parsed = {};
    try {
      parsed = JSON.parse(row.quiz_data || '{}');
    } catch (e) {
      parsed = {};
    }
    res.json({
      uuid: row.uuid,
      title: row.title,
      tags: row.tags ? row.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      raw_tags: row.tags || '',
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
      quiz_data: parsed
    });
  } catch (err) {
    console.error(`Failed to query quiz UUID '${uuid}':`, err);
    res.status(500).json({ error: err.message });
  }
});

// 3. POST /api/quizzes - Create a new quiz
app.post('/api/quizzes', async (req, res) => {
  const { uuid, title, tags, status, quiz_data } = req.body;
  if (!quiz_data) {
    return res.status(400).json({ error: "quiz_data is required" });
  }

  let parsedObj = typeof quiz_data === 'string' ? JSON.parse(quiz_data) : quiz_data;
  const finalTitle = title || parsedObj.quiz_title || "未命名 Quiz";
  const finalUuid = uuid || 'qz_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
  const finalTags = Array.isArray(tags) ? tags.join(',') : (tags || '');
  const finalStatus = status || 'active';
  const contentJson = typeof quiz_data === 'string' ? quiz_data : JSON.stringify(quiz_data);

  try {
    await run(
      `INSERT INTO tblQuiz (uuid, title, tags, status, quiz_data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))`,
      [finalUuid, finalTitle, finalTags, finalStatus, contentJson]
    );

    res.status(201).json({
      success: true,
      uuid: finalUuid,
      title: finalTitle,
      tags: finalTags ? finalTags.split(',').map(t => t.trim()).filter(Boolean) : [],
      status: finalStatus,
      quiz_data: parsedObj
    });
  } catch (err) {
    console.error('Failed to create quiz:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. PUT /api/quizzes/:uuid - Update an existing quiz
app.put('/api/quizzes/:uuid', async (req, res) => {
  const { uuid } = req.params;
  const { title, tags, status, quiz_data } = req.body;

  try {
    const existing = await get(`SELECT uuid, title, tags, status, quiz_data FROM tblQuiz WHERE uuid = ?`, [uuid]);
    if (!existing) {
      return res.status(404).json({ error: `Quiz with UUID '${uuid}' not found` });
    }

    let contentJson = existing.quiz_data;
    let newTitle = title || existing.title;
    if (quiz_data) {
      contentJson = typeof quiz_data === 'string' ? quiz_data : JSON.stringify(quiz_data);
      if (!title) {
        try {
          const parsed = typeof quiz_data === 'string' ? JSON.parse(quiz_data) : quiz_data;
          if (parsed.quiz_title) newTitle = parsed.quiz_title;
        } catch (e) {}
      }
    }

    const newTags = tags !== undefined ? (Array.isArray(tags) ? tags.join(',') : tags) : existing.tags;
    const newStatus = status || existing.status;

    await run(
      `UPDATE tblQuiz SET title = ?, tags = ?, status = ?, quiz_data = ?, updated_at = datetime('now', 'localtime') WHERE uuid = ?`,
      [newTitle, newTags, newStatus, contentJson, uuid]
    );

    const updated = await get(`SELECT * FROM tblQuiz WHERE uuid = ?`, [uuid]);
    let parsedObj = {};
    try {
      parsedObj = JSON.parse(updated.quiz_data);
    } catch (e) {}

    res.json({
      success: true,
      uuid: updated.uuid,
      title: updated.title,
      tags: updated.tags ? updated.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      status: updated.status,
      updated_at: updated.updated_at,
      quiz_data: parsedObj
    });
  } catch (err) {
    console.error(`Failed to update quiz '${uuid}':`, err);
    res.status(500).json({ error: err.message });
  }
});

// 5. DELETE /api/quizzes/:uuid - Delete a quiz
app.delete('/api/quizzes/:uuid', async (req, res) => {
  const { uuid } = req.params;
  try {
    const existing = await get(`SELECT uuid FROM tblQuiz WHERE uuid = ?`, [uuid]);
    if (!existing) {
      return res.status(404).json({ error: `Quiz with UUID '${uuid}' not found` });
    }
    await run(`DELETE FROM tblQuiz WHERE uuid = ?`, [uuid]);
    // Also cleanup submissions for this quiz
    await run(`DELETE FROM tblQuizSubmission WHERE quiz_uuid = ?`, [uuid]);
    res.json({ success: true, message: `Quiz '${uuid}' deleted successfully.` });
  } catch (err) {
    console.error(`Failed to delete quiz '${uuid}':`, err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// Quiz Submissions / Test Results APIs (tblQuizSubmission)
// ==========================================

// 1. POST /api/quizzes/:uuid/submissions - Record a new quiz submission/result
app.post('/api/quizzes/:uuid/submissions', async (req, res) => {
  const { uuid } = req.params;
  const {
    quiz_title,
    mode = 'practice',
    score = 0,
    total_questions = 0,
    score_percent = 0,
    time_taken_seconds = 0,
    max_streak = 0,
    user_answers = [],
    knowledge_breakdown = {}
  } = req.body;

  try {
    const userAnswersStr = typeof user_answers === 'string' ? user_answers : JSON.stringify(user_answers);
    const knowledgeStr = typeof knowledge_breakdown === 'string' ? knowledge_breakdown : JSON.stringify(knowledge_breakdown);

    const result = await run(
      `INSERT INTO tblQuizSubmission (
        quiz_uuid, quiz_title, mode, score, total_questions, score_percent, 
        time_taken_seconds, max_streak, user_answers, knowledge_breakdown, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))`,
      [
        uuid,
        quiz_title || '',
        mode,
        Number(score),
        Number(total_questions),
        Number(score_percent),
        Number(time_taken_seconds),
        Number(max_streak),
        userAnswersStr,
        knowledgeStr
      ]
    );

    const inserted = await get(`SELECT * FROM tblQuizSubmission WHERE id = ?`, [result.lastID]);
    res.status(201).json({
      success: true,
      id: inserted.id,
      submission: {
        ...inserted,
        user_answers: JSON.parse(inserted.user_answers || '[]'),
        knowledge_breakdown: JSON.parse(inserted.knowledge_breakdown || '{}')
      }
    });
  } catch (err) {
    console.error(`Failed to record quiz submission for '${uuid}':`, err);
    res.status(500).json({ error: err.message });
  }
});

// 2. GET /api/quizzes/:uuid/submissions - List submissions for a specific quiz
app.get('/api/quizzes/:uuid/submissions', async (req, res) => {
  const { uuid } = req.params;
  const { limit = 100 } = req.query;
  try {
    const rows = await all(
      `SELECT id, quiz_uuid, quiz_title, mode, score, total_questions, score_percent, 
              time_taken_seconds, max_streak, knowledge_breakdown, created_at 
       FROM tblQuizSubmission 
       WHERE quiz_uuid = ? 
       ORDER BY created_at DESC 
       LIMIT ?`,
      [uuid, Number(limit)]
    );

    const totalAttempts = rows.length;
    const avgScore = totalAttempts > 0 ? Math.round(rows.reduce((sum, r) => sum + r.score_percent, 0) / totalAttempts) : 0;
    const maxScore = totalAttempts > 0 ? Math.max(...rows.map(r => r.score_percent)) : 0;

    const list = rows.map(r => ({
      ...r,
      knowledge_breakdown: JSON.parse(r.knowledge_breakdown || '{}')
    }));

    res.json({
      quiz_uuid: uuid,
      stats: {
        total_attempts: totalAttempts,
        average_score: avgScore,
        max_score: maxScore
      },
      submissions: list
    });
  } catch (err) {
    console.error(`Failed to get submissions for quiz '${uuid}':`, err);
    res.status(500).json({ error: err.message });
  }
});

// 3. GET /api/quiz-submissions - List all submissions (with optional search/filter)
app.get('/api/quiz-submissions', async (req, res) => {
  const { quiz_uuid, limit = 100, include_answers } = req.query;
  try {
    let fields = `id, quiz_uuid, quiz_title, mode, score, total_questions, score_percent, 
                  time_taken_seconds, max_streak, created_at`;
    if (include_answers === 'true' || include_answers === '1') {
      fields += `, user_answers`;
    }
    let sql = `SELECT ${fields} FROM tblQuizSubmission`;
    const params = [];
    if (quiz_uuid) {
      sql += ` WHERE quiz_uuid = ?`;
      params.push(quiz_uuid);
    }
    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(Number(limit));

    const rows = await all(sql, params);
    if (include_answers === 'true' || include_answers === '1') {
      rows.forEach(r => {
        try {
          r.user_answers = JSON.parse(r.user_answers || '[]');
        } catch (e) {
          r.user_answers = [];
        }
      });
    }
    res.json(rows);
  } catch (err) {
    console.error('Failed to get quiz submissions:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. GET /api/quiz-submissions/:id - Get single submission details (including user_answers)
app.get('/api/quiz-submissions/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const row = await get(`SELECT * FROM tblQuizSubmission WHERE id = ?`, [id]);
    if (!row) {
      return res.status(404).json({ error: `Submission #${id} not found` });
    }
    res.json({
      ...row,
      user_answers: JSON.parse(row.user_answers || '[]'),
      knowledge_breakdown: JSON.parse(row.knowledge_breakdown || '{}')
    });
  } catch (err) {
    console.error(`Failed to get submission #${id}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// 5. DELETE /api/quiz-submissions/:id - Delete a submission
app.delete('/api/quiz-submissions/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await get(`SELECT id FROM tblQuizSubmission WHERE id = ?`, [id]);
    if (!existing) {
      return res.status(404).json({ error: `Submission #${id} not found` });
    }
    await run(`DELETE FROM tblQuizSubmission WHERE id = ?`, [id]);
    res.json({ success: true, message: `Submission #${id} deleted successfully.` });
  } catch (err) {
    console.error(`Failed to delete submission #${id}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// ==========================================
// tblCoreWordsets & tblCoreWords APIs (Multiple Wordsets Support)
// ==========================================

// Core Wordsets CRUD
// 1. GET /api/core-wordsets - Retrieve core word sets (optionally filter by lessonId / courseId)
app.get('/api/core-wordsets', async (req, res) => {
  const { lessonId, courseId } = req.query;
  let sql = `
    SELECT 
      w.id,
      w.course_id as courseId,
      w.lesson_id as lessonId,
      w.title,
      w.description,
      w.sort_order as sortOrder,
      w.created_at as createdAt,
      w.updated_at as updatedAt,
      (SELECT COUNT(*) FROM tblCoreWords WHERE set_id = w.id) as wordCount
    FROM tblCoreWordsets w
    WHERE 1=1
  `;
  const params = [];

  if (lessonId) {
    sql += ` AND w.lesson_id = ?`;
    params.push(lessonId);
  }
  if (courseId) {
    sql += ` AND w.course_id = ?`;
    params.push(courseId);
  }

  sql += ` ORDER BY w.sort_order ASC, w.created_at ASC`;

  try {
    const rows = await all(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Failed to query core wordsets:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. GET /api/core-wordsets/:id - Retrieve single wordset
app.get('/api/core-wordsets/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const sql = `
      SELECT 
        w.id,
        w.course_id as courseId,
        w.lesson_id as lessonId,
        w.title,
        w.description,
        w.sort_order as sortOrder,
        w.created_at as createdAt,
        w.updated_at as updatedAt,
        (SELECT COUNT(*) FROM tblCoreWords WHERE set_id = w.id) as wordCount
      FROM tblCoreWordsets w
      WHERE w.id = ?
    `;
    const row = await get(sql, [id]);
    if (!row) {
      return res.status(404).json({ error: "Core wordset not found" });
    }
    res.json(row);
  } catch (err) {
    console.error('Failed to get core wordset by ID:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. POST /api/core-wordsets - Create a new wordset
app.post('/api/core-wordsets', async (req, res) => {
  try {
    const { id, courseId, lessonId, title, description, sortOrder } = req.body;
    if (!lessonId) {
      return res.status(400).json({ error: "Field 'lessonId' is required." });
    }
    if (!title || !title.trim()) {
      return res.status(400).json({ error: "Field 'title' is required." });
    }

    const cleanLesId = lessonId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const setId = id || `set_${cleanLesId}_${Date.now().toString(36)}`;
    const finalSortOrder = sortOrder !== undefined ? sortOrder : 0;
    const finalDesc = description || '';

    // Auto find course_id if not provided
    let finalCourseId = courseId || null;
    if (!finalCourseId) {
      const lessonRow = await get(`SELECT course_id FROM course_lessons WHERE id = ?`, [lessonId]);
      if (lessonRow) finalCourseId = lessonRow.course_id;
    }

    await run(
      `INSERT INTO tblCoreWordsets (id, course_id, lesson_id, title, description, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
      [setId, finalCourseId, lessonId, title.trim(), finalDesc, finalSortOrder]
    );

    const created = await get(
      `SELECT 
        w.id,
        w.course_id as courseId,
        w.lesson_id as lessonId,
        w.title,
        w.description,
        w.sort_order as sortOrder,
        w.created_at as createdAt,
        w.updated_at as updatedAt,
        0 as wordCount
      FROM tblCoreWordsets w WHERE w.id = ?`,
      [setId]
    );

    res.status(201).json(created);
  } catch (err) {
    console.error('Failed to create core wordset:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. PUT /api/core-wordsets/:id - Update wordset metadata
app.put('/api/core-wordsets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await get(`SELECT * FROM tblCoreWordsets WHERE id = ?`, [id]);
    if (!existing) {
      return res.status(404).json({ error: "Core wordset not found" });
    }

    const { title, description, sortOrder, lessonId, courseId } = req.body;
    const newTitle = title !== undefined ? title.trim() : existing.title;
    const newDesc = description !== undefined ? description : existing.description;
    const newSortOrder = sortOrder !== undefined ? sortOrder : existing.sort_order;
    const newLessonId = lessonId !== undefined ? lessonId : existing.lesson_id;
    const newCourseId = courseId !== undefined ? courseId : existing.course_id;

    await run(
      `UPDATE tblCoreWordsets SET title = ?, description = ?, sort_order = ?, lesson_id = ?, course_id = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
      [newTitle, newDesc, newSortOrder, newLessonId, newCourseId, id]
    );

    const updated = await get(
      `SELECT 
        w.id,
        w.course_id as courseId,
        w.lesson_id as lessonId,
        w.title,
        w.description,
        w.sort_order as sortOrder,
        w.created_at as createdAt,
        w.updated_at as updatedAt,
        (SELECT COUNT(*) FROM tblCoreWords WHERE set_id = w.id) as wordCount
      FROM tblCoreWordsets w WHERE w.id = ?`,
      [id]
    );

    res.json(updated);
  } catch (err) {
    console.error('Failed to update core wordset:', err);
    res.status(500).json({ error: err.message });
  }
});

// 5. DELETE /api/core-wordsets/:id - Delete wordset (and optionally its words)
app.delete('/api/core-wordsets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await get(`SELECT * FROM tblCoreWordsets WHERE id = ?`, [id]);
    if (!existing) {
      return res.status(404).json({ error: "Core wordset not found" });
    }

    // Delete associated words in this set
    await run(`DELETE FROM tblCoreWords WHERE set_id = ?`, [id]);
    // Delete the wordset record
    await run(`DELETE FROM tblCoreWordsets WHERE id = ?`, [id]);

    res.json({ message: "Core wordset and its words deleted successfully", id });
  } catch (err) {
    console.error('Failed to delete core wordset:', err);
    res.status(500).json({ error: err.message });
  }
});

// tblCoreWords API
const formatCoreWordRow = (row) => {
  if (!row) return null;
  try {
    const data = JSON.parse(row.data_json);
    data.id = row.id;
    data.lessonId = row.lesson_id;
    data.setId = row.set_id || data.setId || null;
    data.order = row.sort_order;
    data.word = row.word;
    data.ipa = row.ipa;
    return data;
  } catch (err) {
    console.error(`Failed to parse data_json for CoreWord ID ${row.id}:`, err);
    return {
      id: row.id,
      lessonId: row.lesson_id,
      setId: row.set_id || null,
      order: row.sort_order,
      word: row.word,
      ipa: row.ipa,
      meanings: [],
      error: "Malformed data_json"
    };
  }
};

// 1. GET /api/core-words - Retrieve core words (supports setId, lessonId, search)
app.get('/api/core-words', async (req, res) => {
  const { lessonId, setId, search } = req.query;
  let sql = `SELECT * FROM tblCoreWords WHERE 1=1`;
  const params = [];

  if (setId) {
    sql += ` AND set_id = ?`;
    params.push(setId);
  }

  if (lessonId) {
    sql += ` AND lesson_id = ?`;
    params.push(lessonId);
  }

  if (search) {
    sql += ` AND (word LIKE ? OR data_json LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`);
  }

  sql += ` ORDER BY lesson_id ASC, sort_order ASC, created_at ASC`;

  try {
    const rows = await all(sql, params);
    res.json(rows.map(formatCoreWordRow));
  } catch (err) {
    console.error('Failed to query core-words list:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. GET /api/core-words/:id - Retrieve single core word
app.get('/api/core-words/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const row = await get(`SELECT * FROM tblCoreWords WHERE id = ?`, [id]);
    if (!row) {
      return res.status(404).json({ error: "Core word not found" });
    }
    res.json(formatCoreWordRow(row));
  } catch (err) {
    console.error('Failed to get core-word by ID:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. POST /api/core-words - Create a new core word
app.post('/api/core-words', async (req, res) => {
  try {
    const wordData = req.body;
    const lessonId = wordData.lessonId || null;
    let setId = wordData.setId || wordData.set_id || null;
    const sortOrder = wordData.order !== undefined ? wordData.order : 0;
    const word = wordData.word || '';
    const ipa = wordData.ipa || '';

    if (!word) {
      return res.status(400).json({ error: "Field 'word' is required." });
    }

    // Auto resolve default wordset for lesson if setId not provided
    if (!setId && lessonId) {
      const defaultSet = await get(`SELECT id FROM tblCoreWordsets WHERE lesson_id = ? ORDER BY sort_order ASC, created_at ASC LIMIT 1`, [lessonId]);
      if (defaultSet) {
        setId = defaultSet.id;
      }
    }

    let finalId = wordData.id;
    if (!finalId) {
      const cleanSet = setId ? setId.replace(/^set_/, '').replace(/[^a-zA-Z0-9]/g, '') : (lessonId ? lessonId.replace(/[^a-zA-Z0-9]/g, '') : 'word');
      finalId = `cw_${cleanSet}_${Date.now().toString(36)}`;
    } else {
      const existing = await get(`SELECT id FROM tblCoreWords WHERE id = ?`, [finalId]);
      if (existing) {
        finalId = `${finalId}_${Date.now().toString(36)}`;
      }
    }

    wordData.id = finalId;
    wordData.setId = setId;
    await run(
      `INSERT INTO tblCoreWords (id, lesson_id, set_id, sort_order, word, ipa, data_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [finalId, lessonId, setId, sortOrder, word, ipa, JSON.stringify(wordData)]
    );

    res.status(201).json(wordData);
  } catch (err) {
    console.error('Failed to create core-word:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. PUT /api/core-words/:id - Update an existing core word
app.put('/api/core-words/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const wordData = req.body;
    wordData.id = id;

    const existing = await get(`SELECT * FROM tblCoreWords WHERE id = ?`, [id]);
    if (!existing) {
      return res.status(404).json({ error: "Core word not found" });
    }

    const lessonId = wordData.lessonId !== undefined ? wordData.lessonId : existing.lesson_id;
    let setId = wordData.setId !== undefined ? wordData.setId : (wordData.set_id !== undefined ? wordData.set_id : existing.set_id);
    const sortOrder = wordData.order !== undefined ? wordData.order : (existing.sort_order || 0);
    const word = wordData.word || existing.word;
    const ipa = wordData.ipa !== undefined ? wordData.ipa : existing.ipa;

    if (!word) {
      return res.status(400).json({ error: "Field 'word' is required." });
    }

    wordData.setId = setId;
    await run(
      `UPDATE tblCoreWords SET lesson_id = ?, set_id = ?, sort_order = ?, word = ?, ipa = ?, data_json = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
      [lessonId, setId, sortOrder, word, ipa, JSON.stringify(wordData), id]
    );

    res.json(wordData);
  } catch (err) {
    console.error('Failed to update core-word:', err);
    res.status(500).json({ error: err.message });
  }
});

// 5. DELETE /api/core-words/:id - Delete a core word
app.delete('/api/core-words/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await run(`DELETE FROM tblCoreWords WHERE id = ?`, [id]);
    res.json({ message: "Core word deleted successfully", id });
  } catch (err) {
    console.error('Failed to delete core-word:', err);
    res.status(500).json({ error: err.message });
  }
});

// 6. POST /api/core-words/import - Bulk import core words array (supports setId, replaceSet, cross-set collision prevention)
app.post('/api/core-words/import', async (req, res) => {
  try {
    const { words, lessonId, setId, replaceLesson, replaceSet } = req.body;
    const items = Array.isArray(words) ? words : (Array.isArray(req.body) ? req.body : [words]);

    if (!items || items.length === 0) {
      return res.status(400).json({ error: "Empty words array provided" });
    }

    // Resolve target wordset and lesson
    let resolvedSetId = setId || null;
    let resolvedLessonId = lessonId || null;

    if (resolvedSetId) {
      const setRow = await get(`SELECT id, lesson_id, course_id FROM tblCoreWordsets WHERE id = ?`, [resolvedSetId]);
      if (setRow && setRow.lesson_id) {
        resolvedLessonId = setRow.lesson_id;
      }
    } else if (resolvedLessonId) {
      const defaultSet = await get(`SELECT id FROM tblCoreWordsets WHERE lesson_id = ? ORDER BY sort_order ASC, created_at ASC LIMIT 1`, [resolvedLessonId]);
      if (defaultSet) {
        resolvedSetId = defaultSet.id;
      }
    }

    // Handle replace modes:
    if (replaceSet && resolvedSetId) {
      await run(`DELETE FROM tblCoreWords WHERE set_id = ?`, [resolvedSetId]);
    } else if (replaceLesson && resolvedLessonId) {
      await run(`DELETE FROM tblCoreWords WHERE lesson_id = ?`, [resolvedLessonId]);
    }

    let insertedCount = 0;
    let updatedCount = 0;

    // Determine current max sort_order for the target set (if incremental append)
    let maxOrder = 0;
    if (resolvedSetId && !replaceSet && !replaceLesson) {
      const maxRow = await get(`SELECT MAX(sort_order) as maxOrder FROM tblCoreWords WHERE set_id = ?`, [resolvedSetId]);
      if (maxRow && maxRow.maxOrder) {
        maxOrder = maxRow.maxOrder;
      }
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item || (!item.word && !item.headword)) continue;

      const word = item.word || item.headword;
      const ipa = item.ipa || '';

      // Target set & lesson:
      // When resolvedSetId is designated at request level, FORCE targetSetId to resolvedSetId
      const targetSetId = resolvedSetId || item.setId || item.set_id || null;
      let targetLessonId = resolvedLessonId || item.lessonId || item.lesson_id || null;

      if (!targetLessonId && targetSetId) {
        const sRow = await get(`SELECT lesson_id FROM tblCoreWordsets WHERE id = ?`, [targetSetId]);
        if (sRow) targetLessonId = sRow.lesson_id;
      }

      // Sort order
      let sortOrder;
      if (item.order !== undefined && item.order !== null) {
        sortOrder = item.order;
      } else if (maxOrder > 0) {
        maxOrder++;
        sortOrder = maxOrder;
      } else {
        sortOrder = i + 1;
      }

      // Determine ID and whether to update or insert:
      let finalId = null;
      let isUpdate = false;

      if (item.id) {
        const existingRow = await get(`SELECT id, set_id, lesson_id FROM tblCoreWords WHERE id = ?`, [item.id]);
        if (existingRow) {
          // Check if it belongs to the EXACT same wordset (or same lesson if no sets):
          const sameSet = targetSetId 
            ? (existingRow.set_id === targetSetId) 
            : (!existingRow.set_id && existingRow.lesson_id === targetLessonId);

          if (sameSet) {
            // Intentional update within the same set
            finalId = item.id;
            isUpdate = true;
          } else {
            // CRITICAL: ID exists in another wordset/lesson! Do NOT overwrite or steal it!
            finalId = null;
          }
        } else {
          finalId = item.id;
        }
      }

      // Generate a collision-free ID if finalId is not set
      if (!finalId) {
        const itemCleanSet = targetSetId 
          ? targetSetId.replace(/^set_/, '').replace(/[^a-zA-Z0-9]/g, '')
          : (targetLessonId ? targetLessonId.replace(/[^a-zA-Z0-9]/g, '') : 'word');
        
        let seq = (item.order !== undefined && item.order !== null) ? item.order : (i + 1);
        let candidateId = `cw_${itemCleanSet}_${String(seq).padStart(3, '0')}`;
        
        // Loop until an unused ID is found in the entire tblCoreWords table
        while (await get(`SELECT id FROM tblCoreWords WHERE id = ?`, [candidateId])) {
          seq++;
          candidateId = `cw_${itemCleanSet}_${String(seq).padStart(3, '0')}`;
        }
        finalId = candidateId;
      }

      // Update item payload for storage in data_json
      item.id = finalId;
      item.lessonId = targetLessonId;
      item.setId = targetSetId;
      item.order = sortOrder;
      item.word = word;
      item.ipa = ipa;

      if (isUpdate) {
        await run(
          `UPDATE tblCoreWords SET lesson_id = ?, set_id = ?, sort_order = ?, word = ?, ipa = ?, data_json = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
          [targetLessonId, targetSetId, sortOrder, word, ipa, JSON.stringify(item), finalId]
        );
        updatedCount++;
      } else {
        await run(
          `INSERT INTO tblCoreWords (id, lesson_id, set_id, sort_order, word, ipa, data_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [finalId, targetLessonId, targetSetId, sortOrder, word, ipa, JSON.stringify(item)]
        );
        insertedCount++;
      }
    }

    res.json({
      success: true,
      totalReceived: items.length,
      insertedCount,
      updatedCount,
      message: `成功导入 ${insertedCount} 个新核心词条，更新 ${updatedCount} 个已有词条。`
    });
  } catch (err) {
    console.error('Failed to bulk import core-words:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// Proxy for external Ray Dictionary Decks API
// ==========================================
const MAX_PROXY_LOGS = 50;
const proxyLogsBuffer = [];

function addProxyLog(entry) {
  proxyLogsBuffer.unshift(entry);
  if (proxyLogsBuffer.length > MAX_PROXY_LOGS) {
    proxyLogsBuffer.pop();
  }
}

app.get('/api/proxy/decks-logs', (req, res) => {
  res.json({ success: true, logs: proxyLogsBuffer });
});

app.delete('/api/proxy/decks-logs', (req, res) => {
  proxyLogsBuffer.length = 0;
  res.json({ success: true, message: 'Logs cleared', count: 0 });
});

app.all(['/api/proxy/decks', '/api/proxy/decks/*'], async (req, res) => {
  const startTime = Date.now();
  const subPath = req.params[0] ? `/${req.params[0]}` : '';
  const targetBase = req.headers['x-target-base'] || 'https://ray-dictionary-v2.ai.studio';
  const effectiveUserId = req.query.userId || req.query.userid || req.headers['x-user-id'] || 'oo9jUBx6ahTmPQ5Dml6yqv6xVcF3';
  const isDebug = req.headers['x-proxy-debug'] === '1' || req.query._debug === '1';

  let remoteQuery = '';
  try {
    const parsed = new URL(req.url, 'http://localhost');
    const params = new URLSearchParams(parsed.search);
    params.delete('_debug');
    if (effectiveUserId && !params.has('userId')) {
      params.set('userId', effectiveUserId);
    }
    const q = params.toString();
    remoteQuery = q ? `?${q}` : '';
  } catch (e) {
    let queryString = req.url.includes('?') ? '?' + req.url.split('?')[1] : '';
    if (effectiveUserId && !/[?&]userId=/i.test(queryString)) {
      queryString += (queryString ? '&' : '?') + `userId=${encodeURIComponent(effectiveUserId)}`;
    }
    remoteQuery = queryString;
  }

  const targetUrl = `${targetBase.replace(/\/+$/, '')}/api/decks${subPath}${remoteQuery}`;

  const proxyHeaders = {
    'Content-Type': 'application/json',
    'x-user-id': effectiveUserId
  };

  const fetchOptions = {
    method: req.method,
    headers: proxyHeaders
  };

  let forwardedBody = undefined;
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body && Object.keys(req.body).length > 0) {
    let bodyObj = typeof req.body === 'object' ? JSON.parse(JSON.stringify(req.body)) : req.body;
    if (typeof bodyObj === 'object' && !bodyObj.userId && effectiveUserId) {
      bodyObj.userId = effectiveUserId;
    }
    forwardedBody = bodyObj;
    fetchOptions.body = typeof forwardedBody === 'string' ? forwardedBody : JSON.stringify(forwardedBody);
  }

  const appToProxyInfo = {
    method: req.method,
    originalUrl: req.originalUrl,
    subPath: subPath || '/',
    headers: {
      'content-type': req.headers['content-type'] || 'application/json',
      'x-user-id': req.headers['x-user-id'] || null,
      'x-target-base': req.headers['x-target-base'] || null,
      'x-proxy-debug': req.headers['x-proxy-debug'] || null
    },
    queryParams: req.query,
    body: req.body && Object.keys(req.body).length > 0 ? req.body : null
  };

  const proxyToRemoteInfo = {
    method: req.method,
    targetUrl: targetUrl,
    headers: proxyHeaders,
    body: forwardedBody || null
  };

  try {
    const remoteResponse = await fetch(targetUrl, fetchOptions);
    const remoteDurationMs = Date.now() - startTime;
    const rawText = await remoteResponse.text().catch(() => '');
    let remoteData = null;
    try {
      remoteData = JSON.parse(rawText);
    } catch (parseErr) {
      remoteData = rawText;
    }

    const remoteHeadersObj = {};
    if (remoteResponse.headers && typeof remoteResponse.headers.forEach === 'function') {
      remoteResponse.headers.forEach((val, key) => {
        remoteHeadersObj[key] = val;
      });
    }

    const logEntry = {
      id: 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8),
      timestamp: new Date().toISOString(),
      durationMs: remoteDurationMs,
      success: remoteResponse.ok,
      appToProxy: appToProxyInfo,
      proxyToRemote: proxyToRemoteInfo,
      remoteResponse: {
        status: remoteResponse.status,
        statusText: remoteResponse.statusText,
        headers: remoteHeadersObj,
        data: remoteData
      }
    };

    addProxyLog(logEntry);

    if (isDebug) {
      return res.status(200).json({
        success: remoteResponse.ok,
        remoteStatus: remoteResponse.status,
        remoteStatusText: remoteResponse.statusText,
        durationMs: remoteDurationMs,
        log: logEntry,
        data: remoteData
      });
    }

    if (remoteData !== null) {
      res.status(remoteResponse.status).json(remoteData);
    } else {
      res.status(remoteResponse.status).send(rawText);
    }
  } catch (err) {
    console.error('Error proxying deck request:', err);
    const durationMs = Date.now() - startTime;
    const errorLogEntry = {
      id: 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8),
      timestamp: new Date().toISOString(),
      durationMs,
      success: false,
      error: err.message,
      appToProxy: appToProxyInfo,
      proxyToRemote: proxyToRemoteInfo,
      remoteResponse: {
        status: 502,
        statusText: 'Bad Gateway / Network Error',
        headers: {},
        data: { error: err.message }
      }
    };

    addProxyLog(errorLogEntry);

    if (isDebug) {
      return res.status(200).json({
        success: false,
        remoteStatus: 502,
        remoteStatusText: 'Network Error',
        durationMs,
        error: err.message,
        log: errorLogEntry
      });
    }

    res.status(500).json({ success: false, error: err.message });
  }
});


// ==========================================
// THAI-CHINESE IDIOMS / PROVERBS CRUD API (tblIdioms)
// ==========================================

const formatIdiomRow = (row) => {
  if (!row) return null;
  try {
    const data = JSON.parse(row.data_json);
    data.id = row.id;
    data.sortOrder = row.sort_order;
    data.order = row.sort_order;
    data.thaiPhrase = row.thai_phrase;
    data.chineseMeaning = row.chinese_meaning;
    data.thaiExample = row.thai_example;
    data.exampleTranslation = row.example_translation || data.exampleTranslation || '';
    data.literalMeaning = row.literal_meaning || data.literalMeaning || '';
    data.notes = row.notes || data.notes || '';
    data.tags = row.tags || data.tags || '';
    data.createdAt = row.created_at;
    data.updatedAt = row.updated_at;
    return data;
  } catch (err) {
    return {
      id: row.id,
      sortOrder: row.sort_order,
      order: row.sort_order,
      thaiPhrase: row.thai_phrase,
      chineseMeaning: row.chinese_meaning,
      thaiExample: row.thai_example,
      exampleTranslation: row.example_translation || '',
      literalMeaning: row.literal_meaning || '',
      notes: row.notes || '',
      tags: row.tags || '',
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
};

// 1. GET /api/idioms - Retrieve idioms list (supports search, tag filtering, sorting)
app.get('/api/idioms', async (req, res) => {
  try {
    const { search, tag, sortBy, order } = req.query;
    let sql = `SELECT * FROM tblIdioms WHERE 1=1`;
    const params = [];

    if (search) {
      sql += ` AND (thai_phrase LIKE ? OR chinese_meaning LIKE ? OR thai_example LIKE ? OR notes LIKE ? OR literal_meaning LIKE ? OR tags LIKE ?)`;
      const s = `%${search}%`;
      params.push(s, s, s, s, s, s);
    }

    if (tag && tag !== 'all') {
      sql += ` AND (tags LIKE ?)`;
      params.push(`%${tag}%`);
    }

    const sortField = (sortBy === 'thai' || sortBy === 'thai_phrase') ? 'thai_phrase' :
                      (sortBy === 'chinese' || sortBy === 'chinese_meaning') ? 'chinese_meaning' :
                      (sortBy === 'created_at' || sortBy === 'updated_at') ? sortBy : 'sort_order';
    const sortDir = (order && order.toUpperCase() === 'DESC') ? 'DESC' : 'ASC';

    sql += ` ORDER BY ${sortField} ${sortDir}, id ASC`;

    const rows = await all(sql, params);
    res.json(rows.map(formatIdiomRow));
  } catch (err) {
    console.error('Failed to query idioms list:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. GET /api/idioms/:id - Retrieve single idiom by ID
app.get('/api/idioms/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const row = await get(`SELECT * FROM tblIdioms WHERE id = ?`, [id]);
    if (!row) {
      return res.status(404).json({ error: "Idiom not found" });
    }
    res.json(formatIdiomRow(row));
  } catch (err) {
    console.error('Failed to get idiom by ID:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. POST /api/idioms - Create a new idiom
app.post('/api/idioms', async (req, res) => {
  try {
    const data = req.body;
    const thaiPhrase = (data.thaiPhrase || data.thai_phrase || '').trim();
    const chineseMeaning = (data.chineseMeaning || data.chinese_meaning || '').trim();

    if (!thaiPhrase || !chineseMeaning) {
      return res.status(400).json({ error: "thaiPhrase and chineseMeaning are required fields." });
    }

    let sortOrder = data.sortOrder !== undefined ? data.sortOrder : (data.order !== undefined ? data.order : null);
    if (sortOrder === null || isNaN(sortOrder)) {
      const maxRow = await get(`SELECT MAX(sort_order) as maxOrder FROM tblIdioms`);
      sortOrder = (maxRow && maxRow.maxOrder !== null) ? maxRow.maxOrder + 1 : 1;
    }

    const id = data.id || `idm_${String(sortOrder).padStart(3, '0')}_${Date.now().toString(36)}`;
    const thaiExample = data.thaiExample || data.thai_example || '';
    const exampleTranslation = data.exampleTranslation || data.example_translation || '';
    const literalMeaning = data.literalMeaning || data.literal_meaning || '';
    const notes = data.notes || '';
    const tags = Array.isArray(data.tags) ? data.tags.join(',') : (data.tags || '');

    const idiomObj = {
      id,
      sortOrder,
      order: sortOrder,
      thaiPhrase,
      chineseMeaning,
      thaiExample,
      exampleTranslation,
      literalMeaning,
      notes,
      tags
    };

    await run(
      `INSERT INTO tblIdioms (id, sort_order, thai_phrase, chinese_meaning, thai_example, example_translation, literal_meaning, notes, tags, data_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, sortOrder, thaiPhrase, chineseMeaning, thaiExample, exampleTranslation, literalMeaning, notes, tags, JSON.stringify(idiomObj)]
    );

    res.status(201).json(idiomObj);
  } catch (err) {
    console.error('Failed to create idiom:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. PUT /api/idioms/:id - Update an existing idiom
app.put('/api/idioms/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    const existing = await get(`SELECT * FROM tblIdioms WHERE id = ?`, [id]);
    if (!existing) {
      return res.status(404).json({ error: "Idiom not found" });
    }

    const thaiPhrase = (data.thaiPhrase !== undefined ? data.thaiPhrase : (data.thai_phrase !== undefined ? data.thai_phrase : existing.thai_phrase)).trim();
    const chineseMeaning = (data.chineseMeaning !== undefined ? data.chineseMeaning : (data.chinese_meaning !== undefined ? data.chinese_meaning : existing.chinese_meaning)).trim();

    if (!thaiPhrase || !chineseMeaning) {
      return res.status(400).json({ error: "thaiPhrase and chineseMeaning cannot be empty." });
    }

    const sortOrder = data.sortOrder !== undefined ? data.sortOrder : (data.order !== undefined ? data.order : existing.sort_order);
    const thaiExample = data.thaiExample !== undefined ? data.thaiExample : (data.thai_example !== undefined ? data.thai_example : existing.thai_example);
    const exampleTranslation = data.exampleTranslation !== undefined ? data.exampleTranslation : (data.example_translation !== undefined ? data.example_translation : existing.example_translation);
    const literalMeaning = data.literalMeaning !== undefined ? data.literalMeaning : (data.literal_meaning !== undefined ? data.literal_meaning : existing.literal_meaning);
    const notes = data.notes !== undefined ? data.notes : existing.notes;
    const tags = Array.isArray(data.tags) ? data.tags.join(',') : (data.tags !== undefined ? data.tags : existing.tags);

    const idiomObj = {
      ...JSON.parse(existing.data_json || '{}'),
      ...data,
      id,
      sortOrder,
      order: sortOrder,
      thaiPhrase,
      chineseMeaning,
      thaiExample,
      exampleTranslation,
      literalMeaning,
      notes,
      tags
    };

    await run(
      `UPDATE tblIdioms SET sort_order = ?, thai_phrase = ?, chinese_meaning = ?, thai_example = ?, example_translation = ?, literal_meaning = ?, notes = ?, tags = ?, data_json = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
      [sortOrder, thaiPhrase, chineseMeaning, thaiExample, exampleTranslation, literalMeaning, notes, tags, JSON.stringify(idiomObj), id]
    );

    res.json(idiomObj);
  } catch (err) {
    console.error('Failed to update idiom:', err);
    res.status(500).json({ error: err.message });
  }
});

// 5. DELETE /api/idioms/:id - Delete an idiom
app.delete('/api/idioms/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await run(`DELETE FROM tblIdioms WHERE id = ?`, [id]);
    res.json({ message: "Idiom deleted successfully", id });
  } catch (err) {
    console.error('Failed to delete idiom:', err);
    res.status(500).json({ error: err.message });
  }
});

// 6. POST /api/idioms/import - Bulk import idioms (array of items or markdown/JSON payload)
app.post('/api/idioms/import', async (req, res) => {
  try {
    const { items, replaceAll } = req.body;
    const idiomsList = Array.isArray(items) ? items : (Array.isArray(req.body) ? req.body : []);

    if (!idiomsList || idiomsList.length === 0) {
      return res.status(400).json({ error: "No idiom items provided to import." });
    }

    if (replaceAll) {
      await run(`DELETE FROM tblIdioms`);
    }

    let insertedCount = 0;
    let updatedCount = 0;

    for (let i = 0; i < idiomsList.length; i++) {
      const it = idiomsList[i];
      if (!it) continue;
      const thaiPhrase = (it.thaiPhrase || it.thai_phrase || it['泰语核心熟语 / 短语'] || it['泰语核心熟语/短语'] || '').trim();
      const chineseMeaning = (it.chineseMeaning || it.chinese_meaning || it['中文成语 / 熟语'] || it['中文成语/熟语'] || '').trim();
      if (!thaiPhrase || !chineseMeaning) continue;

      const sortOrder = it.sortOrder !== undefined ? it.sortOrder : (it.order !== undefined ? it.order : (it['编号'] ? parseInt(it['编号'], 10) : (i + 1)));
      const id = it.id || `idm_${String(sortOrder || i + 1).padStart(3, '0')}`;
      const thaiExample = (it.thaiExample || it.thai_example || it['泰语例句 (原句)'] || it['泰语例句'] || '').trim();
      const exampleTranslation = (it.exampleTranslation || it.example_translation || '').trim();
      const literalMeaning = (it.literalMeaning || it.literal_meaning || '').trim();
      const notes = (it.notes || '').trim();
      const tags = Array.isArray(it.tags) ? it.tags.join(',') : (it.tags || '');

      const idiomObj = {
        id,
        sortOrder,
        order: sortOrder,
        thaiPhrase,
        chineseMeaning,
        thaiExample,
        exampleTranslation,
        literalMeaning,
        notes,
        tags
      };

      const existing = await get(`SELECT id FROM tblIdioms WHERE id = ?`, [id]);
      if (existing) {
        await run(
          `UPDATE tblIdioms SET sort_order = ?, thai_phrase = ?, chinese_meaning = ?, thai_example = ?, example_translation = ?, literal_meaning = ?, notes = ?, tags = ?, data_json = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
          [sortOrder, thaiPhrase, chineseMeaning, thaiExample, exampleTranslation, literalMeaning, notes, tags, JSON.stringify(idiomObj), id]
        );
        updatedCount++;
      } else {
        await run(
          `INSERT INTO tblIdioms (id, sort_order, thai_phrase, chinese_meaning, thai_example, example_translation, literal_meaning, notes, tags, data_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, sortOrder, thaiPhrase, chineseMeaning, thaiExample, exampleTranslation, literalMeaning, notes, tags, JSON.stringify(idiomObj)]
        );
        insertedCount++;
      }
    }

    res.json({
      success: true,
      totalReceived: idiomsList.length,
      insertedCount,
      updatedCount,
      message: `成功导入 ${insertedCount} 条新熟语/成语，更新 ${updatedCount} 条已有记录。`
    });
  } catch (err) {
    console.error('Failed to bulk import idioms:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// THAI WORDBANK CRUD API (tblWordBank)
// ==========================================

const formatWordBankRow = (row) => {
  if (!row) return null;
  try {
    const data = JSON.parse(row.data_json);
    data.id = row.id;
    data.lessonId = row.lesson_id;
    data.order = row.sort_order;
    data.thai = row.thai;
    data.chinese = row.chinese;
    return data;
  } catch (err) {
    console.error(`Failed to parse wordbank data_json for ID ${row.id}:`, err);
    return {
      id: row.id,
      lessonId: row.lesson_id,
      order: row.sort_order,
      thai: row.thai,
      chinese: row.chinese,
      error: "Malformed data_json"
    };
  }
};

// 1. GET /api/wordbank - Retrieve all wordbank words (filter by lessonId, courseId, or search)
app.get('/api/wordbank', async (req, res) => {
  const { lessonId, courseId, search } = req.query;
  let sql = `SELECT wb.* FROM tblWordBank wb`;
  const params = [];

  if (courseId) {
    sql += ` INNER JOIN course_lessons cl ON wb.lesson_id = cl.id WHERE cl.course_id = ?`;
    params.push(courseId);
  } else {
    sql += ` WHERE 1=1`;
  }

  if (lessonId) {
    sql += ` AND wb.lesson_id = ?`;
    params.push(lessonId);
  }

  if (search) {
    sql += ` AND (wb.thai LIKE ? OR wb.chinese LIKE ? OR wb.data_json LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  sql += ` ORDER BY wb.lesson_id ASC, wb.sort_order ASC, wb.created_at ASC`;

  try {
    const rows = await all(sql, params);
    res.json(rows.map(formatWordBankRow));
  } catch (err) {
    console.error('Failed to query wordbank list:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. GET /api/wordbank/:id - Retrieve single wordbank word
app.get('/api/wordbank/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const row = await get(`SELECT * FROM tblWordBank WHERE id = ?`, [id]);
    if (!row) {
      return res.status(404).json({ error: `Wordbank item '${id}' not found` });
    }
    res.json(formatWordBankRow(row));
  } catch (err) {
    console.error('Failed to get wordbank item by ID:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. POST /api/wordbank - Create a new wordbank item
app.post('/api/wordbank', async (req, res) => {
  try {
    const wordData = req.body;
    const lessonId = wordData.lessonId || wordData.lesson_id || null;
    const thai = (wordData.thai || wordData.word || '').trim();
    const chinese = (wordData.chinese || wordData.meaning || '').trim();
    const sortOrder = wordData.order !== undefined ? parseInt(wordData.order, 10) : (wordData.sort_order !== undefined ? parseInt(wordData.sort_order, 10) : 0);
    const id = wordData.id ? String(wordData.id) : `wb_${lessonId ? lessonId + '_' : ''}${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;

    if (!thai || !chinese) {
      return res.status(400).json({ error: "Fields 'thai' and 'chinese' are required." });
    }

    wordData.id = id;
    wordData.lessonId = lessonId;
    wordData.order = sortOrder;
    wordData.thai = thai;
    wordData.chinese = chinese;

    await run(
      `INSERT INTO tblWordBank (id, lesson_id, sort_order, thai, chinese, data_json) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, lessonId, sortOrder, thai, chinese, JSON.stringify(wordData)]
    );

    res.status(201).json(wordData);
  } catch (err) {
    console.error('Failed to create wordbank item:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. PUT /api/wordbank/:id - Update an existing wordbank item
app.put('/api/wordbank/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const wordData = req.body;
    wordData.id = id;

    const lessonId = wordData.lessonId || wordData.lesson_id || null;
    const thai = (wordData.thai || wordData.word || '').trim();
    const chinese = (wordData.chinese || wordData.meaning || '').trim();
    const sortOrder = wordData.order !== undefined ? parseInt(wordData.order, 10) : (wordData.sort_order !== undefined ? parseInt(wordData.sort_order, 10) : 0);

    if (!thai || !chinese) {
      return res.status(400).json({ error: "Fields 'thai' and 'chinese' are required." });
    }

    wordData.lessonId = lessonId;
    wordData.order = sortOrder;
    wordData.thai = thai;
    wordData.chinese = chinese;

    const existing = await get(`SELECT id FROM tblWordBank WHERE id = ?`, [id]);
    if (!existing) {
      return res.status(404).json({ error: `Wordbank item '${id}' not found` });
    }

    await run(
      `UPDATE tblWordBank SET lesson_id = ?, sort_order = ?, thai = ?, chinese = ?, data_json = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
      [lessonId, sortOrder, thai, chinese, JSON.stringify(wordData), id]
    );

    res.json(wordData);
  } catch (err) {
    console.error('Failed to update wordbank item:', err);
    res.status(500).json({ error: err.message });
  }
});

// 5. DELETE /api/wordbank/:id - Delete a wordbank item
app.delete('/api/wordbank/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await get(`SELECT id FROM tblWordBank WHERE id = ?`, [id]);
    if (!existing) {
      return res.status(404).json({ error: `Wordbank item '${id}' not found` });
    }
    await run(`DELETE FROM tblWordBank WHERE id = ?`, [id]);
    res.json({ success: true, message: `Wordbank item '${id}' deleted successfully`, id });
  } catch (err) {
    console.error('Failed to delete wordbank item:', err);
    res.status(500).json({ error: err.message });
  }
});

// 6. POST /api/wordbank/import - Bulk import wordbank JSON array
app.post('/api/wordbank/import', async (req, res) => {
  try {
    const body = req.body;
    let items = [];
    let targetLessonId = req.query.lessonId || null;
    let replaceLesson = false;

    if (Array.isArray(body)) {
      items = body;
    } else if (body && typeof body === 'object') {
      items = Array.isArray(body.words) ? body.words : (Array.isArray(body.data) ? body.data : [body]);
      if (body.lessonId || body.lesson_id) targetLessonId = body.lessonId || body.lesson_id;
      if (body.replaceLesson !== undefined) replaceLesson = Boolean(body.replaceLesson);
    }

    if (!items || items.length === 0) {
      return res.status(400).json({ error: "No words provided for import" });
    }

    if (replaceLesson && targetLessonId) {
      await run(`DELETE FROM tblWordBank WHERE lesson_id = ?`, [targetLessonId]);
    }

    let insertedCount = 0;
    let updatedCount = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item) continue;

      const thai = (item.thai || item.word || item.headword || '').trim();
      const chinese = (item.chinese || item.meaning || item.definition || '').trim();
      if (!thai) continue;

      const itemLessonId = item.lessonId || item.lesson_id || targetLessonId || null;
      const sortOrder = item.order !== undefined ? parseInt(item.order, 10) : (item.id && typeof item.id === 'number' ? item.id : (i + 1));
      const targetId = item.id && typeof item.id === 'string' && item.id.startsWith('wb_')
        ? item.id
        : `wb_${itemLessonId ? itemLessonId.replace(/[^a-zA-Z0-9_-]/g, '') + '_' : ''}${String(i + 1).padStart(3, '0')}`;

      const wordObj = {
        ...item,
        id: targetId,
        lessonId: itemLessonId,
        order: sortOrder,
        thai,
        chinese
      };

      const existing = await get(`SELECT id FROM tblWordBank WHERE id = ?`, [targetId]);
      if (existing) {
        await run(
          `UPDATE tblWordBank SET lesson_id = ?, sort_order = ?, thai = ?, chinese = ?, data_json = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
          [itemLessonId, sortOrder, thai, chinese, JSON.stringify(wordObj), targetId]
        );
        updatedCount++;
      } else {
        await run(
          `INSERT INTO tblWordBank (id, lesson_id, sort_order, thai, chinese, data_json) VALUES (?, ?, ?, ?, ?, ?)`,
          [targetId, itemLessonId, sortOrder, thai, chinese, JSON.stringify(wordObj)]
        );
        insertedCount++;
      }
    }

    res.json({
      success: true,
      totalReceived: items.length,
      insertedCount,
      updatedCount,
      message: `成功导入 ${insertedCount} 个词库词条，更新 ${updatedCount} 个已有词条。`
    });
  } catch (err) {
    console.error('Failed to bulk import wordbank:', err);
    res.status(500).json({ error: err.message });
  }
});

// 7. DELETE /api/wordbank/lesson/:lessonId - Clear all words for a lesson
app.delete('/api/wordbank/lesson/:lessonId', async (req, res) => {
  try {
    const { lessonId } = req.params;
    await run(`DELETE FROM tblWordBank WHERE lesson_id = ?`, [lessonId]);
    res.json({ success: true, message: `All words for lesson '${lessonId}' deleted successfully` });
  } catch (err) {
    console.error('Failed to clear lesson wordbank:', err);
    res.status(500).json({ error: err.message });
  }
});


// ==========================================
// Literature Analysis & Practice APIs (appLiteracyTutor)
// ==========================================

// 1. GET /api/exercises - Retrieve literature exercises list (supports genre & search)
app.get('/api/exercises', async (req, res) => {
  try {
    const { genre, search } = req.query;
    let sql = `SELECT * FROM works WHERE 1=1`;
    const params = [];

    if (genre && genre !== 'all') {
      sql += ` AND genre = ?`;
      params.push(genre);
    }
    if (search) {
      sql += ` AND (title LIKE ? OR author LIKE ? OR description LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += ` ORDER BY id ASC`;
    const rows = await all(sql, params);
    const result = rows.map(row => {
      let content = {};
      try {
        content = JSON.parse(row.content_json);
      } catch (e) {
        content = {};
      }
      return {
        id: row.id,
        exercise_id: row.exercise_id,
        genre: row.genre,
        title: row.title,
        author: row.author,
        description: row.description,
        sectionsCount: content.sections ? content.sections.length : 0,
        content: content,
        created_at: row.created_at,
        updated_at: row.updated_at
      };
    });
    res.json(result);
  } catch (err) {
    console.error('Failed to query exercises:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. GET /api/exercises/:exercise_id - Retrieve single exercise with full JSON
app.get('/api/exercises/:exercise_id', async (req, res) => {
  try {
    const { exercise_id } = req.params;
    let row = await get(`SELECT * FROM works WHERE exercise_id = ?`, [exercise_id]);
    if (!row) {
      row = await get(`SELECT * FROM works WHERE id = ?`, [exercise_id]);
    }
    if (!row) {
      return res.status(404).json({ error: `Exercise with ID '${exercise_id}' not found` });
    }

    let parsed = {};
    try {
      parsed = JSON.parse(row.content_json);
    } catch (e) {
      parsed = {};
    }

    res.json({
      id: row.id,
      exercise_id: row.exercise_id,
      genre: row.genre,
      title: row.title,
      author: row.author,
      description: row.description,
      ...parsed,
      content: parsed,
      created_at: row.created_at,
      updated_at: row.updated_at
    });
  } catch (err) {
    console.error('Failed to get exercise details:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. POST /api/exercises - Create a new literature work (CRUD)
app.post('/api/exercises', async (req, res) => {
  try {
    const body = req.body;
    let { exercise_id, genre, title, author = "", description = "", content_json, sections, content } = body;

    if (!exercise_id || !genre || !title) {
      return res.status(400).json({ error: "Missing required fields: exercise_id, genre, title" });
    }

    const existing = await get(`SELECT id FROM works WHERE exercise_id = ?`, [exercise_id]);
    if (existing) {
      return res.status(400).json({ error: `Exercise with exercise_id '${exercise_id}' already exists` });
    }

    let rawJson = content_json;
    if (!rawJson) {
      const fullContent = content || {
        exercise_id,
        genre,
        title,
        author,
        description,
        sections: sections || []
      };
      rawJson = JSON.stringify(fullContent);
    } else if (typeof rawJson === 'object') {
      rawJson = JSON.stringify(rawJson);
    }

    await run(
      `INSERT INTO works (exercise_id, genre, title, author, description, content_json) VALUES (?, ?, ?, ?, ?, ?)`,
      [exercise_id, genre, title, author, description, rawJson]
    );

    const created = await get(`SELECT * FROM works WHERE exercise_id = ?`, [exercise_id]);
    let parsed = {};
    try { parsed = JSON.parse(created.content_json); } catch (e) {}
    res.status(201).json({
      id: created.id,
      exercise_id: created.exercise_id,
      genre: created.genre,
      title: created.title,
      author: created.author,
      description: created.description,
      ...parsed,
      created_at: created.created_at,
      updated_at: created.updated_at
    });
  } catch (err) {
    console.error('Failed to create exercise:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. PUT /api/exercises/:exercise_id - Update an existing literature work (CRUD)
app.put('/api/exercises/:exercise_id', async (req, res) => {
  try {
    const { exercise_id } = req.params;
    const body = req.body;
    const { genre, title, author, description, content_json, sections, content } = body;

    const existing = await get(`SELECT * FROM works WHERE exercise_id = ?`, [exercise_id]);
    if (!existing) {
      return res.status(404).json({ error: `Exercise '${exercise_id}' not found` });
    }

    const newGenre = genre || existing.genre;
    const newTitle = title || existing.title;
    const newAuthor = author !== undefined ? author : existing.author;
    const newDesc = description !== undefined ? description : existing.description;

    let rawJson = content_json;
    if (!rawJson) {
      if (content || sections) {
        const fullContent = content || {
          exercise_id,
          genre: newGenre,
          title: newTitle,
          author: newAuthor,
          description: newDesc,
          sections: sections || []
        };
        rawJson = JSON.stringify(fullContent);
      } else {
        rawJson = existing.content_json;
      }
    } else if (typeof rawJson === 'object') {
      rawJson = JSON.stringify(rawJson);
    }

    await run(
      `UPDATE works SET genre = ?, title = ?, author = ?, description = ?, content_json = ?, updated_at = datetime('now', 'localtime') WHERE exercise_id = ?`,
      [newGenre, newTitle, newAuthor, newDesc, rawJson, exercise_id]
    );

    const updated = await get(`SELECT * FROM works WHERE exercise_id = ?`, [exercise_id]);
    let parsed = {};
    try { parsed = JSON.parse(updated.content_json); } catch (e) {}
    res.json({
      id: updated.id,
      exercise_id: updated.exercise_id,
      genre: updated.genre,
      title: updated.title,
      author: updated.author,
      description: updated.description,
      ...parsed,
      created_at: updated.created_at,
      updated_at: updated.updated_at
    });
  } catch (err) {
    console.error('Failed to update exercise:', err);
    res.status(500).json({ error: err.message });
  }
});

// 5. DELETE /api/exercises/:exercise_id - Delete a literature work (CRUD)
app.delete('/api/exercises/:exercise_id', async (req, res) => {
  try {
    const { exercise_id } = req.params;
    const existing = await get(`SELECT id FROM works WHERE exercise_id = ?`, [exercise_id]);
    if (!existing) {
      return res.status(404).json({ error: `Exercise '${exercise_id}' not found` });
    }

    await run(`DELETE FROM works WHERE exercise_id = ?`, [exercise_id]);
    await run(`DELETE FROM user_progress WHERE exercise_id = ?`, [exercise_id]);
    res.json({ success: true, message: `Exercise '${exercise_id}' deleted successfully` });
  } catch (err) {
    console.error('Failed to delete exercise:', err);
    res.status(500).json({ error: err.message });
  }
});

// 6. POST /api/exercises/submit - Submit or save user practice answers & progress
app.post('/api/exercises/submit', async (req, res) => {
  try {
    const { user_id, exercise_id, answers, answers_json, score = 0, tutor_feedback = null } = req.body;
    if (!user_id || !exercise_id) {
      return res.status(400).json({ error: "Missing required fields: user_id, exercise_id" });
    }

    let rawAnswers = answers_json;
    if (!rawAnswers) {
      rawAnswers = JSON.stringify(answers || {});
    } else if (typeof rawAnswers === 'object') {
      rawAnswers = JSON.stringify(rawAnswers);
    }

    await run(
      `INSERT INTO user_progress (user_id, exercise_id, answers_json, score, tutor_feedback, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
       ON CONFLICT(user_id, exercise_id) DO UPDATE SET
         answers_json = excluded.answers_json,
         score = excluded.score,
         tutor_feedback = COALESCE(excluded.tutor_feedback, user_progress.tutor_feedback),
         updated_at = datetime('now', 'localtime')`,
      [user_id, exercise_id, rawAnswers, score, tutor_feedback]
    );

    const record = await get(`SELECT * FROM user_progress WHERE user_id = ? AND exercise_id = ?`, [user_id, exercise_id]);
    let parsedAnswers = {};
    try { parsedAnswers = JSON.parse(record.answers_json); } catch (e) {}

    res.json({
      success: true,
      message: "Progress and answers submitted successfully",
      record: {
        id: record.id,
        user_id: record.user_id,
        exercise_id: record.exercise_id,
        score: record.score,
        tutor_feedback: record.tutor_feedback,
        answers: parsedAnswers,
        updated_at: record.updated_at
      }
    });
  } catch (err) {
    console.error('Failed to submit exercise progress:', err);
    res.status(500).json({ error: err.message });
  }
});

// 7. GET /api/progress/:user_id - Retrieve user practice history & mistake records
app.get('/api/progress/:user_id', async (req, res) => {
  try {
    const { user_id } = req.params;
    const sql = `
      SELECT up.*, w.title as exercise_title, w.genre, w.author, w.description as exercise_description
      FROM user_progress up
      LEFT JOIN works w ON up.exercise_id = w.exercise_id
      WHERE up.user_id = ?
      ORDER BY up.updated_at DESC
    `;
    const rows = await all(sql, [user_id]);
    const results = rows.map(r => {
      let answers = {};
      try { answers = JSON.parse(r.answers_json); } catch (e) {}
      return {
        id: r.id,
        user_id: r.user_id,
        exercise_id: r.exercise_id,
        exercise_title: r.exercise_title || r.exercise_id,
        genre: r.genre || 'unknown',
        author: r.author || '',
        exercise_description: r.exercise_description || '',
        score: r.score,
        tutor_feedback: r.tutor_feedback,
        answers,
        updated_at: r.updated_at
      };
    });
    res.json(results);
  } catch (err) {
    console.error('Failed to query user progress:', err);
    res.status(500).json({ error: err.message });
  }
});

// 8. GET /api/progress - Retrieve all student submissions (for Tutor Admin View)
app.get('/api/progress', async (req, res) => {
  try {
    const { exercise_id, user_id } = req.query;
    let sql = `
      SELECT up.*, w.title as exercise_title, w.genre, w.author
      FROM user_progress up
      LEFT JOIN works w ON up.exercise_id = w.exercise_id
      WHERE 1=1
    `;
    const params = [];
    if (exercise_id) {
      sql += ` AND up.exercise_id = ?`;
      params.push(exercise_id);
    }
    if (user_id) {
      sql += ` AND up.user_id = ?`;
      params.push(user_id);
    }
    sql += ` ORDER BY up.updated_at DESC`;

    const rows = await all(sql, params);
    const results = rows.map(r => {
      let answers = {};
      try { answers = JSON.parse(r.answers_json); } catch (e) {}
      return {
        id: r.id,
        user_id: r.user_id,
        exercise_id: r.exercise_id,
        exercise_title: r.exercise_title || r.exercise_id,
        genre: r.genre || 'unknown',
        author: r.author || '',
        score: r.score,
        tutor_feedback: r.tutor_feedback,
        answers,
        updated_at: r.updated_at
      };
    });
    res.json(results);
  } catch (err) {
    console.error('Failed to query all progress:', err);
    res.status(500).json({ error: err.message });
  }
});

// 9. PUT /api/progress/:id/feedback - Tutor update score & review comments
app.put('/api/progress/:id/feedback', async (req, res) => {
  try {
    const { id } = req.params;
    const { score, tutor_feedback } = req.body;

    const existing = await get(`SELECT * FROM user_progress WHERE id = ?`, [id]);
    if (!existing) {
      return res.status(404).json({ error: `Progress record '${id}' not found` });
    }

    const newScore = score !== undefined ? score : existing.score;
    const newFeedback = tutor_feedback !== undefined ? tutor_feedback : existing.tutor_feedback;

    await run(
      `UPDATE user_progress SET score = ?, tutor_feedback = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
      [newScore, newFeedback, id]
    );

    const updated = await get(`SELECT * FROM user_progress WHERE id = ?`, [id]);
    let answers = {};
    try { answers = JSON.parse(updated.answers_json); } catch (e) {}
    res.json({
      success: true,
      record: {
        id: updated.id,
        user_id: updated.user_id,
        exercise_id: updated.exercise_id,
        score: updated.score,
        tutor_feedback: updated.tutor_feedback,
        answers,
        updated_at: updated.updated_at
      }
    });
  } catch (err) {
    console.error('Failed to update progress feedback:', err);
    res.status(500).json({ error: err.message });
  }
});

// 10. DELETE /api/progress/:id - Delete single progress record
app.delete('/api/progress/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await run(`DELETE FROM user_progress WHERE id = ?`, [id]);
    res.json({ success: true, message: `Progress record '${id}' deleted` });
  } catch (err) {
    console.error('Failed to delete progress:', err);
    res.status(500).json({ error: err.message });
  }
});


// -------------------------------------------------------------
// Dictation App & Collections: SM-2 Spaced Repetition REST APIs
// -------------------------------------------------------------

// Dictation API Authentication Middleware
const authenticateDictationApi = (req, res, next) => {
  const apiKeyHeader = req.headers['x-api-key'];
  const authHeader = req.headers['authorization'];
  const queryKey = req.query.apiKey;
  let bearerToken = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    bearerToken = authHeader.substring(7).trim();
  }

  let configuredKey = 'thainotes_api_key_2026';
  try {
    const cfg = JSON.parse(fsSync.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
    if (cfg && cfg.dictationApiKey) configuredKey = cfg.dictationApiKey;
  } catch (e) {}
  if (process.env.DICTATION_API_KEY) configuredKey = process.env.DICTATION_API_KEY;

  if (apiKeyHeader === configuredKey || bearerToken === configuredKey || queryKey === configuredKey) {
    return next();
  }

  // Internal UI exemption (checks same-origin or referer from local host)
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const host = req.headers.host;
  if ((origin && host && origin.includes(host)) || (referer && host && referer.includes(host))) {
    return next();
  }

  return res.status(401).json({
    error: 'Unauthorized',
    message: 'A valid X-API-Key header, Bearer token, or ?apiKey= parameter is required to access the Dictation API.'
  });
};

// Word formatter
const formatDictationWord = (row, collectionIds = []) => {
  if (!row) return null;
  let examples = [];
  try {
    examples = typeof row.examples_json === 'string' ? JSON.parse(row.examples_json) : (row.examples_json || []);
  } catch (e) {
    examples = [];
  }

  const isDue = row.next_review_date ? new Date(row.next_review_date) <= new Date() : true;

  return {
    id: row.id,
    thaiWord: row.thai_word,
    phonetic: row.phonetic || '',
    transliteration: row.phonetic || '',
    meaning: row.meaning,
    audioUrl: row.audio_url || '',
    examples: Array.isArray(examples) ? examples : [],
    repetition: row.repetition != null ? row.repetition : 0,
    interval: row.interval_days != null ? row.interval_days : 1,
    intervalDays: row.interval_days != null ? row.interval_days : 1,
    easinessFactor: row.easiness_factor != null ? row.easiness_factor : 2.5,
    nextReviewDate: row.next_review_date,
    isDue,
    collectionIds: collectionIds || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
};

// Collection formatter
const formatDictationCollection = (row, stats = {}) => {
  if (!row) return null;
  let tags = [];
  if (row.tags) {
    tags = typeof row.tags === 'string' ? row.tags.split(',').map(s => s.trim()).filter(Boolean) : row.tags;
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    tags: tags,
    tagsString: row.tags || '',
    wordCount: Number(stats.wordCount || 0),
    dueCount: Number(stats.dueCount || 0),
    masteredCount: Number(stats.masteredCount || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
};

// 1. GET /api/collections - List all vocabulary collections
app.get('/api/collections', authenticateDictationApi, async (req, res) => {
  try {
    const { search } = req.query;
    let query = `
      SELECT c.*,
             COUNT(cw.word_id) as word_count,
             SUM(CASE WHEN datetime(w.next_review_date) <= datetime('now') THEN 1 ELSE 0 END) as due_count,
             SUM(CASE WHEN w.repetition >= 3 THEN 1 ELSE 0 END) as mastered_count
      FROM dictation_collections c
      LEFT JOIN dictation_collection_words cw ON c.id = cw.collection_id
      LEFT JOIN dictation_words w ON cw.word_id = w.id
    `;
    const params = [];
    if (search) {
      query += ` WHERE c.name LIKE ? OR c.description LIKE ? OR c.tags LIKE ?`;
      const s = `%${search}%`;
      params.push(s, s, s);
    }
    query += ` GROUP BY c.id ORDER BY c.created_at ASC`;

    const rows = await all(query, params);
    const collections = rows.map(r => formatDictationCollection(r, {
      wordCount: r.word_count,
      dueCount: r.due_count,
      masteredCount: r.mastered_count
    }));

    res.json({
      success: true,
      total: collections.length,
      collections
    });
  } catch (err) {
    console.error('Failed to fetch collections:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. POST /api/collections - Create a new collection
app.post('/api/collections', authenticateDictationApi, async (req, res) => {
  try {
    const { id, name, description, tags } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Collection name is required' });
    }

    const colId = id && id.trim() ? id.trim() : `col_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const colName = name.trim();
    const colDesc = (description || '').trim();
    const colTags = Array.isArray(tags) ? tags.join(',') : (tags || '').trim();
    const nowIso = new Date().toISOString();

    await run(
      `INSERT INTO dictation_collections (id, name, description, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [colId, colName, colDesc, colTags, nowIso, nowIso]
    );

    const created = await get(`SELECT * FROM dictation_collections WHERE id = ?`, [colId]);
    res.status(201).json({
      success: true,
      collection: formatDictationCollection(created, { wordCount: 0, dueCount: 0, masteredCount: 0 })
    });
  } catch (err) {
    console.error('Failed to create collection:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. GET /api/collections/:id - Get collection details & its words
app.get('/api/collections/:id', authenticateDictationApi, async (req, res) => {
  try {
    const { id } = req.params;
    const col = await get(`SELECT * FROM dictation_collections WHERE id = ?`, [id]);
    if (!col) {
      return res.status(404).json({ error: `Collection '${id}' not found` });
    }

    // Get words in this collection
    const wordRows = await all(
      `SELECT w.*, cw.sort_order
       FROM dictation_words w
       JOIN dictation_collection_words cw ON w.id = cw.word_id
       WHERE cw.collection_id = ?
       ORDER BY cw.sort_order ASC, w.created_at ASC`,
      [id]
    );

    // Also get all collection memberships for each word
    const words = [];
    let dueCount = 0;
    let masteredCount = 0;

    for (const w of wordRows) {
      const colRows = await all(`SELECT collection_id FROM dictation_collection_words WHERE word_id = ?`, [w.id]);
      const colIds = colRows.map(c => c.collection_id);
      const formatted = formatDictationWord(w, colIds);
      if (formatted.isDue) dueCount++;
      if (formatted.repetition >= 3) masteredCount++;
      words.push(formatted);
    }

    const collection = formatDictationCollection(col, {
      wordCount: words.length,
      dueCount,
      masteredCount
    });
    collection.words = words;

    res.json({
      success: true,
      collection
    });
  } catch (err) {
    console.error('Failed to fetch collection details:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. PUT /api/collections/:id - Update a collection
app.put('/api/collections/:id', authenticateDictationApi, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await get(`SELECT * FROM dictation_collections WHERE id = ?`, [id]);
    if (!existing) {
      return res.status(404).json({ error: `Collection '${id}' not found` });
    }

    const { name, description, tags } = req.body;
    const colName = name !== undefined ? name.trim() : existing.name;
    const colDesc = description !== undefined ? description.trim() : existing.description;
    const colTags = tags !== undefined ? (Array.isArray(tags) ? tags.join(',') : tags.trim()) : existing.tags;
    const nowIso = new Date().toISOString();

    await run(
      `UPDATE dictation_collections SET name = ?, description = ?, tags = ?, updated_at = ? WHERE id = ?`,
      [colName, colDesc, colTags, nowIso, id]
    );

    const updated = await get(`SELECT * FROM dictation_collections WHERE id = ?`, [id]);
    const countRow = await get(
      `SELECT COUNT(cw.word_id) as word_count,
              SUM(CASE WHEN datetime(w.next_review_date) <= datetime('now') THEN 1 ELSE 0 END) as due_count,
              SUM(CASE WHEN w.repetition >= 3 THEN 1 ELSE 0 END) as mastered_count
       FROM dictation_collection_words cw
       JOIN dictation_words w ON cw.word_id = w.id
       WHERE cw.collection_id = ?`,
      [id]
    );

    res.json({
      success: true,
      collection: formatDictationCollection(updated, {
        wordCount: countRow?.word_count || 0,
        dueCount: countRow?.due_count || 0,
        masteredCount: countRow?.mastered_count || 0
      })
    });
  } catch (err) {
    console.error('Failed to update collection:', err);
    res.status(500).json({ error: err.message });
  }
});

// 5. DELETE /api/collections/:id - Delete a collection
app.delete('/api/collections/:id', authenticateDictationApi, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await get(`SELECT * FROM dictation_collections WHERE id = ?`, [id]);
    if (!existing) {
      return res.status(404).json({ error: `Collection '${id}' not found` });
    }

    await run(`DELETE FROM dictation_collection_words WHERE collection_id = ?`, [id]);
    await run(`DELETE FROM dictation_collections WHERE id = ?`, [id]);

    res.json({
      success: true,
      message: `Collection '${id}' deleted successfully`
    });
  } catch (err) {
    console.error('Failed to delete collection:', err);
    res.status(500).json({ error: err.message });
  }
});

// 6. POST /api/collections/:id/words - Add a vocabulary item (including examples JSON array) to a collection
app.post('/api/collections/:id/words', authenticateDictationApi, async (req, res) => {
  try {
    const { id: collectionId } = req.params;
    const col = await get(`SELECT * FROM dictation_collections WHERE id = ?`, [collectionId]);
    if (!col) {
      return res.status(404).json({ error: `Collection '${collectionId}' not found` });
    }

    const { id, thaiWord, phonetic, transliteration, meaning, audioUrl, examples } = req.body;
    if (!thaiWord || !thaiWord.trim()) {
      return res.status(400).json({ error: 'thaiWord is required' });
    }
    if (!meaning || !meaning.trim()) {
      return res.status(400).json({ error: 'meaning is required' });
    }

    const wordId = id && id.trim() ? id.trim() : `w_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const wordThai = thaiWord.trim();
    const wordPhonetic = (phonetic || transliteration || '').trim();
    const wordMeaning = meaning.trim();
    const wordAudio = (audioUrl || '').trim();

    let cleanExamples = [];
    if (Array.isArray(examples)) {
      cleanExamples = examples.map(ex => ({
        thai: (ex.thai || '').trim(),
        translation: (ex.translation || '').trim()
      })).filter(ex => ex.thai || ex.translation);
    }

    const nowIso = new Date().toISOString();

    // Check if word already exists in dictation_words (by ID or Thai spelling)
    let actualWordId = wordId;
    let existingWord = await get(`SELECT * FROM dictation_words WHERE id = ?`, [wordId]);
    if (!existingWord) {
      existingWord = await get(`SELECT * FROM dictation_words WHERE trim(thai_word) = ?`, [wordThai]);
      if (existingWord) {
        actualWordId = existingWord.id;
      }
    }

    if (!existingWord) {
      await run(
        `INSERT INTO dictation_words (id, thai_word, phonetic, meaning, audio_url, examples_json, repetition, interval_days, easiness_factor, next_review_date, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, 1, 2.5, ?, ?, ?)`,
        [actualWordId, wordThai, wordPhonetic, wordMeaning, wordAudio, JSON.stringify(cleanExamples), nowIso, nowIso, nowIso]
      );
    }

    // Determine highest sort_order in collection
    const maxOrderRow = await get(`SELECT MAX(sort_order) as max_order FROM dictation_collection_words WHERE collection_id = ?`, [collectionId]);
    const nextOrder = (maxOrderRow?.max_order || 0) + 1;

    // Link to collection
    await run(
      `INSERT OR IGNORE INTO dictation_collection_words (collection_id, word_id, sort_order, created_at) VALUES (?, ?, ?, ?)`,
      [collectionId, actualWordId, nextOrder, nowIso]
    );

    const created = await get(`SELECT * FROM dictation_words WHERE id = ?`, [actualWordId]);
    const colRows = await all(`SELECT collection_id FROM dictation_collection_words WHERE word_id = ?`, [actualWordId]);
    const colIds = colRows.map(c => c.collection_id);

    res.status(201).json({
      success: true,
      word: formatDictationWord(created, colIds)
    });
  } catch (err) {
    console.error('Failed to add word to collection:', err);
    res.status(500).json({ error: err.message });
  }
});

// 7. GET /api/words - List all vocabulary items (with filtering and search)
app.get('/api/words', authenticateDictationApi, async (req, res) => {
  try {
    const { collectionId, dueOnly, search, q, limit, offset } = req.query;
    const searchTerm = (search || q || '').trim();

    let query = `
      SELECT DISTINCT w.*
      FROM dictation_words w
    `;
    const params = [];
    const whereConditions = [];

    if (collectionId) {
      query += ` JOIN dictation_collection_words cw ON w.id = cw.word_id`;
      whereConditions.push(`cw.collection_id = ?`);
      params.push(collectionId);
    }

    if (dueOnly === 'true' || dueOnly === '1') {
      whereConditions.push(`datetime(w.next_review_date) <= datetime('now')`);
    }

    if (searchTerm) {
      whereConditions.push(`(w.thai_word LIKE ? OR w.phonetic LIKE ? OR w.meaning LIKE ? OR w.examples_json LIKE ?)`);
      const s = `%${searchTerm}%`;
      params.push(s, s, s, s);
    }

    if (whereConditions.length > 0) {
      query += ` WHERE ` + whereConditions.join(' AND ');
    }

    query += ` ORDER BY w.next_review_date ASC, w.created_at DESC`;

    if (limit) {
      query += ` LIMIT ?`;
      params.push(parseInt(limit, 10));
      if (offset) {
        query += ` OFFSET ?`;
        params.push(parseInt(offset, 10));
      }
    }

    const rows = await all(query, params);

    // Fetch collections for returned words
    const words = [];
    for (const r of rows) {
      const colRows = await all(`SELECT collection_id FROM dictation_collection_words WHERE word_id = ?`, [r.id]);
      words.push(formatDictationWord(r, colRows.map(c => c.collection_id)));
    }

    res.json({
      success: true,
      count: words.length,
      words
    });
  } catch (err) {
    console.error('Failed to fetch words:', err);
    res.status(500).json({ error: err.message });
  }
});

// 8. GET /api/words/:id - Get a specific word
app.get('/api/words/:id', authenticateDictationApi, async (req, res) => {
  try {
    const { id } = req.params;
    const word = await get(`SELECT * FROM dictation_words WHERE id = ?`, [id]);
    if (!word) {
      return res.status(404).json({ error: `Word '${id}' not found` });
    }

    const colRows = await all(`SELECT collection_id FROM dictation_collection_words WHERE word_id = ?`, [id]);
    res.json({
      success: true,
      word: formatDictationWord(word, colRows.map(c => c.collection_id))
    });
  } catch (err) {
    console.error('Failed to fetch word:', err);
    res.status(500).json({ error: err.message });
  }
});

// 9. POST /api/words - Create a new vocabulary item
app.post('/api/words', authenticateDictationApi, async (req, res) => {
  try {
    const { id, thaiWord, phonetic, transliteration, meaning, audioUrl, examples, collectionIds } = req.body;
    if (!thaiWord || !thaiWord.trim()) {
      return res.status(400).json({ error: 'thaiWord is required' });
    }
    if (!meaning || !meaning.trim()) {
      return res.status(400).json({ error: 'meaning is required' });
    }

    const wordId = id && id.trim() ? id.trim() : `w_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const wordThai = thaiWord.trim();
    const wordPhonetic = (phonetic || transliteration || '').trim();
    const wordMeaning = meaning.trim();
    const wordAudio = (audioUrl || '').trim();

    let cleanExamples = [];
    if (Array.isArray(examples)) {
      cleanExamples = examples.map(ex => ({
        thai: (ex.thai || '').trim(),
        translation: (ex.translation || '').trim()
      })).filter(ex => ex.thai || ex.translation);
    }

    const nowIso = new Date().toISOString();

    let actualWordId = wordId;
    let existingWord = await get(`SELECT * FROM dictation_words WHERE id = ?`, [wordId]);
    if (!existingWord) {
      existingWord = await get(`SELECT * FROM dictation_words WHERE trim(thai_word) = ?`, [wordThai]);
      if (existingWord) {
        actualWordId = existingWord.id;
      }
    }

    if (!existingWord) {
      await run(
        `INSERT INTO dictation_words (id, thai_word, phonetic, meaning, audio_url, examples_json, repetition, interval_days, easiness_factor, next_review_date, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, 1, 2.5, ?, ?, ?)`,
        [actualWordId, wordThai, wordPhonetic, wordMeaning, wordAudio, JSON.stringify(cleanExamples), nowIso, nowIso, nowIso]
      );
    }

    if (Array.isArray(collectionIds) && collectionIds.length > 0) {
      for (const colId of collectionIds) {
        await run(
          `INSERT OR IGNORE INTO dictation_collection_words (collection_id, word_id, sort_order, created_at) VALUES (?, ?, 0, ?)`,
          [colId, actualWordId, nowIso]
        );
      }
    }

    const created = await get(`SELECT * FROM dictation_words WHERE id = ?`, [actualWordId]);
    const colRows = await all(`SELECT collection_id FROM dictation_collection_words WHERE word_id = ?`, [actualWordId]);

    res.status(201).json({
      success: true,
      word: formatDictationWord(created, colRows.map(c => c.collection_id))
    });
  } catch (err) {
    console.error('Failed to create word:', err);
    res.status(500).json({ error: err.message });
  }
});

// 10. PUT /api/words/:id - Update a specific word (including updating its examples JSON array)
app.put('/api/words/:id', authenticateDictationApi, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await get(`SELECT * FROM dictation_words WHERE id = ?`, [id]);
    if (!existing) {
      return res.status(404).json({ error: `Word '${id}' not found` });
    }

    const {
      thaiWord,
      phonetic,
      transliteration,
      meaning,
      audioUrl,
      examples,
      repetition,
      interval,
      intervalDays,
      easinessFactor,
      nextReviewDate,
      collectionIds
    } = req.body;

    const wordThai = thaiWord !== undefined ? thaiWord.trim() : existing.thai_word;
    const wordPhonetic = phonetic !== undefined ? phonetic.trim() : (transliteration !== undefined ? transliteration.trim() : existing.phonetic);
    const wordMeaning = meaning !== undefined ? meaning.trim() : existing.meaning;
    const wordAudio = audioUrl !== undefined ? audioUrl.trim() : existing.audio_url;

    let cleanExamples = existing.examples_json;
    if (examples !== undefined) {
      if (Array.isArray(examples)) {
        cleanExamples = JSON.stringify(examples.map(ex => ({
          thai: (ex.thai || '').trim(),
          translation: (ex.translation || '').trim()
        })).filter(ex => ex.thai || ex.translation));
      } else if (typeof examples === 'string') {
        cleanExamples = examples;
      }
    }

    const rep = repetition !== undefined ? parseInt(repetition, 10) : existing.repetition;
    const intDays = (interval !== undefined || intervalDays !== undefined) ? parseInt(interval ?? intervalDays, 10) : existing.interval_days;
    const ef = easinessFactor !== undefined ? parseFloat(easinessFactor) : existing.easiness_factor;
    const nextRev = nextReviewDate !== undefined ? nextReviewDate : existing.next_review_date;
    const nowIso = new Date().toISOString();

    await run(
      `UPDATE dictation_words
       SET thai_word = ?, phonetic = ?, meaning = ?, audio_url = ?, examples_json = ?,
           repetition = ?, interval_days = ?, easiness_factor = ?, next_review_date = ?, updated_at = ?
       WHERE id = ?`,
      [wordThai, wordPhonetic, wordMeaning, wordAudio, cleanExamples, rep, intDays, ef, nextRev, nowIso, id]
    );

    // Update collection associations if collectionIds array is provided
    if (Array.isArray(collectionIds)) {
      await run(`DELETE FROM dictation_collection_words WHERE word_id = ?`, [id]);
      for (const colId of collectionIds) {
        await run(
          `INSERT OR IGNORE INTO dictation_collection_words (collection_id, word_id, sort_order, created_at) VALUES (?, ?, 0, ?)`,
          [colId, id, nowIso]
        );
      }
    }

    const updated = await get(`SELECT * FROM dictation_words WHERE id = ?`, [id]);
    const colRows = await all(`SELECT collection_id FROM dictation_collection_words WHERE word_id = ?`, [id]);

    res.json({
      success: true,
      word: formatDictationWord(updated, colRows.map(c => c.collection_id))
    });
  } catch (err) {
    console.error('Failed to update word:', err);
    res.status(500).json({ error: err.message });
  }
});

// 11. DELETE /api/words/:id - Delete a specific word
app.delete('/api/words/:id', authenticateDictationApi, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await get(`SELECT * FROM dictation_words WHERE id = ?`, [id]);
    if (!existing) {
      return res.status(404).json({ error: `Word '${id}' not found` });
    }

    await run(`DELETE FROM dictation_collection_words WHERE word_id = ?`, [id]);
    await run(`DELETE FROM dictation_review_logs WHERE word_id = ?`, [id]);
    await run(`DELETE FROM dictation_words WHERE id = ?`, [id]);

    res.json({
      success: true,
      message: `Word '${id}' deleted successfully`
    });
  } catch (err) {
    console.error('Failed to delete word:', err);
    res.status(500).json({ error: err.message });
  }
});

// 12. POST /api/dictation/review - Supervisor records dictation grading result & calculates SM-2
app.post('/api/dictation/review', authenticateDictationApi, async (req, res) => {
  try {
    const { wordId, rating, collectionId } = req.body;
    if (!wordId) {
      return res.status(400).json({ error: 'wordId is required' });
    }
    if (rating === undefined || rating === null) {
      return res.status(400).json({ error: 'rating is required (0 to 5)' });
    }

    const numericRating = Math.max(0, Math.min(5, Math.round(Number(rating))));
    const word = await get(`SELECT * FROM dictation_words WHERE id = ?`, [wordId]);
    if (!word) {
      return res.status(404).json({ error: `Word '${wordId}' not found` });
    }

    const currentState = {
      repetition: word.repetition,
      interval: word.interval_days,
      easinessFactor: word.easiness_factor
    };

    const nextState = calculateSM2(currentState, numericRating);
    const nowIso = new Date().toISOString();

    // Update word with new SM-2 parameters
    await run(
      `UPDATE dictation_words
       SET repetition = ?, interval_days = ?, easiness_factor = ?, next_review_date = ?, updated_at = ?
       WHERE id = ?`,
      [nextState.repetition, nextState.interval, nextState.easinessFactor, nextState.nextReviewDate, nowIso, wordId]
    );

    // Record review log
    await run(
      `INSERT INTO dictation_review_logs (
        word_id, collection_id, rating,
        prev_repetition, new_repetition,
        prev_interval, new_interval,
        prev_easiness_factor, new_easiness_factor,
        reviewed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        wordId,
        collectionId || null,
        numericRating,
        word.repetition,
        nextState.repetition,
        word.interval_days,
        nextState.interval,
        word.easiness_factor,
        nextState.easinessFactor,
        nowIso
      ]
    );

    const updatedWord = await get(`SELECT * FROM dictation_words WHERE id = ?`, [wordId]);
    const colRows = await all(`SELECT collection_id FROM dictation_collection_words WHERE word_id = ?`, [wordId]);

    res.json({
      success: true,
      rating: numericRating,
      word: formatDictationWord(updatedWord, colRows.map(c => c.collection_id)),
      sm2: {
        previous: currentState,
        current: nextState
      }
    });
  } catch (err) {
    console.error('Failed to submit dictation review:', err);
    res.status(500).json({ error: err.message });
  }
});

// 13. GET /api/dictation/queue - Get practice queue (smart_due, collection, or all)
app.get('/api/dictation/queue', authenticateDictationApi, async (req, res) => {
  try {
    const { type = 'smart_due', collectionId, limit = 50, shuffle } = req.query;
    let query = '';
    const params = [];

    if (type === 'collection') {
      if (!collectionId) {
        return res.status(400).json({ error: 'collectionId is required when type=collection' });
      }
      query = `
        SELECT w.*, cw.sort_order
        FROM dictation_words w
        JOIN dictation_collection_words cw ON w.id = cw.word_id
        WHERE cw.collection_id = ?
        ORDER BY cw.sort_order ASC, w.created_at ASC
        LIMIT ?
      `;
      params.push(collectionId, parseInt(limit, 10));
    } else if (type === 'smart_due') {
      query = `
        SELECT * FROM dictation_words
        WHERE datetime(next_review_date) <= datetime('now')
        ORDER BY next_review_date ASC, repetition ASC
        LIMIT ?
      `;
      params.push(parseInt(limit, 10));
    } else {
      // type === 'all'
      query = `
        SELECT * FROM dictation_words
        ORDER BY created_at DESC
        LIMIT ?
      `;
      params.push(parseInt(limit, 10));
    }

    let rows = await all(query, params);

    // If smart_due queue is empty, fallback to words with lowest repetition or all words
    if (type === 'smart_due' && rows.length === 0) {
      rows = await all(`SELECT * FROM dictation_words ORDER BY next_review_date ASC LIMIT ?`, [parseInt(limit, 10)]);
    }

    if (shuffle === 'true' || shuffle === '1') {
      for (let i = rows.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rows[i], rows[j]] = [rows[j], rows[i]];
      }
    }

    const queue = [];
    for (const r of rows) {
      const colRows = await all(`SELECT collection_id FROM dictation_collection_words WHERE word_id = ?`, [r.id]);
      queue.push(formatDictationWord(r, colRows.map(c => c.collection_id)));
    }

    res.json({
      success: true,
      type,
      total: queue.length,
      queue
    });
  } catch (err) {
    console.error('Failed to get dictation queue:', err);
    res.status(500).json({ error: err.message });
  }
});

// 14. GET /api/dictation/stats - Overall stats for dashboard and learning progress
app.get('/api/dictation/stats', authenticateDictationApi, async (req, res) => {
  try {
    const colCountRow = await get(`SELECT COUNT(*) as count FROM dictation_collections`);
    const wordCountRow = await get(`SELECT COUNT(*) as count FROM dictation_words`);
    const dueCountRow = await get(`SELECT COUNT(*) as count FROM dictation_words WHERE datetime(next_review_date) <= datetime('now')`);
    const masteredRow = await get(`SELECT COUNT(*) as count FROM dictation_words WHERE repetition >= 3`);
    const learningRow = await get(`SELECT COUNT(*) as count FROM dictation_words WHERE repetition > 0 AND repetition < 3`);
    const newWordRow = await get(`SELECT COUNT(*) as count FROM dictation_words WHERE repetition = 0`);

    const totalReviewsRow = await get(`SELECT COUNT(*) as count FROM dictation_review_logs`);
    const todayReviewsRow = await get(`SELECT COUNT(*) as count FROM dictation_review_logs WHERE date(reviewed_at) = date('now', 'localtime')`);
    const correctReviewsRow = await get(`SELECT COUNT(*) as count FROM dictation_review_logs WHERE rating >= 3`);
    const avgEfRow = await get(`SELECT AVG(easiness_factor) as avg_ef FROM dictation_words`);

    const totalReviews = totalReviewsRow?.count || 0;
    const correctReviews = correctReviewsRow?.count || 0;
    const accuracyRate = totalReviews > 0 ? Math.round((correctReviews / totalReviews) * 100) : 100;

    res.json({
      success: true,
      stats: {
        totalCollections: colCountRow?.count || 0,
        totalWords: wordCountRow?.count || 0,
        dueCount: dueCountRow?.count || 0,
        masteredCount: masteredRow?.count || 0,
        learningCount: learningRow?.count || 0,
        newCount: newWordRow?.count || 0,
        totalReviews,
        todayReviews: todayReviewsRow?.count || 0,
        accuracyRate,
        averageEasiness: avgEfRow?.avg_ef ? Math.round(avgEfRow.avg_ef * 100) / 100 : 2.5
      }
    });
  } catch (err) {
    console.error('Failed to get dictation stats:', err);
    res.status(500).json({ error: err.message });
  }
});

// 15. POST /api/dictation/batch-import - Batch import collection and vocabulary (supports core words JSON array & duplicate skipping)
app.post('/api/dictation/batch-import', authenticateDictationApi, async (req, res) => {
  try {
    let rawWords = [];
    let collectionName = '';
    let collectionDescription = '';
    let tags = '';
    let targetCollectionId = null;

    if (Array.isArray(req.body)) {
      rawWords = req.body;
    } else if (req.body && typeof req.body === 'object') {
      rawWords = Array.isArray(req.body.words) ? req.body.words : (Array.isArray(req.body.data) ? req.body.data : []);
      collectionName = (req.body.collectionName || req.body.name || '').trim();
      collectionDescription = (req.body.collectionDescription || req.body.description || '').trim();
      tags = req.body.tags || '';
      targetCollectionId = req.body.targetCollectionId || req.body.collectionId || null;
    }

    if (!Array.isArray(rawWords) || rawWords.length === 0) {
      return res.status(400).json({ error: 'words array is required and must not be empty' });
    }

    // Auto-derive collectionName if not explicitly provided and not targeting an existing collection
    if (!targetCollectionId && !collectionName && rawWords.length > 0) {
      const first = rawWords[0];
      const setId = first.setId || first.set_id;
      const lessonId = first.lessonId || first.lesson_id;
      if (setId) {
        try {
          const wsRow = await get(`SELECT title, description FROM tblCoreWordsets WHERE id = ?`, [setId]);
          if (wsRow && wsRow.title) {
            collectionName = wsRow.title;
            if (!collectionDescription && wsRow.description) {
              collectionDescription = wsRow.description;
            }
          }
        } catch (e) {
          // ignore table query error
        }
        if (!collectionName) {
          collectionName = `核心词集 (${setId})`;
        }
      } else if (lessonId) {
        collectionName = `课时词集 (${lessonId})`;
      } else {
        collectionName = `导入听写词集_${new Date().toISOString().substring(0, 10)}`;
      }
    }

    const nowIso = new Date().toISOString();
    const tagString = Array.isArray(tags) ? tags.join(',') : (tags || '').trim();

    let colId = targetCollectionId;
    let existingCol = null;
    if (colId) {
      existingCol = await get(`SELECT * FROM dictation_collections WHERE id = ?`, [colId]);
    }

    if (!existingCol) {
      colId = `col_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      await run(
        `INSERT INTO dictation_collections (id, name, description, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [colId, (collectionName || '导入听写词集').trim(), (collectionDescription || '').trim(), tagString, nowIso, nowIso]
      );
    }

    // Determine current max sort_order in collection
    const maxOrderRow = await get(`SELECT MAX(sort_order) as max_order FROM dictation_collection_words WHERE collection_id = ?`, [colId]);
    let currentMaxOrder = (maxOrderRow?.max_order || 0);

    let importedCount = 0; // Total words linked to this collection
    let newWordsCount = 0; // Brand new words created in global dictation_words
    let existingWordsLinked = 0; // Existing words referenced into this collection
    let skippedCount = 0; // Duplicates already present in this exact collection
    const skippedWords = [];
    const importedWords = [];

    for (let i = 0; i < rawWords.length; i++) {
      const w = rawWords[i];
      if (!w) continue;

      // 1. Thai Word extraction
      const wThai = (w.word || w.thaiWord || w.thai_word || w.headword || '').trim();
      if (!wThai) continue;

      // 2. CHECK IF WORD ALREADY EXISTS IN GLOBAL DICTATION_WORDS
      const existingWord = await get(
        `SELECT id, thai_word FROM dictation_words WHERE trim(thai_word) = ?`,
        [wThai]
      );

      let wId;
      if (existingWord) {
        wId = existingWord.id;

        // Check if this word is ALREADY linked to this specific collection
        const alreadyInCol = await get(
          `SELECT 1 FROM dictation_collection_words WHERE collection_id = ? AND word_id = ?`,
          [colId, wId]
        );

        if (alreadyInCol) {
          // Already in THIS collection -> avoid duplicate in the same collection
          skippedCount++;
          skippedWords.push(wThai);
          continue;
        }

        existingWordsLinked++;
      } else {
        // Word does not exist in dictation_words yet -> create as new word entity
        // 3. Phonetic / IPA
        const wPhonetic = (w.ipa || w.phonetic || w.transliteration || '').trim();

        // 4. Meaning (supports string or array of meanings)
        let wMeaning = '';
        if (typeof w.meaning === 'string' && w.meaning.trim()) {
          wMeaning = w.meaning.trim();
        } else if (Array.isArray(w.meanings) && w.meanings.length > 0) {
          wMeaning = w.meanings.map(m => {
            const pos = (m.part_of_speech || m.pos || '').trim();
            const def = (m.meaning || m.definition || '').trim();
            return pos ? `[${pos}] ${def}` : def;
          }).filter(Boolean).join('；');
        }
        if (!wMeaning) wMeaning = wThai;

        // 5. Examples extraction (handles both w.examples and w.meanings[].examples)
        let cleanExamples = [];
        if (Array.isArray(w.examples)) {
          for (const ex of w.examples) {
            const thai = (ex.thai || ex.sentence || '').trim();
            const translation = (ex.translation || ex.meaning || ex.chinese || '').trim();
            if (thai || translation) {
              cleanExamples.push({ thai, translation });
            }
          }
        }
        if (Array.isArray(w.meanings)) {
          for (const m of w.meanings) {
            if (Array.isArray(m.examples)) {
              for (const ex of m.examples) {
                const thai = (ex.thai || ex.sentence || '').trim();
                const translation = (ex.translation || ex.meaning || ex.chinese || '').trim();
                if (thai || translation) {
                  if (!cleanExamples.some(e => e.thai === thai && e.translation === translation)) {
                    cleanExamples.push({ thai, translation });
                  }
                }
              }
            }
          }
        }

        // 6. Audio
        const wAudio = (w.audioUrl || w.audio_url || '').trim();

        // 7. Word ID (ensure no primary key collision)
        wId = w.id && w.id.trim() ? w.id.trim() : `w_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`;
        const existingIdWord = await get(`SELECT id FROM dictation_words WHERE id = ?`, [wId]);
        if (existingIdWord) {
          wId = `w_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`;
        }

        // 8. Insert into dictation_words (with SM-2 default parameters)
        await run(
          `INSERT INTO dictation_words (id, thai_word, phonetic, meaning, audio_url, examples_json, repetition, interval_days, easiness_factor, next_review_date, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, 1, 2.5, ?, ?, ?)`,
          [wId, wThai, wPhonetic, wMeaning, wAudio, JSON.stringify(cleanExamples), nowIso, nowIso, nowIso]
        );

        newWordsCount++;
      }

      // 9. Associate word with collection (Perspective / View reference)
      currentMaxOrder++;
      await run(
        `INSERT OR IGNORE INTO dictation_collection_words (collection_id, word_id, sort_order, created_at)
         VALUES (?, ?, ?, ?)`,
        [colId, wId, currentMaxOrder, nowIso]
      );

      importedCount++;
      importedWords.push(wThai);
    }

    // If 0 words were added to this new collection, clean up empty collection
    if (!existingCol && importedCount === 0) {
      await run(`DELETE FROM dictation_collections WHERE id = ?`, [colId]);
      return res.status(200).json({
        success: true,
        collectionId: null,
        collectionName,
        wordsImported: 0,
        newWordsCreated: 0,
        existingWordsLinked: 0,
        wordsSkipped: skippedCount,
        skippedWords,
        message: `本次导入的 ${skippedCount} 个单词均已存在于该分组中，未重复添加。`
      });
    }

    let detailMsg = `批量导入成功！本分组共添加 ${importedCount} 个词汇`;
    if (newWordsCount > 0 && existingWordsLinked > 0) {
      detailMsg += `（新收录生词 ${newWordsCount} 个，透视引用已有词汇 ${existingWordsLinked} 个）`;
    } else if (newWordsCount > 0) {
      detailMsg += `（全部为新收录生词）`;
    } else if (existingWordsLinked > 0) {
      detailMsg += `（全部透视引用系统已有词库，保留既有复习进度）`;
    }
    if (skippedCount > 0) {
      detailMsg += `，已忽略 ${skippedCount} 个本组已有重复单词`;
    }

    res.status(201).json({
      success: true,
      collectionId: colId,
      collectionName: existingCol ? existingCol.name : collectionName,
      wordsImported: importedCount,
      newWordsCreated: newWordsCount,
      existingWordsLinked: existingWordsLinked,
      wordsSkipped: skippedCount,
      skippedWords: skippedWords.slice(0, 15),
      message: detailMsg
    });
  } catch (err) {
    console.error('Failed to batch import dictation words:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// Sentence Translation & SM-2 Spaced Repetition Practice Backend APIs
// ============================================================================

// 1. GET /api/sentence-groups - List all sentence groups with counts & stats
app.get('/api/sentence-groups', async (req, res) => {
  try {
    const { search } = req.query;
    let sql = `
      SELECT 
        g.*,
        COUNT(s.id) AS total_sentences,
        SUM(CASE WHEN datetime(s.next_review_date) <= datetime('now', 'localtime') THEN 1 ELSE 0 END) AS due_count,
        SUM(CASE WHEN s.repetition >= 3 THEN 1 ELSE 0 END) AS mastered_count
      FROM sentence_groups g
      LEFT JOIN sentence_items s ON g.id = s.group_id
    `;
    const params = [];
    if (search && search.trim()) {
      sql += ` WHERE g.name LIKE ? OR g.description LIKE ?`;
      const term = `%${search.trim()}%`;
      params.push(term, term);
    }
    sql += ` GROUP BY g.id ORDER BY g.sort_order ASC, g.created_at ASC`;
    const groups = await all(sql, params);
    res.json(groups.map(g => ({
      ...g,
      total_sentences: Number(g.total_sentences || 0),
      due_count: Number(g.due_count || 0),
      mastered_count: Number(g.mastered_count || 0)
    })));
  } catch (err) {
    console.error('Failed to get sentence groups:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. GET /api/sentence-groups/:id - Single sentence group detail with sentences
app.get('/api/sentence-groups/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const group = await get(`SELECT * FROM sentence_groups WHERE id = ?`, [id]);
    if (!group) {
      return res.status(404).json({ error: `Sentence group with ID ${id} not found` });
    }

    const sentences = await all(
      `SELECT * FROM sentence_items WHERE group_id = ? ORDER BY sort_order ASC, created_at ASC`,
      [id]
    );

    res.json({
      group,
      sentences: sentences.map(s => ({
        ...s,
        other_vocab_notes: typeof s.other_vocab_notes === 'string' ? JSON.parse(s.other_vocab_notes || '[]') : s.other_vocab_notes
      }))
    });
  } catch (err) {
    console.error('Failed to get sentence group:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. POST /api/sentence-groups - Create new sentence group
app.post('/api/sentence-groups', async (req, res) => {
  try {
    const { id, name, description, sort_order } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Group name is required' });
    }

    const groupId = (id && id.trim()) ? id.trim() : `grp_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
    const nowIso = new Date().toISOString();

    const maxSortRow = await get(`SELECT MAX(sort_order) as max_sort FROM sentence_groups`);
    const nextSort = sort_order !== undefined ? parseInt(sort_order, 10) : (Number(maxSortRow?.max_sort || 0) + 1);

    await run(
      `INSERT INTO sentence_groups (id, name, description, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [groupId, name.trim(), description ? description.trim() : '', nextSort, nowIso, nowIso]
    );

    const created = await get(`SELECT * FROM sentence_groups WHERE id = ?`, [groupId]);
    res.status(201).json(created);
  } catch (err) {
    console.error('Failed to create sentence group:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. PUT /api/sentence-groups/:id - Update sentence group
app.put('/api/sentence-groups/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, sort_order } = req.body;

    const existing = await get(`SELECT * FROM sentence_groups WHERE id = ?`, [id]);
    if (!existing) {
      return res.status(404).json({ error: `Sentence group with ID ${id} not found` });
    }

    const updatedName = name !== undefined ? name.trim() : existing.name;
    const updatedDesc = description !== undefined ? description.trim() : existing.description;
    const updatedSort = sort_order !== undefined ? parseInt(sort_order, 10) : existing.sort_order;
    const nowIso = new Date().toISOString();

    await run(
      `UPDATE sentence_groups SET name = ?, description = ?, sort_order = ?, updated_at = ? WHERE id = ?`,
      [updatedName, updatedDesc, updatedSort, nowIso, id]
    );

    const updated = await get(`SELECT * FROM sentence_groups WHERE id = ?`, [id]);
    res.json(updated);
  } catch (err) {
    console.error('Failed to update sentence group:', err);
    res.status(500).json({ error: err.message });
  }
});

// 5. DELETE /api/sentence-groups/:id - Delete sentence group and cascade sentences
app.delete('/api/sentence-groups/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await get(`SELECT * FROM sentence_groups WHERE id = ?`, [id]);
    if (!existing) {
      return res.status(404).json({ error: `Sentence group with ID ${id} not found` });
    }

    // Delete review logs for all sentences in this group
    await run(
      `DELETE FROM sentence_review_logs WHERE sentence_id IN (SELECT id FROM sentence_items WHERE group_id = ?)`,
      [id]
    );
    // Delete sentences in this group
    await run(`DELETE FROM sentence_items WHERE group_id = ?`, [id]);
    // Delete group
    await run(`DELETE FROM sentence_groups WHERE id = ?`, [id]);

    res.json({ success: true, message: `Group ${id} and all its sentences deleted successfully` });
  } catch (err) {
    console.error('Failed to delete sentence group:', err);
    res.status(500).json({ error: err.message });
  }
});

// 6. GET /api/sentences - Query sentences with filters
app.get('/api/sentences', async (req, res) => {
  try {
    const { group_id, search, due_only, limit, offset } = req.query;
    let whereClauses = [];
    let params = [];

    if (group_id && group_id !== 'all') {
      whereClauses.push(`s.group_id = ?`);
      params.push(group_id);
    }

    if (search && search.trim()) {
      whereClauses.push(`(s.thai_word LIKE ? OR s.chinese_sentence LIKE ? OR s.reference_thai LIKE ? OR s.notes LIKE ?)`);
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term);
    }

    if (due_only === 'true' || due_only === '1') {
      whereClauses.push(`datetime(s.next_review_date) <= datetime('now', 'localtime')`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countRow = await get(
      `SELECT COUNT(*) as total FROM sentence_items s ${whereSql}`,
      params
    );

    let querySql = `
      SELECT s.*, g.name AS group_name 
      FROM sentence_items s
      LEFT JOIN sentence_groups g ON s.group_id = g.id
      ${whereSql}
      ORDER BY s.sort_order ASC, s.created_at ASC
    `;

    if (limit) {
      querySql += ` LIMIT ?`;
      params.push(parseInt(limit, 10));
      if (offset) {
        querySql += ` OFFSET ?`;
        params.push(parseInt(offset, 10));
      }
    }

    const rows = await all(querySql, params);
    res.json({
      total: countRow ? countRow.total : 0,
      sentences: rows.map(r => ({
        ...r,
        other_vocab_notes: typeof r.other_vocab_notes === 'string' ? JSON.parse(r.other_vocab_notes || '[]') : r.other_vocab_notes
      }))
    });
  } catch (err) {
    console.error('Failed to list sentences:', err);
    res.status(500).json({ error: err.message });
  }
});

// 7. GET /api/sentences/:id - Single sentence detail with review history
app.get('/api/sentences/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const sentence = await get(
      `SELECT s.*, g.name AS group_name FROM sentence_items s LEFT JOIN sentence_groups g ON s.group_id = g.id WHERE s.id = ?`,
      [id]
    );
    if (!sentence) {
      return res.status(404).json({ error: `Sentence with ID ${id} not found` });
    }

    const logs = await all(
      `SELECT * FROM sentence_review_logs WHERE sentence_id = ? ORDER BY reviewed_at DESC LIMIT 20`,
      [id]
    );

    res.json({
      ...sentence,
      other_vocab_notes: typeof sentence.other_vocab_notes === 'string' ? JSON.parse(sentence.other_vocab_notes || '[]') : sentence.other_vocab_notes,
      review_logs: logs
    });
  } catch (err) {
    console.error('Failed to get sentence:', err);
    res.status(500).json({ error: err.message });
  }
});

// 8. POST /api/sentences - Create single sentence
app.post('/api/sentences', async (req, res) => {
  try {
    const {
      id,
      group_id,
      thai_word,
      chinese_sentence,
      reference_thai,
      target_word_used,
      other_vocab_notes,
      thai_word_count,
      notes,
      sort_order
    } = req.body;

    if (!group_id) {
      return res.status(400).json({ error: 'group_id is required' });
    }
    if (!thai_word || !thai_word.trim()) {
      return res.status(400).json({ error: 'thai_word is required' });
    }
    if (!chinese_sentence || !chinese_sentence.trim()) {
      return res.status(400).json({ error: 'chinese_sentence is required' });
    }
    if (!reference_thai || !reference_thai.trim()) {
      return res.status(400).json({ error: 'reference_thai is required' });
    }

    // Verify group exists
    const group = await get(`SELECT id FROM sentence_groups WHERE id = ?`, [group_id]);
    if (!group) {
      return res.status(400).json({ error: `Group with ID ${group_id} does not exist` });
    }

    const sentenceId = (id && id.trim()) ? id.trim() : `sent_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    const nowIso = new Date().toISOString();

    const maxSortRow = await get(`SELECT MAX(sort_order) as max_sort FROM sentence_items WHERE group_id = ?`, [group_id]);
    const nextSort = sort_order !== undefined ? parseInt(sort_order, 10) : (Number(maxSortRow?.max_sort || 0) + 1);

    const vocabNotesStr = Array.isArray(other_vocab_notes) ? JSON.stringify(other_vocab_notes) : (typeof other_vocab_notes === 'string' ? other_vocab_notes : '[]');
    const countVal = thai_word_count ? parseInt(thai_word_count, 10) : 0;
    const rawJsonStr = JSON.stringify({
      thai_word: thai_word.trim(),
      chinese_sentence: chinese_sentence.trim(),
      reference_thai: reference_thai.trim(),
      target_word_used: target_word_used ? target_word_used.trim() : thai_word.trim(),
      other_vocab_notes: Array.isArray(other_vocab_notes) ? other_vocab_notes : [],
      thai_word_count: countVal,
      notes: notes ? notes.trim() : ''
    });

    await run(
      `INSERT INTO sentence_items (
        id, group_id, thai_word, chinese_sentence, reference_thai, target_word_used,
        other_vocab_notes, thai_word_count, notes, raw_json, sort_order,
        repetition, interval_days, easiness_factor, next_review_date, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 2.5, ?, ?, ?)`,
      [
        sentenceId,
        group_id,
        thai_word.trim(),
        chinese_sentence.trim(),
        reference_thai.trim(),
        target_word_used ? target_word_used.trim() : thai_word.trim(),
        vocabNotesStr,
        countVal,
        notes ? notes.trim() : '',
        rawJsonStr,
        nextSort,
        nowIso,
        nowIso,
        nowIso
      ]
    );

    const created = await get(`SELECT * FROM sentence_items WHERE id = ?`, [sentenceId]);
    res.status(201).json({
      ...created,
      other_vocab_notes: JSON.parse(created.other_vocab_notes || '[]')
    });
  } catch (err) {
    console.error('Failed to create sentence:', err);
    res.status(500).json({ error: err.message });
  }
});

// 9. PUT /api/sentences/:id - Update single sentence
app.put('/api/sentences/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await get(`SELECT * FROM sentence_items WHERE id = ?`, [id]);
    if (!existing) {
      return res.status(404).json({ error: `Sentence with ID ${id} not found` });
    }

    const {
      group_id,
      thai_word,
      chinese_sentence,
      reference_thai,
      target_word_used,
      other_vocab_notes,
      thai_word_count,
      notes,
      sort_order,
      repetition,
      interval_days,
      easiness_factor,
      next_review_date
    } = req.body;

    const updatedGroupId = group_id !== undefined ? group_id : existing.group_id;
    const updatedThaiWord = thai_word !== undefined ? thai_word.trim() : existing.thai_word;
    const updatedChinese = chinese_sentence !== undefined ? chinese_sentence.trim() : existing.chinese_sentence;
    const updatedRefThai = reference_thai !== undefined ? reference_thai.trim() : existing.reference_thai;
    const updatedTargetWord = target_word_used !== undefined ? target_word_used.trim() : existing.target_word_used;
    const updatedVocabNotes = other_vocab_notes !== undefined 
      ? (Array.isArray(other_vocab_notes) ? JSON.stringify(other_vocab_notes) : (typeof other_vocab_notes === 'string' ? other_vocab_notes : '[]'))
      : existing.other_vocab_notes;
    const updatedCount = thai_word_count !== undefined ? parseInt(thai_word_count, 10) : existing.thai_word_count;
    const updatedNotes = notes !== undefined ? notes.trim() : existing.notes;
    const updatedSort = sort_order !== undefined ? parseInt(sort_order, 10) : existing.sort_order;
    
    // SM-2 fields update if explicitly passed
    const updatedRep = repetition !== undefined ? parseInt(repetition, 10) : existing.repetition;
    const updatedInterval = interval_days !== undefined ? parseInt(interval_days, 10) : existing.interval_days;
    const updatedEF = easiness_factor !== undefined ? parseFloat(easiness_factor) : existing.easiness_factor;
    const updatedNextReview = next_review_date !== undefined ? next_review_date : existing.next_review_date;
    const nowIso = new Date().toISOString();

    const rawJsonObj = {
      thai_word: updatedThaiWord,
      chinese_sentence: updatedChinese,
      reference_thai: updatedRefThai,
      target_word_used: updatedTargetWord,
      other_vocab_notes: typeof updatedVocabNotes === 'string' ? JSON.parse(updatedVocabNotes || '[]') : updatedVocabNotes,
      thai_word_count: updatedCount,
      notes: updatedNotes
    };

    await run(
      `UPDATE sentence_items SET
        group_id = ?, thai_word = ?, chinese_sentence = ?, reference_thai = ?, target_word_used = ?,
        other_vocab_notes = ?, thai_word_count = ?, notes = ?, raw_json = ?, sort_order = ?,
        repetition = ?, interval_days = ?, easiness_factor = ?, next_review_date = ?, updated_at = ?
      WHERE id = ?`,
      [
        updatedGroupId,
        updatedThaiWord,
        updatedChinese,
        updatedRefThai,
        updatedTargetWord,
        updatedVocabNotes,
        updatedCount,
        updatedNotes,
        JSON.stringify(rawJsonObj),
        updatedSort,
        updatedRep,
        updatedInterval,
        updatedEF,
        updatedNextReview,
        nowIso,
        id
      ]
    );

    const updated = await get(`SELECT * FROM sentence_items WHERE id = ?`, [id]);
    res.json({
      ...updated,
      other_vocab_notes: JSON.parse(updated.other_vocab_notes || '[]')
    });
  } catch (err) {
    console.error('Failed to update sentence:', err);
    res.status(500).json({ error: err.message });
  }
});

// 10. DELETE /api/sentences/:id - Delete single sentence
app.delete('/api/sentences/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await get(`SELECT * FROM sentence_items WHERE id = ?`, [id]);
    if (!existing) {
      return res.status(404).json({ error: `Sentence with ID ${id} not found` });
    }

    await run(`DELETE FROM sentence_review_logs WHERE sentence_id = ?`, [id]);
    await run(`DELETE FROM sentence_items WHERE id = ?`, [id]);
    res.json({ success: true, message: `Sentence ${id} deleted successfully` });
  } catch (err) {
    console.error('Failed to delete sentence:', err);
    res.status(500).json({ error: err.message });
  }
});

// 11. POST /api/sentences/:id/reset-sm2 - Reset spaced repetition progress
app.post('/api/sentences/:id/reset-sm2', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await get(`SELECT * FROM sentence_items WHERE id = ?`, [id]);
    if (!existing) {
      return res.status(404).json({ error: `Sentence with ID ${id} not found` });
    }

    const nowIso = new Date().toISOString();
    await run(
      `UPDATE sentence_items SET
        repetition = 0, interval_days = 1, easiness_factor = 2.5,
        next_review_date = ?, last_reviewed_at = NULL, last_score = NULL,
        review_count = 0, updated_at = ?
      WHERE id = ?`,
      [nowIso, nowIso, id]
    );

    const updated = await get(`SELECT * FROM sentence_items WHERE id = ?`, [id]);
    res.json({
      success: true,
      message: 'SM-2 spaced repetition status has been reset.',
      sentence: {
        ...updated,
        other_vocab_notes: JSON.parse(updated.other_vocab_notes || '[]')
      }
    });
  } catch (err) {
    console.error('Failed to reset SM-2:', err);
    res.status(500).json({ error: err.message });
  }
});

// 12. POST /api/sentences/batch-import - Batch JSON import & upsert sentences into a group
app.post('/api/sentences/batch-import', async (req, res) => {
  try {
    let { group_id, new_group_name, new_group_description, group_name, sentences } = req.body;

    // Support payload directly being an array: [ {...}, {...} ]
    if (Array.isArray(req.body)) {
      sentences = req.body;
      group_id = req.query.group_id;
    }

    if (!Array.isArray(sentences) || sentences.length === 0) {
      return res.status(400).json({ error: 'No sentences provided in array.' });
    }

    let targetGroupId = group_id;
    const targetGroupName = new_group_name || group_name;
    const nowIso = new Date().toISOString();

    // If new group name is provided, or group_id not specified but group name exists:
    if (!targetGroupId && targetGroupName) {
      targetGroupId = `grp_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
      const maxSort = await get(`SELECT MAX(sort_order) as m FROM sentence_groups`);
      await run(
        `INSERT INTO sentence_groups (id, name, description, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [targetGroupId, targetGroupName.trim(), new_group_description || '', Number(maxSort?.m || 0) + 1, nowIso, nowIso]
      );
    } else if (!targetGroupId) {
      // Pick first available group if none provided
      const firstGroup = await get(`SELECT id FROM sentence_groups ORDER BY sort_order ASC, created_at ASC LIMIT 1`);
      if (firstGroup) {
        targetGroupId = firstGroup.id;
      } else {
        // Create default group
        targetGroupId = 'grp_default';
        await run(
          `INSERT INTO sentence_groups (id, name, description, sort_order, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`,
          [targetGroupId, '默认单词句型练习组', '系统自动创建的默认词组', nowIso, nowIso]
        );
      }
    }

    let importedCount = 0;
    let maxSortRow = await get(`SELECT MAX(sort_order) as m FROM sentence_items WHERE group_id = ?`, [targetGroupId]);
    let currentSort = Number(maxSortRow?.m || 0) + 1;

    for (const item of sentences) {
      if (!item || !item.thai_word || !item.chinese_sentence || !item.reference_thai) {
        continue;
      }

      const sentenceId = (item.id && String(item.id).trim()) ? String(item.id).trim() : `sent_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}_${importedCount}`;
      const thaiWord = String(item.thai_word).trim();
      const chineseSentence = String(item.chinese_sentence).trim();
      const referenceThai = String(item.reference_thai).trim();
      const targetWordUsed = item.target_word_used ? String(item.target_word_used).trim() : thaiWord;
      const vocabNotesStr = Array.isArray(item.other_vocab_notes) 
        ? JSON.stringify(item.other_vocab_notes) 
        : (typeof item.other_vocab_notes === 'string' ? item.other_vocab_notes : '[]');
      const wordCount = item.thai_word_count ? parseInt(item.thai_word_count, 10) : 0;
      const notes = item.notes ? String(item.notes).trim() : '';
      const rawJson = JSON.stringify(item);

      // Check if existing sentence with same id or (group_id + thai_word + chinese_sentence) exists
      const existing = await get(
        `SELECT id FROM sentence_items WHERE id = ? OR (group_id = ? AND thai_word = ? AND chinese_sentence = ?)`,
        [sentenceId, targetGroupId, thaiWord, chineseSentence]
      );

      if (existing) {
        await run(
          `UPDATE sentence_items SET
            thai_word = ?, chinese_sentence = ?, reference_thai = ?, target_word_used = ?,
            other_vocab_notes = ?, thai_word_count = ?, notes = ?, raw_json = ?, updated_at = ?
          WHERE id = ?`,
          [
            thaiWord,
            chineseSentence,
            referenceThai,
            targetWordUsed,
            vocabNotesStr,
            wordCount,
            notes,
            rawJson,
            nowIso,
            existing.id
          ]
        );
      } else {
        await run(
          `INSERT INTO sentence_items (
            id, group_id, thai_word, chinese_sentence, reference_thai, target_word_used,
            other_vocab_notes, thai_word_count, notes, raw_json, sort_order,
            repetition, interval_days, easiness_factor, next_review_date, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 2.5, ?, ?, ?)`,
          [
            sentenceId,
            targetGroupId,
            thaiWord,
            chineseSentence,
            referenceThai,
            targetWordUsed,
            vocabNotesStr,
            wordCount,
            notes,
            rawJson,
            currentSort++,
            nowIso,
            nowIso,
            nowIso
          ]
        );
      }
      importedCount++;
    }

    res.status(201).json({
      success: true,
      group_id: targetGroupId,
      count: importedCount
    });
  } catch (err) {
    console.error('Failed to batch import sentences:', err);
    res.status(500).json({ error: err.message });
  }
});

// 13. GET /api/sentence-practice/group/:groupId - Practice items for a specific group
app.get('/api/sentence-practice/group/:groupId', async (req, res) => {
  try {
    const { groupId } = req.params;
    const group = await get(`SELECT * FROM sentence_groups WHERE id = ?`, [groupId]);
    if (!group) {
      return res.status(404).json({ error: `Group ${groupId} not found` });
    }

    const sentences = await all(
      `SELECT * FROM sentence_items WHERE group_id = ? ORDER BY sort_order ASC, created_at ASC`,
      [groupId]
    );

    res.json({
      group,
      total: sentences.length,
      sentences: sentences.map(s => ({
        ...s,
        other_vocab_notes: typeof s.other_vocab_notes === 'string' ? JSON.parse(s.other_vocab_notes || '[]') : s.other_vocab_notes
      }))
    });
  } catch (err) {
    console.error('Failed to get group practice items:', err);
    res.status(500).json({ error: err.message });
  }
});

// 14. GET /api/sentence-practice/review - Spaced Repetition Due Review Queue
app.get('/api/sentence-practice/review', async (req, res) => {
  try {
    const { all: includeAll, limit } = req.query;
    let querySql = `
      SELECT s.*, g.name AS group_name
      FROM sentence_items s
      LEFT JOIN sentence_groups g ON s.group_id = g.id
    `;
    const params = [];

    if (includeAll !== 'true' && includeAll !== '1') {
      querySql += ` WHERE datetime(s.next_review_date) <= datetime('now', 'localtime')`;
    }

    querySql += ` ORDER BY s.next_review_date ASC, s.repetition ASC`;

    if (limit) {
      querySql += ` LIMIT ?`;
      params.push(parseInt(limit, 10));
    }

    const rows = await all(querySql, params);

    const totalDueRow = await get(
      `SELECT COUNT(*) as due_total FROM sentence_items WHERE datetime(next_review_date) <= datetime('now', 'localtime')`
    );

    res.json({
      due_count: totalDueRow ? totalDueRow.due_total : 0,
      total_retrieved: rows.length,
      sentences: rows.map(r => ({
        ...r,
        other_vocab_notes: typeof r.other_vocab_notes === 'string' ? JSON.parse(r.other_vocab_notes || '[]') : r.other_vocab_notes
      }))
    });
  } catch (err) {
    console.error('Failed to get review practice items:', err);
    res.status(500).json({ error: err.message });
  }
});

// 15. POST /api/sentence-practice/score - Submit grading score (0-5) and update SM-2
app.post('/api/sentence-practice/score', async (req, res) => {
  try {
    const { sentence_id, score } = req.body;
    if (!sentence_id) {
      return res.status(400).json({ error: 'sentence_id is required' });
    }
    const numScore = parseInt(score, 10);
    if (isNaN(numScore) || numScore < 0 || numScore > 5) {
      return res.status(400).json({ error: 'score must be an integer between 0 and 5' });
    }

    const sentence = await get(`SELECT * FROM sentence_items WHERE id = ?`, [sentence_id]);
    if (!sentence) {
      return res.status(404).json({ error: `Sentence with ID ${sentence_id} not found` });
    }

    // Calculate SM-2 state
    const sm2Result = calculateSentenceSM2({
      repetition: sentence.repetition,
      interval_days: sentence.interval_days,
      easiness_factor: sentence.easiness_factor
    }, numScore);

    const nowIso = new Date().toISOString();

    // Update sentence_items
    await run(
      `UPDATE sentence_items SET
        repetition = ?,
        interval_days = ?,
        easiness_factor = ?,
        next_review_date = ?,
        last_reviewed_at = ?,
        last_score = ?,
        review_count = review_count + 1,
        updated_at = ?
      WHERE id = ?`,
      [
        sm2Result.repetition,
        sm2Result.interval_days,
        sm2Result.easiness_factor,
        sm2Result.next_review_date,
        nowIso,
        numScore,
        nowIso,
        sentence_id
      ]
    );

    // Insert review log
    await run(
      `INSERT INTO sentence_review_logs (
        sentence_id, group_id, score,
        prev_repetition, new_repetition,
        prev_interval, new_interval,
        prev_easiness_factor, new_easiness_factor,
        next_review_date, reviewed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sentence_id,
        sentence.group_id,
        numScore,
        sentence.repetition,
        sm2Result.repetition,
        sentence.interval_days,
        sm2Result.interval_days,
        sentence.easiness_factor,
        sm2Result.easiness_factor,
        sm2Result.next_review_date,
        nowIso
      ]
    );

    const updated = await get(
      `SELECT s.*, g.name AS group_name FROM sentence_items s LEFT JOIN sentence_groups g ON s.group_id = g.id WHERE s.id = ?`,
      [sentence_id]
    );

    res.json({
      success: true,
      sentence: {
        ...updated,
        other_vocab_notes: JSON.parse(updated.other_vocab_notes || '[]')
      },
      sm2: sm2Result
    });
  } catch (err) {
    console.error('Failed to record sentence score:', err);
    res.status(500).json({ error: err.message });
  }
});

// 16. GET /api/sentence-practice/stats - Overall stats for dashboard & review banner
app.get('/api/sentence-practice/stats', async (req, res) => {
  try {
    const totalSentencesRow = await get(`SELECT COUNT(*) as count FROM sentence_items`);
    const dueTodayRow = await get(
      `SELECT COUNT(*) as count FROM sentence_items WHERE datetime(next_review_date) <= datetime('now', 'localtime')`
    );
    const reviewedTodayRow = await get(
      `SELECT COUNT(*) as count FROM sentence_review_logs WHERE date(reviewed_at) = date('now', 'localtime')`
    );
    const masteredRow = await get(
      `SELECT COUNT(*) as count FROM sentence_items WHERE repetition >= 3`
    );
    const groupsCountRow = await get(`SELECT COUNT(*) as count FROM sentence_groups`);

    const recentLogs = await all(
      `SELECT l.*, s.thai_word, s.chinese_sentence, g.name as group_name
       FROM sentence_review_logs l
       LEFT JOIN sentence_items s ON l.sentence_id = s.id
       LEFT JOIN sentence_groups g ON l.group_id = g.id
       ORDER BY l.reviewed_at DESC LIMIT 15`
    );

    res.json({
      total_sentences: Number(totalSentencesRow?.count || 0),
      due_today_count: Number(dueTodayRow?.count || 0),
      reviewed_today_count: Number(reviewedTodayRow?.count || 0),
      mastered_count: Number(masteredRow?.count || 0),
      total_groups: Number(groupsCountRow?.count || 0),
      recent_logs: recentLogs
    });
  } catch (err) {
    console.error('Failed to get sentence practice stats:', err);
    res.status(500).json({ error: err.message });
  }
});

// Serve static files from parent directory (which hosts the Pages folder)
app.use(express.static(parentDir));



// Redirect root to console admin page
app.get('/', (req, res) => {
  res.redirect('/Pages/consoleCourseReview.html');
});

// Initialize DB and start listening
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`ThaiNotes Backend Server running on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database on startup:', err);
});
