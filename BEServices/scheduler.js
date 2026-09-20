import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { all, get, run } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.join(__dirname, 'config.json');

// Default configurations
let config = {
  taskWeights: {
    firstAttemptCorrect: 1.0,
    firstAttemptIncorrectSecondAttemptCorrect: 0.6,
    hintsUsedCorrect: 0.5,
    failed: 0.0
  },
  highFreqSession: {
    targetCount: 15,
    newWordRatio: 0.2
  }
};

// Attempt to read config.json
try {
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }
} catch (e) {
  console.warn("Failed to load config.json, using defaults:", e);
}

/**
 * 1. Weighted Score Engine
 * Converts task performance metrics to SM-2 quality ratings (0 to 5)
 */
export class WeightedScoreEngine {
  static calculateQualityRating(attempts) {
    if (!attempts || attempts.length === 0) return 3;
    let totalScore = 0;
    const weights = config.taskWeights;
    
    attempts.forEach(attempt => {
      if (!attempt.finalCorrect) {
        totalScore += weights.failed;
      } else if (attempt.attemptsCount === 1 && !attempt.hintsUsed) {
        totalScore += weights.firstAttemptCorrect;
      } else if (attempt.hintsUsed) {
        totalScore += weights.hintsUsedCorrect;
      } else if (attempt.attemptsCount === 2) {
        totalScore += weights.firstAttemptIncorrectSecondAttemptCorrect;
      } else {
        totalScore += weights.failed;
      }
    });
    
    const averageScore = totalScore / attempts.length;
    // Map average score [0.0 - 1.0] to SM-2 quality q [0 - 5]
    const q = Math.round(averageScore * 5);
    return Math.max(0, Math.min(5, q));
  }
}

/**
 * 2. SM-2 Spaced Repetition Strategy
 */
export class SM2Strategy {
  calculateNext(state, q) {
    let repetitions = state.repetitions || 0;
    let easeFactor = state.ease_factor || 2.5;
    let intervalDays = 1;

    if (q >= 3) {
      if (repetitions === 0) {
        intervalDays = 1;
      } else if (repetitions === 1) {
        intervalDays = 6;
      } else {
        const prevIntervalDays = Math.round((state.interval_minutes || 1440) / 1440);
        intervalDays = Math.round(prevIntervalDays * easeFactor);
      }
      repetitions++;
    } else {
      repetitions = 0;
      intervalDays = 1;
    }

    easeFactor = easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
    if (easeFactor < 1.3) easeFactor = 1.3;
    if (easeFactor > 2.5) easeFactor = 2.5;

    const intervalMinutes = intervalDays * 24 * 60;
    const nextReviewAt = new Date(Date.now() + intervalMinutes * 60 * 1000).toISOString();

    return {
      repetitions,
      interval_minutes: intervalMinutes,
      ease_factor: easeFactor,
      next_review_at: nextReviewAt
    };
  }
}

/**
 * 3. Pimsleur Spaced Repetition Strategy (for Grammar & High Freq items)
 */
export class PimsleurStrategy {
  calculateNext(state, isCorrect) {
    let repetitions = state.repetitions || 0;
    // In minutes: 5min, 25min, 2hrs (120), 10hrs (600), 1d (1440), 4d (5760), 15d (21600), 60d (86400)
    const baseIntervals = [5, 25, 120, 600, 1440, 5760, 21600, 86400];
    let intervalMinutes = 5;

    if (isCorrect) {
      if (repetitions < baseIntervals.length) {
        intervalMinutes = baseIntervals[repetitions];
      } else {
        const prevInterval = state.interval_minutes || 86400;
        intervalMinutes = Math.min(prevInterval * 2, 86400 * 180); // max 180 days
      }
      repetitions++;
    } else {
      repetitions = Math.max(0, repetitions - 2);
      intervalMinutes = baseIntervals[repetitions] || 5;
    }

    const nextReviewAt = new Date(Date.now() + intervalMinutes * 60 * 1000).toISOString();

    return {
      repetitions,
      interval_minutes: intervalMinutes,
      next_review_at: nextReviewAt
    };
  }
}

// In-memory registry for active high-frequency session managers
export const activeSessions = new Map();

