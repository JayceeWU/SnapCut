import { useEffect, useRef, useState } from 'react';
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
  const [renameTarget, setRenameTarget] = useState<SnapCutProject | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SnapCutProject | null>(null);
  const [deleteCorruptTarget, setDeleteCorruptTarget] = useState<string | null>(null);
  const creatingRef = useRef(false);
  const renameDialogVisible = renameTarget !== null;
  const deleteDialogVisible = deleteTarget !== null || deleteCorruptTarget !== null;

  useEffect(() => {
    if (!initialized) {
      void loadProjects();
    }
  }, [initialized, loadProjects]);

  const openProject = (projectId: string) => {
    router.push({ pathname: '/project/[id]', params: { id: projectId } });
  };

  const createNewProject = async () => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    try {
      const project = await createProject();
      if (project) openProject(project.id);
    } finally {
      creatingRef.current = false;
    }
  };

  const submitRename = async (name: string) => {
    if (!renameTarget) return;
    const renamed = await renameProject(renameTarget.id, name);
    if (renamed) setRenameTarget(null);
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
                <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
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
                  disabled={mutation === 'create'}
                  label={copy.projects.newAction}
                  loading={mutation === 'create'}
                  onPress={() => void createNewProject()}
                />
              </View>
            </View>
            {error && !renameDialogVisible && !deleteDialogVisible ? (
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
              actionDisabled={mutation === 'create'}
              actionLabel={copy.projects.newAction}
              actionLoading={mutation === 'create'}
              message={copy.projects.emptyMessage}
              onAction={() => void createNewProject()}
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
                onDelete={() => {
                  clearError();
                  setDeleteCorruptTarget(projectId);
                }}
                projectId={projectId}
              />
            ))}
          </View>
        }
        renderItem={({ item }) => (
          <ProjectCard
            onDelete={() => {
              clearError();
              setDeleteTarget(item);
            }}
            onOpen={() => openProject(item.id)}
            onRename={() => {
              clearError();
              setRenameTarget(item);
            }}
            project={item}
            repairStatus={repairStatuses[item.id]}
          />
        )}
      />
      <ProjectNameModal
        busy={mutation === 'rename'}
        initialName={renameTarget?.name}
        onCancel={() => {
          setRenameTarget(null);
          clearError();
        }}
        onDismissError={clearError}
        onSubmit={(name) => void submitRename(name)}
        operationError={error}
        visible={renameDialogVisible}
      />
      <ConfirmDeleteModal
        busy={mutation === 'delete'}
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteCorruptTarget(null);
          clearError();
        }}
        onConfirm={() => void confirmDelete()}
        onDismissError={clearError}
        operationError={error}
        projectName={deleteTarget?.name ?? copy.projects.corruptTitle}
        visible={deleteDialogVisible}
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
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  titleColumn: {
    minWidth: 150,
    flexShrink: 1,
  },
  headerActions: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    flexShrink: 0,
    justifyContent: 'flex-end',
    gap: spacing.xs,
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
