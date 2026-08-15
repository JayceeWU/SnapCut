import {
  addClip,
  addSource,
  createProject,
  deleteClip,
  removeUnusedSource,
  updateClip,
} from '@/domain';
import type { SnapCutProject, SnapCutSource } from '@/domain';
import { MAX_CLIP_EDIT_HISTORY, useClipEditHistoryStore } from '@/stores';

const PROJECT_A_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_B_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_ID = '33333333-3333-4333-8333-333333333333';
const CLIP_ID = '44444444-4444-4444-8444-444444444444';
const CREATED_AT = '2026-08-12T20:00:00.000Z';
const UPDATED_AT = '2026-08-12T20:01:00.000Z';

function source(): SnapCutSource {
  return {
    id: SOURCE_ID,
    displayName: 'session.m4a',
    originalMimeType: 'audio/mp4',
    sourceKind: 'm4a',
    privateAudioFileName: 'source.m4a',
    durationMs: 60_000,
    codecMime: 'audio/mp4a-latm',
    sampleRateHz: 48_000,
    channelCount: 2,
    encodedBitrateBps: 192_000,
    pcmBitsPerSample: null,
    aacProfile: 'aac-lc',
    codecConfigFingerprint: null,
    encoderDelayFrames: null,
    encoderPaddingFrames: null,
    privateAudioSha256: null,
    fileSizeBytes: 1_024,
    waveformFileName: 'waveform.json',
    waveformStatus: 'pending',
    createdAt: CREATED_AT,
  };
}

function project(id = PROJECT_A_ID): SnapCutProject {
  return addClip(addSource(createProject({ id, name: 'History', now: CREATED_AT }), source()), {
    id: CLIP_ID,
    sourceId: SOURCE_ID,
    startMs: 1_000,
    endMs: 2_000,
  });
}