/**
 * 4. High Frequency Session Manager (In-Memory Micro Queue)
 */
export class HighFreqSessionManager {
  constructor(userId) {
    this.userId = userId;
    this.activeQueue = []; // Cards in memory: { item, type, correctInRow }
    this.currentIndex = 0;
    this.sessionTarget = config.highFreqSession.targetCount || 15;
    this.newRatio = config.highFreqSession.newWordRatio || 0.2;
    this.completedCount = 0; // Number of unique items successfully completed in this session
  }

  async initializeSession() {
    const targetNew = Math.round(this.sessionTarget * this.newRatio);
    const targetOld = this.sessionTarget - targetNew;

    // 1. Get due reviews
    const dueReviews = await all(
      `SELECT ur.*, hfw.word, hfw.meaning, hfw.options_json, hfw.ipa, hfw.examples_json
       FROM user_reviews ur
       JOIN high_frequency_words hfw ON ur.item_id = hfw.id
       WHERE ur.user_id = ? AND ur.item_type = 'high_freq' AND ur.next_review_at <= datetime('now', 'utc')
       ORDER BY ur.next_review_at ASC
       LIMIT ?`,
      [this.userId, targetOld]
    );

    // Fill missing target quota with new words
    let newCount = targetNew + (targetOld - dueReviews.length);

    // 2. Get never-studied high frequency words
    const newWords = await all(
      `SELECT * FROM high_frequency_words
       WHERE id NOT IN (
         SELECT item_id FROM user_reviews WHERE user_id = ? AND item_type = 'high_freq'
       )
       LIMIT ?`,
      [this.userId, newCount]
    );

    // 3. If still short of the target count, get reviews that are not yet due to maintain practice volume
    let currentTotal = dueReviews.length + newWords.length;
    let extraOldReviews = [];
    if (currentTotal < this.sessionTarget) {
      const neededExtra = this.sessionTarget - currentTotal;
      extraOldReviews = await all(
        `SELECT ur.*, hfw.word, hfw.meaning, hfw.options_json, hfw.ipa, hfw.examples_json
         FROM user_reviews ur
         JOIN high_frequency_words hfw ON ur.item_id = hfw.id
         WHERE ur.user_id = ? AND ur.item_type = 'high_freq' AND ur.next_review_at > datetime('now', 'utc')
         ORDER BY ur.next_review_at ASC
         LIMIT ?`,
        [this.userId, neededExtra]
      );
    }

    // Combine queue
    this.activeQueue = [];
    dueReviews.forEach(r => {
      this.activeQueue.push({ item: r, type: 'old', correctInRow: 0 });
    });
    newWords.forEach(w => {
      this.activeQueue.push({ item: w, type: 'new', correctInRow: 0 });
    });
    extraOldReviews.forEach(r => {
      this.activeQueue.push({ item: r, type: 'old', correctInRow: 0 });
    });

    this.shuffle(this.activeQueue);
    this.currentIndex = 0;
    this.completedCount = 0;
    return this.getCurrentCard();
  }

  shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  getCurrentCard() {
    if (this.currentIndex >= this.activeQueue.length) {
      return null; // Session over
    }
    const current = this.activeQueue[this.currentIndex];
    
    // Parse options_json
    let options = [];
    try {
      options = JSON.parse(current.item.options_json);
    } catch (e) {
      options = [current.item.meaning, "Distractor A", "Distractor B", "Distractor C"];
    }

    // Parse examples_json
    let examples = [];
    try {
      examples = current.item.examples_json ? JSON.parse(current.item.examples_json) : [];
    } catch (e) {
      examples = [];
    }

    return {
      id: current.item.item_id || current.item.id,
      word: current.item.word,
      ipa: current.item.ipa || "",
      options,
      examples,
      meaning: current.item.meaning,
      type: current.type,
      progressIndex: this.completedCount,
      totalTarget: this.sessionTarget,
      currentIndexInQueue: this.currentIndex,
      queueLength: this.activeQueue.length
    };
  }

