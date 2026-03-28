/** Lightweight performance timer using process.hrtime.bigint(). */

/** Result returned when a timer is stopped. */
export interface TimerResult {
  label: string;
  durationMs: number;
}

/** Active timer with elapsed() and stop() methods. */
export interface Timer {
  /** Get elapsed milliseconds without stopping the timer. */
  elapsed(): number;
  /** Stop the timer and return the final result. */
  stop(): TimerResult;
}

/** Create a named performance timer. */
export function createTimer(label: string): Timer {
  const start = process.hrtime.bigint();

  function elapsed(): number {
    const now = process.hrtime.bigint();
    return Number(now - start) / 1_000_000;
  }

  function stop(): TimerResult {
    return { label, durationMs: elapsed() };
  }

  return { elapsed, stop };
}
