import { StyleSheet, Text, View } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';

import { colors, copy, radii, spacing, typography } from '@/constants';
import type { WaveformStatus } from '@/domain';
import type { WaveformJobSnapshot } from '@/stores';
import { AppButton } from './AppButton';

export interface WaveformJobPanelProps {
  readonly job: WaveformJobSnapshot | undefined;
  readonly sourceStatus: WaveformStatus;
  readonly onCancel: () => void;
  readonly onStart: () => void;
}

function WaveformKeepAwake() {
  useKeepAwake('SnapCut waveform');
  return null;
}

export function WaveformJobPanel({ job, sourceStatus, onCancel, onStart }: WaveformJobPanelProps) {
  const processing = job?.status === 'processing' || job?.status === 'cancelling';
  const queued = job?.status === 'queued';
  const pending = job?.status === 'pending' || (!job && sourceStatus === 'pending');
  const orphanedProcessing = !job && sourceStatus === 'processing';
  const failed = job?.status === 'failed' || (!job && sourceStatus === 'failed');

  if (processing || queued) {
    const percent =
      job?.fraction === null || job?.fraction === undefined ? null : Math.round(job.fraction * 100);
    const label =
      job?.status === 'cancelling'
        ? copy.editor.waveformCancelling
        : queued
          ? copy.editor.waveformQueued
          : job?.stage === 'writing'
            ? copy.editor.waveformWriting
            : copy.editor.waveformProgress(percent);
    return (
      <View accessibilityLiveRegion="polite" style={styles.panel} testID="waveform-job-panel">
        {processing ? <WaveformKeepAwake /> : null}
        <View style={styles.progressRow}>
          <View
            accessibilityLabel={label}
            accessibilityRole="progressbar"
            accessibilityValue={percent === null ? undefined : { min: 0, max: 100, now: percent }}
            style={styles.track}
          >
            <View
              style={[styles.fill, { width: `${Math.max(0, Math.min(100, percent ?? 0))}%` }]}
            />
          </View>
          <Text style={styles.status}>{label}</Text>
        </View>
        <AppButton
          disabled={job?.status === 'cancelling'}
          label={copy.editor.cancelWaveform}
          onPress={onCancel}
          variant="ghost"
        />
      </View>
    );
  }

  if (pending || orphanedProcessing || failed) {
    return (
      <View style={styles.panel} testID="waveform-job-panel">
        <Text accessibilityLiveRegion="polite" style={styles.status}>
          {failed ? copy.editor.waveformFailed : copy.editor.waveformPaused}
        </Text>
        <AppButton
          label={failed ? copy.editor.retryWaveform : copy.editor.resumeWaveform}
          onPress={onStart}
          variant="ghost"
        />
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  panel: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.soft,
    gap: spacing.sm,
  },
  progressRow: {
    gap: spacing.xs,
  },
  track: {
    height: 8,
    overflow: 'hidden',
    borderRadius: radii.pill,
    backgroundColor: colors.disabledSurface,
  },
  fill: {
    height: '100%',
    backgroundColor: colors.accent,
  },
  status: {
    ...typography.bodySecondary,
  },
});
