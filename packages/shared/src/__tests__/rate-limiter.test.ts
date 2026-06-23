import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TokenBucket } from '../rate-limiter.js';

describe('TokenBucket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with full capacity', () => {
    const bucket = new TokenBucket({ capacity: 10, refillRate: 1, refillIntervalMs: 1000 });
    expect(bucket.available).toBe(10);
  });

  it('consumes tokens correctly', () => {
    const bucket = new TokenBucket({ capacity: 10, refillRate: 1, refillIntervalMs: 1000 });

    expect(bucket.tryConsume(3)).toBe(true);
    expect(bucket.available).toBe(7);

    expect(bucket.tryConsume(1)).toBe(true);
    expect(bucket.available).toBe(6);
  });

  it('rejects when not enough tokens', () => {
    const bucket = new TokenBucket({ capacity: 2, refillRate: 1, refillIntervalMs: 1000 });

    expect(bucket.tryConsume(1)).toBe(true);
    expect(bucket.tryConsume(1)).toBe(true);
    expect(bucket.tryConsume(1)).toBe(false);
    expect(bucket.available).toBe(0);
  });

  it('rejects when requesting more than available', () => {
    const bucket = new TokenBucket({ capacity: 5, refillRate: 1, refillIntervalMs: 1000 });

    expect(bucket.tryConsume(3)).toBe(true);
    expect(bucket.tryConsume(3)).toBe(false);
    expect(bucket.available).toBe(2);
  });

  it('refills tokens over time', () => {
    const bucket = new TokenBucket({ capacity: 10, refillRate: 2, refillIntervalMs: 1000 });

    // Drain all tokens
    expect(bucket.tryConsume(10)).toBe(true);
    expect(bucket.available).toBe(0);

    // Advance 1 interval: +2 tokens
    vi.advanceTimersByTime(1000);
    expect(bucket.available).toBe(2);

    // Advance 2 more intervals: +4 tokens
    vi.advanceTimersByTime(2000);
    expect(bucket.available).toBe(6);
  });

  it('does not exceed capacity on refill', () => {
    const bucket = new TokenBucket({ capacity: 5, refillRate: 3, refillIntervalMs: 1000 });

    // Consume 1 token (4 remaining)
    bucket.tryConsume(1);

    // Advance enough time to overfill
    vi.advanceTimersByTime(5000);
    expect(bucket.available).toBe(5); // capped at capacity
  });

  it('waitAndConsume resolves immediately when tokens available', async () => {
    const bucket = new TokenBucket({ capacity: 10, refillRate: 1, refillIntervalMs: 1000 });

    await bucket.waitAndConsume(3);
    expect(bucket.available).toBe(7);
  });

  it('waitAndConsume waits for refill when tokens insufficient', async () => {
    const bucket = new TokenBucket({ capacity: 2, refillRate: 1, refillIntervalMs: 1000 });

    // Drain the bucket
    bucket.tryConsume(2);
    expect(bucket.available).toBe(0);

    // Start waiting for 1 token
    const consumePromise = bucket.waitAndConsume(1);

    // Advance time to allow refill
    vi.advanceTimersByTime(1000);

    await consumePromise;

    // The token was consumed after waiting
    expect(bucket.available).toBe(0);
  });

  it('serializes concurrent waiters FIFO and never over-issues tokens', async () => {
    const bucket = new TokenBucket({ capacity: 2, refillRate: 1, refillIntervalMs: 1000 });
    bucket.tryConsume(2); // drain to 0
    expect(bucket.available).toBe(0);

    const order: number[] = [];
    const p1 = bucket.waitAndConsume(1).then(() => order.push(1));
    const p2 = bucket.waitAndConsume(1).then(() => order.push(2));

    // Each waiter needs one refill interval; serialized, not simultaneous.
    await vi.advanceTimersByTimeAsync(1000); // first waiter gets its token
    await vi.advanceTimersByTimeAsync(1000); // second waiter gets its token
    await Promise.all([p1, p2]);

    expect(order).toEqual([1, 2]); // FIFO order preserved
    expect(bucket.available).toBeGreaterThanOrEqual(0); // never drove tokens negative
  });

  it('throws when waitAndConsume count exceeds capacity', async () => {
    const bucket = new TokenBucket({ capacity: 2, refillRate: 1, refillIntervalMs: 1000 });
    await expect(bucket.waitAndConsume(3)).rejects.toThrow(/capacity/);
  });

  it('defaults count to 1 for tryConsume', () => {
    const bucket = new TokenBucket({ capacity: 3, refillRate: 1, refillIntervalMs: 1000 });

    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.available).toBe(2);
  });
});