  /**
   * Process a single answer submit
   * @param {boolean} isCorrect 
   * @returns {Object} next card details or null if session is complete
   */
  async handleAnswer(isCorrect) {
    const currentCard = this.activeQueue[this.currentIndex];
    if (!currentCard) return null;

    const itemId = currentCard.item.id || currentCard.item.item_id;

    // Perform database logging/updating immediately for progress safety
    const reviewId = `${this.userId}_high_freq_${itemId}`;
    let existingReview = await get(`SELECT * FROM user_reviews WHERE id = ?`, [reviewId]);

    const pimsleur = new PimsleurStrategy();

    if (isCorrect) {
      currentCard.correctInRow++;
      
      // Correct for the second time in this session: mastered
      if (currentCard.correctInRow >= 2) {
        this.completedCount++;
        this.removeFromQueue(itemId);

        // Advance intervals in the database (Pimsleur Strategy)
        let reviewState = existingReview || { repetitions: 0, interval_minutes: 5 };
        const newState = pimsleur.calculateNext(reviewState, true);

        if (existingReview) {
          await run(
            `UPDATE user_reviews 
             SET repetitions = ?, interval_minutes = ?, next_review_at = ?, last_reviewed_at = datetime('now', 'utc'), updated_at = datetime('now', 'utc') 
             WHERE id = ?`,
            [newState.repetitions, newState.interval_minutes, newState.next_review_at, reviewId]
          );
        } else {
          await run(
            `INSERT INTO user_reviews (id, user_id, item_type, item_id, scheduler_type, interval_minutes, repetitions, next_review_at, last_reviewed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'utc'))`,
            [reviewId, this.userId, 'high_freq', itemId, 'pimsleur', newState.interval_minutes, newState.repetitions, newState.next_review_at]
          );
        }

        // Log the success
        await run(
          `INSERT INTO user_review_logs (user_id, item_type, item_id, reviewed_at, rating, prev_interval, new_interval)
           VALUES (?, ?, ?, datetime('now', 'utc'), ?, ?, ?)`,
          [this.userId, 'high_freq', itemId, 1, reviewState.interval_minutes || 0, newState.interval_minutes]
        );

        this.currentIndex++;
      } else {
        // Correct but first time: insert 3 steps later
        this.insertIntoQueue(currentCard, 3);
        this.currentIndex++;
      }
    } else {
      // Incorrect answer: reset queue streaks, insert 1 step later
      currentCard.correctInRow = 0;
      this.insertIntoQueue(currentCard, 1);
      this.currentIndex++;

      // Downgrade intervals in the database immediately
      let reviewState = existingReview || { repetitions: 0, interval_minutes: 5 };
      const newState = pimsleur.calculateNext(reviewState, false);

      if (existingReview) {
        await run(
          `UPDATE user_reviews 
           SET repetitions = ?, interval_minutes = ?, next_review_at = ?, last_reviewed_at = datetime('now', 'utc'), updated_at = datetime('now', 'utc') 
           WHERE id = ?`,
          [newState.repetitions, newState.interval_minutes, newState.next_review_at, reviewId]
        );
      } else {
        await run(
          `INSERT INTO user_reviews (id, user_id, item_type, item_id, scheduler_type, interval_minutes, repetitions, next_review_at, last_reviewed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'utc'))`,
          [reviewId, this.userId, 'high_freq', itemId, 'pimsleur', newState.interval_minutes, newState.repetitions, newState.next_review_at]
        );
      }

      // Log the failure (rating = 0)
      await run(
        `INSERT INTO user_review_logs (user_id, item_type, item_id, reviewed_at, rating, prev_interval, new_interval)
         VALUES (?, ?, ?, datetime('now', 'utc'), ?, ?, ?)`,
        [this.userId, 'high_freq', itemId, 0, reviewState.interval_minutes || 0, newState.interval_minutes]
      );
    }

    return this.getCurrentCard();
  }

  insertIntoQueue(card, relativeStep) {
    const targetIndex = this.currentIndex + relativeStep + 1;
    const cardCopy = { ...card };
    if (targetIndex >= this.activeQueue.length) {
      this.activeQueue.push(cardCopy);
    } else {
      this.activeQueue.splice(targetIndex, 0, cardCopy);
    }
  }

  removeFromQueue(itemId) {
    this.activeQueue = this.activeQueue.filter((card, idx) => {
      if (idx <= this.currentIndex) return true;
      const id = card.item.id || card.item.item_id;
      return id !== itemId;
    });
  }
}
