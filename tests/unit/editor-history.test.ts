import { describe, expect, it } from 'vitest';
import {
  canRedoHistory,
  canUndoHistory,
  createNoteHistory,
  recordNoteEdit,
  redoNoteHistory,
  undoNoteHistory,
} from '../../src/lib/note-history.ts';
import {
  applyTextSegmentEdit,
  findSegmentForGlobalOffset,
  parseEditorSegments,
  removeImageSegment,
  updateImageSegmentCaption,
} from '../../src/lib/editor-segments.ts';

describe('note-history undo/redo manager', () => {
  it('supports commit checkpoints, undo, and redo', () => {
    let history = createNoteHistory({ title: '筆記', content: '第一句' });
    expect(canUndoHistory(history)).toBe(false);
    expect(canRedoHistory(history)).toBe(false);

    history = recordNoteEdit(
      history,
      { title: '筆記', content: '第一句\n==[yellow]重點==', selectionStart: 16, selectionEnd: 16 },
      { mode: 'commit' },
    );
    expect(canUndoHistory(history)).toBe(true);
    expect(canRedoHistory(history)).toBe(false);

    const undone = undoNoteHistory(history);
    expect(undone.snapshot?.content).toBe('第一句');
    expect(canUndoHistory(undone.nextState)).toBe(false);
    expect(canRedoHistory(undone.nextState)).toBe(true);

    const redone = redoNoteHistory(undone.nextState);
    expect(redone.snapshot?.content).toBe('第一句\n==[yellow]重點==');
    expect(canRedoHistory(redone.nextState)).toBe(false);
  });

  it('coalesces rapid typing bursts and separates distinct pauses', () => {
    let history = createNoteHistory({ title: 'T', content: '' });
    history = recordNoteEdit(history, { title: 'T', content: 'A' }, { mode: 'typing', now: 1000 });
    history = recordNoteEdit(history, { title: 'T', content: 'AB' }, { mode: 'typing', now: 1120 });
    history = recordNoteEdit(history, { title: 'T', content: 'ABC' }, { mode: 'typing', now: 1240 });

    // Entire rapid burst undoes back to empty
    const afterBurstUndo = undoNoteHistory(history);
    expect(afterBurstUndo.snapshot?.content).toBe('');

    // After a pause (> 600ms), new typing creates a separate step
    let paused = recordNoteEdit(history, { title: 'T', content: 'ABCD' }, { mode: 'typing', now: 2500 });
    const step1 = undoNoteHistory(paused);
    expect(step1.snapshot?.content).toBe('ABC');
    const step2 = undoNoteHistory(step1.nextState);
    expect(step2.snapshot?.content).toBe('');
  });

  it('clears redo stack when a new edit occurs after undo', () => {
    let history = createNoteHistory({ title: 'T', content: 'v1' });
    history = recordNoteEdit(history, { title: 'T', content: 'v2' }, { mode: 'commit' });
    const undone = undoNoteHistory(history);
    expect(canRedoHistory(undone.nextState)).toBe(true);

    const branched = recordNoteEdit(
      undone.nextState,
      { title: 'T', content: 'v3' },
      { mode: 'commit' },
    );
    expect(canRedoHistory(branched)).toBe(false);
    expect(branched.present.content).toBe('v3');
  });
});

describe('editor-segments visual image segmentation', () => {
  const sampleDataUrl = 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=';

  it('keeps plain markdown as a single text segment', () => {
    const segments = parseEditorSegments('# 標題\n\n一般段落內容');
    expect(segments).toHaveLength(1);
    expect(segments[0].kind).toBe('text');
  });

  it('splits embedded data-url images cleanly without exposing base64 text in text segments', () => {
    const md = `前段文字\n\n![實驗圖表](${sampleDataUrl})\n\n後段文字`;
    const segments = parseEditorSegments(md);
    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({ kind: 'text', text: '前段文字' });
    expect(segments[1]).toMatchObject({ kind: 'image', alt: '實驗圖表', src: sampleDataUrl });
    expect(segments[2]).toMatchObject({ kind: 'text', text: '後段文字' });

    // Verify editing before or after preserves exact markdown & base64
    if (segments[0].kind === 'text') {
      const edited = applyTextSegmentEdit(md, segments[0], '修改後前段');
      expect(edited.nextContent).toBe(`修改後前段\n\n![實驗圖表](${sampleDataUrl})\n\n後段文字`);
    }
  });

  it('supports notes starting or ending with an image via virtual text segments', () => {
    const md = `![截圖](${sampleDataUrl})`;
    const segments = parseEditorSegments(md);
    expect(segments.map((s) => s.kind)).toEqual(['text', 'image', 'text']);

    const trailing = segments[2];
    expect(trailing.kind).toBe('text');
    if (trailing.kind === 'text') {
      const edited = applyTextSegmentEdit(md, trailing, '圖片說明');
      expect(edited.nextContent).toBe(`![截圖](${sampleDataUrl})\n\n圖片說明`);
    }
  });

  it('ignores markdown image syntax inside fenced code blocks', () => {
    const md = '```markdown\n![example](https://example.com/a.png)\n```';
    const segments = parseEditorSegments(md);
    expect(segments).toHaveLength(1);
    expect(segments[0].kind).toBe('text');
  });

  it('updates caption and removes image segment cleanly', () => {
    const md = `段落一\n\n![舊標題](${sampleDataUrl})\n\n段落二`;
    const segments = parseEditorSegments(md);
    const img = segments[1];
    expect(img.kind).toBe('image');
    if (img.kind === 'image') {
      const renamed = updateImageSegmentCaption(md, img, '新標題 [修正]');
      expect(renamed).toContain('![新標題  修正 ](');

      const removed = removeImageSegment(md, img);
      expect(removed.nextContent).toBe('段落一\n\n段落二');
      expect(removed.nextCursorOffset).toBe('段落一'.length);
    }

    const located = findSegmentForGlobalOffset(segments, md.indexOf('段落二') + 1);
    expect(located?.segment.kind).toBe('text');
    expect(located?.localOffset).toBe(1);
  });
});
