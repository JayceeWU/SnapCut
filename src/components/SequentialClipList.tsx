import { useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { colors, layout, minimumTouchTarget, radii, spacing, typography } from '@/constants';
import type { SnapCutClip, SnapCutSource } from '@/domain';
import { formatTimelineTime } from '@/utils/time';

export const SEQUENTIAL_CLIP_ROW_HEIGHT = 72;
const ROW_GAP = spacing.xs;
const ROW_SLOT_HEIGHT = SEQUENTIAL_CLIP_ROW_HEIGHT + ROW_GAP;

interface SequentialClipRowProps {
  clip: SnapCutClip;
  source: SnapCutSource | undefined;
  index: number;
  clipCount: number;
  disabled: boolean;
  onEdit: (clip: SnapCutClip) => void;
  onMove: (destinationIndex: number) => void;
  onDragStart: () => void;
  onDragMove: (translationY: number, absoluteY: number) => void;
  onDragEnd: (translationY: number) => void;
}

function SequentialClipRow({
  clip,
  source,
  index,
  clipCount,
  disabled,
  onEdit,
  onMove,
  onDragStart,
  onDragMove,
  onDragEnd,
}: SequentialClipRowProps) {
  const [dragOffset, setDragOffset] = useState(0);
  const dragGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!disabled)
        .activateAfterLongPress(220)
        .runOnJS(true)
        .onBegin(() => {
          setDragOffset(0);
          onDragStart();
        })
        .onUpdate(({ translationY, absoluteY }) => {
          setDragOffset(translationY);
          onDragMove(translationY, absoluteY);
        })
        .onFinalize(({ translationY }) => {
          setDragOffset(0);
          onDragEnd(translationY);
        }),
    [disabled, onDragEnd, onDragMove, onDragStart],
  );

  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'moveEarlier' && index > 0) onMove(index - 1);
    if (event.nativeEvent.actionName === 'moveLater' && index < clipCount - 1) onMove(index + 1);
  };

  return (
    <View
      style={[
        styles.row,
        dragOffset !== 0 && styles.draggingRow,
        dragOffset !== 0 && { transform: [{ translateY: dragOffset }] },
      ]}
      testID={`clip-row-${clip.id}`}
    >
      <GestureDetector gesture={dragGesture}>
        <View
          accessibilityActions={[
            { name: 'moveEarlier', label: 'Move earlier' },
            { name: 'moveLater', label: 'Move later' },
          ]}
          accessibilityHint="Long press and drag to reorder"
          accessibilityLabel={`Reorder Clip ${index + 1}`}
          accessibilityRole="adjustable"
          accessibilityState={{ disabled }}
          onAccessibilityAction={onAccessibilityAction}
          style={styles.dragHandle}
          testID={`clip-drag-handle-${clip.id}`}
        >
          <Text accessibilityElementsHidden style={styles.dragGlyph}>
            ≡
          </Text>
        </View>
      </GestureDetector>
      <Pressable
        accessibilityLabel={`Edit Clip ${index + 1}, ${source?.displayName ?? 'Unknown source'}, start ${formatTimelineTime(clip.startMs)}, end ${formatTimelineTime(clip.endMs)}`}
        accessibilityRole="button"
        disabled={disabled}
        onPress={() => onEdit(clip)}
        style={({ pressed }) => [styles.rowBody, pressed && styles.pressed]}
      >
        <View style={styles.leftCopy}>
          <Text numberOfLines={1} style={styles.clipNumber}>
            Clip {index + 1}
          </Text>
          <Text numberOfLines={1} style={styles.sourceName}>
            {source?.displayName ?? 'Unknown source'}
          </Text>
        </View>
        <View style={styles.rangeCopy}>
          <Text numberOfLines={1} style={styles.rangeText}>
            Start {formatTimelineTime(clip.startMs)}
          </Text>
          <Text numberOfLines={1} style={styles.rangeText}>
            End {formatTimelineTime(clip.endMs)}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

interface SequentialClipListProps {
  clips: readonly SnapCutClip[];
  sources: readonly SnapCutSource[];
  disabled?: boolean;
  onEdit: (clip: SnapCutClip) => void;
  onInteractionStart?: () => void;
  onReorder: (clipId: string, destinationIndex: number) => void | Promise<unknown>;
}

export function SequentialClipList({
  clips,
  sources,
  disabled = false,
  onEdit,
  onInteractionStart,
  onReorder,
}: SequentialClipListProps) {
  const listRef = useRef<FlatList<SnapCutClip>>(null);
  const scrollOffsetRef = useRef(0);
  const dragStartScrollOffsetRef = useRef(0);
  const listTopRef = useRef(0);
  const listHeightRef = useRef(0);
  const draggingClipIdRef = useRef<string | null>(null);
  const sourcesById = useMemo(
    () => new Map(sources.map((source) => [source.id, source])),
    [sources],
  );

  const onLayout = (event: LayoutChangeEvent) => {
    listHeightRef.current = event.nativeEvent.layout.height;
    event.currentTarget.measureInWindow((_x, y) => {
      listTopRef.current = y;
    });
  };

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollOffsetRef.current = Math.max(0, event.nativeEvent.contentOffset.y);
  };

  const scrollBy = (delta: number) => {
    const maximum = Math.max(0, clips.length * ROW_SLOT_HEIGHT - listHeightRef.current);
    const next = Math.min(Math.max(scrollOffsetRef.current + delta, 0), maximum);
    if (next === scrollOffsetRef.current) return;
    scrollOffsetRef.current = next;
    listRef.current?.scrollToOffset({ animated: false, offset: next });
  };

  return (
    <FlatList
      contentContainerStyle={clips.length === 0 ? styles.emptyContent : styles.listContent}
      data={[...clips]}
      getItemLayout={(_data, index) => ({
        index,
        length: ROW_SLOT_HEIGHT,
        offset: ROW_SLOT_HEIGHT * index,
      })}
      keyExtractor={(clip) => clip.id}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No clips yet</Text>
          <Text style={styles.emptyMessage}>Tap + Clip and choose a range from your media.</Text>
        </View>
      }
      onLayout={onLayout}
      onScroll={onScroll}
      ref={listRef}
      renderItem={({ item: clip, index }) => (
        <SequentialClipRow
          clip={clip}
          clipCount={clips.length}
          disabled={disabled}
          index={index}
          onDragEnd={(translationY) => {
            const draggedId = draggingClipIdRef.current;
            draggingClipIdRef.current = null;
            if (!draggedId) return;
            const scrollDelta = scrollOffsetRef.current - dragStartScrollOffsetRef.current;
            const destinationIndex = Math.min(
              clips.length - 1,
              Math.max(0, Math.round(index + (translationY + scrollDelta) / ROW_SLOT_HEIGHT)),
            );
            if (destinationIndex !== index) void onReorder(draggedId, destinationIndex);
          }}
          onDragMove={(_translationY, absoluteY) => {
            const relativeY = absoluteY - listTopRef.current;
            if (relativeY < minimumTouchTarget) scrollBy(-ROW_SLOT_HEIGHT);
            else if (relativeY > listHeightRef.current - minimumTouchTarget)
              scrollBy(ROW_SLOT_HEIGHT);
          }}
          onDragStart={() => {
            draggingClipIdRef.current = clip.id;
            dragStartScrollOffsetRef.current = scrollOffsetRef.current;
            onInteractionStart?.();
          }}
          onEdit={onEdit}
          onMove={(destinationIndex) => {
            onInteractionStart?.();
            void onReorder(clip.id, destinationIndex);
          }}
          source={sourcesById.get(clip.sourceId)}
        />
      )}
      scrollEventThrottle={16}
      style={styles.list}
      testID="sequential-clip-list"
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: spacing.md,
  },
  emptyContent: {
    flexGrow: 1,
  },
  row: {
    ...layout.card,
    height: SEQUENTIAL_CLIP_ROW_HEIGHT,
    marginBottom: ROW_GAP,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  draggingRow: {
    zIndex: 10,
    borderColor: colors.focus,
    elevation: 6,
  },
  dragHandle: {
    width: minimumTouchTarget,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRightColor: colors.border,
    borderRightWidth: StyleSheet.hairlineWidth,
    backgroundColor: colors.soft,
  },
  dragGlyph: {
    color: colors.textSecondary,
    fontSize: 28,
    lineHeight: 30,
    transform: [{ rotate: '90deg' }],
  },
  rowBody: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
  },
  leftCopy: {
    minWidth: 0,
    flex: 1,
    paddingRight: spacing.xs,
  },
  clipNumber: {
    ...typography.label,
  },
  sourceName: {
    ...typography.caption,
    marginTop: spacing.xxs,
  },
  rangeCopy: {
    minWidth: 122,
    alignItems: 'flex-end',
  },
  rangeText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  pressed: {
    backgroundColor: colors.accentTranslucent,
  },
  empty: {
    flex: 1,
    minHeight: 128,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  emptyTitle: {
    ...typography.cardTitle,
  },
  emptyMessage: {
    ...typography.bodySecondary,
    maxWidth: 280,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
});
