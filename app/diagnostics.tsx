import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton, EmptyState, ErrorBanner } from '@/components';
import { colors, copy, layout, spacing, typography } from '@/constants';
import { diagnosticLog, type DiagnosticEntry } from '@/diagnostics';
import SnapCutMedia from '@/native';
import type { CodecBuildInfo, NativeHealth } from '@/native';
import { useExportStore, useImportStore, usePlaybackStore } from '@/stores';

interface NativeSnapshot {
  health: NativeHealth | null;
  codecs: CodecBuildInfo | null;
}

export default function DiagnosticsScreen() {
  const [native, setNative] = useState<NativeSnapshot>(() => {
    if (!__DEV__) return { health: null, codecs: null };
    try {
      return { health: SnapCutMedia.getHealth(), codecs: SnapCutMedia.getCodecBuildInfo() };
    } catch {
      return { health: null, codecs: null };
    }
  });
  const [entries, setEntries] = useState<DiagnosticEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const importStage = useImportStore((state) => state.stage);
  const exportStatus = useExportStore((state) => state.status);
  const previewAvailable = usePlaybackStore((state) => state.available);
  const previewPlaying = usePlaybackStore((state) => state.playing);

  const refresh = useCallback(async () => {
    try {
      const nextNative = {
        health: SnapCutMedia.getHealth(),
        codecs: SnapCutMedia.getCodecBuildInfo(),
      };
      setNative(nextNative);
      setEntries(await diagnosticLog.list());
      setError(null);
    } catch {
      setError('Diagnostics could not be refreshed.');
    }
  }, []);

  useEffect(() => {
    if (!__DEV__) return;
    let active = true;
    void diagnosticLog.list().then((nextEntries) => {
      if (active) setEntries(nextEntries);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!__DEV__) {
    return (
      <SafeAreaView style={styles.screen}>
        <EmptyState
          actionLabel={copy.diagnostics.backAction}
          message={copy.diagnostics.unavailableMessage}
          onAction={() => router.replace('/')}
          title={copy.diagnostics.unavailableTitle}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <AppButton
            label={copy.diagnostics.backAction}
            onPress={() => router.back()}
            variant="ghost"
          />
          <Text accessibilityRole="header" style={styles.title}>
            {copy.diagnostics.title}
          </Text>
          <AppButton
            label={copy.diagnostics.refreshAction}
            onPress={() => void refresh()}
            variant="ghost"
          />
        </View>
        {error ? <ErrorBanner message={error} onRetry={() => void refresh()} /> : null}

        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {copy.diagnostics.moduleTitle}
        </Text>
        <View style={styles.card}>
          <DiagnosticRow label="Ready" value={String(native.health?.ready ?? false)} />
          <DiagnosticRow
            label="Media pipeline"
            value={String(native.health?.mediaPipelineAvailable ?? false)}
          />
          <DiagnosticRow label="Media3" value={libraryValue(native.codecs?.media3)} />
          <DiagnosticRow label="libFLAC" value={libraryValue(native.codecs?.flac)} />
          <DiagnosticRow label="LAME" value={libraryValue(native.codecs?.lame)} />
          <DiagnosticRow label="libsamplerate" value={libraryValue(native.codecs?.libsamplerate)} />
        </View>

        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {copy.diagnostics.activityTitle}
        </Text>
        <View style={styles.card}>
          <DiagnosticRow label="Import" value={importStage} />
          <DiagnosticRow label="Export" value={exportStatus} />
          <DiagnosticRow label="Preview available" value={String(previewAvailable)} />
          <DiagnosticRow label="Preview playing" value={String(previewPlaying)} />
        </View>

        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {copy.diagnostics.logTitle}
        </Text>
        <View style={styles.card}>
          {entries.length === 0 ? (
            <Text style={styles.secondary}>{copy.diagnostics.noEntries}</Text>
          ) : (
            [...entries].reverse().map((entry, index) => (
              <View key={`${entry.timestamp}:${index}`} style={styles.logEntry}>
                <Text style={styles.logTitle}>
                  {entry.timestamp} [{entry.level.toUpperCase()}] {entry.event}
                </Text>
                <Text style={styles.secondary}>{JSON.stringify(entry.fields)}</Text>
              </View>
            ))
          )}
        </View>
        <View style={styles.actions}>
          <AppButton
            label={copy.diagnostics.clearAction}
            onPress={() => void diagnosticLog.clear().then(refresh)}
            variant="ghost"
          />
          <AppButton
            label={copy.diagnostics.shareAction}
            onPress={() => void diagnosticLog.share().catch(() => setError('Log sharing failed.'))}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function libraryValue(value: CodecBuildInfo['media3'] | undefined): string {
  if (!value) return 'Unavailable';
  return `${value.available ? 'Available' : 'Unavailable'} · ${value.version ?? 'Not loaded'}`;
}

function DiagnosticRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.secondary}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { ...layout.screen },
  content: { ...layout.screenContent, paddingTop: spacing.sm },
  header: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  title: { ...typography.screenTitle, flex: 1, textAlign: 'center' },
  sectionTitle: { ...typography.sectionTitle, marginTop: spacing.lg, marginBottom: spacing.sm },
  card: { ...layout.card, padding: spacing.md },
  row: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  secondary: { ...typography.caption },
  value: { ...typography.label, flexShrink: 1, textAlign: 'right' },
  logEntry: { paddingVertical: spacing.sm, borderBottomColor: colors.border, borderBottomWidth: 1 },
  logTitle: { ...typography.caption, color: colors.textPrimary },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
});
