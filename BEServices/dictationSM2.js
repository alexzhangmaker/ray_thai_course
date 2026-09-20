/**
 * SuperMemo SM-2 Spaced Repetition Algorithm Implementation
 * 
 * Inputs:
 * - currentState: { repetition: number, interval: number, easinessFactor: number }
 * - rating: number between 0 and 5
 *   0: Complete blackout / Forgot
 *   1: Incorrect response; the correct one remembered
 *   2: Incorrect response; where the correct one seemed easy to recall
 *   3: Correct response recalled with serious difficulty
 *   4: Correct response after a hesitation
 *   5: Perfect response
 * 
 * Supervisor simplified grading:
 *   0 = Forgot (❌)
 *   3 = Hard (⚠️)
 *   4 = Correct (✅)
 *   5 = Perfect (⭐)
 */

export function calculateSM2(currentState = {}, rating = 0) {
  let q = Math.round(Number(rating));
  if (isNaN(q) || q < 0) q = 0;
  if (q > 5) q = 5;

  let rep = parseInt(currentState.repetition, 10);
  if (isNaN(rep) || rep < 0) rep = 0;

  let ef = parseFloat(currentState.easinessFactor ?? currentState.easiness_factor);
  if (isNaN(ef) || ef < 1.3) ef = 2.5;

  let prevInterval = parseInt(currentState.interval ?? currentState.interval_days, 10);
  if (isNaN(prevInterval) || prevInterval < 1) prevInterval = 1;

  let nextInterval = 1;

  if (q >= 3) {
    // Successful recall
    if (rep === 0) {
      nextInterval = 1;
    } else if (rep === 1) {
      nextInterval = 6;
    } else {
      nextInterval = Math.round(prevInterval * ef);
    }
    rep += 1;
  } else {
    // Failed recall (repetition resets to 0, interval resets to 1)
    rep = 0;
    nextInterval = 1;
  }

  // Update Easiness Factor:
  // EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
  ef = ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  if (ef < 1.3) ef = 1.3;
  // Keep EF rounded to 2 decimal places for clean storage
  ef = Math.round(ef * 100) / 100;

  // Calculate next review timestamp (now + nextInterval days)
  const now = new Date();
  const nextReviewDate = new Date(now.getTime() + nextInterval * 24 * 60 * 60 * 1000).toISOString();

  return {
    repetition: rep,
    interval: nextInterval,
    easinessFactor: ef,
    nextReviewDate
  };
}
