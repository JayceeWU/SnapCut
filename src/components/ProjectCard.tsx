import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { SnapCutProject } from '@/domain/types';
import type { ProjectRepairStatus } from '@/services/RecoveryService';
import {
  colors,
  copy,
  formatDuration,
  formatUpdatedAt,
  layout,
  minimumTouchTarget,
  spacing,
  typography,
} from '@/constants';

interface ProjectCardProps {
  project: SnapCutProject;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  repairStatus?: ProjectRepairStatus | undefined;
}

export function ProjectCard({
  project,
  onOpen,
  onRename,
  onDelete,
  repairStatus,
}: ProjectCardProps) {
  const durationMs = project.clips.reduce(
    (total, clip) => total + Math.max(0, clip.endMs - clip.startMs),
    0,
  );

  return (
    <View style={styles.card} testID={`project-card-${project.id}`}>
      <Pressable
        accessibilityHint={copy.projects.openHint}
        accessibilityLabel={project.name}
        accessibilityRole="button"
        accessibilityState={{ disabled: repairStatus?.state === 'needs-repair' }}
        disabled={repairStatus?.state === 'needs-repair'}
        onPress={onOpen}
        style={({ pressed }) => [
          styles.openArea,
          repairStatus?.state === 'needs-repair' && styles.repairArea,
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.headingRow}>
          <Text accessibilityRole="header" numberOfLines={2} style={styles.name}>
            {project.name}
          </Text>
          <Text accessibilityElementsHidden style={styles.chevron}>
            ›
          </Text>
        </View>
        <View style={styles.metrics}>
          <Text style={styles.metric}>{copy.projects.sourceCount(project.sources.length)}</Text>
          <View accessibilityElementsHidden style={styles.dot} />
          <Text style={styles.metric}>{copy.projects.clipCount(project.clips.length)}</Text>
          <View accessibilityElementsHidden style={styles.dot} />
          <Text style={styles.metric}>{copy.projects.duration(formatDuration(durationMs))}</Text>
        </View>
        <Text style={styles.updated}>
          {copy.projects.updated(formatUpdatedAt(project.updatedAt))}
        </Text>
        {repairStatus?.state === 'needs-repair' ? (
          <View accessibilityRole="alert" style={styles.repairNotice}>
            <Text style={styles.repairTitle}>{copy.projects.repairTitle}</Text>
            {repairStatus.issues.map((issue) => (
              <Text key={issue} style={styles.repairIssue}>
                {copy.projects.repairIssue(issue)}
              </Text>
            ))}
          </View>
        ) : null}
      </Pressable>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={onRename}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <Text style={styles.actionLabel}>{copy.projects.renameAction}</Text>
        </Pressable>
        <View style={styles.divider} />
        <Pressable
          accessibilityRole="button"
          onPress={onDelete}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <Text style={[styles.actionLabel, styles.deleteLabel]}>{copy.projects.deleteAction}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...layout.card,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  openArea: {
    padding: spacing.md,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  name: {
    ...typography.cardTitle,
    flex: 1,
    marginRight: spacing.sm,
  },
  chevron: {
    color: colors.focus,
    fontSize: 30,
    lineHeight: 30,
  },
  metrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  metric: {
    ...typography.caption,
    color: colors.textPrimary,
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.waveformOverview,
  },
  updated: {
    ...typography.caption,
    marginTop: spacing.xs,
  },
  repairArea: {
    opacity: 0.88,
  },
  repairNotice: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderColor: colors.error,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    backgroundColor: colors.soft,
  },
  repairTitle: {
    ...typography.label,
    color: colors.error,
  },
  repairIssue: {
    ...typography.caption,
    marginTop: spacing.xs,
    color: colors.textPrimary,
  },
  actions: {
    minHeight: minimumTouchTarget,
    flexDirection: 'row',
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  action: {
    flex: 1,
    minHeight: minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  actionLabel: {
    ...typography.label,
    color: colors.focus,
  },
  deleteLabel: {
    color: colors.error,
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  pressed: {
    backgroundColor: colors.accentTranslucent,
  },
});
