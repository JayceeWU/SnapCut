import fs from 'node:fs';
import path from 'node:path';

describe('root media recovery startup', () => {
  it('handles a rejected cold-start waveform resume immediately', () => {
    const layout = fs.readFileSync(path.resolve(__dirname, '../app/_layout.tsx'), 'utf8');

    expect(layout).toContain('resumePendingWaveforms().catch(() => undefined)');
  });

  it('absorbs fire-and-forget Undo and Redo release failures', () => {
    const editor = fs.readFileSync(path.resolve(__dirname, '../app/project/[id].tsx'), 'utf8');
    const commandStart = editor.indexOf(
      "const runHistoryCommand = async (direction: 'undo' | 'redo')",
    );
    const commandEnd = editor.indexOf('const changeCompositionCursor', commandStart);
    const command = editor.slice(commandStart, commandEnd);

    expect(commandStart).toBeGreaterThanOrEqual(0);
    expect(command).toContain('await previewCoordinator.releaseProject(project.id)');
    expect(command).toMatch(/}\s*catch\s*{/);
  });

  it('keeps the editor Add Clip entry while removing the Sources Add Clip bridge', () => {
    const editor = fs.readFileSync(path.resolve(__dirname, '../app/project/[id].tsx'), 'utf8');

    expect(editor).toContain('testID="add-clip"');
    expect(editor).toContain('testID="add-crossfade"');
    expect(editor).not.toContain('onAddClip=');
  });
});
