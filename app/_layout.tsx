import { useEffect } from 'react';
import { AppState } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { NavigationBar } from 'expo-navigation-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { colors } from '@/constants';
import { diagnosticLog } from '@/diagnostics';
import { projectRepository } from '@/repositories';
import {
  disposeImportRuntime,
  exportCoordinator,
  handleMediaAppStateChange,
  prepareProjectMediaDeletion,
  previewCoordinator,
  resumePendingWaveforms,
} from '@/services';
import {
  configureEditorServices,
  configureProjectReleasePort,
  configureProjectRepository,
} from '@/stores';

configureProjectRepository(projectRepository);
configureEditorServices({ waveformReader: projectRepository });
configureProjectReleasePort({
  async releaseProject(projectId) {
    await prepareProjectMediaDeletion();
    await previewCoordinator.releaseProject(projectId);
  },
});

export default function RootLayout() {
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.background);
    void diagnosticLog.initialize();
    previewCoordinator.start();
    // One cold-start recovery pass is allowed. A later foreground transition
    // must not restart work that backgrounding cancelled.
    let mediaTransition = resumePendingWaveforms();
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      mediaTransition = mediaTransition
        .catch(() => undefined)
        .then(() => handleMediaAppStateChange(state));
    });
    return () => {
      appStateSubscription.remove();
      previewCoordinator.stop();
      exportCoordinator.stop();
      disposeImportRuntime();
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="light" />
      <NavigationBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'fade',
          contentStyle: { backgroundColor: colors.background },
        }}
      />
    </GestureHandlerRootView>
  );
}
