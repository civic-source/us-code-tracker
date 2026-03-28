import { describe, it, expect } from 'vitest';
import { createMetricsCollector, createTimer } from '../index.js';

describe('createMetricsCollector', () => {
  it('initializes with zero counts and a startedAt timestamp', () => {
    const collector = createMetricsCollector();
    const snapshot = collector.toJSON();
    expect(snapshot.startedAt).toBeTruthy();
    expect(snapshot.titlesProcessed).toBe(0);
    expect(snapshot.titlesSkipped).toBe(0);
    expect(snapshot.titlesFailed).toBe(0);
    expect(snapshot.sectionsGenerated).toBe(0);
    expect(snapshot.annotationsGenerated).toBe(0);
    expect(snapshot.xmlDownloadSizeBytes).toBe(0);
    expect(snapshot.peakMemoryMB).toBe(0);
    expect(snapshot.runnerType).toBe('self-hosted');
  });

  it('records additive count values', () => {
    const collector = createMetricsCollector();
    collector.record({ titlesProcessed: 3, sectionsGenerated: 50 });
    collector.record({ titlesProcessed: 2, sectionsGenerated: 30 });
    const snapshot = collector.toJSON();
    expect(snapshot.titlesProcessed).toBe(5);
    expect(snapshot.sectionsGenerated).toBe(80);
  });

  it('records peakMemoryMB as a max (not additive)', () => {
    const collector = createMetricsCollector();
    collector.record({ peakMemoryMB: 100 });
    collector.record({ peakMemoryMB: 50 });
    collector.record({ peakMemoryMB: 200 });
    expect(collector.toJSON().peakMemoryMB).toBe(200);
  });

  it('accepts a custom runnerType', () => {
    const collector = createMetricsCollector('github-hosted');
    expect(collector.toJSON().runnerType).toBe('github-hosted');
  });

  it('complete() sets completedAt and durationMs', () => {
    const collector = createMetricsCollector();
    collector.record({ titlesProcessed: 1 });
    const final = collector.complete();
    expect(final.completedAt).toBeTruthy();
    expect(typeof final.durationMs).toBe('number');
    expect(final.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('toJSON() returns a snapshot (not a reference to internal state)', () => {
    const collector = createMetricsCollector();
    const snap1 = collector.toJSON();
    collector.record({ titlesProcessed: 10 });
    const snap2 = collector.toJSON();
    expect(snap1.titlesProcessed).toBe(0);
    expect(snap2.titlesProcessed).toBe(10);
  });

  it('toMarkdown() returns a GitHub Actions-compatible summary table', () => {
    const collector = createMetricsCollector();
    collector.record({ titlesProcessed: 5, titlesFailed: 1, sectionsGenerated: 120 });
    collector.complete();
    const md = collector.toMarkdown();
    expect(md).toContain('## Pipeline Run Summary');
    expect(md).toContain('| Metric | Value |');
    expect(md).toContain('| Titles processed | 5 |');
    expect(md).toContain('| Titles failed | 1 |');
    expect(md).toContain('| Sections generated | 120 |');
    expect(md).toContain('Completed');
  });

  it('toMarkdown() shows "in progress" when not yet completed', () => {
    const collector = createMetricsCollector();
    const md = collector.toMarkdown();
    expect(md).toContain('in progress');
    expect(md).not.toContain('Completed');
  });
});

describe('createTimer', () => {
  it('returns a timer with the given label', () => {
    const timer = createTimer('test-op');
    const result = timer.stop();
    expect(result.label).toBe('test-op');
  });

  it('elapsed() returns a non-negative millisecond value', () => {
    const timer = createTimer('elapsed-test');
    const ms = timer.elapsed();
    expect(typeof ms).toBe('number');
    expect(ms).toBeGreaterThanOrEqual(0);
  });

  it('stop() returns durationMs as a non-negative number', () => {
    const timer = createTimer('stop-test');
    const result = timer.stop();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('elapsed() can be called multiple times and values increase', async () => {
    const timer = createTimer('multi-elapsed');
    const first = timer.elapsed();
    // Small busy-wait to ensure time passes
    const start = performance.now();
    while (performance.now() - start < 5) {
      // spin
    }
    const second = timer.elapsed();
    expect(second).toBeGreaterThanOrEqual(first);
  });
});
