import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  AppButton,
  ConfirmDeleteModal,
  CorruptProjectCard,
  EmptyState,
  ErrorBanner,
  ProjectCard,
  ProjectNameModal,
} from '@/components';
import { colors, copy, layout, spacing, typography } from '@/constants';
import type { SnapCutProject } from '@/domain/types';
import { useProjectStore } from '@/stores';

type NameDialog = { mode: 'create'; project: null } | { mode: 'rename'; project: SnapCutProject };

export default function ProjectListScreen() {
  const projects = useProjectStore((state) => state.projects);
  const repairStatuses = useProjectStore((state) => state.repairStatuses);
  const corruptProjectIds = useProjectStore((state) => state.corruptProjectIds);
  const loading = useProjectStore((state) => state.loadingList);
  const mutation = useProjectStore((state) => state.mutation);
  const initialized = useProjectStore((state) => state.initialized);
  const error = useProjectStore((state) => state.error);
  const loadProjects = useProjectStore((state) => state.loadProjects);
  const createProject = useProjectStore((state) => state.createProject);
  const renameProject = useProjectStore((state) => state.renameProject);
  const deleteProject = useProjectStore((state) => state.deleteProject);
  const deleteCorruptProject = useProjectStore((state) => state.deleteCorruptProject);
  const clearError = useProjectStore((state) => state.clearError);
  const [nameDialog, setNameDialog] = useState<NameDialog | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SnapCutProject | null>(null);
  const [deleteCorruptTarget, setDeleteCorruptTarget] = useState<string | null>(null);

  useEffect(() => {
    if (!initialized) {
      void loadProjects();
    }
  }, [initialized, loadProjects]);

  const openProject = (projectId: string) => {
    router.push({ pathname: '/project/[id]', params: { id: projectId } });
  };

  const submitName = async (name: string) => {
    if (!nameDialog) return;

    if (nameDialog.mode === 'create') {
      const project = await createProject(name);
      if (project) {
        setNameDialog(null);
        openProject(project.id);
      }
      return;
    }

    const renamed = await renameProject(nameDialog.project.id, name);
    if (renamed) setNameDialog(null);
  };

  const confirmDelete = async () => {
    if (deleteTarget) {
      const deleted = await deleteProject(deleteTarget.id);
      if (deleted) setDeleteTarget(null);
      return;
    }
    if (deleteCorruptTarget) {
      const deleted = await deleteCorruptProject(deleteCorruptTarget);
      if (deleted) setDeleteCorruptTarget(null);
    }
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
      <FlatList
        contentContainerStyle={[
          styles.content,
          projects.length === 0 && corruptProjectIds.length === 0 && styles.emptyContent,
        ]}
        data={projects}
        keyExtractor={(project) => project.id}
        ListHeaderComponent={
          <View>
            <View style={styles.header}>
              <View style={styles.titleColumn}>
                <Text style={styles.eyebrow}>{copy.projects.eyebrow}</Text>
                <Text accessibilityRole="header" style={styles.title}>
                  {copy.appName}
                </Text>
              </View>
              <View style={styles.headerActions}>
                {__DEV__ ? (
                  <AppButton
                    label={copy.projects.diagnosticsAction}
                    onPress={() => router.push('/diagnostics')}
                    variant="ghost"
                  />
                ) : null}
                <AppButton
                  label={copy.projects.newAction}
                  onPress={() => setNameDialog({ mode: 'create', project: null })}
                />
              </View>
            </View>
            {error ? (
              <ErrorBanner
                message={error}
                onDismiss={clearError}
                onRetry={() => void loadProjects()}
              />
            ) : null}
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <View accessibilityLabel={copy.projects.loading} style={styles.loading}>
              <ActivityIndicator color={colors.accent} size="large" />
              <Text style={styles.loadingLabel}>{copy.projects.loading}</Text>
            </View>
          ) : corruptProjectIds.length === 0 ? (
            <EmptyState
              actionLabel={copy.projects.newAction}
              message={copy.projects.emptyMessage}
              onAction={() => setNameDialog({ mode: 'create', project: null })}
              testID="empty-project-list"
              title={copy.projects.emptyTitle}
            />
          ) : null
        }
        ListFooterComponent={
          <View>
            {corruptProjectIds.map((projectId) => (
              <CorruptProjectCard
                key={projectId}
                onDelete={() => setDeleteCorruptTarget(projectId)}
                projectId={projectId}
              />
            ))}
          </View>
        }
        renderItem={({ item }) => (
          <ProjectCard
            onDelete={() => setDeleteTarget(item)}
            onOpen={() => openProject(item.id)}
            onRename={() => setNameDialog({ mode: 'rename', project: item })}
            project={item}
            repairStatus={repairStatuses[item.id]}
          />
        )}
      />
      <ProjectNameModal
        busy={mutation === 'create' || mutation === 'rename'}
        initialName={nameDialog?.project?.name}
        mode={nameDialog?.mode ?? 'create'}
        onCancel={() => setNameDialog(null)}
        onSubmit={(name) => void submitName(name)}
        visible={nameDialog !== null}
      />
      <ConfirmDeleteModal
        busy={mutation === 'delete'}
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteCorruptTarget(null);
        }}
        onConfirm={() => void confirmDelete()}
        projectName={deleteTarget?.name ?? copy.projects.corruptTitle}
        visible={deleteTarget !== null || deleteCorruptTarget !== null}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    ...layout.screen,
  },
  content: {
    ...layout.screenContent,
    paddingTop: spacing.lg,
  },
  emptyContent: {
    flexGrow: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  titleColumn: {
    flexShrink: 1,
  },
  headerActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: spacing.xs,
  },
  eyebrow: {
    ...typography.caption,
    color: colors.focus,
    fontWeight: '700',
    letterSpacing: 1.3,
  },
  title: {
    ...typography.appTitle,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  loadingLabel: {
    ...typography.bodySecondary,
    marginTop: spacing.md,
  },
});
