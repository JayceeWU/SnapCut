import type { TextStyle, ViewStyle } from 'react-native';

export const colors = {
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

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 18,
  pill: 999,
} as const;

export const typography = {
  appTitle: {
    color: colors.textPrimary,
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  screenTitle: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.25,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
  },
  cardTitle: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '700',
  },
  body: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 23,
  },
  bodySecondary: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
  },
  label: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  caption: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
} satisfies Record<string, TextStyle>;

export const layout = {
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  screenContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xxl,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
  },
} satisfies Record<string, ViewStyle>;

export const minimumTouchTarget = 48;
