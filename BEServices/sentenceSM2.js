/**
 * SuperMemo SM-2 Algorithm Implementation for Sentence Translation Practice
 * 
 * Score scale (0 - 5):
 *   0: Complete blackout / completely incorrect
 *   1: Serious error; correct sentence recognized only upon seeing answer
 *   2: Noticeable errors in key grammar/vocabulary; recalled with significant hesitation
 *   3: Acceptable response; correct with difficulty or minor imperfection
 *   4: Good response; accurate translation with slight hesitation
 *   5: Perfect response; idiomatic, natural, and instant translation
 * 
 * Algorithm rules:
 * - If score >= 3:
 *     repetition = repetition + 1
 *     if repetition == 1: interval = 1 day
 *     if repetition == 2: interval = 6 days
 *     if repetition > 2: interval = round(prev_interval * EF)
 * - If score < 3:
 *     repetition = 0
 *     interval = 1 day
 * 
 * Easiness Factor (EF):
 *   EF' = EF + (0.1 - (5 - score) * (0.08 + (5 - score) * 0.02))
 *   Minimum EF = 1.3
 */

export function calculateSentenceSM2(currentState = {}, score = 0) {
  let q = Math.round(Number(score));
  if (isNaN(q) || q < 0) q = 0;
  if (q > 5) q = 5;

  let rep = parseInt(currentState.repetition, 10);
  if (isNaN(rep) || rep < 0) rep = 0;

  let ef = parseFloat(currentState.easiness_factor ?? currentState.easinessFactor);
  if (isNaN(ef) || ef < 1.3) ef = 2.5;

  let prevInterval = parseInt(currentState.interval_days ?? currentState.interval, 10);
  if (isNaN(prevInterval) || prevInterval < 1) prevInterval = 1;

  let nextInterval = 1;

  if (q >= 3) {
    if (rep === 0) {
      nextInterval = 1;
    } else if (rep === 1) {
      nextInterval = 6;
    } else {
      nextInterval = Math.round(prevInterval * ef);
    }
    rep += 1;
  } else {
    rep = 0;
    nextInterval = 1;
  }

  // Update Easiness Factor
  ef = ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  if (ef < 1.3) ef = 1.3;
  ef = Math.round(ef * 100) / 100;

  // Next review date timestamp (ISO string)
  const now = new Date();
  const nextReviewDate = new Date(now.getTime() + nextInterval * 24 * 60 * 60 * 1000).toISOString();

  return {
    repetition: rep,
    interval_days: nextInterval,
    easiness_factor: ef,
    next_review_date: nextReviewDate
  };
}
