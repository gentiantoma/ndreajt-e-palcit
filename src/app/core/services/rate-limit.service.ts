import { Injectable } from '@angular/core';

/*
 * Client-side abuse throttle. Not a substitute for server rules, but it stops
 * the common case: one person hammering reactions/comments/reports.
 *
 * Per action bucket we keep a sliding window of recent timestamps. Cross the
 * limit and the bucket goes into a cooldown; keep hammering during cooldown and
 * the cooldown escalates (10s → 30s → 2m → 5m). Behaves for normal users,
 * bites only sustained spam.
 */
interface Bucket {
  hits: number[];        // timestamps within the window
  cooldownUntil: number; // 0 = not cooling down
  strikes: number;       // how many times they've tripped it in a row
}

interface Limit { max: number; windowMs: number; }

const LIMITS: Record<string, Limit> = {
  reaction: { max: 12, windowMs: 10_000 }, // 12 reactions / 10s
  comment:  { max: 6,  windowMs: 30_000 }, // 6 comments / 30s
  report:   { max: 4,  windowMs: 60_000 }, // 4 reports / minute
  default:  { max: 15, windowMs: 10_000 },
};

const COOLDOWN_STEPS = [10_000, 30_000, 120_000, 300_000]; // escalating

@Injectable({ providedIn: 'root' })
export class RateLimitService {
  private buckets = new Map<string, Bucket>();

  /**
   * @returns 0 if the action is allowed (and records it), otherwise the number
   *          of seconds the user must wait.
   */
  check(action: string): number {
    const limit = LIMITS[action] ?? LIMITS['default'];
    const now = Date.now();
    const b = this.buckets.get(action) ?? { hits: [], cooldownUntil: 0, strikes: 0 };

    // Still cooling down?
    if (b.cooldownUntil > now) {
      this.buckets.set(action, b);
      return Math.ceil((b.cooldownUntil - now) / 1000);
    }

    // Drop timestamps outside the window
    b.hits = b.hits.filter(t => now - t < limit.windowMs);

    if (b.hits.length >= limit.max) {
      // Trip the cooldown, escalating with each consecutive strike
      const step = COOLDOWN_STEPS[Math.min(b.strikes, COOLDOWN_STEPS.length - 1)];
      b.cooldownUntil = now + step;
      b.strikes += 1;
      b.hits = [];
      this.buckets.set(action, b);
      return Math.ceil(step / 1000);
    }

    // Allowed — record it, decay strikes when they behave
    b.hits.push(now);
    if (b.strikes > 0 && b.hits.length === 1) b.strikes = Math.max(0, b.strikes - 1);
    this.buckets.set(action, b);
    return 0;
  }
}
