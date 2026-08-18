import fs from 'node:fs';
import path from 'node:path';

import { colors } from '@/constants';

const expectedColors = {
  background: '#120A24',
  surface: '#1D1033',
  soft: '#2A1746',
  textPrimary: '#FAF7FF',
  textSecondary: '#B9A9CC',
  accent: '#A970FF',
  accentPressed: '#8750D6',
  accentTranslucent: 'rgba(169,112,255,0.24)',
  modalBackdrop: 'rgba(18,10,36,0.88)',
  border: '#432B5E',
  disabledSurface: '#2B2234',
  disabledText: '#80758B',
  error: '#FF6B8A',
  focus: '#C4A1FF',
  waveformOverview: '#756486',
  transparent: 'transparent',
} as const;

function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrastRatio(foreground: string, background: string): number {
  const light = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const dark = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (light + 0.05) / (dark + 0.05);
}

function collectFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const resolved = path.join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(resolved) : [resolved];
  });
}

describe('SnapCut purple theme contract', () => {
  it('keeps the approved semantic color tokens exact', () => {
    expect(colors).toEqual(expectedColors);
  });

  it('keeps dark text on the primary purple button above WCAG AA contrast', () => {
    expect(contrastRatio(colors.background, colors.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it('does not scatter color literals through screens or components', () => {
    const sourceFiles = [
      ...collectFiles(path.resolve(__dirname, '../app')),
      ...collectFiles(path.resolve(__dirname, '../src/components')),
    ].filter((file) => /\.tsx?$/.test(file));

    for (const file of sourceFiles) {
      const source = fs.readFileSync(file, 'utf8');
      expect({ file, matches: source.match(/#[0-9a-f]{3,8}|rgba?\(/giu) }).toEqual({
        file,
        matches: null,
      });
    }
  });
});
