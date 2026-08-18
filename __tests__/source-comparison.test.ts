import type { WaveformFile } from '@/domain';
import {
  comparisonVisibleSpanBounds,
  comparisonResultDurationMs,
  comparisonResultPath,
  comparisonResultSourceTimeMs,
  comparisonWindowPath,
  defaultComparisonVisibleSpan,
  initialComparisonPositions,
  snapComparisonVisibleSpan,
} from '@/utils/sourceComparison';

describe('source comparison viewport', () => {
  it('uses whole-second spans capped at ten seconds and fits short sources', () => {
    expect(defaultComparisonVisibleSpan(45_000)).toBe(10_000);
    expect(defaultComparisonVisibleSpan(4_250)).toBe(4_000);
    expect(defaultComparisonVisibleSpan(750)).toBe(1_000);
    expect(comparisonVisibleSpanBounds(45_000)).toEqual({ minimum: 1_000, maximum: 10_000 });
    expect(comparisonVisibleSpanBounds(750)).toEqual({ minimum: 1_000, maximum: 1_000 });
    expect(snapComparisonVisibleSpan(3_149, 45_000)).toBe(3_000);
    expect(snapComparisonVisibleSpan(60_000, 45_000)).toBe(10_000);
  });

  it('restores independent saved centers or starts with separated defaults', () => {
    expect(initialComparisonPositions(30_000)).toEqual({ firstMs: 10_000, secondMs: 20_000 });
    expect(
      initialComparisonPositions(30_000, {
        sourceId: '11111111-1111-4111-8111-111111111111',
        firstMs: 8_250,
        secondMs: 21_750,
      }),
    ).toEqual({ firstMs: 8_250, secondMs: 21_750 });
  });

  it('renders virtual silence when a centered window extends beyond the source edge', () => {
    const waveform: WaveformFile = {
      schemaVersion: 1,
      durationMs: 2_000,
      binCount: 8192,
      rms: Array.from({ length: 8192 }, (_, index) => index / 8191),
      peak: Array.from({ length: 8192 }, () => 1),
    };
    const leftEdge = comparisonWindowPath(waveform, 2_000, 0, 1_000, 300, 80);
    const rightEdge = comparisonWindowPath(waveform, 2_000, 2_000, 1_000, 300, 80);
    expect(leftEdge).toMatch(/^M /u);
    expect(rightEdge).toMatch(/^M /u);
    expect(leftEdge).not.toEqual(rightEdge);
  });

  it('maps a full spliced result across both retained source ranges', () => {
    const waveform: WaveformFile = {
      schemaVersion: 1,
      durationMs: 40_000,
      binCount: 8192,
      rms: Array.from({ length: 8192 }, (_, index) => index / 8191),
      peak: Array.from({ length: 8192 }, () => 1),
    };
    expect(comparisonResultDurationMs(40_000, 10_000, 25_000)).toBe(25_000);
    expect(comparisonResultSourceTimeMs(9_000, 10_000, 25_000)).toBe(9_000);
    expect(comparisonResultSourceTimeMs(12_000, 10_000, 25_000)).toBe(27_000);
    expect(comparisonResultPath(waveform, 40_000, 10_000, 25_000, 320, 68)).toMatch(/^M /u);
  });
});
