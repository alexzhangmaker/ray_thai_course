import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'thainotes.db');
const db = new sqlite3.Database(dbPath);

// Promisify database operations
export const run = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
};

export const get = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

export const all = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

export const initDb = async () => {
  // Create vocabulary table with nullable lesson_id and sort_order
  await run(`
    CREATE TABLE IF NOT EXISTS vocabulary (
      id TEXT PRIMARY KEY,
      lesson_id TEXT,
      sort_order INTEGER,
      headword TEXT NOT NULL,
      pos TEXT NOT NULL,
      meaning TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // Create grammar_notes table with nullable lesson_id and sort_order
  await run(`
    CREATE TABLE IF NOT EXISTS grammar_notes (
      id TEXT PRIMARY KEY,
      lesson_id TEXT,
      sort_order INTEGER,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      summary TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // Migrate vocabulary table if columns are currently NOT NULL
  const vocabCols = await all(`PRAGMA table_info(vocabulary)`);
  const vocabLessonId = vocabCols.find(c => c.name === 'lesson_id');
  if (vocabLessonId && vocabLessonId.notnull === 1) {
    console.log("Migrating vocabulary table to make lesson_id nullable...");
    await run(`ALTER TABLE vocabulary RENAME TO _vocabulary_old`);
    await run(`
      CREATE TABLE vocabulary (
        id TEXT PRIMARY KEY,
        lesson_id TEXT,
        sort_order INTEGER,
        headword TEXT NOT NULL,
        pos TEXT NOT NULL,
        meaning TEXT NOT NULL,
        data_json TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT DEFAULT (datetime('now', 'localtime'))
      )
    `);
    await run(`INSERT INTO vocabulary SELECT id, lesson_id, sort_order, headword, pos, meaning, data_json, created_at, updated_at FROM _vocabulary_old`);
    await run(`DROP TABLE _vocabulary_old`);
    console.log("Vocabulary table migrated successfully.");
  }

  // Migrate grammar_notes table if columns are currently NOT NULL
  const grammarCols = await all(`PRAGMA table_info(grammar_notes)`);
  const grammarLessonId = grammarCols.find(c => c.name === 'lesson_id');
  if (grammarLessonId && grammarLessonId.notnull === 1) {
    console.log("Migrating grammar_notes table to make lesson_id nullable...");
    await run(`ALTER TABLE grammar_notes RENAME TO _grammar_notes_old`);
    await run(`
      CREATE TABLE grammar_notes (
        id TEXT PRIMARY KEY,
        lesson_id TEXT,
        sort_order INTEGER,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        summary TEXT NOT NULL,
        data_json TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT DEFAULT (datetime('now', 'localtime'))
      )
    `);
    await run(`INSERT INTO grammar_notes SELECT id, lesson_id, sort_order, title, category, summary, data_json, created_at, updated_at FROM _grammar_notes_old`);
    await run(`DROP TABLE _grammar_notes_old`);
    console.log("Grammar_notes table migrated successfully.");
  }

  // Create courses table
  await run(`
    CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // Create course_lessons table
  await run(`
    CREATE TABLE IF NOT EXISTS course_lessons (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      title TEXT NOT NULL,
      content_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE
    )
  `);

  // Seed default course and course lessons if courses table is empty
  const courseCount = await get(`SELECT COUNT(*) as count FROM courses`);
  if (courseCount.count === 0) {
    console.log("Seeding default course '基础泰语2' and 10 lessons...");
    const courseId = "course_001";
    await run(
      `INSERT INTO courses (id, name, description) VALUES (?, ?, ?)`,
      [courseId, "基础泰语2", "泰语进阶课程，涵盖日常交流、核心词汇和复杂语法结构。"]
    );

    // Create 10 lessons
    for (let i = 1; i <= 10; i++) {
      const lessonId = `lesson_${String(i).padStart(3, '0')}`;
      let title = `第${i}课：`;
      let vocabularyIds = [];
      let grammarNoteIds = [];

      // Link existing seeded data to appropriate lessons
      if (i === 1) {
        title += "大约与数量估计";
        vocabularyIds = ["vp_008"]; // vp_008 ประมาณ
      } else if (i === 3) {
        title += "被动句式的应用";
        grammarNoteIds = ["gn_001"]; // gn_001 被动句 ถูก
      } else {
        title += `日常主题课 ${i}`;
      }

      const content = {
        vocabularyIds,
        grammarNoteIds
      };

      await run(
        `INSERT INTO course_lessons (id, course_id, sort_order, title, content_json) VALUES (?, ?, ?, ?, ?)`,
        [lessonId, courseId, i, title, JSON.stringify(content)]
      );
    }
    console.log("Seeded courses and course_lessons successfully.");
  }

  // Seed default vocabulary if empty
  const count = await get(`SELECT COUNT(*) as count FROM vocabulary`);
  if (count.count === 0) {
    console.log("Seeding default vocabulary data (vp_008 ประมาณ) from appKeyWordsV0_1.html...");
    
    const seedVocab = {
      id: "vp_008",
      lessonId: "lesson_001",
      order: 8,
      headword: "ประมาณ",
      pos: "副词",
      meaning: "大约、大概",
      usageRule: {
        summary: "用在数词前面，表示一个大概的数目。",
        structure: "动词/名词 + ประมาณ + 数字 + 量词"
      },
      metadata: { difficulty: 2, estimatedTimeSec: 120, tags: ["副词", "数词", "A2"] },
      interactions: [
        {
          id: "vp_008_task_1",
          type: "position_insert",
          instruction: "将 'ประมาณ' 拖到句子中的正确插槽位置",
          difficulty: 1,
          hints: ["想想：ประมาณ 应该放在什么词的前面？", "提示：数词是哪一个？"],
          feedback: { correct: "正确！ประมาณ 放在数词 ๘ 的前面。", wrong: "不对哦，ประมาณ 应该放在数词的前面，再试试。" },
          payload: {
            contextParts: ["เราเรียนภาษาไทย", "๘ ชั่วโมง", "ต่อสัปดาห์"],
            targetWord: "ประมาณ",
            correctSlotIndex: 1
          }
        },
        {
          id: "vp_008_task_2",
          type: "fill_blank",
          instruction: "选择正确的词填入空白处",
          difficulty: 2,
          hints: ["句子要表达'大约'的意思", "哪个词表示'大约、大概'？"],
          feedback: { correct: "正确！ประมาณ 表示大约。", wrong: "不对，这里需要表示'大约'的词。" },
          payload: {
            sentenceWithBlank: "เขาอยู่กว่างโจว ______ ๒๐ ปีแล้ว",
            options: [
              { id: "opt_1", text: "ประมาณ", isCorrect: true },
              { id: "opt_2", text: "มาก", isCorrect: false },
              { id: "opt_3", text: "น้อย", isCorrect: false },
              { id: "opt_4", text: "บาง", isCorrect: false }
            ]
          }
        },
        {
          id: "vp_008_task_3",
          type: "sentence_build",
          instruction: "点击词块，组成正确的句子（支持多种语序）",
          difficulty: 2,
          hints: ["时间状语 'ปีหนึ่ง' 通常放在句首或句尾", "ประมาณ 要放在数词前面"],
          feedback: { correct: "太棒了！句子结构完全正确。", wrong: "检查一下：ประมาณ 的位置对吗？或者ปีหนึ่ง的位置是否合适？" },
          payload: {
            chunks: [
              { id: "c1", text: "ผม" }, { id: "c2", text: "ไปเมืองไทย" },
              { id: "c3", text: "ประมาณ" }, { id: "c4", text: "๒-๓ เดือน" },
              { id: "c5", text: "ปีหนึ่ง" }
            ],
            acceptableOrders: [
              ["c1", "c2", "c3", "c4", "c5"],
              ["c5", "c1", "c2", "c3", "c4"]
            ]
          }
        },
        {
          id: "vp_008_task_4",
          type: "scenario_judge",
          instruction: "判断以下哪种情况应该使用 'ประมาณ'？",
          difficulty: 2,
          hints: ["ประมาณ 用于什么情况？", "确切的数字 vs 大概的数字"],
          feedback: { correct: "正确！理解得很清楚。", wrong: "记住：ประมาณ 用于不确定的大概数量。" },
          payload: {
            scenarios: [
              { id: "sc_1", text: "你知道确切的价格是 100 泰铢", shouldUse: false, reason: "确切数字不需要用ประมาณ" },
              { id: "sc_2", text: "你估计价格大概是 100 泰铢左右", shouldUse: true, reason: "不确定的估计需要用ประมาณ" }
            ]
          }
        },
        {
          id: "vp_008_task_5",
          type: "error_detect",
          instruction: "找出句子中的错误并选择原因",
          difficulty: 3,
          hints: ["想想：'3碗'是确切的数字还是大概的数字？", "如果每天确切吃3碗，需要用'大约'吗？"],
          feedback: { correct: "对！确切的数量不需要用ประมาณ。", wrong: "再想想：ประมาณ 的使用场景是什么？" },
          payload: {
            targetSentence: "ฉันกินข้าวประมาณ ๓ จานทุกวัน",
            choices: [
              { id: "err_1", text: "位置错误", isCorrectChoice: false },
              { id: "err_2", text: "不应该用ประมาณ (确切数量)", isCorrectChoice: true },
              { id: "err_3", text: "量词错误", isCorrectChoice: false },
              { id: "err_4", text: "句子完全正确", isCorrectChoice: false }
            ]
          }
        }
      ]
    };

    await run(
      `INSERT INTO vocabulary (id, lesson_id, sort_order, headword, pos, meaning, data_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        seedVocab.id,
        seedVocab.lessonId,
        seedVocab.order,
        seedVocab.headword,
        seedVocab.pos,
        seedVocab.meaning,
        JSON.stringify(seedVocab)
      ]
    );
    console.log("Seeded database with initial vocabulary: ", seedVocab.id);
  }

  // Seed default grammar notes if empty
  const grammarCount = await get(`SELECT COUNT(*) as count FROM grammar_notes`);
  if (grammarCount.count === 0) {
    console.log("Seeding default grammar note (gn_001 ถูก)...");
    const seedGrammar = {
      "id": "gn_001",
      "lessonId": "lesson_003",
      "order": 1,
      "title": "被动句 ถูก",
      "titleThai": "ประโยคถูกกระทำ",
      "category": "句式结构",
      "summary": "用 ถูก 表示被动，常用于不好的事情发生在主语身上。",
      "rules": [
        {
          "name": "基本被动句式",
          "structure": "主语 + ถูก + (施事者) + 动词",
          "explanation": "ถูก 放在动词前面，表示主语被（某人）做了某事。施事者可以省略。",
          "constraints": ["多用于不好的事情", "好事通常用 ได้รับ 而非 ถูก"]
        }
      ],
      "examples": [
        {
          "thai": "เขาถูกตี",
          "chinese": "他被打了",
          "focusSpan": "ถูกตี",
          "isCorrect": true,
          "annotation": "基本被动句：不好的事"
        },
        {
          "thai": "เขาถูกรางวัล",
          "chinese": "他被（得了）奖 ✗",
          "focusSpan": "ถูกรางวัล",
          "isCorrect": false,
          "annotation": "✗ 得奖是好事，不应用 ถูก，应该用 ได้รับ"
        }
      ],
      "relatedVocabIds": [],
      "confusables": [],
      "metadata": {
        "difficulty": 2,
        "estimatedTimeSec": 180,
        "tags": ["被动句", "句式结构", "A2"]
      },
      "interactions": [
        {
          "id": "gn_001_task_1",
          "type": "flashcard",
          "instruction": "翻转闪卡，复习被动句的核心知识点",
          "difficulty": 1,
          "hints": ["先看泰语句子，猜猜中文意思", "注意 ถูก 后面跟什么"],
          "feedback": {
            "correct": "很好！你对被动句的基本概念掌握得不错。",
            "wrong": "被动句是重点语法，建议再看一遍规则说明。"
          },
          "payload": {
            "cards": [
              {
                "id": "fc_1",
                "front": {
                  "title": "ถูก + V 是什么句式？",
                  "subtitle": "เขาถูกตี"
                },
                "back": {
                  "title": "被动句",
                  "subtitle": "他被打了",
                  "details": ["ถูก 多用于不好的事情", "施事者可以省略"]
                }
              }
            ]
          }
        }
      ]
    };
    await run(
      `INSERT INTO grammar_notes (id, lesson_id, sort_order, title, category, summary, data_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        seedGrammar.id,
        seedGrammar.lessonId,
        seedGrammar.order,
        seedGrammar.title,
        seedGrammar.category,
        seedGrammar.summary,
        JSON.stringify(seedGrammar)
      ]
    );
    console.log("Seeded database with initial grammar note: ", seedGrammar.id);
  }

  // Create user_reviews table
  await run(`
    CREATE TABLE IF NOT EXISTS user_reviews (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      item_type TEXT NOT NULL,
      item_id TEXT NOT NULL,
      scheduler_type TEXT NOT NULL,
      interval_minutes INTEGER DEFAULT 1440,
      repetitions INTEGER DEFAULT 0,
      next_review_at TEXT NOT NULL,
      last_reviewed_at TEXT,
      ease_factor REAL DEFAULT 2.5,
      created_at TEXT DEFAULT (datetime('now', 'utc')),
      updated_at TEXT DEFAULT (datetime('now', 'utc')),
      UNIQUE(user_id, item_type, item_id)
    )
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_user_reviews_due 
    ON user_reviews(user_id, item_type, next_review_at)
  `);

  // Create user_review_logs table
  await run(`
    CREATE TABLE IF NOT EXISTS user_review_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      item_type TEXT NOT NULL,
      item_id TEXT NOT NULL,
      reviewed_at TEXT NOT NULL,
      rating INTEGER,
      response_time_ms INTEGER,
      prev_interval INTEGER,
      new_interval INTEGER,
      prev_ease_factor REAL,
      new_ease_factor REAL
    )
  `);

  // Create user_streak_stats table
  await run(`
    CREATE TABLE IF NOT EXISTS user_streak_stats (
      user_id TEXT,
      session_type TEXT,
      current_streak_days INTEGER DEFAULT 0,
      max_streak_days INTEGER DEFAULT 0,
      last_streak_date TEXT,
      session_target_count INTEGER DEFAULT 15,
      completed_streaks_today INTEGER DEFAULT 0,
      current_session_completed INTEGER DEFAULT 0,
      last_active_date TEXT,
      PRIMARY KEY (user_id, session_type)
    )
  `);

  // Create high_frequency_words table
  await run(`
    CREATE TABLE IF NOT EXISTS high_frequency_words (
      id TEXT PRIMARY KEY,
      word TEXT NOT NULL,
      ipa TEXT,
      meaning TEXT NOT NULL,
      options_json TEXT NOT NULL,
      examples_json TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // Migration: Add examples_json column if not exists
  try {
    await run(`ALTER TABLE high_frequency_words ADD COLUMN examples_json TEXT`);
    console.log("Added examples_json column to high_frequency_words table");
  } catch (err) {
    // Column already exists or table was just created with it
  }

  // Seed default high-frequency words if empty
  const hfwCount = await get(`SELECT COUNT(*) as count FROM high_frequency_words`);
  if (hfwCount.count === 0) {
    console.log("Seeding default A2 high-frequency words...");
    const seeds = [
      { id: "hfw_001", word: "คน", ipa: "khon", meaning: "人 / 人类", options: ["人 / 人类", "水", "火", "木"], examples: [{ thai: "เขาเป็นคนดี", chinese: "他是一个好人。" }] },
      { id: "hfw_002", word: "และ", ipa: "lae", meaning: "和 / 并且", options: ["和 / 并且", "但是", "因为", "所以"], examples: [{ thai: "พ่อและแม่", chinese: "爸爸和妈妈。" }] },
      { id: "hfw_003", word: "มี", ipa: "mī", meaning: "有 / 拥有", options: ["有 / 拥有", "没有", "要", "想"], examples: [{ thai: "ฉันมีเงิน", chinese: "我有钱。" }] },
      { id: "hfw_004", word: "ได้", ipa: "dāi", meaning: "能够 / 获得", options: ["能够 / 获得", "必须", "应该", "不能"], examples: [{ thai: "ฉันทำได้", chinese: "我能做到。" }] },
      { id: "hfw_005", word: "เป็น", ipa: "pen", meaning: "是 / 成为", options: ["是 / 成为", "去", "吃", "喝"], examples: [{ thai: "เขาเป็นหมอ", chinese: "他是医生。" }] },
      { id: "hfw_006", word: "ที่", ipa: "thī", meaning: "在 / 的 / 地方", options: ["在 / 的 / 地方", "时间", "数量", "颜色"], examples: [{ thai: "คนที่นี่", chinese: "这里的人。" }] },
      { id: "hfw_007", word: "จะ", ipa: "cha", meaning: "将要 / 会", options: ["将要 / 会", "已经", "正在", "刚刚"], examples: [{ thai: "ฉันจะไป", chinese: "我将要去。" }] },
      { id: "hfw_008", word: "在", ipa: "nai", meaning: "在...里面", options: ["在...里面", "在...外面", "在...上面", "在...下面"], examples: [{ thai: "ในบ้าน", chinese: "在屋子里。" }] },
      { id: "hfw_009", word: "ไม่", ipa: "māi", meaning: "不 / 没有", options: ["不 / 没有", "是", "对", "好"], examples: [{ thai: "ฉันไม่รู้", chinese: "我不知道。" }] },
      { id: "hfw_010", word: "ของ", ipa: "khǭng", meaning: "的 / 物品", options: ["的 / 物品", "人", "天", "地"], examples: [{ thai: "บ้านของฉัน", chinese: "我的家。" }] },
      { id: "hfw_011", word: "ให้", ipa: "hāi", meaning: "给 / 让", options: ["给 / 让", "拿", "借", "还"], examples: [{ thai: "ให้ฉันดู", chinese: "让我看看。" }] },
      { id: "hfw_012", word: "พูด", ipa: "phūt", meaning: "说 / 讲话", options: ["说 / 讲话", "听", "看", "写"], examples: [{ thai: "พูดภาษาไทย", chinese: "说泰语。" }] },
      { id: "hfw_013", word: "ทำ", ipa: "tham", meaning: "做 / 制造", options: ["做 / 制造", "玩", "睡", "买"], examples: [{ thai: "ทำอะไรอยู่", chinese: "在做什么呢？" }] },
      { id: "hfw_014", word: "ไป", ipa: "pai", meaning: "去 / 离开", options: ["去 / 离开", "来", "停", "走"], examples: [{ thai: "ไปโรงเรียน", chinese: "去学校。" }] },
      { id: "hfw_015", word: "มา", ipa: "mā", meaning: "来 / 到来", options: ["来 / 到来", "去", "回", "进"], examples: [{ thai: "มาที่นี่", chinese: "来这里。" }] }
    ];

    for (const seed of seeds) {
      await run(
        `INSERT INTO high_frequency_words (id, word, ipa, meaning, options_json, examples_json) VALUES (?, ?, ?, ?, ?, ?)`,
        [seed.id, seed.word, seed.ipa, seed.meaning, JSON.stringify(seed.options), JSON.stringify(seed.examples || [])]
      );
    }
    console.log("Seeded A2 high-frequency words successfully.");
  }

  // Create tblReadingCache table
  await run(`
    CREATE TABLE IF NOT EXISTS tblReadingCache (
      uuid TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      subject TEXT,
      difficulty REAL,
      word_count INTEGER,
      content_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // Seed default reading exercise if empty
  const readingCount = await get(`SELECT COUNT(*) as count FROM tblReadingCache`);
  if (readingCount.count === 0) {
    console.log("Seeding default reading exercise in tblReadingCache...");
    const defaultArticle = {
      uuid: "e8b209d5-45d2-430c-83b3-0a7c49b1ff19",
      title: "ประวัติศาสตร์และอาณาจักรของไทย (泰国的历史与王国)",
      subject: "ประวัติศาสตร์ (历史)",
      difficulty: 2.0,
      word_count: 184,
      content_json: JSON.stringify({
        "vocabulary_glossary": {
          "v_001": { "thai": "ประวัติศาสตร์", "ipa": "/prà.wàt.sà.tìt/", "pos": "n.", "zh": "历史", "en": "history" },
          "v_002": { "thai": "บรรพบุรุษ", "ipa": "/ban.pʰáp.bu.rùt/", "pos": "n.", "zh": "祖先", "en": "ancestors" },
          "v_003": { "thai": "อาณาจักร", "ipa": "/aː.naː.càk/", "pos": "n.", "zh": "王国，帝国", "en": "kingdom, empire" },
          "v_004": { "thai": "สถาปนา", "ipa": "/sa.tʰà.pà.nǎː/", "pos": "v.", "zh": "建立，创立", "en": "to establish, to found" },
          "v_005": { "thai": "กอบกู้ชาติ", "ipa": "/kòp.kûː.tɕâːt/", "pos": "v.", "zh": "救国，复国", "en": "to restore the nation" },
          "v_006": { "thai": "สืบทอด", "ipa": "/sɯ̀t.tʰɔ̀ːt/", "pos": "v.", "zh": "继承，传承", "en": "to inherit, to pass down" }
        },
        "sentences": [
          { "sentence_id": "s1", "role": "topic_sentence", "translation_zh": "泰国是一个拥有700多年悠久历史的国家。", "html_render": "ประเทศไทยเป็นประเทศที่มี<span class='token vocab-challenge' data-vocab='v_001'>ประวัติศาสตร์</span>เก่าแก่ยาวนานรวม 700 กว่าปี" },
          { "sentence_id": "s2", "role": "major_detail", "translation_zh": "泰国祖先建立了第一个王国，即素可泰王国，现在的素可泰府有素可泰历史公园这座古城供民众学习和旅游。", "html_render": "<span class='token vocab-challenge' data-vocab='v_002'>บรรพบุรุษ</span> ไทย ได้ ก่อตั้ง <span class='token vocab-challenge' data-vocab='v_003'>อาณาจักร</span> แรก คือ <span class='token vocab-challenge' data-vocab='v_003'>อาณาจักร</span> สุโขทัย ปัจจุบัน คือ จังหวัด สุโขทัย ซึ่ง มี อุทยาน <span class='token vocab-challenge' data-vocab='v_001'>ประวัติศาสตร์</span> สุโขทัย เป็น เมือง เก่า ให้ ประชาชน ได้ ศึกษา <span class='token vocab-challenge' data-vocab='v_001'>ประวัติศาสตร์</span> และ ท่องเที่ยว" },
          { "sentence_id": "s3", "role": "minor_detail", "translation_zh": "素可泰王国的建立者是室利·因陀罗迭多（พ่อขุนศรีอินทราทิตย์）。", "html_render": "ผู้ ก่อตั้ง <span class='token vocab-challenge' data-vocab='v_003'>อาณาจักร</span> สุโขทัย คือ พ่อขุนศรีอินทราทิตย์" },
          { "sentence_id": "s4", "role": "minor_detail", "translation_zh": "该王国在帕坤兰甘亨大帝时期达到最繁荣。", "html_render": "<span class='token vocab-challenge' data-vocab='v_003'>อาณาจักร</span> นี้ เจริญ สูงสุด ใน สมัย พ่อขุนรามคำแหงมหาราช" },
          { "sentence_id": "s5", "role": "minor_detail", "translation_zh": "在这个时期，开始信仰佛教，发明了泰文，并将领土广泛扩张至缅甸、马来和老挝等城市。", "html_render": "ใน สมัย นี้ มี การ เริ่ม นับถือ พระพุทธศาสนา มี การ ประดิษฐ์ อักษร ไทย รวมทั้ง ขยาย อาณาเขต ไป อย่าง กว้างขวาง จนถึง เมือง พม่า มลายู <span class='token signal-add'>and</span> ลาว" },
          { "sentence_id": "s6", "role": "major_detail", "translation_zh": "后来在昭披耶河平原（中部），帕坤乌通建立了大城王国，首都在大城（阿瑜陀耶府）。", "html_render": "ต่อมา ใน พื้น ลุ่มน้ำ เจ้าพระยา (ภาค กลาง) พระเจ้าอู่ทอง ได้ <span class='token vocab-challenge' data-vocab='v_004'>สถาปนา</span> <span class='token vocab-challenge' data-vocab='v_003'>อาณาจักร</span> อยุธยา โดย มี เมืองหลวง อยู่ ที่ พระนครศรีอยุธยา (จังหวัด อยุธยา)" },
          { "sentence_id": "s7", "role": "minor_detail", "translation_zh": "在这个时期，社会发展水平很高，在政治、统治、宗教、文学和法律方面都很繁荣，并作为国家遗产传承至今。", "html_render": "ใน สมัย นี้ มี การ พัฒนาการ ทาง สังคม สูง คือ มี ความ รุ่งเรือง ทั้ง ด้าน การเมือง การปกครอง ศาสนา วรรณกรรม <span class='token signal-add'>and</span> กฎหมาย <span class='token signal-add'>and</span> <span class='token vocab-challenge' data-vocab='v_006'>สืบทอด</span> เป็น มรดก ของ ชาติ มาจนถึง สมัย ปัจจุบัน" },
          { "sentence_id": "s8", "role": "major_detail", "translation_zh": "后来泰国被缅甸两次入侵，导致大城王国在佛历2310年灭亡。", "html_render": "ต่อมา ไทย ถูก พม่า รุกราน ด้วย การ ทำ สงคราม ถึง 2 ครั้ง <span class='token signal-cause'>เป็นผลให้</span> <span class='token vocab-challenge' data-vocab='v_003'>อาณาจักร</span> อยุธยา ล่มสลาย ลง ใน ปี พ.ศ.2310" },
          { "sentence_id": "s9", "role": "major_detail", "translation_zh": "Later, the hero who restored the nation, King Taksin the Great, fought and successfully drove out the Burmese, establishing the new capital of Thonburi (currently part of Bangkok, called the Thonburi side), governing for 15 years.", "html_render": "ต่อมา วีรบุรุษ <span class='token vocab-challenge' data-vocab='v_005'>กอบกู้ชาติ</span> คือ พระเจ้าตากสินมหาราช ได้ ต่อสู้ ขับไล่ พม่า จน สำเร็จ <span class='token signal-add'>and</span> สร้าง เมืองหลวง ใหม่ คือ กรุงธนบุรี (ปัจจุบัน เป็น ส่วน หนึ่ง ของ กรุงเทพมหานคร เรียกว่า ฝั่ง ธนฯ) ปกครอง เมือง ได้ 15 ปี" },
          { "sentence_id": "s10", "role": "major_detail", "translation_zh": "之后，拉玛一世帕佛陀约华朱拉洛大帝建立新城市曼谷，中心位于曼谷，也称为却克里王朝（รัตนโกสินทร์）。", "html_render": "หลังจากนั้น มี การ <span class='token vocab-challenge' data-vocab='v_004'>สถาปนา</span> เมือง ใหม่ ขึ้นมา คือ กรุงเทพมหานคร โดย รัชกาล ที่ 1 สมเด็จพระพุทธยอดฟ้าจุฬาโลกมหาราช มี ศูนย์กลาง อยู่ ที่ กรุงเทพมหานคร หรือ เรียกว่า กรุงรัตนโกสินทร์" },
          { "sentence_id": "s11", "role": "minor_detail", "translation_zh": "在这个时期，传承了来自大城时期的泰国艺术和文化，被称为艺术科学复兴时代。", "html_render": "ใน สมัย นี้ มี การ <span class='token vocab-challenge' data-vocab='v_006'>สืบทอด</span> ศิลปะ วัฒนธรรม ไทย มาจาก สมัย อยุธยา เรียกว่า เป็น ยุค ฟื้นฟู ศิลปะวิทยาการ" },
          { "sentence_id": "s12", "role": "concluding_sentence", "translation_zh": "随后积累并传承为国家遗产，并将却克里王朝传承至今。", "html_render": "ต่อมา สร้างสม <span class='token signal-add'>and</span> <span class='token vocab-challenge' data-vocab='v_006'>สืบทอด</span> เป็น มรดก ของ ชาติ <span class='token signal-add'>and</span> <span class='token vocab-challenge' data-vocab='v_006'>สืบทอด</span> ราชวงศ์จักรี มาจนถึง สมัย ปัจจุบัน" }
        ],
        "comprehension_quiz": {
          "topic": {
            "type": "single", "question_zh": "1. 这段文字讨论的核心主题（Topic）是什么？",
            "options": [
              { "id": "t1", "text": "ประวัติศาสตร์และอาณาจักรของไทย (泰国的历史与王国)", "is_correct": true },
              { "id": "t2", "text": "สถานที่ท่องเที่ยวในจังหวัดสุโขทัย (素可泰府的旅游景点)", "is_correct": false },
              { "id": "t3", "text": "สงครามระหว่างไทยกับพม่า (泰缅战争)", "is_correct": false }
            ]
          },
          "main_idea": {
            "type": "single", "question_zh": "2. 这段文字的主旨（Main Idea）是什么？",
            "options": [
              { "id": "m1", "text": "ประเทศไทยมีประวัติศาสตร์ยาวนานกว่า 700 ปี มีการก่อตั้งและสืบทอดอาณาจักรมาตั้งแต่สุโขทัยจนถึงปัจจุบัน (泰国拥有700多年悠久历史，从素可泰至今建立并传承了各个王国。)", "is_correct": true },
              { "id": "m2", "text": "พ่อขุนรามคำแหงมหาราชเป็นผู้ประดิษฐ์อักษรไทยและนำพระพุทธศาสนามาเผยแพร่ (帕坤兰甘亨大帝发明了泰文并引入佛教。)", "is_correct": false },
              { "id": "m3", "text": "ประเทศไทยเป็นประเทศที่มีประวัติศาสตร์เก่าแก่ยาวนานที่สุดในโลก (泰国是世界上历史最悠久的国家。)", "is_correct": false }
            ]
          },
          "supporting_details": {
            "type": "multiple", "question_zh": "3. 以下哪些是支持主旨的具体细节（Supporting Details）？（多选题）",
            "options": [
              { "id": "sd1", "text": "อาณาจักรสุโขทัยเจริญสูงสุดในสมัยพ่อขุนรามคำแหงมหาราช (素可泰王国在帕坤兰甘亨大帝时期达到鼎盛。)", "is_correct": true },
              { "id": "sd2", "text": "พระเจ้าอู่ทองสถาปนาอาณาจักรอยุธยาและมีความรุ่งเรืองด้านการเมืองและการปกครอง (帕坤乌通建立大城王国，在政治和统治方面繁荣。)", "is_correct": true },
              { "id": "sd3", "text": "อาณาจักรอยุธยาล่มสลายลงเพราะว่ามีการประดิษฐ์อักษรไทย (大城王国灭亡是因为发明了泰文。)", "is_correct": false },
              { "id": "sd4", "text": "กรุงธนบุรีเป็นเมืองหลวงที่ปกครองโดยรัชกาลที่ 1 (吞武里是由拉玛一世统治的首都。)", "is_correct": false }
            ]
          }
        }
      })
    };

    await run(
      `INSERT INTO tblReadingCache (uuid, title, subject, difficulty, word_count, content_json) VALUES (?, ?, ?, ?, ?, ?)`,
      [defaultArticle.uuid, defaultArticle.title, defaultArticle.subject, defaultArticle.difficulty, defaultArticle.word_count, defaultArticle.content_json]
    );
    console.log("Seeded default reading exercise successfully.");
  }

  // Create tblCourseReading table for linking courses/lessons to reading materials
  await run(`
    CREATE TABLE IF NOT EXISTS tblCourseReading (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id TEXT NOT NULL,
      lesson_id TEXT NOT NULL,
      reading_uuid TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
      FOREIGN KEY (lesson_id) REFERENCES course_lessons (id) ON DELETE CASCADE,
      FOREIGN KEY (reading_uuid) REFERENCES tblReadingCache (uuid) ON DELETE CASCADE
    )
  `);

  // Seed default course reading association if empty
  const readingAssocCount = await get(`SELECT COUNT(*) as count FROM tblCourseReading`);
  if (readingAssocCount.count === 0) {
    console.log("Seeding default course reading association in tblCourseReading...");
    await run(
      `INSERT INTO tblCourseReading (course_id, lesson_id, reading_uuid) VALUES (?, ?, ?)`,
      ["course_001", "lesson_001", "e8b209d5-45d2-430c-83b3-0a7c49b1ff19"]
    );
    console.log("Seeded default course reading association successfully.");
  }

  // Create tblNotes table for course notes
  await run(`
    CREATE TABLE IF NOT EXISTS tblNotes (
      uuid TEXT PRIMARY KEY,
      topic TEXT,
      tags TEXT,
      noteContent TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // Create tblCourseNot table for linking courses/lessons to notes
  await run(`
    CREATE TABLE IF NOT EXISTS tblCourseNot (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id TEXT NOT NULL,
      lesson_id TEXT NOT NULL,
      note_uuid TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
      FOREIGN KEY (lesson_id) REFERENCES course_lessons (id) ON DELETE CASCADE,
      FOREIGN KEY (note_uuid) REFERENCES tblNotes (uuid) ON DELETE CASCADE
    )
  `);

  // Seed default note if empty
  const notesCount = await get(`SELECT COUNT(*) as count FROM tblNotes`);
  if (notesCount.count === 0) {
    console.log("Seeding default note in tblNotes...");
    const defaultNoteUuid = "8d2f10b4-93c2-473d-bc67-ff7db091ef38";
    const defaultNoteContent = {
      "topic": "泰国旅游体验图鉴",
      "era": "从理念基石到12大体验维度",
      "persona": "全景探索蓝图",
      "timeframe": "核心概念与体验分类",
      "points": [
        {
          "id": "p1",
          "title": "旅游的权威定义",
          "detail": "根据1963年联合国（罗马）会议及世界旅游组织的定义，旅游是为休闲、商务等目的，自愿前往惯常居住地以外地区的暂时性旅行，时间不超过连续1年，且不以从事职业或赚取收入为目的。"
        },
        {
          "id": "p2",
          "title": "旅游的四大基石",
          "detail": "构成旅游的四大核心要素包括：暂时性（不超过1年）、自愿性（完全出于个人意愿）、多重目的（涵盖休闲、探亲、会议等）以及非谋利性（绝非为了在目的地工作或赚钱）。"
        },
        {
          "id": "p3",
          "title": "非旅游行为边界",
          "detail": "基于上述定义，赴外地打工、移民定居、劳务输出、异地求学以及纯粹过境等行为，由于不符合暂时性、非谋利或非定居原则，均被排除在旅游范畴之外。"
        },
        {
          "id": "p4",
          "title": "泰国12大体验维度",
          "detail": "泰国国家旅游局将旅游体验划分为12个独特的维度，涵盖历史、文化、生态、自然、海滩、海岛、瀑布、洞穴、温泉、溪流探险、艺术科学教育及创意休闲，形成全面的旅游生态系统。"
        }
      ],
      "flashcards": [
        {
          "front": "世界旅游组织规定旅游的暂时性时间上限是多久？",
          "back": "连续不超过1年"
        },
        {
          "front": "根据定义，旅游的四大核心基石是什么？",
          "back": "暂时性、自愿性、多重目的、非谋利性"
        },
        {
          "front": "以下哪种行为不属于旅游：异地求学、参加体育赛事、探亲访友？",
          "back": "异地求学"
        },
        {
          "front": "泰国国家旅游局将旅游体验划分为多少个维度？",
          "back": "12个"
        },
        {
          "front": "泰国哪种旅游体验以传授知识为核心，打造学习场所？",
          "back": "艺术科学教育旅游"
        }
      ],
      "quiz": {
        "question": "根据国际旅游定义，以下哪项行为属于旅游范畴？",
        "options": [
          {
            "id": "a",
            "text": "前往外地参加为期两周的体育赛事观摩",
            "isCorrect": true,
            "explanation": "正确。体育赛事观摩属于休闲和娱乐目的，且是短期、自愿、非谋利的出行，符合旅游的全部核心要素。"
          },
          {
            "id": "b",
            "text": "移民至泰国并购买永久住所",
            "isCorrect": false,
            "explanation": "错误。移民并建立永久住所属于定居行为，违反了旅游的“非定居”原则，因此不属于旅游。"
          },
          {
            "id": "c",
            "text": "受雇于外国公司，前往该国工作一年半",
            "isCorrect": false,
            "explanation": "错误。工作是为了赚取收入，违反了“非谋利”原则，且停留时间超过一年，也违背了“暂时性”原则，因此不属于旅游。"
          },
          {
            "id": "d",
            "text": "在机场短暂过境，转机前往另一个国家",
            "isCorrect": false,
            "explanation": "错误。纯粹过境不在目的地进行任何停留或活动，通常不被视为旅游，因为没有实质性的游览体验。"
          }
        ]
      },
      "summary": {
        "textParts": [
          "旅游是基于 ",
          "BLANK_1",
          " 原则，在不超过一年的时间内，出于 ",
          "BLANK_2",
          " 而进行的自愿旅行。",
          "泰国国家旅游局在此基础上，将旅游体验细分为 ",
          "BLANK_3",
          " 个独特维度，构建了全面的旅游生态系统。"
        ],
        "blanks": ["非谋利", "休闲、商务等目的", "12"],
        "wordPool": ["非谋利", "休闲、商务等目的", "营利", "定居", "12", "8"]
      }
    };

    await run(
      `INSERT INTO tblNotes (uuid, topic, tags, noteContent) VALUES (?, ?, ?, ?)`,
      [defaultNoteUuid, "泰国旅游体验图鉴", "旅游,体验", JSON.stringify(defaultNoteContent)]
    );

    // Also link it in tblCourseNot to course_001 / lesson_001
    await run(
      `INSERT INTO tblCourseNot (course_id, lesson_id, note_uuid) VALUES (?, ?, ?)`,
      ["course_001", "lesson_001", defaultNoteUuid]
    );
    console.log("Seeded default note association in tblCourseNot successfully.");
  }

  // Create tblDailyAnkiError table
  await run(`
    CREATE TABLE IF NOT EXISTS tblDailyAnkiError (
      uuid TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      errorWords TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // Seed default daily anki error if empty
  const errorCount = await get(`SELECT COUNT(*) as count FROM tblDailyAnkiError`);
  if (errorCount.count === 0) {
    console.log("Seeding default daily anki error in tblDailyAnkiError...");
    const defaultErrorUuid = "9f2e3b1c-84d5-492e-b3c1-0a7c49b1ff30";
    const defaultErrorDate = "2026-07-01";
    const defaultErrorWords = [
      {
        "id": "hfw_286",
        "word": "โภชนาการ",
        "ipa": "phôt chà naa kaan",
        "meaning": "营养",
        "options": ["营养", "健康", "饮食", "运动"],
        "examples": [
          {
            "thai": "อาหารเช้าควรมีโภชนาการครบถ้วน",
            "chinese": "早餐应该有全面的营养。"
          }
        ]
      }
    ];

    await run(
      `INSERT INTO tblDailyAnkiError (uuid, date, errorWords) VALUES (?, ?, ?)`,
      [defaultErrorUuid, defaultErrorDate, JSON.stringify(defaultErrorWords)]
    );
    console.log("Seeded default daily anki error successfully.");
  }

  // Create tblWordset table for word sets
  await run(`
    CREATE TABLE IF NOT EXISTS tblWordset (
      uuid TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      tags TEXT,
      words TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // Seed default wordset if empty
  const wordsetCount = await get(`SELECT COUNT(*) as count FROM tblWordset`);
  if (wordsetCount.count === 0) {
    console.log("Seeding default wordset in tblWordset...");
    const defaultWordsetUuid = "ws_001_seed_uuid_xyz_12345";
    const defaultTitle = "日常泰语基础词汇";
    const defaultTags = "基础,日常,食物";
    const defaultWords = [
      {
        "id": "ws_w1",
        "word": "อาหาร",
        "ipa": "aa-haan",
        "meaning": "食物",
        "options": ["食物", "水", "饮料", "水果"],
        "examples": [
          {
            "thai": "อาหารไทยอร่อยมากและมีชื่อเสียงทั่วโลก",
            "chinese": "泰国菜非常美味而且在全世界都很有名。"
          }
        ]
      }
    ];

    await run(
      `INSERT INTO tblWordset (uuid, title, tags, words) VALUES (?, ?, ?, ?)`,
      [defaultWordsetUuid, defaultTitle, defaultTags, JSON.stringify(defaultWords)]
    );
    console.log("Seeded default wordset successfully.");
  }

  // Create tblImportantWords table for important words
  await run(`
    CREATE TABLE IF NOT EXISTS tblImportantWords (
      uuid TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      tags TEXT,
      words TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // Seed default important words if empty
  const importantWordsCount = await get(`SELECT COUNT(*) as count FROM tblImportantWords`);
  if (importantWordsCount.count === 0) {
    console.log("Seeding default important words in tblImportantWords...");
    const defaultImpUuid = "imp_001_seed_uuid_xyz_12345";
    const defaultImpTitle = "泰语核心重点词汇集";
    const defaultImpTags = "重点,核心,高频";
    const defaultImpWords = [
      {
        "id": "imp_w1",
        "word": "สำคัญ",
        "ipa": "sǎm-khan",
        "meaning": "重要",
        "options": ["重要", "简单", "困难", "必须"],
        "examples": [
          {
            "thai": "การเรียนภาษาไทยมีความสำคัญมาก",
            "chinese": "学习泰语非常重要。"
          }
        ]
      },
      {
        "id": "imp_w2",
        "word": "จำเป็น",
        "ipa": "cam-pen",
        "meaning": "必须 / 必要",
        "options": ["必须 / 必要", "选择", "可能", "随便"],
        "examples": [
          {
            "thai": "สิ่งนี้จำเป็นสำหรับการเดินทาง",
            "chinese": "这个对旅行来说是必须的。"
          }
        ]
      }
    ];

    await run(
      `INSERT INTO tblImportantWords (uuid, title, tags, words) VALUES (?, ?, ?, ?)`,
      [defaultImpUuid, defaultImpTitle, defaultImpTags, JSON.stringify(defaultImpWords)]
    );
    console.log("Seeded default important words successfully.");
  }

  // Create tblSentencePattern table for sentence patterns
  await run(`
    CREATE TABLE IF NOT EXISTS tblSentencePattern (
      uuid TEXT PRIMARY KEY,
      tags TEXT,
      patternContent TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // Seed default sentence pattern if empty
  const patternCount = await get(`SELECT COUNT(*) as count FROM tblSentencePattern`);
  if (patternCount.count === 0) {
    console.log("Seeding default sentence pattern in tblSentencePattern...");
    const defaultPattern = {
      "id": "pattern-004",
      "createdAt": "2026-07-02T08:30:00.000Z",
      "updatedAt": "2026-07-02T08:30:00.000Z",
      "level": "A2",
      "topic": "意图与目标表达",
      "patternName": "เพื่อ 句型（为了……）",
      "formula": {
        "display": "名词短语 + 动词短语 + เพื่อ + 动词短语",
        "components": [
          {
            "slot": "subject",
            "label": "主语",
            "description": "动作的发出者，可以是人或事物",
            "examples": ["ฉัน", "เขา", "คน", "เด็ก", "เรา"],
            "glossary": "ประธาน",
            "ipa": "/prà-thaːn/"
          },
          {
            "slot": "action",
            "label": "主要动作",
            "description": "为了实现目标而采取的主要行为或动作",
            "examples": ["เรียน", "ทำงาน", "ไป", "ซื้อ", "ทำ"],
            "glossary": "กริยาหลัก",
            "ipa": "/krí-jaː lǎk/"
          },
          {
            "slot": "purpose",
            "label": "目的动作",
            "description": "通过主要动作想要达成的目标或意图",
            "examples": ["สอบได้", "มีเงิน", "พบหมอ", "สุขภาพดี", "เก่งขึ้น"],
            "glossary": "กริยาเป้าหมาย",
            "ipa": "/krí-jaː pâo-mǎi/"
          }
        ]
      },
      "usage": {
        "summary": "ใช้เพื่อบอกจุดประสงค์หรือเป้าหมายของการกระทำ (用来表达行为的目的或意图)",
        "detail": "句型结构为 '主语 + 主要动作 + เพื่อ + 目的动作'，表示做前一个动作是为了实现后一个目标。适用于日常对话和书面语，可用于说明学习、工作、旅行等各种生活场景中的行为动机。",
        "notes": [
          "เพื่อ 后面接动词短语，表示目的或意图",
          "如果目的动作是名词，需在前面加 การ 或 ความ 变成名词化形式，如 เพื่อความสำเร็จ（为了成功）",
          "该句型与 เพราะ（因为）不同：เพราะ 表原因，เพื่อ 表目的",
          "主语可以省略，尤其在语境明确时"
        ]
      },
      "examples": [
        {
          "id": "ex-001",
          "thai": "ฉันเรียนภาษาไทยเพื่อทำงานที่ประเทศไทย",
          "parsed": {
            "subject": "ฉัน",
            "action": "เรียนภาษาไทย",
            "purpose": "ทำงานที่ประเทศไทย"
          },
          "english": "I study Thai to work in Thailand.",
          "chinese": "我学习泰语是为了在泰国工作。",
          "audioThai": "",
          "imageHint": "",
          "isVariant": false,
          "variantNote": ""
        },
        {
          "id": "ex-002",
          "thai": "เขาออกกำลังกายเพื่อสุขภาพที่ดี",
          "parsed": {
            "subject": "เขา",
            "action": "ออกกำลังกาย",
            "purpose": "สุขภาพที่ดี"
          },
          "english": "He exercises for good health.",
          "chinese": "他锻炼身体是为了健康。",
          "audioThai": "",
          "imageHint": "",
          "isVariant": false,
          "variantNote": ""
        },
        {
          "id": "ex-003",
          "thai": "เราประหยัดเงินเพื่อซื้อบ้าน",
          "parsed": {
            "subject": "เรา",
            "action": "ประหยัดเงิน",
            "purpose": "ซื้อบ้าน"
          },
          "english": "We save money to buy a house.",
          "chinese": "我们存钱是为了买房子。",
          "audioThai": "",
          "imageHint": "",
          "isVariant": false,
          "variantNote": ""
        },
        {
          "id": "ex-004",
          "thai": "เด็กๆ ตั้งใจเรียนเพื่อสอบเข้ามหาวิทยาลัย",
          "parsed": {
            "subject": "เด็กๆ",
            "action": "ตั้งใจเรียน",
            "purpose": "สอบเข้ามหาวิทยาลัย"
          },
          "english": "The children study hard to get into university.",
          "chinese": "孩子们努力学习是为了考上大学。",
          "audioThai": "",
          "imageHint": "",
          "isVariant": false,
          "variantNote": ""
        }
      ],
      "exercises": {
        "recognition": {
          "description": "识别句子中是否使用了 'เพื่อ' 来表达目的",
          "items": [
            {
              "sentence": "ฉันไปร้านอาหารเพราะหิว",
              "audioUrl": "",
              "answer": false,
              "explanation": "这个句子使用了 'เพราะ'（因为）来表示原因，而不是 'เพื่อ'（为了）表示目的。正确表达目的应为：ฉันไปร้านอาหารเพื่อกินข้าว。"
            },
            {
              "sentence": "เขามาโรงเรียนเพื่อเรียนภาษา",
              "audioUrl": "",
              "answer": true,
              "explanation": "句子正确使用了 'เพื่อ' 连接主要动作（มาโรงเรียน）和目的（เรียนภาษา），表示来学校是为了学语言。"
            },
            {
              "sentence": "เราซื้อขนมเพื่อกินเล่น",
              "audioUrl": "",
              "answer": true,
              "explanation": "正确使用 'เพื่อ' 表达买零食的目的是为了当点心吃。"
            }
          ]
        },
        "fillInBlank": {
          "description": "选择合适的词填空，完成 'เพื่อ' 句型",
          "items": [
            {
              "sentence": "ฉันไปตลาด ______ ซื้อผัก",
              "slot": "purpose",
              "answer": "เพื่อ",
              "hints": ["表示目的", "/pʉ̂a/"],
              "acceptableAnswers": ["เพื่อ"]
            },
            {
              "sentence": "เขาตั้งใจทำงาน ______ สอบได้คะแนนดี",
              "slot": "purpose",
              "answer": "เพื่อ",
              "hints": ["表示意图", "/pʉ̂a/"],
              "acceptableAnswers": ["เพื่อ"]
            },
            {
              "sentence": "แม่ทำอาหาร ______ ให้ครอบครัว",
              "slot": "purpose",
              "answer": "เพื่อ",
              "hints": ["为了家人", "/pʉ̂a/"],
              "acceptableAnswers": ["เพื่อ"]
            },
            {
              "sentence": "ฉันเรียนภาษาญี่ปุ่น ______ ไปทำงานที่ญี่ปุ่น",
              "slot": "purpose",
              "answer": "เพื่อ",
              "hints": ["为了去日本工作", "/pʉ̂a/"],
              "acceptableAnswers": ["เพื่อ"]
            }
          ]
        },
        "dragAndDrop": {
          "description": "将词块按正确顺序排列，构成完整的 'เพื่อ' 句型句子",
          "items": [
            {
              "id": "dd-001",
              "targetSentence": "ฉันเรียนภาษาไทยเพื่อทำงานที่ไทย",
              "targetEnglish": "I study Thai to work in Thailand.",
              "blocks": [
                { "text": "ฉัน", "slot": "subject", "order": 0 },
                { "text": "เรียนภาษาไทย", "slot": "action", "order": 1 },
                { "text": "เพื่อ", "slot": "purpose", "order": 2 },
                { "text": "ทำงานที่ไทย", "slot": "purpose", "order": 3 }
              ],
              "distractors": ["เพราะ", "ที่", "ของ"],
              "audioUrl": ""
            },
            {
              "id": "dd-002",
              "targetSentence": "เราประหยัดเงินเพื่อซื้อรถใหม่",
              "targetEnglish": "We save money to buy a new car.",
              "blocks": [
                { "text": "เรา", "slot": "subject", "order": 0 },
                { "text": "ประหยัดเงิน", "slot": "action", "order": 1 },
                { "text": "เพื่อ", "slot": "purpose", "order": 2 },
                { "text": "ซื้อรถใหม่", "slot": "purpose", "order": 3 }
              ],
              "distractors": ["แล้ว", "ก็", "และ"],
              "audioUrl": ""
            }
          ]
        },
        "multipleChoice": {
          "description": "选择正确的选项完成句子或翻译",
          "items": [
            {
              "id": "mc-001",
              "question": "选择正确的词填入空白：ฉันไปร้านอาหาร ______ กินข้าว",
              "type": "fillIn",
              "options": ["เพื่อ", "เพราะ", "ที่", "ว่า"],
              "correctIndex": 0,
              "explanation": "这里表示去餐馆的目的是吃饭，应该用 'เพื่อ'。'เพราะ' 表原因，'ที่' 表地点，'ว่า' 表内容。"
            },
            {
              "id": "mc-002",
              "question": "\"他努力工作是为了赚钱。\" 的正确泰语翻译是？",
              "type": "translation",
              "options": [
                "เขาทำงานหนักเพื่อหาเงิน",
                "เขาทำงานหนักเพราะหาเงิน",
                "เขาทำงานหนักที่หาเงิน",
                "เขาทำงานหนักว่าเงิน"
              ],
              "correctIndex": 0,
              "explanation": "正确使用 'เพื่อ' 表示目的。选项 B 用 'เพราะ' 表示原因，不符合句意；C 和 D 结构错误。"
            },
            {
              "id": "mc-003",
              "question": "下列哪个句子正确表达了 '为了健康，我每天跑步'？",
              "type": "recognition",
              "options": [
                "ฉันวิ่งทุกวันเพื่อสุขภาพ",
                "ฉันวิ่งทุกวันเพราะสุขภาพ",
                "ฉันวิ่งเพื่อทุกวันสุขภาพ",
                "เพื่อฉันวิ่งทุกวันสุขภาพ"
              ],
              "correctIndex": 0,
              "explanation": "正确结构是 '主语 + 主要动作 + เพื่อ + 目的'。只有选项 A 符合；B 用 'เพราะ' 表原因；C 和 D 词序错误。"
            }
          ]
        },
        "translation": {
          "description": "翻译练习，练习 'เพื่อ' 句型的双向翻译",
          "items": [
            {
              "id": "tr-001",
              "direction": "th2zh",
              "prompt": "ฉันเรียนพิเศษเพื่อสอบเข้ามหาวิทยาลัย",
              "audioUrl": "",
              "referenceAnswer": "我上补习班是为了考上大学。",
              "keywords": ["补习班", "为了", "考上", "大学"],
              "wordBlocks": [],
              "targetSentence": "",
              "distractors": [],
              "explanation": "เรียนพิเศษ = 上补习班；เพื่อ = 为了；สอบเข้ามหาวิทยาลัย = 考上大学"
            },
            {
              "id": "tr-002",
              "direction": "th2zh",
              "prompt": "เขาทำงานหนักเพื่อเลี้ยงดูครอบครัว",
              "audioUrl": "",
              "referenceAnswer": "他努力工作是为了养家。",
              "keywords": ["努力工作", "为了", "养家", "家庭"],
              "wordBlocks": [],
              "targetSentence": "",
              "distractors": [],
              "explanation": "ทำงานหนัก = 努力工作；เพื่อ = 为了；เลี้ยงดูครอบครัว = 养家"
            },
            {
              "id": "tr-003",
              "direction": "zh2th",
              "prompt": "我每天学英语是为了去国外工作。",
              "audioUrl": "",
              "referenceAnswer": "ฉันเรียนภาษาอังกฤษทุกวันเพื่อไปทำงานต่างประเทศ",
              "keywords": [],
              "wordBlocks": ["ฉัน", "เรียนภาษาอังกฤษ", "ทุกวัน", "เพื่อ", "ไปทำงาน", "ต่างประเทศ"],
              "targetSentence": "ฉันเรียนภาษาอังกฤษทุกวันเพื่อไปทำงานต่างประเทศ",
              "distractors": ["เพราะ", "ที่", "แล้ว"],
              "explanation": "主语+主要动作+เพื่อ+目的。注意 'เรียนภาษาอังกฤษ' 是主要动作，'ไปทำงานต่างประเทศ' 是目的。"
            },
            {
              "id": "tr-004",
              "direction": "zh2th",
              "prompt": "我们早起是为了不迟到。",
              "audioUrl": "",
              "referenceAnswer": "เราตื่นเช้าเพื่อไม่สาย",
              "keywords": [],
              "wordBlocks": ["เรา", "ตื่นเช้า", "เพื่อ", "ไม่", "สาย"],
              "targetSentence": "เราตื่นเช้าเพื่อไม่สาย",
              "distractors": ["แต่", "เพราะ", "ก็"],
              "explanation": "ตื่นเช้า = 早起；เพื่อ = 为了；ไม่สาย = 不迟到"
            }
          ]
        },
        "sentenceConstruction": {
          "description": "根据提示，用 'เพื่อ' 句型造句",
          "items": [
            {
              "id": "sc-001",
              "prompt": {
                "subject": "ฉัน",
                "subjectZh": "我",
                "prepositionalHint": "เพื่อสุขภาพ",
                "prepositionalHintZh": "为了健康",
                "englishHint": "I exercise for health."
              },
              "referenceAnswer": "ฉันออกกำลังกายเพื่อสุขภาพ",
              "scoringRubric": {
                "hasSubject": { "weight": 20, "keyword": "ฉัน" },
                "hasVerb": { "weight": 35, "keyword": "ออกกำลังกาย" },
                "hasPrepPhrase": { "weight": 35, "keyword": "เพื่อ" },
                "spellingCorrect": { "weight": 10, "exactMatch": true }
              }
            },
            {
              "id": "sc-002",
              "prompt": {
                "subject": "เขา",
                "subjectZh": "他",
                "prepositionalHint": "เพื่อสอบได้",
                "prepositionalHintZh": "为了通过考试",
                "englishHint": "He studies hard to pass the exam."
              },
              "referenceAnswer": "เขาตั้งใจเรียนเพื่อสอบได้",
              "scoringRubric": {
                "hasSubject": { "weight": 20, "keyword": "เขา" },
                "hasVerb": { "weight": 35, "keyword": "ตั้งใจ" },
                "hasPrepPhrase": { "weight": 35, "keyword": "เพื่อ" },
                "spellingCorrect": { "weight": 10, "exactMatch": true }
              }
            },
            {
              "id": "sc-003",
              "prompt": {
                "subject": "เรา",
                "subjectZh": "我们",
                "prepositionalHint": "เพื่อพักผ่อน",
                "prepositionalHintZh": "为了休息",
                "englishHint": "We go to the beach to relax."
              },
              "referenceAnswer": "เราไปทะเลเพื่อพักผ่อน",
              "scoringRubric": {
                "hasSubject": { "weight": 20, "keyword": "เรา" },
                "hasVerb": { "weight": 35, "keyword": "ไป" },
                "hasPrepPhrase": { "weight": 35, "keyword": "เพื่อ" },
                "spellingCorrect": { "weight": 10, "exactMatch": true }
              }
            }
          ]
        },
        "errorCorrection": {
          "description": "找出并改正下列句子中的错误",
          "items": [
            {
              "wrongSentence": "ฉันไปตลาดเพราะซื้อผัก",
              "errorPosition": "ใช้ 'เพราะ' แทน 'เพื่อ'",
              "errorType": "wrong_word",
              "correctedSentence": "ฉันไปตลาดเพื่อซื้อผัก",
              "explanation": "这里表示去市场的目的是买菜，应该用 'เพื่อ' 表示目的，而不是 'เพราะ'（因为）。"
            },
            {
              "wrongSentence": "เราตั้งใจเรียนเพื่อสอบเข้ามหาวิทยาลัยอย่าง",
              "errorPosition": "มีคำว่า 'อย่าง' เกินมา",
              "errorType": "extra_word",
              "correctedSentence": "เราตั้งใจเรียนเพื่อสอบเข้ามหาวิทยาลัย",
              "explanation": "删除多余的 'อย่าง'。'เพื่อ' 可以直接接动词短语 'สอบเข้ามหาวิทยาลัย'，不需要加 'อย่าง'。"
            },
            {
              "wrongSentence": "เพื่อสุขภาพเขาออกกำลังกาย",
              "errorPosition": "词序错误",
              "errorType": "word_order",
              "correctedSentence": "เขาออกกำลังกายเพื่อสุขภาพ",
              "explanation": "正确语序应为 '主语 + 主要动作 + เพื่อ + 目的'。'เพื่อสุขภาพ' 应放在句末。"
            }
          ]
        }
      },
      "quiz": {
        "description": "综合测验：使用 'เพื่อ' 句型表达目的",
        "config": {
          "totalQuestions": 10,
          "timeLimitSeconds": 600,
          "passingScore": 70,
          "questionTypes": ["recognition", "fillInBlank", "dragAndDrop", "multipleChoice", "translation"]
        },
        "pool": ["mc-001", "mc-002", "mc-003", "tr-001", "tr-002", "tr-003", "tr-004", "dd-001", "dd-002"]
      },
      "printableWorksheet": {
        "description": "可打印练习纸：围绕 'เพื่อ' 句型的练习",
        "config": {
          "paperSize": "A4",
          "fontSize": 16,
          "lineHeight": 2.5,
          "showAnswerLines": true,
          "includeAudioQR": false
        },
        "sections": ["fillInBlank", "translation", "sentenceConstruction"]
      },
      "metadata": {
        "relatedPatterns": ["pattern-001", "pattern-005"],
        "prerequisiteVocab": ["เรียน", "ทำงาน", "ไป", "ซื้อ", "ทำ", "ออกกำลังกาย", "สุขภาพ", "เงิน", "บ้าน", "สอบ"],
        "tags": ["เพื่อ", "目的", "意图", "目标", "学习", "工作", "健康", "生活"],
        "difficulty": 2
      }
    };

    const tagsStr = defaultPattern.metadata.tags.join(',');
    await run(
      `INSERT INTO tblSentencePattern (uuid, tags, patternContent) VALUES (?, ?, ?)`,
      [defaultPattern.id, tagsStr, JSON.stringify(defaultPattern)]
    );
    console.log("Seeded default sentence pattern successfully.");
  }

  // Create tblCourseSentencePattern table for linking courses/lessons to sentence patterns
  await run(`
    CREATE TABLE IF NOT EXISTS tblCourseSentencePattern (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id TEXT NOT NULL,
      lesson_id TEXT NOT NULL,
      pattern_uuid TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
      FOREIGN KEY (lesson_id) REFERENCES course_lessons (id) ON DELETE CASCADE,
      FOREIGN KEY (pattern_uuid) REFERENCES tblSentencePattern (uuid) ON DELETE CASCADE
    )
  `);

  // Seed default course pattern association if empty
  const assocCount = await get(`SELECT COUNT(*) as count FROM tblCourseSentencePattern`);
  if (assocCount.count === 0) {
    console.log("Seeding default course sentence pattern association in tblCourseSentencePattern...");
    await run(
      `INSERT INTO tblCourseSentencePattern (course_id, lesson_id, pattern_uuid) VALUES (?, ?, ?)`,
      ["course_001", "lesson_001", "pattern-004"]
    );
    console.log("Seeded default association successfully.");
  }

  // Create tblTranslateSentence table
  await run(`
    CREATE TABLE IF NOT EXISTS tblTranslateSentence (
      uuid TEXT PRIMARY KEY,
      tags TEXT,
      jsonContent TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // Create tblCourseTranslateSentence table for linking courses/lessons to translate sentences
  await run(`
    CREATE TABLE IF NOT EXISTS tblCourseTranslateSentence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id TEXT NOT NULL,
      lesson_id TEXT NOT NULL,
      sentence_uuid TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
      FOREIGN KEY (lesson_id) REFERENCES course_lessons (id) ON DELETE CASCADE,
      FOREIGN KEY (sentence_uuid) REFERENCES tblTranslateSentence (uuid) ON DELETE CASCADE
    )
  `);

  // Seed default translate sentence if empty
  const translateCount = await get(`SELECT COUNT(*) as count FROM tblTranslateSentence`);
  if (translateCount.count === 0) {
    console.log("Seeding default translate sentence in tblTranslateSentence...");
    const defaultSentence = {
      id: "s001",
      chinese: "刚刚入学就被派来泰国教书，从来也没有想到。",
      thai: "เพิ่งเข้าเรียนก็ถูกส่งมาสอนหนังสือที่ไทย ไม่เคยคิดมาก่อนเลย",
      thai_spaced: "เพิ่ง เข้าเรียน ก็ ถูกส่ง มา สอนหนังสือ ที่ไทย ไม่เคย คิด มาก่อน เลย",
      english: "Just after enrolling, I was sent to teach in Thailand. I never expected it at all.",
      direction: "zh2th",
      tokens: [
        { thai: "เพิ่ง", meaning: "刚刚", start: 0, end: 5, importance: 2 },
        { thai: "เข้าเรียน", meaning: "入学", start: 5, end: 14, importance: 3 },
        { thai: "ก็", meaning: "就", start: 14, end: 16, importance: 1 },
        { thai: "ถูกส่ง", meaning: "被派", start: 16, end: 23, importance: 3 },
        { thai: "มา", meaning: "来", start: 23, end: 26, importance: 2 },
        { thai: "สอนหนังสือ", meaning: "教书", start: 26, end: 37, importance: 3 },
        { thai: "ที่ไทย", meaning: "在泰国", start: 37, end: 43, importance: 2 },
        { thai: "ไม่เคย", meaning: "从不", start: 44, end: 50, importance: 3 },
        { thai: "คิด", meaning: "想", start: 50, end: 54, importance: 2 },
        { thai: "มาก่อน", meaning: "之前", start: 54, end: 60, importance: 2 },
        { thai: "เลย", meaning: "完全", start: 60, end: 63, importance: 1 }
      ],
      glossary: [
        { thai: "เข้าเรียน", meaning: "入学", importance: 3 },
        { thai: "ถูกส่ง", meaning: "被派", importance: 3 },
        { thai: "สอนหนังสือ", meaning: "教书", importance: 3 },
        { thai: "ไม่เคย", meaning: "从不", importance: 3 }
      ],
      category: "日常生活",
      difficulty: 3
    };

    await run(
      `INSERT INTO tblTranslateSentence (uuid, tags, jsonContent) VALUES (?, ?, ?)`,
      ["s001", "日常生活,初学者", JSON.stringify(defaultSentence)]
    );
    console.log("Seeded default translate sentence successfully.");
  }

  // Seed default course translate sentence association if empty
  const translateAssocCount = await get(`SELECT COUNT(*) as count FROM tblCourseTranslateSentence`);
  if (translateAssocCount.count === 0) {
    console.log("Seeding default course translate sentence association in tblCourseTranslateSentence...");
    await run(
      `INSERT INTO tblCourseTranslateSentence (course_id, lesson_id, sentence_uuid) VALUES (?, ?, ?)`,
      ["course_001", "lesson_001", "s001"]
    );
    console.log("Seeded default course translate sentence association successfully.");
  }

  // Create tblCourseware table for storing courseware metadata
  await run(`
    CREATE TABLE IF NOT EXISTS tblCourseware (
      uuid TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      tags TEXT,
      coursewareURI TEXT,
      studyGuide TEXT,
      pageMarkdowns TEXT,
      quizCheck TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // Create tblCourseCourseware table for linking courses/lessons to courseware
  await run(`
    CREATE TABLE IF NOT EXISTS tblCourseCourseware (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id TEXT NOT NULL,
      lesson_id TEXT NOT NULL,
      courseware_uuid TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
      FOREIGN KEY (lesson_id) REFERENCES course_lessons (id) ON DELETE CASCADE,
      FOREIGN KEY (courseware_uuid) REFERENCES tblCourseware (uuid) ON DELETE CASCADE
    )
  `);

  // Create tblCoursewarePageNotes table for per-page AI notes and flashcards linked to physical pages
  await run(`
    CREATE TABLE IF NOT EXISTS tblCoursewarePageNotes (
      id TEXT PRIMARY KEY,
      courseware_uuid TEXT NOT NULL,
      page_num INTEGER NOT NULL,
      title_original TEXT,
      title_cn TEXT,
      summary TEXT,
      core_points_json TEXT,
      vocabulary_json TEXT,
      flashcards_json TEXT,
      data_json TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime')),
      UNIQUE(courseware_uuid, page_num),
      FOREIGN KEY (courseware_uuid) REFERENCES tblCourseware (uuid) ON DELETE CASCADE
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_cwpn_cw_page ON tblCoursewarePageNotes (courseware_uuid, page_num)`);

  // Create tblAlgoDebugLog table for algorithm debugging logs
  await run(`
    CREATE TABLE IF NOT EXISTS tblAlgoDebugLog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      reviewed_at TEXT DEFAULT (datetime('now', 'localtime')),
      total_words INTEGER,
      old_words_count INTEGER,
      new_words_count INTEGER,
      total_attempts INTEGER,
      correct_attempts INTEGER,
      accuracy REAL,
      duration_seconds INTEGER,
      queue_log_json TEXT
    )
  `);

  // Seed default courseware if empty
  const coursewareCount = await get(`SELECT COUNT(*) as count FROM tblCourseware`);
  if (coursewareCount.count === 0) {
    console.log("Seeding default courseware in tblCourseware...");
    const defaultUuid = "eng_ch1_cw1";
    const title = "Lesson 1 PPT- reading comprehension.pdf";
    const tags = "English,Reading";
    const coursewareURI = "coursePPT/Lesson 1 PPT- reading comprehension.pdf";
    
    const studyGuide = {
      warmup: {
        q: "在研读泰语阅读主旨大意（การอ่านจับใจความสำคัญ）讲义前，你认为应该如何有效区分文章的主题（Topic）与核心大意（Main Idea）？"
      },
      pageGuides: {
        1: {
          question: "请结合课件第一页内容，用中文或泰语描述你对“จับใจความสำคัญ”（抓取核心大意）这个概念的初步理解是什么？",
          ref: "จับใจความสำคัญ 代表了阅读中的核心大意抓取，要求学生能够穿透表象文字，提炼并总结出一段话或一篇文章中作者最想表达的中心思想。",
          keywords: ["ใจความ", "สำคัญ", "大意", "主旨", "จับ", "核心"]
        },
        2: {
          question: "根据第二页讲义中的“วัตถุประสงค์”（学习目标），用中文或泰语回答：本课前两个核心目标分别是什么？它们对于区分信息有什么要求？",
          ref: "前两个目标是：(1) 能够准确识别和划定主题(topic)、核心大意(main idea)、主题句(topic sentence)及支持细节(supporting details)；(2) 能够清晰辨别“议题(ประเด็น)”与“核心大意(ใจความสำคัญ)”之间的区别。",
          keywords: ["วัตถุประสงค์", "ประเด็น", "ใจความสำคัญ", "เป้าหมาย", "教学目标", "大意", "细节", "区分", "topic", "main idea"]
        },
        3: {
          question: "<strong>思考题 1：关于阅读误区与策略的转变</strong><br>许多语言学习者习惯于在阅读时进行“逐字翻译”（word-for-word translation），请结合第三页的教学内容，思考这种习惯为什么会成为获取“中心思想”的障碍？在阅读中，我们应该将注意力从哪些琐碎细节转移到哪些核心要素上？<br><br><strong>思考题 2：关于“结构化阅读”的价值</strong><br>第三页提到，本课程将训练学生阅读的“方向感”。请尝试用自己的话解释：为什么理解“段落结构”和“篇章标记”对于我们理解文章意图至关重要？这与单纯理解字面意思有什么本质区别？",
          ref: "【思考题 1】逐字翻译容易让读者陷入数字、时间、地点及修饰语等琐碎细节的泥潭，从而忽略核心主旨。我们应当放弃翻译每句话的念头，转向识别段落结构、事件结构以及篇章标记。<br>【思考题 2】单纯理解字面意思会导致信息碎片化、分不清主次。结构化阅读能帮我们识别整体框架，分清论点与支持细节，建立清晰的阅读『方向感』，从而从结构层面真实理解文章意图。",
          keywords: ["逐字翻译", "细节", "段落结构", "方向感", "字面", "主次", "框架", "篇章", "标记"]
        }
      },
      summary: {
        q: "恭喜您学完了本篇泰语阅读理解讲义。请用一两句话总结，在实际阅读过程中，该如何准确提炼段落的核心大意？"
      }
    };
    
    const pageMarkdowns = {
      2: "# การอ่านจับใจความสำคัญ\\n\\n## วัตถุประสงค์ของบทเรียน\\n(1) ระบุประเด็น (topic) ใจความสำคัญ (main idea) ประโยคใจความสำคัญ (topic sentence) และข้อมูลสนับสนุน (supporting details)\\n(2) แยกความแตกต่างระหว่าง “ประเด็น” กับ “ใจความสำคัญ”\\n(3) ระบุใจความสำคัญในแต่ละย่อหน้าของบทอ่านภาษาไทยระดับ A2-B1\\n(4) แยกความแตกต่างระหว่างข้อมูลสนับสนุนประเภทต่าง ๆ\\n(5) สังเกตลักษณะภาษา (linguistic features) ที่สำคัญ\\n(6) ทำความเข้าใจบทอ่านภาษาไทยได้ตามเวลาที่กำหนด"
    };
    
    const quizCheck = {
      3: [
        {
          question: "根据课程指导，外国语言学习者在阅读时常犯的哪种错误，会导致他们将大量时间浪费在如数字、时间、地点等琐碎细节上？",
          options: {
            A: "过度关注文章的段落结构",
            B: "尝试进行“逐字翻译” (Word-for-word translation)",
            C: "忽略了文章的中心思想",
            D: "过度分析篇章标记 (Discourse markers)"
          },
          answer: "B",
          explanation: "第三页明确指出，阅读的核心并非“翻译每一个词”。许多外语学习者习惯于“逐字翻译”，这会使他们陷入细节的泥潭，从而难以把握文章整体想要表达的内容。"
        },
        {
          question: "本课程旨在训练学生养成“有方向感”的阅读习惯。为了实现这一目标，学生应该重点观察以下哪些要素？",
          options: {
            A: "文章中出现的所有数字和专有名词",
            B: "每一句话的语法分析和逐词翻译",
            C: "段落结构 (Paragraph structure)、事件结构 (Event structures) 和篇章标记 (Discourse markers)",
            D: "文章的标题和作者简介"
          },
          answer: "C",
          explanation: "本课程建议学生改变传统的阅读方式，转而通过识别“段落结构”、“事件结构”以及“篇章标记”来明确阅读方向，从而提升理解文章核心信息的能力。"
        }
      ]
    };

    await run(
      `INSERT INTO tblCourseware (uuid, title, tags, coursewareURI, studyGuide, pageMarkdowns, quizCheck) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [defaultUuid, title, tags, coursewareURI, JSON.stringify(studyGuide), JSON.stringify(pageMarkdowns), JSON.stringify(quizCheck)]
    );
    console.log("Seeded default courseware successfully.");
    
    // Seed default courseware association with course_001 / lesson_001
    await run(
      `INSERT INTO tblCourseCourseware (course_id, lesson_id, courseware_uuid) VALUES (?, ?, ?)`,
      ["course_001", "lesson_001", defaultUuid]
    );
    console.log("Seeded default courseware association successfully.");
  }

  // Seed / Ensure Tourism course & Lesson 6 multiple coursewares association
  try {
    const tourismCourse = await get(`SELECT id FROM courses WHERE name = 'Tourism' OR id = 'course-0uv6bg1w'`);
    let tourismCourseId = tourismCourse ? tourismCourse.id : 'course-0uv6bg1w';
    if (!tourismCourse) {
      await run(`INSERT INTO courses (id, name, description) VALUES (?, ?, ?)`, [tourismCourseId, 'Tourism', '泰语旅游与文化进阶课程']);
    }

    const tourismLesson = await get(`SELECT id FROM course_lessons WHERE course_id = ? AND title LIKE '%第6课%'`, [tourismCourseId]);
    let tourismLessonId = tourismLesson ? tourismLesson.id : 'les_1786003484421_qqtfr';
    if (!tourismLesson) {
      await run(`INSERT INTO course_lessons (id, course_id, sort_order, title, content_json) VALUES (?, ?, ?, ?, ?)`, [tourismLessonId, tourismCourseId, 6, '第6课：泰国文化身份', '{}']);
    }

    const tourismCwList = [
      {
        uuid: 'cw_1786003638687_t223k',
        title: '泰国特质的全貌:从文化内核到身份认同的视觉长廊',
        tags: 'Tourism, 泰国文化身份, Thainess',
        coursewareURI: 'coursewares/Ch6-The_Thainess_Gallery.pdf'
      },
      {
        uuid: 'cw_1786008206104_vafee',
        title: 'A Chronological Guide to Thai History for Tourism: 700 Years of Heritage',
        tags: 'Tourism, 泰国历史, 旅游文化',
        coursewareURI: 'coursewares/Ch5-Thai_History_for_Tourism.pdf'
      },
      {
        uuid: 'cw_1785987140126_bp02x',
        title: '泰北画卷:地理、自然与人文的交织',
        tags: 'Tourism, 泰北文化, 视觉图谱',
        coursewareURI: 'coursewares/Ch7-Northern_Thailand_Visual_Atlas.pdf'
      }
    ];

    for (const cwItem of tourismCwList) {
      const existingCw = await get(`SELECT uuid FROM tblCourseware WHERE uuid = ?`, [cwItem.uuid]);
      if (!existingCw) {
        await run(
          `INSERT INTO tblCourseware (uuid, title, tags, coursewareURI, studyGuide, pageMarkdowns, quizCheck) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [cwItem.uuid, cwItem.title, cwItem.tags, cwItem.coursewareURI, '{}', '{}', '{}']
        );
      }
      const existingAssoc = await get(
        `SELECT id FROM tblCourseCourseware WHERE course_id = ? AND lesson_id = ? AND courseware_uuid = ?`,
        [tourismCourseId, tourismLessonId, cwItem.uuid]
      );
      if (!existingAssoc) {
        await run(
          `INSERT INTO tblCourseCourseware (course_id, lesson_id, courseware_uuid) VALUES (?, ?, ?)`,
          [tourismCourseId, tourismLessonId, cwItem.uuid]
        );
      }
    }
  } catch (err) {
    console.error("Failed seeding Tourism multiple coursewares:", err);
  }

  // Create tblReviewSentences table
  await run(`
    CREATE TABLE IF NOT EXISTS tblReviewSentences (
      id TEXT PRIMARY KEY,
      thai_sentence TEXT NOT NULL,
      translation_zh TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // Create tblCourseReviewSentence table for linking courses/lessons to review sentences
  await run(`
    CREATE TABLE IF NOT EXISTS tblCourseReviewSentence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id TEXT NOT NULL,
      lesson_id TEXT NOT NULL,
      sentence_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
      FOREIGN KEY (lesson_id) REFERENCES course_lessons (id) ON DELETE CASCADE,
      FOREIGN KEY (sentence_id) REFERENCES tblReviewSentences (id) ON DELETE CASCADE
    )
  `);

  // Seed default sentence if empty
  const sentenceCount = await get(`SELECT COUNT(*) as count FROM tblReviewSentences`);
  if (sentenceCount.count === 0) {
    console.log("Seeding default review sentence in tblReviewSentences...");
    const defaultSentence = {
      id: "s_review_001",
      thai_sentence: "ภาษาไทยไม่ยากอย่างที่คิดถ้าคุณตั้งใจเรียน",
      translation_zh: "如果你用心学习，泰语并没有想象中那么难。",
      translation_en: "Thai language is not as difficult as you think if you study hard.",
      words_segmented: [
        { word: "ภาษา", ipa: "phaa-sǎa", pos: "N", meaning: "语言" },
        { word: "ไทย", ipa: "thai", pos: "PROPN", meaning: "泰国/泰语" },
        { word: "ไม่", ipa: "mâi", pos: "PART", meaning: "不/没有" },
        { word: "ยาก", ipa: "yâak", pos: "ADJ", meaning: "难" },
        { word: "อย่าง", ipa: "y&agrave;ang", pos: "ADP", meaning: "像...一样" },
        { word: "ที่", ipa: "th&icirc;i", pos: "PRON", meaning: "所/的" },
        { word: "คิด", ipa: "kh&iacute;t", pos: "V", meaning: "想/认为" },
        { word: "ถ้า", ipa: "th&acirc;a", pos: "SCONJ", meaning: "如果" },
        { word: "คุณ", ipa: "khun", pos: "PRON", meaning: "你" },
        { word: "ตั้งใจ", ipa: "t&acirc;ng-cai", pos: "V", meaning: "专心/用心" },
        { word: "เรียน", ipa: "rian", pos: "V", meaning: "学习" }
      ],
      difficult_vocab: [
        {
          vocab_id: "v_082",
          word: "ตั้งใจ",
          ipa: "tâng-cai",
          meaning_zh: "专心，用心，有意，打算",
          meaning_en: "to intend; be determined; concentrate",
          pos: "动词 (Verb)",
          examples: [
            {
              thai: "เขาตั้งใจเรียนมากเพื่อสอบชิงทุน",
              chinese: "他非常用心学习以争取奖学金。",
              english: "He studies very hard to win the scholarship."
            }
          ]
        }
      ],
      sentence_analysis: {
        key_grammar_patterns: [
          { pattern_id: "pat_045", pattern_name: "ไม่... อย่างที่คิด", explanation: "表示“不像所想的那样...”，用于对先前的看法进行转折或澄清。" }
        ],
        structure_breakdown: [
          { part: "主句部分", content: "ภาษาไทยไม่ยากอย่างที่คิด", role: "陈述事实", analysis: "ภาษาไทย (主语) + ไม่ยาก (谓语) + อย่างที่คิด (修饰)" }
        ],
        learning_focus: "重点体会泰语中“อย่างที่คิด”这一习惯表达的语序。"
      }
    };

    await run(
      `INSERT INTO tblReviewSentences (id, thai_sentence, translation_zh, data_json) VALUES (?, ?, ?, ?)`,
      [defaultSentence.id, defaultSentence.thai_sentence, defaultSentence.translation_zh, JSON.stringify(defaultSentence)]
    );
    console.log("Seeded default review sentence successfully.");

    // Seed default review sentence association
    await run(
      `INSERT INTO tblCourseReviewSentence (course_id, lesson_id, sentence_id) VALUES (?, ?, ?)`,
      ["course_001", "lesson_001", defaultSentence.id]
    );
    console.log("Seeded default review sentence association successfully.");
  }

  // Create tblAssignments table
  await run(`
    CREATE TABLE IF NOT EXISTS tblAssignments (
      uuid TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      assignment_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // Seed default assignments if empty
  const assignmentCount = await get(`SELECT COUNT(*) as count FROM tblAssignments`);
  if (assignmentCount.count === 0) {
    console.log("Seeding default assignments in tblAssignments...");
    const defaultAssignments = [
      {
        uuid: "a_001",
        title: "第一单元泰语拼读与基础问候作业",
        date: "2026-07-20",
        assignment_json: JSON.stringify({
          worksheet_number: "WS-01",
          exercises: [
            {
              question_number: "1",
              question_text: "写出以下泰语单词的意思：สวัสดี (sawatdi)",
              student_answer: "你好"
            },
            {
              question_number: "2",
              question_text: "翻译句子：สบายดีไหม (sabai di mai)",
              student_answer: "你好吗？"
            },
            {
              question_number: "3",
              question_text: "写出泰语元音 'ะ' 的发音特点",
              student_answer: "短元音，发音类似中文的‘啊’，但是发音很短促。"
            },
            {
              question_number: "4",
              question_text: "翻译句子：ขอบคุณครับ (khop khun khrap)",
              student_answer: "谢谢（男性用语）"
            }
          ]
        })
      },
      {
        uuid: "a_002",
        title: "第二单元自我介绍与代词运用作业",
        date: "2026-07-21",
        assignment_json: JSON.stringify({
          worksheet_number: "WS-02",
          exercises: [
            {
              question_number: "1",
              question_text: "指出泰语中女性和男性第一人称代词的区别",
              student_answer: "女性用 ดิฉัน (dichan) 或 ฉัน (chan)，男性用 ผม (phom)。"
            },
            {
              question_number: "2",
              question_text: "翻译句子：ผมชื่อสมชายครับ (phom chue Somchai khrap)",
              student_answer: "我的名字叫颂猜。"
            },
            {
              question_number: "3",
              question_text: "翻译句子：ยินดีที่ได้รู้จัก (yin di thi dai ru cak)",
              student_answer: "很高兴认识你。"
            }
          ]
        })
      }
    ];

    for (const item of defaultAssignments) {
      await run(
        `INSERT INTO tblAssignments (uuid, title, date, assignment_json) VALUES (?, ?, ?, ?)`,
        [item.uuid, item.title, item.date, item.assignment_json]
      );
    }
    console.log("Seeded default assignments successfully.");
  }

  // Create tblQuiz table
  await run(`
    CREATE TABLE IF NOT EXISTS tblQuiz (
      uuid TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      tags TEXT,
      status TEXT DEFAULT 'active',
      quiz_data TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  const quizCount = await get(`SELECT COUNT(*) as count FROM tblQuiz`);
  if (quizCount.count === 0) {
    console.log("Seeding default quiz in tblQuiz...");
    const defaultQuizData = {
      "quiz_title": "แบบทดสอบทบทวนความรู้: ภาษาไทยเพื่อการท่องเที่ยว (วัฒนธรรมและวิถีชีวิต)",
      "total_questions": 10,
      "questions": [
        {
          "id": 1,
          "type": "single_choice",
          "difficulty": "easy",
          "knowledge_point": "ความหมายและรากศัพท์ของคำว่าวัฒนธรรม",
          "question": "คำว่า 'วัฒนธรรม' มีรากศัพท์มาจากคำว่า 'วัฒนะ' และ 'ธรรม' ซึ่งคำว่า 'วัฒนะ' มีความหมายตรงกับข้อใด?",
          "options": [
            "ก. ความดีงาม",
            "ข. ความเจริญงอกงาม",
            "ค. ความเชื่อทางศาสนา",
            "ง. กฎระเบียบสังคม"
          ],
          "answer": "ข",
          "explanation": "ตามเอกสารอ้างอิง วัฒนธรรมมาจากคำว่า 'วัฒนะ' ซึ่งหมายถึงความเจริญงอกงาม และ 'ธรรม' ซึ่งหมายถึงความดี"
        },
        {
          "id": 2,
          "type": "single_choice",
          "difficulty": "easy",
          "knowledge_point": "นิยามพื้นฐานของวัฒนธรรม",
          "question": "ข้อใดคือคำนิยามของ 'วัฒนธรรม' ตามที่ปรากฏในเอกสารการเรียน?",
          "options": [
            "ก. สิ่งที่เกิดขึ้นเองตามธรรมชาติ",
            "ข. การกระทำของสัตว์ป่า",
            "ค. สิ่งที่มนุษย์สร้างขึ้นเพื่อกำกับควบคุมให้คนในสังคมอยู่ร่วมกันอย่างมีความสุข",
            "ง. สภาพอากาศและภูมิประเทศของแต่ละท้องถิ่น"
          ],
          "answer": "ค",
          "explanation": "เอกสารอ้างอิง ระบุว่าวัฒนธรรมคือความเจริญงอกงามที่มนุษย์สร้างขึ้นเพื่อกำกับควบคุมคนในสังคมให้อยู่ร่วมกันอย่างมีความสุข"
        },
        {
          "id": 3,
          "type": "true_false",
          "difficulty": "easy",
          "knowledge_point": "การสืบทอดวัฒนธรรม",
          "question": "วัฒนธรรมเป็นสิ่งที่คงที่และไม่มีการถ่ายทอดจากรุ่นสู่รุ่น",
          "options": [],
          "answer": "false",
          "explanation": "ผิด เพราะในเอกสาร และ ระบุชัดเจนว่าวัฒนธรรมมีการสืบสานและถ่ายทอดจากรุ่นสู่รุ่น"
        },
        {
          "id": 4,
          "type": "single_choice",
          "difficulty": "medium",
          "knowledge_point": "การแยกแยะวัฒนธรรมรูปธรรมในบริบทการท่องเที่ยว",
          "question": "นักท่องเที่ยวที่เข้าชม 'วัดพระแก้ว' และชื่นชมในความงามของ 'พระอุโบสถ' ถือว่ากำลังเข้าถึงวัฒนธรรมประเภทใด?",
          "options": [
            "ก. วัฒนธรรมรูปธรรม (สถาปัตยกรรม)",
            "ข. วัฒนธรรมนามธรรม (ศีลธรรม)",
            "ค. วิถีชีวิตทางการประกอบอาชีพ",
            "ง. เทคโนโลยีการสื่อสาร"
          ],
          "answer": "ก",
          "explanation": "เอกสาร ระบุว่า 'สถาปัตยกรรม' จัดเป็นวัฒนธรรมประเภทรูปธรรม ซึ่งเป็นสิ่งที่มนุษย์สร้างขึ้นเพื่ออำนวยความสะดวกหรือแสดงความเจริญ"
        },
        {
          "id": 5,
          "type": "single_choice",
          "difficulty": "medium",
          "knowledge_point": "การแยกแยะวัฒนธรรมนามธรรม",
          "question": "ข้อใดจัดเป็น 'วัฒนธรรมนามธรรม' ที่ส่งผลต่อพฤติกรรมและการต้อนรับนักท่องเที่ยวของคนไทย?",
          "options": [
            "ก. พระบรมมหาราชวัง",
            "ข. น้ำใจ ความเกรงใจ และรอยยิ้ม",
            "ค. เรือนไทยภาคกลาง",
            "ง. อาหารไทยต้มยำกุ้ง"
          ],
          "answer": "ข",
          "explanation": "เอกสาร ระบุว่าวัฒนธรรมนามธรรมคือสิ่งที่ไม่สามารถจับต้องได้ เช่น ศีลธรรม ค่านิยม น้ำใจ ความเกรงใจ"
        },
        {
          "id": 6,
          "type": "multiple_choice",
          "difficulty": "hard",
          "knowledge_point": "การจำแนกประเภทของวัฒนธรรม (เลือกได้หลายข้อ)",
          "question": "ข้อใดต่อไปนี้จัดเป็น 'วัฒนธรรมรูปธรรม' (Concrete Culture) ทั้งหมด? (เลือกทุกข้อที่ถูกต้อง)",
          "options": [
            "ก. วัดวาอารามและสถาปัตยกรรม",
            "ข. ความเคารพผู้สูงอายุ",
            "ค. เครื่องแต่งกายชุดไทย",
            "ง. ภาษาพูดและสำนวนภาษา"
          ],
          "answer": ["ก", "ค"],
          "explanation": "วัดวาอารามและเครื่องแต่งกายเป็นวัตถุที่จับต้องได้ (รูปธรรม) ส่วนความเคารพและภาษาจัดเป็นวัฒนธรรมนามธรรม"
        },
        {
          "id": 7,
          "type": "single_choice",
          "difficulty": "medium",
          "knowledge_point": "วิถีชีวิตไทยกับสายน้ำ",
          "question": "วัฒนธรรมประเพณีใดของไทยที่มีความเชื่อมโยงโดยตรงกับ 'วิถีชีวิตการพึ่งพาอาศัยสายน้ำ' ของคนไทยในอดีต?",
          "options": [
            "ก. ประเพณีบุญบั้งไฟ",
            "ข. ประเพณีลอยกระทง",
            "ค. ประเพณีแห่นางแมว",
            "ง. ประเพณีวิ่งควาย"
          ],
          "answer": "ข",
          "explanation": "ประเพณีลอยกระทงเป็นการแสดงความขอบคุณและขอขมาแม่น้ำลำคลอง ซึ่งสะท้อนวิถีชีวิตที่ผูกพันกับสายน้ำ"
        },
        {
          "id": 8,
          "type": "true_false",
          "difficulty": "easy",
          "knowledge_point": "การเปลี่ยนแปลงของวัฒนธรรมและวิถีชีวิต",
          "question": "การรับเอาเทคโนโลยีสมัยใหม่เข้ามาใช้ในสังคมไทย ทำให้วัฒนธรรมดั้งเดิมบางอย่างสูญหายไปโดยไม่มีการปรับตัว",
          "options": [],
          "answer": "false",
          "explanation": "ผิด วัฒนธรรมมีการปรับตัวและผสมผสานระหว่างความเชื่อดั้งเดิมกับเทคโนโลยีสมัยใหม่"
        },
        {
          "id": 9,
          "type": "single_choice",
          "difficulty": "hard",
          "knowledge_point": "ความสำคัญของภาษาไทยเพื่อการท่องเที่ยว",
          "question": "การเรียนรู้ 'ภาษาไทยเพื่อการท่องเที่ยว' มีวัตถุประสงค์หลักตรงกับข้อใดมากที่สุด?",
          "options": [
            "ก. เพื่อใช้ในการสอบแข่งขันระดับประเทศเท่านั้น",
            "ข. เพื่อเข้าใจความหมายของสถานที่และสื่อสารนำเสนอเสน่ห์ของวัฒนธรรมไทยได้อย่างถูกต้อง",
            "ค. เพื่อท่องจำคำศัพท์โบราณที่ไม่มีการใช้งานแล้ว",
            "ง. เพื่อแปลเอกสารทางกฎหมายระหว่างประเทศ"
          ],
          "answer": "ข",
          "explanation": "วัตถุประสงค์ของการเรียนภาษาไทยเพื่อการท่องเที่ยวคือการเข้าใจบริบททางวัฒนธรรมและสามารถสื่อสารแนะนำเสน่ห์ของไทยได้อย่างถูกต้อง"
        },
        {
          "id": 10,
          "type": "single_choice",
          "difficulty": "hard",
          "knowledge_point": "การประยุกต์ใช้วัฒนธรรมในอุตสาหกรรมท่องเที่ยว",
          "question": "การจัดกิจกรรม 'เวิร์กช็อปทำกระทง' หรือ 'ทำอาหารไทย' ให้นักท่องเที่ยวชาวต่างชาติ จัดเป็นการท่องเที่ยวประเภทใด?",
          "options": [
            "ก. การท่องเที่ยวเชิงนิเวศ (Ecotourism)",
            "ข. การท่องเที่ยวเชิงวัฒนธรรมและประสบการณ์ (Cultural & Experiential Tourism)",
            "ค. การท่องเที่ยวเชิงผจญภัย (Adventure Tourism)",
            "ง. การท่องเที่ยวเชิงการแพทย์ (Medical Tourism)"
          ],
          "answer": "ข",
          "explanation": "การสัมผัสและลงมือปฏิบัติกิจกรรมทางวัฒนธรรมถือเป็นการท่องเที่ยวเชิงวัฒนธรรมและประสบการณ์ (Cultural & Experiential Tourism)"
        }
      ]
    };

    await run(
      `INSERT INTO tblQuiz (uuid, title, tags, status, quiz_data) VALUES (?, ?, ?, ?, ?)`,
      [
        "qz_default_001",
        defaultQuizData.quiz_title,
        "วัฒนธรรม,ท่องเที่ยว,A2-B1",
        "active",
        JSON.stringify(defaultQuizData)
      ]
    );
    console.log("Seeded default quiz in tblQuiz successfully.");
  }

  // Create tblQuizSubmission table for quiz test results
  await run(`
    CREATE TABLE IF NOT EXISTS tblQuizSubmission (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_uuid TEXT NOT NULL,
      quiz_title TEXT,
      mode TEXT DEFAULT 'practice',
      score INTEGER NOT NULL,
      total_questions INTEGER NOT NULL,
      score_percent INTEGER NOT NULL,
      time_taken_seconds INTEGER DEFAULT 0,
      max_streak INTEGER DEFAULT 0,
      user_answers TEXT,
      knowledge_breakdown TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_quiz_submission_uuid ON tblQuizSubmission(quiz_uuid)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_quiz_submission_created_at ON tblQuizSubmission(created_at)`);

  // Create tblCoreWordsets table for grouping core words into multiple sets per lesson/course
  await run(`
    CREATE TABLE IF NOT EXISTS tblCoreWordsets (
      id TEXT PRIMARY KEY,
      course_id TEXT,
      lesson_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_core_wordsets_lesson ON tblCoreWordsets(lesson_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_core_wordsets_course ON tblCoreWordsets(course_id)`);

  // Create tblCoreWords table dedicated for Pages/appCoreWords.html
  await run(`
    CREATE TABLE IF NOT EXISTS tblCoreWords (
      id TEXT PRIMARY KEY,
      lesson_id TEXT,
      set_id TEXT,
      sort_order INTEGER DEFAULT 0,
      word TEXT NOT NULL,
      ipa TEXT,
      data_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // Migration: Add set_id column to tblCoreWords if not exists
  try {
    await run(`ALTER TABLE tblCoreWords ADD COLUMN set_id TEXT`);
    console.log("Added set_id column to tblCoreWords table");
  } catch (err) {
    // Column already exists or table was just created with it
  }
  await run(`CREATE INDEX IF NOT EXISTS idx_core_words_set ON tblCoreWords(set_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_core_words_lesson ON tblCoreWords(lesson_id)`);

  // Migration: Backfill default wordset for existing tblCoreWords without set_id
  const unassignedWords = await all(`
    SELECT DISTINCT lesson_id 
    FROM tblCoreWords 
    WHERE (set_id IS NULL OR set_id = '') AND lesson_id IS NOT NULL AND lesson_id != ''
  `);
  if (unassignedWords && unassignedWords.length > 0) {
    console.log(`Backfilling default wordsets for ${unassignedWords.length} lessons in tblCoreWords...`);
    for (const row of unassignedWords) {
      const lesId = row.lesson_id;
      const cleanLesId = lesId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const defaultSetId = `set_${cleanLesId}_1`;

      // Fetch lesson & course details if available
      const lessonRow = await get(`SELECT id, course_id, title FROM course_lessons WHERE id = ?`, [lesId]);
      const courseId = lessonRow ? lessonRow.course_id : null;
      const lessonTitle = lessonRow ? lessonRow.title : lesId;

      // Check if this wordset already exists in tblCoreWordsets
      const existingSet = await get(`SELECT id FROM tblCoreWordsets WHERE id = ?`, [defaultSetId]);
      if (!existingSet) {
        await run(
          `INSERT INTO tblCoreWordsets (id, course_id, lesson_id, title, description, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
          [
            defaultSetId,
            courseId,
            lesId,
            `${lessonTitle} - 核心词集 1`,
            `默认核心词汇集合`,
            1
          ]
        );
      }

      // Update words with this set_id
      await run(
        `UPDATE tblCoreWords SET set_id = ? WHERE lesson_id = ? AND (set_id IS NULL OR set_id = '')`,
        [defaultSetId, lesId]
      );
    }
    console.log("Backfilled default core wordsets successfully.");
  }

  const coreWordsCount = await get(`SELECT COUNT(*) as count FROM tblCoreWords`);
  if (coreWordsCount.count === 0) {
    const defaultSetId = "set_lesson_001_1";
    await run(
      `INSERT OR IGNORE INTO tblCoreWordsets (id, course_id, lesson_id, title, description, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
      [defaultSetId, "course_001", "lesson_001", "第1课核心词集 1", "基础日常招呼词汇", 1]
    );

    const seedCoreWords = [
      {
        id: "cw_001",
        lessonId: "lesson_001",
        setId: defaultSetId,
        order: 1,
        word: "ภูมิฐาน",
        ipa: "/pʰuːm˧.tʰaːn˩˩˦/",
        meanings: [
          {
            part_of_speech: "adj.",
            meaning: "有地位的，有尊严的，端庄的",
            examples: [
              {
                sentence: "เขามีบุคลิกภาพที่ภูมิฐาน",
                meaning: "他有端庄稳重的气质"
              },
              {
                sentence: "การแต่งกายแบบภูมิฐานเหมาะกับงานสำคัญ",
                meaning: "端庄的着装适合重要场合"
              }
            ]
          }
        ]
      },
      {
        id: "cw_002",
        lessonId: "lesson_001",
        setId: defaultSetId,
        order: 2,
        word: "ประมาณ",
        ipa: "/pra˧.maːn˧/",
        meanings: [
          {
            part_of_speech: "adv.",
            meaning: "大约、大概",
            examples: [
              {
                sentence: "เราเรียนภาษาไทยประมาณ ๘ ชั่วโมงต่อสัปดาห์",
                meaning: "我们每周大约学8个小时泰语"
              },
              {
                sentence: "เขาอยู่กว่างโจวประมาณ ๒๐ ปีแล้ว",
                meaning: "他在广州待了大约20年了"
              }
            ]
          }
        ]
      }
    ];

    for (const cw of seedCoreWords) {
      await run(
        `INSERT INTO tblCoreWords (id, lesson_id, set_id, sort_order, word, ipa, data_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [cw.id, cw.lessonId, cw.setId, cw.order, cw.word, cw.ipa, JSON.stringify(cw)]
      );
    }
    console.log("Seeded default data in tblCoreWords successfully.");
  }

  // Create tblIdioms table for Thai-Chinese Idioms / Proverbs
  await run(`
    CREATE TABLE IF NOT EXISTS tblIdioms (
      id TEXT PRIMARY KEY,
      sort_order INTEGER DEFAULT 0,
      thai_phrase TEXT NOT NULL,
      chinese_meaning TEXT NOT NULL,
      thai_example TEXT,
      example_translation TEXT,
      literal_meaning TEXT,
      notes TEXT,
      tags TEXT,
      data_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  const idiomsCount = await get(`SELECT COUNT(*) as count FROM tblIdioms`);
  if (idiomsCount.count === 0) {
    console.log("Seeding default 29 Thai-Chinese idioms into tblIdioms...");
    const seedIdioms = [
      {
        id: "idm_001",
        sortOrder: 1,
        thaiPhrase: "รัดเข็มขัด",
        chineseMeaning: "勒紧裤腰带（比喻节约开支）",
        thaiExample: "เศรษฐกิจย่ำแย่แบบนี้ ทุกคนต้องช่วยกันรัดเข็มขัด",
        exampleTranslation: "经济如此低迷，大家都必须一起勒紧裤腰带过日子。",
        literalMeaning: "系紧皮带 / 勒紧腰带",
        notes: "常用于经济萧条或财政紧张时，表示缩减开支、省吃俭用。",
        tags: "比喻,日常,经济"
      },
      {
        id: "idm_002",
        sortOrder: 2,
        thaiPhrase: "ดั่งไข่ในหิน",
        chineseMeaning: "掌上明珠 / 极力爱护、珍视",
        thaiExample: "พ่อแม่รักลูกและถนอมลูกดั่งไข่ในหิน",
        exampleTranslation: "父母深爱孩子，把孩子像掌上明珠一样悉心呵护。",
        literalMeaning: "如石头中的蛋（受到极其严密的保护）",
        notes: "用于形容对子女或心爱之人极为珍视、呵护备至。",
        tags: "修辞,家庭,比喻"
      },
      {
        id: "idm_003",
        sortOrder: 3,
        thaiPhrase: "แขวนนวม",
        chineseMeaning: "挂靴 / 挂牌退役",
        thaiExample: "นักมวยคนนี้มีอายุมากแล้ว เขาจึงแขวนนวม",
        exampleTranslation: "这位拳击手年纪大了，因此选择挂拳套退役。",
        literalMeaning: "挂起拳套",
        notes: "原指拳击手退役，现引申指退出竞技体育界或从本行退休。",
        tags: "运动,比喻,职场"
      },
      {
        id: "idm_004",
        sortOrder: 4,
        thaiPhrase: "ฟาดแข้ง",
        chineseMeaning: "激烈交锋 / 上场比赛拼抢",
        thaiExample: "เดวิด เบ็คแฮม นักเตะลูกหนังลงฟาดแข้งในนัดนี้ด้วย",
        exampleTranslation: "足球名将大卫·贝克汉姆也在本场比赛中披挂上阵激烈拼抢。",
        literalMeaning: "踢腿 / 摆腿拼抢",
        notes: "常用在足球等体育赛事的生动报道中，比喻在赛场上火热角逐。",
        tags: "运动,竞争,比喻"
      },
      {
        id: "idm_005",
        sortOrder: 5,
        thaiPhrase: "หมกเม็ด",
        chineseMeaning: "暗藏玄机 / 耍花招 / 隐瞒内情",
        thaiExample: "คุณต้องดูสัญญาให้ดีระวังมีการหมกเม็ด",
        exampleTranslation: "你必须仔细审查合同，小心里面暗藏玄机、耍花招。",
        literalMeaning: "掩藏种子/隐匿细节",
        notes: "指在合同、条款或言谈中刻意隐瞒关键信息或暗设陷阱。",
        tags: "处事,警示,商业"
      },
      {
        id: "idm_006",
        sortOrder: 6,
        thaiPhrase: "ตัดสินคนแค่เปลือกนอก",
        chineseMeaning: "以貌取人 / 表里不一",
        thaiExample: "อย่าตัดสินคนแค่เปลือกนอก",
        exampleTranslation: "不要单凭外表就妄下断语（不要以貌取人）。",
        literalMeaning: "仅凭外壳判定一个人",
        notes: "เปลือกนอก 意为外皮/外壳，劝诫人们看人不能只看表面光鲜。",
        tags: "哲理,待人,警示"
      },
      {
        id: "idm_007",
        sortOrder: 7,
        thaiPhrase: "แทงใจดำ",
        chineseMeaning: "戳中痛处 / 说中要害",
        thaiExample: "เธอพูดแทงใจดำฉันเต็ม ๆ",
        exampleTranslation: "她的话完完全全戳中了我的痛处。",
        literalMeaning: "刺中内心的黑点（要害）",
        notes: "比喻一语中的，说到了他人最不愿触及或最痛切的隐藏心思。",
        tags: "情感,言语,日常"
      },
      {
        id: "idm_008",
        sortOrder: 8,
        thaiPhrase: "มือสะอาด",
        chineseMeaning: "两袖清风 / 廉洁奉公",
        thaiExample: "เขาเป็นคนมือสะอาด",
        exampleTranslation: "他是一个廉洁奉公、两袖清风的人。",
        literalMeaning: "双手清白洁净",
        notes: "形容公职人员或办事人员为人正直清廉、绝不贪污受贿。",
        tags: "品质,廉洁,褒义"
      },
      {
        id: "idm_009",
        sortOrder: 9,
        thaiPhrase: "ลอยแพ",
        chineseMeaning: "放任不管 / 任其自生自灭",
        thaiExample: "งานนี้เขาโดนลอยแพ",
        exampleTranslation: "在这项任务中他被彻底放任不管、抛弃了。",
        literalMeaning: "任由竹筏漂流",
        notes: "源自古代将犯人置于竹筏上随波逐流放逐，现比喻抛弃、置之不理或解雇扔下不管。",
        tags: "处境,工作,比喻"
      },
      {
        id: "idm_010",
        sortOrder: 10,
        thaiPhrase: "จับปลาสองมือ",
        chineseMeaning: "脚踩两条船（三心二意）",
        thaiExample: "ตอนนี้เธอจับปลาสองมืออยู่",
        exampleTranslation: "她现在脚踩两条船（三心二意想两头兼得）。",
        literalMeaning: "两只手同时抓两条鱼",
        notes: "两手抓鱼往往两条都抓不住，比喻贪多或感情上三心二意、企图兼得。",
        tags: "警示,谚语,情感"
      },
      {
        id: "idm_011",
        sortOrder: 11,
        thaiPhrase: "หามรุ่งหามค่ำ",
        chineseMeaning: "日夜兼程 / 连轴转",
        thaiExample: "เขาทำงานหามรุ่งหามค่ำ",
        exampleTranslation: "他日夜兼程、连轴转地工作。",
        literalMeaning: "从拂晓一直忙到深夜",
        notes: "形容极其辛劳、加班加点、通宵达旦地赶工。",
        tags: "工作,勤奋,日常"
      },
      {
        id: "idm_012",
        sortOrder: 12,
        thaiPhrase: "เอาหูไปนาเอาตาไปไร่",
        chineseMeaning: "视而不见，听而不闻 / 装聋作哑",
        thaiExample: "อย่าเอาหูไปนาเอาตาไปไร่",
        exampleTranslation: "不要在那装聋作哑、视而不见听而不闻。",
        literalMeaning: "把耳朵搁在水田，把眼睛搁在旱地",
        notes: "比喻故意装作没看见、没听见，不闻不问。",
        tags: "谚语,态度,处事"
      },
      {
        id: "idm_013",
        sortOrder: 13,
        thaiPhrase: "พูดไม่เข้าหู",
        chineseMeaning: "不中听 / 逆耳",
        thaiExample: "เขาพูดไม่เข้าหูผู้ใหญ่ เลยถูกมองไม่ดี",
        exampleTranslation: "他说话不中长辈的听，因此给长辈留下了不好的印象。",
        literalMeaning: "话进不了耳朵",
        notes: "形容说话不得体、不合长辈或听者心意、令人反感。",
        tags: "言语,交际,日常"
      },
      {
        id: "idm_014",
        sortOrder: 14,
        thaiPhrase: "ขุดคุ้ย",
        chineseMeaning: "翻旧账 / 刨根问底",
        thaiExample: "เรื่องนี้อย่าไปขุดคุ้ยเลย มันจบไปนานแล้ว",
        exampleTranslation: "这件事就别再去翻旧账、刨根问底了，已经过去很久了。",
        literalMeaning: "挖掘搜刮",
        notes: "指反复去翻检、深挖他人过去的隐秘或陈年旧事。",
        tags: "处事,言语,日常"
      },
      {
        id: "idm_015",
        sortOrder: 15,
        thaiPhrase: "เข้าเมืองตาหลิ่ว ต้องหลิ่วตาตาม",
        chineseMeaning: "入乡随俗",
        thaiExample: "เมื่อไปอยู่ต่างประเทศ เราควรเคารพวัฒนธรรมและวิถีชีวิตของคนที่นั่น เพราะเข้าเมืองตาหลิ่ว ต้องหลิ่วตาตาม",
        exampleTranslation: "去到国外生活时，我们应当尊重当地人的文化与生活方式，因为入乡随俗。",
        literalMeaning: "进到独眼人的城池，就得跟着眯起一只眼",
        notes: "泰国极其经典的谚语，比喻到了新环境要顺应当地风俗习惯。",
        tags: "谚语,文化,处事"
      },
      {
        id: "idm_016",
        sortOrder: 16,
        thaiPhrase: "ได้คืบจะเอาศอก",
        chineseMeaning: "得寸进尺",
        thaiExample: "ตอนแรกเขาขอความช่วยเหลือเพียงเล็กน้อย แต่หลังจากนั้นก็เรียกร้องมากขึ้นเรื่อย ๆ จนคนรอบตัวรู้สึกว่าเขาได้คืบจะเอาศอก",
        exampleTranslation: "起初他只要一点点帮助，但之后要求越来越多，让身边的人都觉得他得寸进尺。",
        literalMeaning: "得到一拃（คืบ）还想要一肘长（ศอก）",
        notes: "比喻贪得无厌、得寸进尺，不知满足。",
        tags: "谚语,警示,性格"
      },
      {
        id: "idm_017",
        sortOrder: 17,
        thaiPhrase: "ความลับไม่มีในโลก",
        chineseMeaning: "世上没有不透风的墙",
        thaiExample: "ถึงจะพยายามปิดบังเรื่องนี้แค่ไหน สุดท้ายก็ต้องมีคนรู้ เพราะความลับไม่มีในโลก",
        exampleTranslation: "不管多努力去隐瞒这件事，最后终究会有人知道，因为世上没有不透风的墙。",
        literalMeaning: "世界上没有真正的秘密",
        notes: "告诫世事终将败露，真理与真相无法永久掩盖。",
        tags: "俗语,哲理,生活"
      },
      {
        id: "idm_018",
        sortOrder: 18,
        thaiPhrase: "ปากว่าตาขยิบ",
        chineseMeaning: "口是心非 / 阳奉阴违",
        thaiExample: "เขาพูดว่าจะไม่ช่วยเรื่องนี้แล้ว แต่สุดท้ายก็กลับแอบช่วยอยู่ดี เรียกได้ว่าปากว่าตาขยิบจริง ๆ",
        exampleTranslation: "他嘴上说着再也不帮这件事了，可最后还是悄悄帮了，真可谓是口是心非。",
        literalMeaning: "嘴上在说，眼睛却在眨眼示意",
        notes: "形容嘴上说的与实际做的或内心的真实意图完全相反。",
        tags: "俗语,性格,行为"
      },
      {
        id: "idm_019",
        sortOrder: 19,
        thaiPhrase: "ตีเหล็กต้องตีตอนร้อน",
        chineseMeaning: "趁热打铁",
        thaiExample: "ลูกค้าแสดงความสนใจในสินค้าของเราแล้ว ควรรีบติดต่อกลับทันที เพราะตีเหล็กต้องตีตอนร้อน",
        exampleTranslation: "客户已经对我们的产品表现出兴趣了，应该立即联系跟进，因为趁热打铁。",
        literalMeaning: "打铁必须在铁还热的时候打",
        notes: "比喻抓紧有利时机迅速行动，以免错失良机。",
        tags: "谚语,时机,行动"
      },
      {
        id: "idm_020",
        sortOrder: 20,
        thaiPhrase: "ขี่ช้างจับตั๊กแตน",
        chineseMeaning: "大材小用 / 杀鸡用牛刀",
        thaiExample: "งานเล็กนิดเดียว แต่กลับส่งคนไปทำตั้งหลายสิบคน แบบนี้ก็เหมือนขี่ช้างจับตั๊กแตน",
        exampleTranslation: "就这么一点小事，却派了几十个人去做，这简直就像骑着大象去抓蚂蚱（大材小用、得不偿失）。",
        literalMeaning: "骑着大象去抓蚂蚱",
        notes: "比喻投入巨大成本或兴师动众去办一件极小的事，得不偿失。",
        tags: "成语,效率,比喻"
      },
      {
        id: "idm_021",
        sortOrder: 21,
        thaiPhrase: "เอาไม้ซีกไปงัดไม้ซุง",
        chineseMeaning: "以卵击石 / 不自量力",
        thaiExample: "เขาเพิ่งเริ่มทำธุรกิจ แต่กลับคิดจะแข่งกับบริษัทใหญ่ที่มีประสบการณ์มานาน แบบนี้ก็เหมือนเอาไม้ซีกไปงัดไม้ซุง",
        exampleTranslation: "他刚开始创业，就妄图与经验丰富的大公司正面竞争，这就像拿小木片去撬大原木（以卵击石）。",
        literalMeaning: "拿小木片（木屑）去撬大原木",
        notes: "比喻以极弱小的力量去抗衡悬殊的庞大力量，自取灭亡或徒劳无功。",
        tags: "谚语,力量,警示"
      },
      {
        id: "idm_022",
        sortOrder: 22,
        thaiPhrase: "ร้อนตัว",
        chineseMeaning: "做做心虚 / 不打自招",
        thaiExample: "ฉันยังไม่ได้เอ่ยชื่อใครเลย แต่เกลับรีบออกมาแก้ตัวเอง เห็นได้ชัดว่าร้อนตัว",
        exampleTranslation: "我还没点谁的名呢，他就急着跳出来辩解，显然是做贼心虚、不打自招。",
        literalMeaning: "身体发热/坐立难安",
        notes: "比喻做了亏心事的人在受到风吹草动时神色慌张、急于辩解。",
        tags: "心理,行为,日常"
      },
      {
        id: "idm_023",
        sortOrder: 23,
        thaiPhrase: "กินบนเรือนขี้รดบนหลังคา",
        chineseMeaning: "忘恩负义 / 端起碗吃饭放下筷子骂娘",
        thaiExample: "บริษัทตูลูแเชแขเป็นอย่างดี แต่สุดท้ายก็กลับเปิดเผยความลับของบริษัทให้คู่แข่ง แบบนี้เรียกว่ากินบนเรือนขี้รดบนหลังคา",
        exampleTranslation: "公司对他悉心栽培照料，但他最后却将公司商业机密泄露给竞争对手，这简直就是忘恩负义、恩将仇报。",
        literalMeaning: "在人家屋里吃饭，却在人家的屋顶上拉屎",
        notes: "极度生动地谴责受人恩惠却背叛甚至加害恩人的忘恩负义之徒。",
        tags: "谚语,道德,警示"
      },
      {
        id: "idm_024",
        sortOrder: 24,
        thaiPhrase: "หมาเห่าใบตองแห้ง",
        chineseMeaning: "虚张声势 / 纸老虎",
        thaiExample: "เขาชอบพูดข่มคนอื่นว่าจะฟ้อง จะเอาเรื่อง แต่สุดท้ายก็ไม่เคยทำจริง เป็นแค่หมาเห่าใบตองแห้ง",
        exampleTranslation: "他总爱恐吓别人说要起诉、要追究到底，但最后从不付诸行动，纯粹是只纸老虎、虚张声势。",
        literalMeaning: "狗对着干芭蕉叶狂吠（风吹枯叶沙沙响就把狗吓得狂叫）",
        notes: "形容只会虚张声势叫嚣威胁、实际毫无胆量与本领的人。",
        tags: "成语,讽刺,比喻"
      },
      {
        id: "idm_025",
        sortOrder: 25,
        thaiPhrase: "ปิดทองหลังพระ",
        chineseMeaning: "默默无闻 / 做好事不留名",
        thaiExample: "เขาทำงานเบื้องหลังมาหลายปี ไม่เคยเรียกร้องชื่อเสียงหรือคำชม เป็นการปิดทองหลังพระอย่างแท้จริง",
        exampleTranslation: "他在幕后默默奉献多年，从不索求名声与赞赏，真正做到了默默无闻、做好事不留名。",
        literalMeaning: "在佛像的背后贴金箔",
        notes: "泰国传统文化名句：人们拜佛多往佛前贴金，而往佛像背后贴金虽然无人得见，却是纯粹的奉献与功德。",
        tags: "成语,美德,奉献"
      },
      {
        id: "idm_026",
        sortOrder: 26,
        thaiPhrase: "เห็นช้างขี้ ขี้ตามช้าง",
        chineseMeaning: "盲目攀比 / 东施效颦",
        thaiExample: "เห็นเพื่อนซื้อของแพงก็รีบซื้อบ้าง ทั้งที่รายได้ตัวเองไม่พอ แบบนี้คือเห็นช้างขี้ ขี้ตามช้าง",
        exampleTranslation: "看到朋友买昂贵物品就急着跟着买，哪怕自己收入根本不够，这就是盲目攀比。",
        literalMeaning: "看见大象拉屎，自己也跟着像大象那样拉大坨",
        notes: "形象比喻见别人富有奢华便盲目跟风攀比，最终招致经济窘迫。",
        tags: "谚语,攀比,警示"
      },
      {
        id: "idm_027",
        sortOrder: 27,
        thaiPhrase: "ขี่หลังเสือ",
        chineseMeaning: "骑虎难下",
        thaiExample: "เขาลงทุนไปมากแล้ว แม้จะรู้ว่ามีความเสี่ยง ก็หยุดไม่ได้ เพราะตอนนี้เหมือนขี่หลังเสือ จะลงก็ยาก",
        exampleTranslation: "他已经投入了太多资金，即使明知有很大风险也停不下来了，因为现在就像骑在虎背上，想下也难了。",
        literalMeaning: "骑在老虎背上",
        notes: "比喻事情进行到危险或困难境地，已无法中途停手或脱身。",
        tags: "成语,困境,比喻"
      },
      {
        id: "idm_028",
        sortOrder: 28,
        thaiPhrase: "กบในกะลาครอบ",
        chineseMeaning: "井底之蛙（见识短浅）",
        thaiExample: "ถ้าเอาแต่คิดว่าความรู้ของตัวเองเพียงพอ และไม่ยอมเปิดใจเรียนรู้สิ่งใหม่ ๆ สุดท้ายก็จะกลายเป็นกบในกะลาครอบ",
        exampleTranslation: "如果总自以为学识已经足够、不愿敞开心扉学习新事物，最终就会变成井底之蛙。",
        literalMeaning: "扣在椰子壳下的青蛙",
        notes: "泰国对应中文“井底之蛙”的成语，比喻眼界狭隘、孤陋寡闻还自高自大。",
        tags: "成语,见识,警示"
      },
      {
        id: "idm_029",
        sortOrder: 29,
        thaiPhrase: "จับแพะชนแกะ",
        chineseMeaning: "生搬硬套 / 凑合应对 / 滥竽充数",
        thaiExample: "ตำรวจยังหาหลักฐานไม่ได้ แต่กลับรีบจับคนมารับผิด แบบนี้ก็เหมือนจับแพะชนแกะ",
        exampleTranslation: "警方还没找到确凿证据，就急着抓人来顶罪，这简直就是生拉硬拽、胡乱拼凑。",
        literalMeaning: "抓来山羊去与绵羊相撞拼凑",
        notes: "比喻在没有合适办法或资源时，把不搭界的东西生硬拼凑在一起敷衍了事。",
        tags: "成语,比喻,处事"
      }
    ];

    for (const idm of seedIdioms) {
      await run(
        `INSERT INTO tblIdioms (id, sort_order, thai_phrase, chinese_meaning, thai_example, example_translation, literal_meaning, notes, tags, data_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          idm.id,
          idm.sortOrder,
          idm.thaiPhrase,
          idm.chineseMeaning,
          idm.thaiExample,
          idm.exampleTranslation || '',
          idm.literalMeaning || '',
          idm.notes || '',
          idm.tags || '',
          JSON.stringify(idm)
        ]
      );
    }
    console.log("Seeded default 29 idioms into tblIdioms successfully.");
  }

  // Create tblWordBank table dedicated for Pages/appWordBank.html
  await run(`
    CREATE TABLE IF NOT EXISTS tblWordBank (
      id TEXT PRIMARY KEY,
      lesson_id TEXT,
      sort_order INTEGER DEFAULT 0,
      thai TEXT NOT NULL,
      chinese TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  const wordBankCount = await get(`SELECT COUNT(*) as count FROM tblWordBank`);
  if (wordBankCount.count === 0) {
    const rawSeedWords = [
      { "id": 1, "thai": "มองหา", "chinese": "寻找" },
      { "id": 2, "thai": "พันธมิตร", "chinese": "合作伙伴" },
      { "id": 3, "thai": "สถาบัน", "chinese": "机构 / 学院" },
      { "id": 4, "thai": "อนุปริญญา", "chinese": "大专文凭" },
      { "id": 5, "thai": "ค่าคอมมิชชั่น", "chinese": "佣金 / 提成" },
      { "id": 6, "thai": "โบนัส", "chinese": "奖金" },
      { "id": 7, "thai": "สวัสดิการ", "chinese": "福利" },
      { "id": 8, "thai": "รหัสไปรษณีย์", "chinese": "邮政编码" },
      { "id": 9, "thai": "โทรสาร", "chinese": "传真" },
      { "id": 10, "thai": "ผู้ติดต่อ", "chinese": "联系人" },
      { "id": 11, "thai": "เว็บไซต์", "chinese": "网站" },
      { "id": 12, "thai": "โอกาส", "chinese": "机会" },
      { "id": 13, "thai": "มีความสนใจ", "chinese": "有兴趣" },
      { "id": 14, "thai": "จบการศึกษาแล้ว", "chinese": "已毕业" },
      { "id": 15, "thai": "อย่างยิ่ง", "chinese": "非常 / 极其" },
      { "id": 16, "thai": "ทะเยอทะยาน", "chinese": "有雄心 / 有抱负" },
      { "id": 17, "thai": "เชื่อมั่น", "chinese": "坚信 / 确信" },
      { "id": 18, "thai": "ความสามารถ", "chinese": "能力" },
      { "id": 19, "thai": "เงินเดือนพื้นฐาน", "chinese": "基本工资" },
      { "id": 20, "thai": "ความต้องการ", "chinese": "需求 / 要求" },
      { "id": 21, "thai": "เงินเดือน", "chinese": "工资 / 薪水" },
      { "id": 22, "thai": "การล่าม", "chinese": "口译" },
      { "id": 23, "thai": "การประชุม", "chinese": "会议" },
      { "id": 24, "thai": "เอกสาร", "chinese": "文件" },
      { "id": 25, "thai": "บุคลากร", "chinese": "人事 / 员工" },
      { "id": 26, "thai": "คอมพิวเตอร์", "chinese": "计算机 / 电脑" },
      { "id": 27, "thai": "สำนักงาน", "chinese": "办公室" },
      { "id": 28, "thai": "แปล", "chinese": "翻译" },
      { "id": 29, "thai": "ประสานงาน", "chinese": "协调" },
      { "id": 30, "thai": "สื่อสาร", "chinese": "沟通 / 交流" },
      { "id": 31, "thai": "ต่อรอง", "chinese": "谈判 / 协商" },
      { "id": 32, "thai": "ประจำวัน", "chinese": "日常的" },
      { "id": 33, "thai": "การใช้", "chinese": "使用" },
      { "id": 34, "thai": "ตำแหน่ง", "chinese": "职位" },
      { "id": 35, "thai": "ส่วนใหญ่", "chinese": "大部分 / 大多数" },
      { "id": 36, "thai": "พนักงานขาย", "chinese": "销售员" },
      { "id": 37, "thai": "คอมมิชชั่น", "chinese": "佣金" },
      { "id": 38, "thai": "วุฒิการศึกษา", "chinese": "学历" },
      { "id": 39, "thai": "บริการ", "chinese": "服务" },
      { "id": 40, "thai": "ลูกค้า", "chinese": "客户" },
      { "id": 41, "thai": "ประสบการณ์", "chinese": "经验" },
      { "id": 42, "thai": "ประกันสังคม", "chinese": "社会保险" },
      { "id": 43, "thai": "กฎหมาย", "chinese": "法律" },
      { "id": 44, "thai": "เปิดรับสมัคร", "chinese": "开放招聘" },
      { "id": 45, "thai": "รักษา", "chinese": "保持 / 维护" },
      { "id": 46, "thai": "ศึกษา", "chinese": "学习 / 研究" },
      { "id": 47, "thai": "ทดลอง", "chinese": "试用 / 试验" },
      { "id": 48, "thai": "แก้ไข", "chinese": "修改 / 纠正" },
      { "id": 49, "thai": "ซื่อสัตย์", "chinese": "诚实" },
      { "id": 50, "thai": "สแกน", "chinese": "扫描" },
      { "id": 51, "thai": "เฉพาะหน้า", "chinese": "应变 / 临场" },
      { "id": 52, "thai": "ประจำปี", "chinese": "年度的" },
      { "id": 53, "thai": "สุภาพ", "chinese": "礼貌" },
      { "id": 54, "thai": "วุฒิป.ตรี", "chinese": "学士学历" },
      { "id": 55, "thai": "ทำงานเป็นทีม", "chinese": "团队合作" },
      { "id": 56, "thai": "รับผิดชอบ", "chinese": "负责" },
      { "id": 57, "thai": "สมัคร", "chinese": "申请" },
      { "id": 58, "thai": "พิเศษ", "chinese": "特别 / 特殊" },
      { "id": 59, "thai": "พิจารณา", "chinese": "考虑 / 审阅" },
      { "id": 60, "thai": "บุคลิกภาพ", "chinese": "个性 / 气质" },
      { "id": 61, "thai": "มนุษยสัมพันธ์", "chinese": "人际关系" },
      { "id": 62, "thai": "สัมพันธ์", "chinese": "关联 / 联系" },
      { "id": 63, "thai": "ความซื่อสัตย์", "chinese": "诚实度" },
      { "id": 64, "thai": "คิดบวก", "chinese": "积极思维" },
      { "id": 65, "thai": "ความรับผิดชอบ", "chinese": "责任感" },
      { "id": 66, "thai": "รักษาเวลา", "chinese": "守时" },
      { "id": 67, "thai": "ทักษะ", "chinese": "技能" },
      { "id": 68, "thai": "อกเห็นใจ", "chinese": "同理心" },
      { "id": 69, "thai": "ปริญญาตรี", "chinese": "学士学位" },
      { "id": 70, "thai": "จำกัด", "chinese": "限制" },
      { "id": 71, "thai": "ส่วนหนึ่ง", "chinese": "一部分" },
      { "id": 72, "thai": "ความท้าทาย", "chinese": "挑战" },
      { "id": 73, "thai": "พร้อม", "chinese": "准备好" },
      { "id": 74, "thai": "พลัง", "chinese": "能量 / 动力" },
      { "id": 75, "thai": "ตกลง", "chinese": "同意 / 达成协议" },
      { "id": 76, "thai": "ภาษาจีนกลาง", "chinese": "普通话 / 中文" },
      { "id": 77, "thai": "กำหนด", "chinese": "规定 / 设定" },
      { "id": 78, "thai": "ตำแหน่งงาน", "chinese": "工作岗位" },
      { "id": 79, "thai": "การสร้าง", "chinese": "创建 / 建设" },
      { "id": 80, "thai": "มั่นใจ", "chinese": "自信" },
      { "id": 81, "thai": "กล้าที่จะ", "chinese": "敢于" },
      { "id": 82, "thai": "สำเร็จ", "chinese": "成功" },
      { "id": 83, "thai": "จบ", "chinese": "结束 / 毕业" },
      { "id": 84, "thai": "ผู้สมัคร", "chinese": "申请人" },
      { "id": 85, "thai": "สอน", "chinese": "教导 / 教学" },
      { "id": 86, "thai": "สำหรับ", "chinese": "为了 / 对于" },
      { "id": 87, "thai": "รับสมัคร", "chinese": "招聘" },
      { "id": 88, "thai": "ประกาศ", "chinese": "公告 / 声明" }
    ];

    const targetLessonId = "lesson_001";
    for (let i = 0; i < rawSeedWords.length; i++) {
      const item = rawSeedWords[i];
      const id = `wb_${targetLessonId}_${String(i + 1).padStart(3, '0')}`;
      const data = {
        id,
        lessonId: targetLessonId,
        order: item.id || (i + 1),
        thai: item.thai,
        chinese: item.chinese
      };
      await run(
        `INSERT INTO tblWordBank (id, lesson_id, sort_order, thai, chinese, data_json) VALUES (?, ?, ?, ?, ?, ?)`,
        [id, targetLessonId, data.order, data.thai, data.chinese, JSON.stringify(data)]
      );
    }
    console.log("Seeded default 88 words into tblWordBank successfully.");
  }

  // ==========================================
  // Literature Analysis Works & User Progress Tables
  // ==========================================
  await run(`
    CREATE TABLE IF NOT EXISTS works (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exercise_id TEXT UNIQUE NOT NULL,
      genre TEXT NOT NULL,
      title TEXT NOT NULL,
      author TEXT,
      description TEXT,
      content_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS user_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      exercise_id TEXT NOT NULL,
      answers_json TEXT NOT NULL,
      score REAL DEFAULT 0,
      tutor_feedback TEXT,
      updated_at TEXT DEFAULT (datetime('now', 'localtime')),
      UNIQUE(user_id, exercise_id)
    )
  `);

  const worksCount = await get(`SELECT COUNT(*) as count FROM works`);
  if (worksCount.count === 0) {
    console.log("Seeding default multi-genre literature exercises in works table...");

    const fictionExercise = {
      exercise_id: "behind_the_painting_full_01",
      genre: "fiction",
      title: "ข้างหลังภาพ (Behind the Painting)",
      author: "ศรีบูรพา (Kulap Saipradit)",
      target_level: "A2 to B1",
      description: "《后面画》全本习题精细化标准 JSON 实例数据，完整涵盖文学要素分析、讨论思考题及 5W1H 语法细读练习。",
      sections: [
        {
          section_number: 1,
          section_title: "ภาคที่ 1: การวิเคราะห์องค์ประกอบวรรณกรรม",
          section_title_zh: "第一部分：文学要素分析",
          instructions: "ให้นักศึกษาเติมข้อมูลเพื่อวิเคราะห์องค์ประกอบของวรรณกรรมเรื่อง \"ข้างหลังภาพ\"",
          content: {
            work_title: "ข้างหลังภาพ (Behind the Painting)",
            conflict: {
              "1.1_type": "ความขัดแย้งระหว่างมนุษย์กับตัวเอง (Man against himself) และความขัดแย้งระหว่างมนุษย์กับสภาพสังคม/ศีลธรรม (Man against society/morals)",
              "1.2_details": "ม.ร.ว.กีรติแต่งงานแล้วกับพระยาอธิการบดี แต่เธอพบรักแท้กับนพพร เธอมีความขัดแย้งในใจอย่างมากเพราะเธอต้องข่มใจและรักษาเกียรติยศ ศีลธรรม และชื่อเสียงตามประเพณีไทย ส่วนนพพรรักกีรติมากในตอนแรก แต่เวลาและภาระหน้าที่ทำให้ความรักของเขาเปลี่ยนไป",
              "1.3_ending": "จบแบบโศกนาฏกรรม (Tragic ending) ม.ร.ว.กีรติเสียชีวิตด้วยโรควณโรคหลังจากนพพรแต่งงานใหม่ได้ไม่นาน ทิ้งไว้เพียงภาพเขียนและข้อความระลึกถึงความรักของทั้งสองคน"
            },
            characters: {
              "2.1_main_characters": [
                {
                  name: "ม.ร.ว.กีรติ",
                  description: "ราชนิกุลหญิงอายุ 35 ปี ที่สวย อ่อนหวาน รักศิลปะ และตามหารักแท้"
                },
                {
                  name: "นพพร",
                  description: "นิสิตหนุ่มไทยอายุ 22 ปี ที่ไปเรียนต่อที่ประเทศญี่ปุ่น มีอารมณ์รักที่ร้อนแรงในตอนแรกแต่เปลี่ยนไปตามกาลเวลา"
                }
              ],
              "2.2_supporting_characters": [
                {
                  name: "พระยาอธิการบดี (ท่านเจ้าคุณ)",
                  description: "ข้าราชการอายุ 50 ปี เป็นพ่อหม้ายลูกติด 2 คน ซึ่งเป็นสามีของ ม.ร.ว.กีรติ"
                }
              ],
              "2.3_minor_characters": [
                "บิดาของนพพร (ผู้หาคู่หมั้นให้)",
                "คู่หมั้นของนพพร",
                "แพทย์และพยาบาล (ผู้ดูแลกีรติตอนป่วย)"
              ]
            },
            setting_and_atmosphere: {
              locations: [
                "ประเทศญี่ปุ่น (เช่น ภูเขามิตาเกะ โตเกียว)",
                "ประเทศไทย (สยาม)"
              ],
              time_period: "ประมาณปี พ.ศ. 2480",
              atmosphere: "บรรยากาศในญี่ปุ่นมีความสวยงาม โรแมนติก อบอุ่น และเป็นอิสระ ส่วนบรรยากาศในประเทศไทยมีความเงียบสงบ เคร่งครัดในกฎเกณฑ์และประเพณีทางสังคม"
            },
            key_concept: "\"ไม่มีใครที่จะเพียบพร้อมทุกอย่างในชีวิต\" ม.ร.ว.กีรติมีฐานะ เงินทอง และความงาม แต่เธอขาดความรักที่แท้จริง และเมื่อเธอพบรักแท้ รักนั้นก็เกิดขึ้นผิดเวลาและไม่สามารถสมหวังได้",
            social_issues: [
              "สถานภาพสตรีในอดีต: ผู้หญิงไม่มีโอกาสเลือกชีวิตของตนเองมากนัก และมักต้องแต่งงานเพื่อความมั่นคงและเกียรติยศมากกว่าความรัก",
              "ศีลธรรมและประเพณี: สังคมไทยในอดีตให้ความสำคัญกับความซื่อสัตย์ในชีวิตสมรสอย่างมาก",
              "บทบาทของชายหนุ่ม: ชายหนุ่มในสังคมมีหน้าที่สำคัญคือการเรียน การทำงาน และการสร้างฐานะเพื่อครอบครัว"
            ]
          }
        },
        {
          section_number: 2,
          section_title: "ภาคที่ 2: คำถามชวนคิดเพื่อการอภิปราย",
          section_title_zh: "第二部分：讨论与思考题",
          instructions: "ให้นักศึกษาร่วมกันอภิปรายและตอบคำถามสำคัญจากบทเรียนเกี่ยวกับตัวละครหลักทั้งสองคน",
          topics: [
            {
              topic_id: "topic_1",
              topic_name: "เกี่ยวกับ \"นพพร\"",
              questions: [
                {
                  q_number: 1,
                  question: "นพพรรักจริงหรือไม่?",
                  answer: "นพพรรัก ม.ร.ว.กีรติ จริงในตอนแรก แต่เป็นความรักแบบเด็กหนุ่ม (อายุ 22 ปี) ที่มีความตื่นเต้น ร้อนแรง และเป็นรักครั้งแรกของเขา แต่ความรักนี้ไม่ใช่รักแท้ที่มั่นคงถาวร เพราะเมื่อเวลาและสิ่งแวดล้อมเปลี่ยนไป ความรักก็จางหายไปจนเหลือเพียงความรู้สึกแบบพี่สาว"
                },
                {
                  q_number: 2,
                  question: "ทำไมนพพรเปลี่ยนใจ?",
                  answer: "เพราะเวลา 6 ปีในประเทศญี่ปุ่นทำให้นพพรเติบโตขึ้นเป็นผู้ใหญ่ เขามีหน้าที่การงานที่ต้องรับผิดชอบ และต้องคิดถึงอนาคตและการสร้างตัวตามค่านิยมของสังคม ความรักในอดีตจึงกลายเป็นเพียงความทรงจำ"
                }
              ]
            },
            {
              topic_id: "topic_2",
              topic_name: "เกี่ยวกับ \"ม.ร.ว.กีรติ\"",
              questions: [
                {
                  q_number: 1,
                  question: "ทำไม ม.ร.ว.กีรติ ต้องแต่งงาน?",
                  answer: "เพราะเธอมีอายุย่างเข้า 35 ปีแล้ว ซึ่งถือเป็นสาวเทื้อในยุคนั้น และเธอไม่มีความหวังว่าจะได้เจอผู้ชายที่ดีกว่านี้ อีกทั้งเธออยากเห็นโลกภายนอกที่กว้างขึ้น หลังจากที่ต้องใช้ชีวิตอยู่ในกรอบแคบๆ มานาน 35 ปี"
                },
                {
                  q_number: 2,
                  question: "ม.ร.ว.กีรติ รักนพพรหรือไม่?",
                  answer: "ม.ร.ว.กีรติรักนพพรอย่างแท้จริงและมั่นคงจนถึงลมหายใจสุดท้าย แต่เธอได้รับการอบรมสั่งสอนมาอย่างดี ทำให้เธอต้องข่มใจและเก็บความรู้สึกนั้นไว้ในใจโดยไม่แสดงออกให้นพพรรู้ เพื่อรักษาเกียรติของสามีและตัวเธอเอง"
                }
              ]
            }
          ]
        },
        {
          section_number: 3,
          section_title: "ภาคที่ 3: แบบฝึกหัดหลักภาษา 5W1H",
          section_title_zh: "第三部分：5W1H 语法与细读练习",
          instructions: "เรียนรู้องค์ประกอบพื้นฐานของประโยคเพื่อช่วยในการอ่านและเขียนวิเคราะห์",
          example_sentence: {
            sentence: "\"น้องกินข้าวต้มร้อนๆ ที่ห้องครัวเมื่อเช้า\"",
            who: "น้อง",
            what: "กินข้าวต้ม",
            where: "ที่ห้องครัว",
            when: "เมื่อเช้า",
            how: "ร้อนๆ"
          },
          exercises: [
            {
              exercise_id: "ex_1",
              sentence: "\"พระยาอธิการบดีพาเธอไปเที่ยวประเทศญี่ปุ่น\"",
              source_ref: "จากเนื้อเรื่องหน้า 4-1",
              who: "พระยาอธิการบดี (ท่านเจ้าคุณ)",
              what: "พาเธอ (ม.ร.ว.กีรติ) ไปเที่ยว",
              where: "ประเทศญี่ปุ่น",
              when: "หลังจากแต่งงานใหม่ๆ / ในอดีต",
              how: "เดินทางท่องเที่ยวเพื่อเปิดหูเปิดตาและหาความสุข"
            },
            {
              exercise_id: "ex_2",
              sentence: "\"นพพรกลับสยามเมื่อเวลาผ่านไป 6 ปี\"",
              source_ref: "ปรับปรุงจากประโยคในหน้า 4-2",
              who: "นพพร",
              what: "กลับสยาม (กลับประเทศไทย)",
              where: "ประเทศไทย (สยาม)",
              when: "หลังจากสำเร็จการศึกษาและฝึกงาน / เมื่อเวลาผ่านไป 6 ปี",
              how: "กลับมาเพื่อทำงานและตั้งตัว โดยไม่มีความรู้สึกรัก ม.ร.ว.กีรติ แบบคนรักอีกต่อไป"
            }
          ]
        }
      ]
    };

    const poetryExercise = {
      exercise_id: "lit_poetry_01",
      genre: "poetry",
      title: "ฉันจึงมาหาความหมาย (Chanthu Ma Ha Khwam Mai) / 示例诗歌",
      author: "วิทยากร เชียงกูล (Witthayakon Chiangkul)",
      description: "诗歌分析模板（侧重意象、韵律与隐喻）",
      sections: [
        {
          section_number: 1,
          section_title: "การวิเคราะห์องค์ประกอบบทกวี (诗歌要素分析)",
          content: {
            theme_and_tone: {
              main_theme: "การแสวงหาความหมายของชีวิตและคุณค่าความเป็นมนุษย์",
              tone: "มุ่งมั่น, สิ้นหวังแต่ไม่ยอมแพ้, สะท้อนสังคม"
            },
            imagery_and_symbolism: [
              {
                element: "ทางเดิน / รอยเท้า",
                meaning: "การเดินทางของชีวิตและการแสวงหา"
              },
              {
                element: "ความมืด / แสงสว่าง",
                meaning: "ความไม่รู้/ความกดดัน กับความหวังและปัญญา"
              }
            ],
            poetic_devices: [
              {
                device: "Metaphor (การเปรียบเทียบ)",
                description: "เปรียบชีวิตเหมือนการเดินทางไกลที่ไร้จุดสิ้นสุด"
              },
              {
                device: "Repetition (การซ้ำคำ)",
                description: "เพื่อเน้นย้ำความตั้งใจและการวนเวียนของคำถามในใจ"
              }
            ]
          }
        },
        {
          section_number: 2,
          section_title: "คำถามชวนคิดเพื่อการอภิปราย (诗歌意义与赏析)",
          topics: [
            {
              topic_name: "การตีความบทกวี",
              questions: [
                {
                  q_no: 1,
                  question: "กวีพยายามสื่อถึงอะไรผ่านการเดินทาง?",
                  answer: "การตั้งคำถามต่อระบบสังคมและการค้นหาเป้าหมายที่แท้จริงของชีวิตมนุษย์"
                }
              ]
            }
          ]
        },
        {
          section_number: 3,
          section_title: "แบบฝึกหัดหลักภาษา 5W1H (语法与文本细读)",
          exercises: [
            {
              sentence: "ฉันมาที่นี่เพื่อค้นหาความหมายของชีวิตที่แท้จริง",
              who: "ฉัน (ผู้แสวงหา)",
              what: "มาเพื่อค้นหาความหมายของชีวิต",
              where: "ที่นี่ (มหาวิทยาลัย/โลกกว้าง)",
              when: "ในวัยหนุ่มสาว",
              how: "ด้วยความมุ่งมั่นและตั้งคำถามต่อสังคม"
            }
          ]
        }
      ]
    };

    const essayExercise = {
      exercise_id: "lit_essay_01",
      genre: "essay",
      title: "ตัวอย่างบทความแสดงทัศนะ / 散文/议论文",
      author: "นามปากกา / นักเขียน",
      description: "散文与随笔分析模板（侧重作者观点、论证与文风）",
      sections: [
        {
          section_number: 1,
          section_title: "การวิเคราะห์โครงสร้างบทความ (散文/随笔要素分析)",
          content: {
            central_argument: "คุณค่าของการใช้ชีวิตเรียบง่ายท่ามกลางสังคมสมัยใหม่ที่เร่งรีบ",
            author_perspective: "ผู้เขียนมองว่าเทคโนโลยีทำให้มนุษย์ห่างเหินกันและสูญเสียความสงบภายใน",
            tone_and_style: "อบอุ่น, โน้มน้าวใจ, ใช้ภาษาเชิงพรรณนาเปรียบเทียบ (Descriptive & Reflective)",
            key_motifs: [
              "ธรรมชาติ",
              "เวลา",
              "ความเงียบสงบ"
            ]
          }
        },
        {
          section_number: 2,
          section_title: "คำถามชวนคิดเพื่อการอภิปราย (散文观点讨论)",
          topics: [
            {
              topic_name: "การวิเคราะห์แนวคิดผู้เขียน",
              questions: [
                {
                  q_no: 1,
                  question: "ข้อโต้แย้งหลักของผู้เขียนคืออะไร และคุณเห็นด้วยหรือไม่?",
                  answer: "วิพากษ์วิจารณ์ทุนนิยมและเทคโนโลยีที่ทำลายความสัมพันธ์ในครอบครัว"
                }
              ]
            }
          ]
        },
        {
          section_number: 3,
          section_title: "แบบฝึกหัดหลักภาษา 5W1H (语法与文本细读)",
          exercises: [
            {
              sentence: "ผู้เขียนเตือนใจให้พวกเราหันกลับมาดูแลความสัมพันธ์ในครอบครัว",
              who: "ผู้เขียน",
              what: "เตือนใจให้หันกลับมาดูแลความสัมพันธ์",
              where: "ในครอบครัวและบ้านเกิด",
              when: "ก่อนที่เวลาจะสายเกินไป",
              how: "ด้วยการลดเวลาใช้อุปกรณ์ดิจิทัลและเปิดใจรับฟังกัน"
            }
          ]
        }
      ]
    };

    const dramaExercise = {
      exercise_id: "lit_drama_01",
      genre: "drama",
      title: "มัทนะพาธา (Madhanabadha / The Legend of the Rose)",
      author: "พระบาทสมเด็จพระมงกุฎเกล้าเจ้าอยู่หัว (Rama VI)",
      description: "经典诗剧分析模板（拉玛六世御作泰语古典诗剧《玫瑰的传说》）",
      sections: [
        {
          section_number: 1,
          section_title: "การวิเคราะห์องค์ประกอบบทละคร (戏剧文学要素分析)",
          content: {
            conflict: {
              type: "ความรักที่ไม่สมหวังและความขัดแย้งของอำนาจ (Unrequited love & power struggle)",
              details: "สุเทษณ์เทพบุตรหลงรักนางฟ้ามัทนาแต่นางไม่รับรัก จึงสาปนางให้ไปเกิดเป็นดอกกุหลาบบนโลกมนุษย์",
              ending: "โศกนาฏกรรม (Tragic ending): มัทนาถูกเข้าใจผิดและปฏิเสธรักสุเทษณ์อีกครั้ง จนถูกสาปเป็นดอกกุหลาบตลอดกาล"
            },
            characters: {
              main_characters: [
                {
                  name: "มัทนา",
                  role: "ตัวละครเอกหญิง (นางฟ้าผู้ซื่อสัตย์ต่อใจตน)",
                  description: "หญิงสาวผู้มีความงดงามบริสุทธิ์และยึดมั่นในความจริงใจ ไม่ยอมรับรักที่ตนไม่ได้รู้สึก"
                },
                {
                  name: "สุเทษณ์",
                  role: "ตัวละครเอกชาย (เทพบุตร)",
                  description: "เทพบุตรผู้มีอำนาจแต่ลุ่มหลงในตัณหา ถือทิฐิและใช้อำนาจลงโทษเมื่อผิดหวัง"
                },
                {
                  name: "ท้าวชัยเสน",
                  role: "กษัตริย์มนุษย์",
                  description: "กษัตริย์เมืองหัสตินาปุระผู้พบรักกับมัทนา แต่หูเบาและหลงเชื่อคำใส่ร้าย"
                }
              ],
              supporting_characters: [
                {
                  name: "มายาวิน",
                  role: "วิทยาธรผู้ใช้เวทมนตร์",
                  description: "ผู้ร่ายมนตร์สะกดมัทนามาพบสุเทษณ์"
                }
              ]
            },
            setting_and_atmosphere: {
              locations: [
                "สวรรค์ (วิมานสุเทษณ์)",
                "ป่าหิมพานต์",
                "พระราชวังหัสตินาปุระ"
              ],
              time_period: "ยุคโบราณในเทพนิยาย",
              atmosphere: "ขลัง โรแมนติก และแฝงความโศกเศร้าลึกซึ้ง"
            },
            key_concept: "ความรักหากเจือปนด้วยความหลงและการบังคับ ย่อมนำมาซึ่งความทุกข์ระทมดั่งหนามกุหลาบ"
          }
        },
        {
          section_number: 2,
          section_title: "คำถามชวนคิดเพื่อการอภิปราย (戏剧冲突与人物动机)",
          topics: [
            {
              topic_name: "การวิเคราะห์แก่นเรื่องและตัวละคร",
              questions: [
                {
                  q_no: 1,
                  question: "ทำไมมัทนาจึงยอมถูกสาปแทนที่จะยอมรับรักสุเทษณ์?",
                  answer: "เพราะมัทนายึดมั่นในความสัจจะจริงใจ ไม่ยอมโกหกหัวใจตนเองเพื่อแลกกับความสุขสบายบนสวรรค์"
                },
                {
                  q_no: 2,
                  question: "ชื่อ 'มัทนะพาธา' สื่อความหมายถึงอะไรในแง่ของความรัก?",
                  answer: "หมายถึง 'ความเจ็บปวดอันเกิดจากความรัก' สะท้อนว่าความรักที่ขาดปัญญาย่อมนำมาซึ่งความทรมาน"
                }
              ]
            }
          ]
        },
        {
          section_number: 3,
          section_title: "แบบฝึกหัดหลักภาษา 5W1H (语法与文本细读)",
          exercises: [
            {
              sentence: "สุเทษณ์สาปนางมัทนาให้จุติลงไปเป็นดอกกุหลาบในป่าหิมพานต์",
              who: "สุเทษณ์",
              what: "สาปนางมัทนาให้จุติเป็นดอกกุหลาบ",
              where: "ในป่าหิมพานต์",
              when: "หลังจากนางปฏิเสธความรัก",
              how: "ด้วยความโกรธแค้นและอำนาจเทวฤทธิ์"
            }
          ]
        }
      ]
    };

    const multiGenrePackage = {
      exercise_id: "intro_to_literature_multigenre_01",
      course: "Introduction to Literature",
      description: "支持多种文学体裁（小说、散文、诗歌、戏剧）的通用文学分析与练习 JSON 结构",
      supported_genres: [
        "fiction",
        "poetry",
        "essay",
        "drama"
      ],
      exercises: [
        fictionExercise,
        poetryExercise,
        essayExercise,
        dramaExercise
      ]
    };

    // 1. Insert multi-genre bundle
    await run(
      `INSERT INTO works (exercise_id, genre, title, author, description, content_json) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        multiGenrePackage.exercise_id,
        "multigenre",
        "Introduction to Literature (通用多体裁合集)",
        "Various Authors",
        multiGenrePackage.description,
        JSON.stringify(multiGenrePackage)
      ]
    );

    // 2. Insert individual works for direct exercise access
    const individualWorks = [fictionExercise, poetryExercise, essayExercise, dramaExercise];
    for (const w of individualWorks) {
      await run(
        `INSERT INTO works (exercise_id, genre, title, author, description, content_json) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          w.exercise_id,
          w.genre,
          w.title,
          w.author,
          w.description,
          JSON.stringify(w)
        ]
      );
    }
    console.log("Seeded multi-genre literature works successfully into 'works' table.");
  }

  // -------------------------------------------------------------
  // Dictation App: Collections, Words & SM-2 Review Tables
  // -------------------------------------------------------------
  await run(`
    CREATE TABLE IF NOT EXISTS dictation_collections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      tags TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS dictation_words (
      id TEXT PRIMARY KEY,
      thai_word TEXT NOT NULL,
      phonetic TEXT,
      meaning TEXT NOT NULL,
      audio_url TEXT,
      examples_json TEXT NOT NULL DEFAULT '[]',
      repetition INTEGER NOT NULL DEFAULT 0,
      interval_days INTEGER NOT NULL DEFAULT 1,
      easiness_factor REAL NOT NULL DEFAULT 2.5,
      next_review_date TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS dictation_collection_words (
      collection_id TEXT NOT NULL,
      word_id TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      PRIMARY KEY (collection_id, word_id),
      FOREIGN KEY (collection_id) REFERENCES dictation_collections(id) ON DELETE CASCADE,
      FOREIGN KEY (word_id) REFERENCES dictation_words(id) ON DELETE CASCADE
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS dictation_review_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word_id TEXT NOT NULL,
      collection_id TEXT,
      rating INTEGER NOT NULL,
      prev_repetition INTEGER,
      new_repetition INTEGER,
      prev_interval INTEGER,
      new_interval INTEGER,
      prev_easiness_factor REAL,
      new_easiness_factor REAL,
      reviewed_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // Seed default collections & words if table is empty
  const existingColCount = await get(`SELECT COUNT(*) as count FROM dictation_collections`);
  if (existingColCount && existingColCount.count === 0) {
    console.log("Seeding initial Dictation collections and vocabulary...");

    const initialCollections = [
      {
        id: "col_food_01",
        name: "Unit 1: Food & Dining (อาหารและเครื่องดื่ม)",
        description: "日常饮食、特色泰餐、饮料与餐厅点餐常用核心词汇",
        tags: "Food,Dining,Daily",
        words: [
          {
            id: "w_food_01",
            thaiWord: "ข้าวผัด",
            phonetic: "kâao-pàt",
            meaning: "炒饭",
            audioUrl: "",
            examples: [
              { thai: "ผมชอบกินข้าวผัดกุ้ง", translation: "我喜欢吃鲜虾炒饭。" },
              { thai: "ข้าวผัดจานนี้รสชาติอร่อยมาก", translation: "这盘炒饭味道非常好吃。" }
            ]
          },
          {
            id: "w_food_02",
            thaiWord: "ต้มยำกุ้ง",
            phonetic: "dtôm-yam-gûng",
            meaning: "冬阴功汤 / 酸辣虾汤",
            audioUrl: "",
            examples: [
              { thai: "ต้มยำกุ้งเป็นอาหารไทยที่มีชื่อเสียงมาก", translation: "冬阴功汤是非常著名的泰国菜。" },
              { thai: "ขอต้มยำกุ้งหม้อไฟหนึ่งที่ครับ", translation: "请来一份冬阴功虾火锅。" }
            ]
          },
          {
            id: "w_food_03",
            thaiWord: "กาแฟเย็น",
            phonetic: "gaa-fae-yen",
            meaning: "冰咖啡",
            audioUrl: "",
            examples: [
              { thai: "ตอนบ่ายผมชอบดื่มกาแฟเย็น", translation: "下午我喜欢喝冰咖啡。" },
              { thai: "ขอกาแฟเย็นหวานน้อยหนึ่งแก้ว", translation: "请来一杯微糖的冰咖啡。" }
            ]
          },
          {
            id: "w_food_04",
            thaiWord: "ผลไม้",
            phonetic: "pǒn-lá-mái",
            meaning: "水果",
            audioUrl: "",
            examples: [
              { thai: "ประเทศไทยมีผลไม้สดตลอดทั้งปี", translation: "泰国一年四季都有新鲜水果。" },
              { thai: "การกินผลไม้ทุกวันดีต่อสุขภาพ", translation: "每天吃水果对身体有益。" }
            ]
          },
          {
            id: "w_food_05",
            thaiWord: "อร่อย",
            phonetic: "à-ròi",
            meaning: "好吃 / 美味",
            audioUrl: "",
            examples: [
              { thai: "อาหารร้านนี้อร่อยและราคาไม่แพง", translation: "这家店的饭菜既好吃又实惠。" },
              { thai: "แม่ทำกับข้าวอร่อยที่สุด", translation: "妈妈做的饭菜最好吃。" }
            ]
          }
        ]
      },
      {
        id: "col_daily_02",
        name: "Unit 2: Daily Greetings & Manners (การทักทายและมารยาท)",
        description: "日常交际、礼貌问候与感谢致歉高频词汇",
        tags: "Greetings,Conversation,Manners",
        words: [
          {
            id: "w_daily_01",
            thaiWord: "สวัสดี",
            phonetic: "sà-wàt-dee",
            meaning: "你好 / 再见",
            audioUrl: "",
            examples: [
              { thai: "สวัสดีตอนเช้าครับทุกคน", translation: "大家早上好。" },
              { thai: "สวัสดีครับ ยินดีที่ได้รู้จัก", translation: "你好，很高兴认识你。" }
            ]
          },
          {
            id: "w_daily_02",
            thaiWord: "ขอบคุณ",
            phonetic: "kòop-kun",
            meaning: "谢谢 / 感谢",
            audioUrl: "",
            examples: [
              { thai: "ขอบคุณมากสำหรับคำแนะนำที่ดี", translation: "非常感谢您的宝贵建议。" },
              { thai: "ขอบคุณที่มาร่วมงานวันนี้นะครับ", translation: "感谢您今天来参加活动。" }
            ]
          },
          {
            id: "w_daily_03",
            thaiWord: "ขอโทษ",
            phonetic: "kɔ̌ɔ-tôot",
            meaning: "对不起 / 抱歉",
            audioUrl: "",
            examples: [
              { thai: "ขอโทษครับ ผมมาสายไปหน่อย", translation: "对不起，我稍微来迟了一点。" },
              { thai: "ขอโทษนะคะ ช่วยบอกทางหน่อยได้ไหม", translation: "不好意思，能帮我指一下路吗？" }
            ]
          },
          {
            id: "w_daily_04",
            thaiWord: "สบายดี",
            phonetic: "sà-baai-dee",
            meaning: "很好 / 身体安好",
            audioUrl: "",
            examples: [
              { thai: "ช่วงนี้คุณสบายดีไหมครับ", translation: "你最近身体和生活都好吗？" },
              { thai: "ผมสบายดีมาก ขอบคุณที่เป็นห่วง", translation: "我一切都很好，谢谢关心。" }
            ]
          },
          {
            id: "w_daily_05",
            thaiWord: "โรงเรียน",
            phonetic: "roong-rian",
            meaning: "学校",
            audioUrl: "",
            examples: [
              { thai: "เด็กๆ เดินไปโรงเรียนในตอนเช้า", translation: "早晨孩子们步行去学校。" },
              { thai: "โรงเรียนของเรามีห้องสมุดขนาดใหญ่", translation: "我们的学校有一个大型图书馆。" }
            ]
          }
        ]
      },
      {
        id: "col_travel_03",
        name: "Unit 3: Travel & Commute (การเดินทางและการท่องเที่ยว)",
        description: "出行交通、乘车出行与酒店旅游实用词汇",
        tags: "Travel,Transport,Hotel",
        words: [
          {
            id: "w_travel_01",
            thaiWord: "สนามบิน",
            phonetic: "sà-nǎam-bin",
            meaning: "机场 / 飞机场",
            audioUrl: "",
            examples: [
              { thai: "เราควรไปถึงสนามบินก่อนเวลาเดินทาง", translation: "我们应该在出发时间前到达机场。" },
              { thai: "สนามบินสุวรรณภูมิมีความทันสมัยมาก", translation: "素万那普机场非常具有现代感。" }
            ]
          },
          {
            id: "w_travel_02",
            thaiWord: "รถไฟ",
            phonetic: "rót-fai",
            meaning: "火车",
            audioUrl: "",
            examples: [
              { thai: "นั่งรถไฟชมวิวธรรมชาติเพลินดี", translation: "坐火车欣赏自然风景非常惬意。" },
              { thai: "รถไฟขบวนนี้จะออกในอีกสิบนาที", translation: "这趟列车将在10分钟后发车。" }
            ]
          },
          {
            id: "w_travel_03",
            thaiWord: "โรงแรม",
            phonetic: "roong-raem",
            meaning: "酒店 / 宾馆",
            audioUrl: "",
            examples: [
              { thai: "โรงแรมนี้ตั้งอยู่ริมแม่น้ำเจ้าพระยา", translation: "这家酒店坐落在湄南河畔。" },
              { thai: "เราจองห้องพักในโรงแรมไว้ล่วงหน้า", translation: "我们提前预订了酒店的客房。" }
            ]
          },
          {
            id: "w_travel_04",
            thaiWord: "ซื้อของ",
            phonetic: "sʉ́ʉ-kɔ̌ɔng",
            meaning: "买东西 / 购物",
            audioUrl: "",
            examples: [
              { thai: "วันหยุดนี้ไปซื้อของที่ห้างสรรพสินค้า", translation: "这个周末去商场购物买东西。" },
              { thai: "คุณแม่ชอบซื้อของสดจากตลาดเช้า", translation: "妈妈喜欢在早市买新鲜食材。" }
            ]
          },
          {
            id: "w_travel_05",
            thaiWord: "แผนที่",
            phonetic: "pɛ̌ɛn-tîi",
            meaning: "地图",
            audioUrl: "",
            examples: [
              { thai: "ก่อนออกเดินทางควรเปิดดูแผนที่ให้ชัดเจน", translation: "出行前应先仔细查看地图。" },
              { thai: "แผนที่ท่องเที่ยวกระดาษดูง่ายและสะดวก", translation: "纸质旅游地图看起来简单又方便。" }
            ]
          }
        ]
      }
    ];

    const nowIso = new Date().toISOString();
    for (const col of initialCollections) {
      await run(
        `INSERT INTO dictation_collections (id, name, description, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [col.id, col.name, col.description, col.tags, nowIso, nowIso]
      );

      let order = 1;
      for (const w of col.words) {
        // Insert word
        await run(
          `INSERT OR REPLACE INTO dictation_words (id, thai_word, phonetic, meaning, audio_url, examples_json, repetition, interval_days, easiness_factor, next_review_date, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, 1, 2.5, ?, ?, ?)`,
          [
            w.id,
            w.thaiWord,
            w.phonetic,
            w.meaning,
            w.audioUrl || "",
            JSON.stringify(w.examples || []),
            nowIso,
            nowIso,
            nowIso
          ]
        );

        // Associate with collection
        await run(
          `INSERT OR REPLACE INTO dictation_collection_words (collection_id, word_id, sort_order, created_at)
           VALUES (?, ?, ?, ?)`,
          [col.id, w.id, order++, nowIso]
        );
      }
    }
    console.log("Dictation collections and vocabulary seeded successfully.");
  }

  // -------------------------------------------------------------
  // Sentence Translation App: Groups, Items & SM-2 Review Tables
  // -------------------------------------------------------------
  await run(`
    CREATE TABLE IF NOT EXISTS sentence_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS sentence_items (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      thai_word TEXT NOT NULL,
      chinese_sentence TEXT NOT NULL,
      reference_thai TEXT NOT NULL,
      target_word_used TEXT NOT NULL,
      other_vocab_notes TEXT NOT NULL DEFAULT '[]',
      thai_word_count INTEGER DEFAULT 0,
      notes TEXT,
      raw_json TEXT,
      sort_order INTEGER DEFAULT 0,
      repetition INTEGER NOT NULL DEFAULT 0,
      interval_days INTEGER NOT NULL DEFAULT 1,
      easiness_factor REAL NOT NULL DEFAULT 2.5,
      next_review_date TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      last_reviewed_at TEXT,
      last_score INTEGER,
      review_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (group_id) REFERENCES sentence_groups(id) ON DELETE CASCADE
    )
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_sentence_items_group_id ON sentence_items(group_id)
  `);
  await run(`
    CREATE INDEX IF NOT EXISTS idx_sentence_items_next_review ON sentence_items(next_review_date)
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS sentence_review_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sentence_id TEXT NOT NULL,
      group_id TEXT,
      score INTEGER NOT NULL,
      prev_repetition INTEGER,
      new_repetition INTEGER,
      prev_interval INTEGER,
      new_interval INTEGER,
      prev_easiness_factor REAL,
      new_easiness_factor REAL,
      next_review_date TEXT,
      reviewed_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (sentence_id) REFERENCES sentence_items(id) ON DELETE CASCADE
    )
  `);

  const existingSentenceGroups = await get(`SELECT COUNT(*) as count FROM sentence_groups`);
  if (!existingSentenceGroups || existingSentenceGroups.count === 0) {
    console.log("Seeding initial sentence translation groups and items...");
    const nowIso = new Date().toISOString();

    const initialSentenceGroups = [
      {
        id: "grp_b1_personality",
        name: "B1 人物性格与社交评价",
        description: "练习日常交流中评价他人性格特征、待人接物态度的高频表达与句型。",
        sort_order: 1,
        sentences: [
          {
            id: "sent_nisai_001",
            thai_word: "นิสัยดี",
            chinese_sentence: "我的新同事是一个人很好、很友善的人。",
            reference_thai: "เพื่อนร่วมงานใหม่ของฉันเป็นคนนิสัยดีมาก",
            target_word_used: "นิสัยดี",
            other_vocab_notes: [
              { word: "เพื่อนร่วมงาน", meaning: "同事", level: "A2" },
              { word: "ใหม่", meaning: "新的", level: "A1" },
              { word: "ของ", meaning: "的", level: "A1" },
              { word: "ฉัน", meaning: "我", level: "A1" },
              { word: "เป็น", meaning: "是", level: "A1" },
              { word: "คน", meaning: "人", level: "A1" },
              { word: "มาก", meaning: "很、非常", level: "A1" }
            ],
            thai_word_count: 7,
            notes: "“นิสัยดี”在句中作形容词性后置定语或复合词组修饰“人”（คน），是日常泰语中描述他人性格最基础、最高频的B1词汇用法。"
          },
          {
            id: "sent_jaiyen_002",
            thai_word: "ใจเย็น",
            chinese_sentence: "遇到困难时，我们必须保持冷静，不能慌张。",
            reference_thai: "เมื่อเจอปัญหา เราต้องใจเย็นๆ อย่าตื่นตระหนก",
            target_word_used: "ใจเย็นๆ",
            other_vocab_notes: [
              { word: "เมื่อ", meaning: "当...时", level: "A1" },
              { word: "เจอ", meaning: "遇到/面对", level: "A1" },
              { word: "ปัญหา", meaning: "问题/困难", level: "A2" },
              { word: "เรา", meaning: "我们", level: "A1" },
              { word: "ต้อง", meaning: "必须", level: "A1" },
              { word: "อย่า", meaning: "不要/别", level: "A1" },
              { word: "ตื่นตระหนก", meaning: "惊慌失措", level: "B1" }
            ],
            thai_word_count: 8,
            notes: "“ใจเย็น”常用重叠词“ใจเย็นๆ”表示放宽心、别着急，是口语和书面语中劝导他人的高频词。"
          },
          {
            id: "sent_rubpitt_003",
            thai_word: "รับผิดชอบ",
            chinese_sentence: "这位项目经理对工作非常负责任。",
            reference_thai: "ผู้จัดการโครงการคนนี้มีความรับผิดชอบต่อหน้าที่การงานสูงมาก",
            target_word_used: "รับผิดชอบ",
            other_vocab_notes: [
              { word: "ผู้จัดการ", meaning: "经理", level: "A2" },
              { word: "โครงการ", meaning: "项目/工程", level: "B1" },
              { word: "คนนี้", meaning: "这个人", level: "A1" },
              { word: "มี", meaning: "有", level: "A1" },
              { word: "ความรับผิดชอบ", meaning: "责任感", level: "B1" },
              { word: "ต่อ", meaning: "对/向", level: "A2" },
              { word: "หน้าที่การงาน", meaning: "本职工作", level: "B1" },
              { word: "สูง", meaning: "高", level: "A1" },
              { word: "มาก", meaning: "很/非常", level: "A1" }
            ],
            thai_word_count: 9,
            notes: "“รับผิดชอบ”常与介词“ต่อ”搭配（มีความรับผิดชอบต่อ...），表达对某职责或人具有高度责任感。"
          },
          {
            id: "sent_krengjai_004",
            thai_word: "เกรงใจ",
            chinese_sentence: "在别人家里做客时，应该懂得礼貌和客气。",
            reference_thai: "เวลาไปเป็นแขกที่บ้านคนอื่น เราต้องรู้จักเกรงใจเจ้าของบ้าน",
            target_word_used: "เกรงใจ",
            other_vocab_notes: [
              { word: "เวลา", meaning: "当...时/时间", level: "A1" },
              { word: "ไป", meaning: "去", level: "A1" },
              { word: "เป็นแขก", meaning: "做客/当客人", level: "A2" },
              { word: "ที่บ้าน", meaning: "在...家里", level: "A1" },
              { word: "คนอื่น", meaning: "别人", level: "A2" },
              { word: "รู้จัก", meaning: "懂得/知道", level: "A1" },
              { word: "เจ้าของบ้าน", meaning: "屋主/主人", level: "A2" }
            ],
            thai_word_count: 9,
            notes: "“เกรงใจ”是泰国文化核心词汇，表示怕给别人添麻烦、体谅客气。句中“รู้จักเกรงใจ”意为懂得体谅他人。"
          },
          {
            id: "sent_khayan_005",
            thai_word: "ขยัน",
            chinese_sentence: "只要你每天勤奋练习泰语，进步一定会很快。",
            reference_thai: "ขอเพียงคุณขยันฝึกฝนภาษาไทยทุกวัน ความก้าวหน้าจะต้องเร็วมากแน่นอน",
            target_word_used: "ขยัน",
            other_vocab_notes: [
              { word: "ขอเพียง", meaning: "只要", level: "B1" },
              { word: "คุณ", meaning: "你", level: "A1" },
              { word: "ฝึกฝน", meaning: "练习/磨练", level: "B1" },
              { word: "ภาษาไทย", meaning: "泰语", level: "A1" },
              { word: "ทุกวัน", meaning: "每天", level: "A1" },
              { word: "ความก้าวหน้า", meaning: "进步/进展", level: "B1" },
              { word: "จะต้อง", meaning: "必定会", level: "A2" },
              { word: "เร็วมาก", meaning: "很快", level: "A1" },
              { word: "แน่นอน", meaning: "必定/肯定", level: "A2" }
            ],
            thai_word_count: 10,
            notes: "“ขยัน”作谓语前置助动修饰“ฝึกฝน”，表达“勤劳刻苦地做某事”。"
          }
        ]
      },
      {
        id: "grp_b1_workplace",
        name: "B1 职场办公与商务沟通",
        description: "涉及会议预约、跨部门协作、商务决策等实用职场翻译造句。",
        sort_order: 2,
        sentences: [
          {
            id: "sent_natmai_006",
            thai_word: "นัดหมาย",
            chinese_sentence: "我想和客户预约在明天下午两点开会。",
            reference_thai: "ฉันต้องการนัดหมายประชุมกับลูกค้าในวันพรุ่งนี้เวลาบ่ายสองโมง",
            target_word_used: "นัดหมาย",
            other_vocab_notes: [
              { word: "ฉัน", meaning: "我", level: "A1" },
              { word: "ต้องการ", meaning: "想要/需要", level: "A1" },
              { word: "ประชุม", meaning: "开会", level: "A2" },
              { word: "กับ", meaning: "和/与", level: "A1" },
              { word: "ลูกค้า", meaning: "客户", level: "A2" },
              { word: "ในวันพรุ่งนี้", meaning: "在明天", level: "A1" },
              { word: "เวลา", meaning: "时间", level: "A1" },
              { word: "บ่ายสองโมง", meaning: "下午两点", level: "A1" }
            ],
            thai_word_count: 9,
            notes: "“นัดหมาย”意为约定时间/预约，后面可直接接动词（如 นัดหมายประชุม 预约开会）。"
          },
          {
            id: "sent_prasangarn_007",
            thai_word: "ประสานงาน",
            chinese_sentence: "我们需要与市场部协调推广活动的细节。",
            reference_thai: "พวกเราต้องประสานงานกับฝ่ายการตลาดเกี่ยวกับรายละเอียดของกิจกรรมส่งเสริมการขาย",
            target_word_used: "ประสานงาน",
            other_vocab_notes: [
              { word: "พวกเรา", meaning: "我们", level: "A1" },
              { word: "ต้อง", meaning: "必须", level: "A1" },
              { word: "ฝ่ายการตลาด", meaning: "市场部", level: "B1" },
              { word: "เกี่ยวกับ", meaning: "关于", level: "A2" },
              { word: "รายละเอียด", meaning: "细节/详情", level: "B1" },
              { word: "กิจกรรม", meaning: "活动", level: "A2" },
              { word: "ส่งเสริมการขาย", meaning: "促销/推广", level: "B1" }
            ],
            thai_word_count: 9,
            notes: "“ประสานงาน”通常搭配“กับ”（与...协调/对接）和“เกี่ยวกับ”（关于...事项）。"
          },
          {
            id: "sent_tatsinjai_008",
            thai_word: "ตัดสินใจ",
            chinese_sentence: "总经理在仔细阅读报告后才做出最后的决定。",
            reference_thai: "กรรมการผู้จัดการตัดสินใจขั้นสุดท้ายหลังจากอ่านรายงานอย่างละเอียดแล้ว",
            target_word_used: "ตัดสินใจ",
            other_vocab_notes: [
              { word: "กรรมการผู้จัดการ", meaning: "总经理/常务董事", level: "B1" },
              { word: "ขั้นสุดท้าย", meaning: "最终/最后一步", level: "B1" },
              { word: "หลังจาก", meaning: "在...之后", level: "A2" },
              { word: "อ่าน", meaning: "阅读", level: "A1" },
              { word: "รายงาน", meaning: "报告", level: "A2" },
              { word: "อย่างละเอียด", meaning: "仔细地/详尽地", level: "B1" },
              { word: "แล้ว", meaning: "了", level: "A1" }
            ],
            thai_word_count: 8,
            notes: "“ตัดสินใจขั้นสุดท้าย”是商务泰语中表达“拍板、做出最终裁决”的常用搭配。"
          }
        ]
      }
    ];

    for (const grp of initialSentenceGroups) {
      await run(
        `INSERT INTO sentence_groups (id, name, description, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [grp.id, grp.name, grp.description, grp.sort_order, nowIso, nowIso]
      );

      let order = 1;
      for (const s of grp.sentences) {
        const rawJsonStr = JSON.stringify(s);
        const vocabNotesStr = JSON.stringify(s.other_vocab_notes || []);
        await run(
          `INSERT OR REPLACE INTO sentence_items (
            id, group_id, thai_word, chinese_sentence, reference_thai, target_word_used,
            other_vocab_notes, thai_word_count, notes, raw_json, sort_order,
            repetition, interval_days, easiness_factor, next_review_date, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 2.5, ?, ?, ?)`,
          [
            s.id,
            grp.id,
            s.thai_word,
            s.chinese_sentence,
            s.reference_thai,
            s.target_word_used || s.thai_word,
            vocabNotesStr,
            s.thai_word_count || 0,
            s.notes || "",
            rawJsonStr,
            order++,
            nowIso,
            nowIso,
            nowIso
          ]
        );
      }
    }
    console.log("Sentence translation groups and items seeded successfully.");
  }
}