describe('clip edit history store', () => {
  beforeEach(() => useClipEditHistoryStore.getState().reset());

  test('undoes and redoes clips on top of the latest source and waveform metadata', () => {
    const before = project();
    useClipEditHistoryStore.getState().record(before);
    const edited = updateClip(before, CLIP_ID, { endMs: 3_000 });
    const latest: SnapCutProject = {
      ...edited,
      name: 'Latest name',
      updatedAt: UPDATED_AT,
      sources: [
        {
          ...edited.sources[0]!,
          waveformFileName: 'waveform-v2.json',
          waveformStatus: 'ready',
        },
      ],
    };

    const undone = useClipEditHistoryStore.getState().previewUndo(latest);
    expect(undone.clips[0]?.endMs).toBe(2_000);
    expect(undone).toMatchObject({
      name: 'Latest name',
      updatedAt: UPDATED_AT,
      sources: [{ waveformFileName: 'waveform-v2.json', waveformStatus: 'ready' }],
    });
    expect(useClipEditHistoryStore.getState()).toMatchObject({ canUndo: true, canRedo: false });
    useClipEditHistoryStore.getState().commitUndo(latest);
    expect(useClipEditHistoryStore.getState()).toMatchObject({ canUndo: false, canRedo: true });

    const redone = useClipEditHistoryStore.getState().previewRedo(undone);
    expect(redone.clips[0]?.endMs).toBe(3_000);
    expect(redone.sources).toEqual(latest.sources);
    useClipEditHistoryStore.getState().commitRedo(undone);
  });

  test('a new edit clears redo and project switches or reset clear both stacks', () => {
    const before = project();
    useClipEditHistoryStore.getState().record(before);
    const edited = updateClip(before, CLIP_ID, { endMs: 3_000 });
    const undone = useClipEditHistoryStore.getState().previewUndo(edited);
    useClipEditHistoryStore.getState().commitUndo(edited);
    expect(useClipEditHistoryStore.getState().canRedo).toBe(true);

    useClipEditHistoryStore.getState().record(undone);
    const replacement = updateClip(undone, CLIP_ID, { endMs: 2_500 });
    expect(useClipEditHistoryStore.getState().canRedo).toBe(false);
    expect(useClipEditHistoryStore.getState().previewRedo(replacement)).toEqual(replacement);

    const other = project(PROJECT_B_ID);
    useClipEditHistoryStore.getState().syncProject(other.id);
    expect(useClipEditHistoryStore.getState()).toMatchObject({
      projectId: other.id,
      canUndo: false,
      canRedo: false,
    });
    expect(useClipEditHistoryStore.getState().previewUndo(other)).toEqual(other);

    useClipEditHistoryStore.getState().reset();
    expect(useClipEditHistoryStore.getState()).toMatchObject({
      projectId: null,
      canUndo: false,
      canRedo: false,
    });
  });

  test('leaves history unchanged when an undo or redo preview is not committed', () => {
    const before = project();
    useClipEditHistoryStore.getState().record(before);
    const edited = updateClip(before, CLIP_ID, { endMs: 3_000 });

    const firstUndoCandidate = useClipEditHistoryStore.getState().previewUndo(edited);
    expect(useClipEditHistoryStore.getState()).toMatchObject({ canUndo: true, canRedo: false });
    expect(useClipEditHistoryStore.getState().previewUndo(edited)).toEqual(firstUndoCandidate);

    useClipEditHistoryStore.getState().commitUndo(edited);
    const firstRedoCandidate = useClipEditHistoryStore.getState().previewRedo(firstUndoCandidate);
    expect(useClipEditHistoryStore.getState()).toMatchObject({ canUndo: false, canRedo: true });
    expect(useClipEditHistoryStore.getState().previewRedo(firstUndoCandidate)).toEqual(
      firstRedoCandidate,
    );
  });

  test('retains at most the latest 50 pre-edit clip snapshots', () => {
    let current = project();
    for (let edit = 0; edit < MAX_CLIP_EDIT_HISTORY + 10; edit += 1) {
      useClipEditHistoryStore.getState().record(current);
      current = updateClip(current, CLIP_ID, { endMs: 2_001 + edit });
    }

    for (let undo = 0; undo < MAX_CLIP_EDIT_HISTORY; undo += 1) {
      const beforeUndo = current;
      current = useClipEditHistoryStore.getState().previewUndo(current);
      useClipEditHistoryStore.getState().commitUndo(beforeUndo);
    }
    expect(current.clips[0]?.endMs).toBe(2_010);
    expect(useClipEditHistoryStore.getState().canUndo).toBe(false);
    expect(useClipEditHistoryStore.getState().previewUndo(current)).toEqual(current);
  });

  test('clears snapshots after a formerly referenced source is deleted successfully', () => {
    const withReferencedSource = project();
    useClipEditHistoryStore.getState().syncProject(withReferencedSource.id);
    useClipEditHistoryStore.getState().record(withReferencedSource);

    const withoutClip = deleteClip(withReferencedSource, CLIP_ID);
    const afterSuccessfulSourceDelete = removeUnusedSource(withoutClip, SOURCE_ID);
    useClipEditHistoryStore.getState().clearProjectHistory(withReferencedSource.id);

    expect(useClipEditHistoryStore.getState()).toMatchObject({
      projectId: withReferencedSource.id,
      canUndo: false,
      canRedo: false,
    });
    expect(useClipEditHistoryStore.getState().previewUndo(afterSuccessfulSourceDelete)).toEqual(
      afterSuccessfulSourceDelete,
    );
    expect(useClipEditHistoryStore.getState().previewRedo(afterSuccessfulSourceDelete)).toEqual(
      afterSuccessfulSourceDelete,
    );
  });

  test('does not clear another project history', () => {
    const before = project();
    useClipEditHistoryStore.getState().record(before);

    useClipEditHistoryStore.getState().clearProjectHistory(PROJECT_B_ID);

    expect(useClipEditHistoryStore.getState()).toMatchObject({ canUndo: true, canRedo: false });
  });
});
