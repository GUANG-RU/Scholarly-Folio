import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { createNoteDocxBuffer } from '../../src/lib/export/docx.ts';
import {
  buildReferencesMarkdown,
  createNotesZipBuffer,
  sanitizeFilename,
} from '../../src/lib/export/packager.ts';

describe('export/packager', () => {
  it('sanitizes filenames to prevent path traversal attacks', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('etc-passwd');
    expect(sanitizeFilename('..\\..\\secret.md')).toBe('secret.md');
    expect(sanitizeFilename('...')).toBe('untitled-note');
    expect(sanitizeFilename('研究筆記：Raft 共識演算法')).toBe('研究筆記：Raft-共識演算法');
  });

  it('creates valid zip archive with notes/*.md and references.md', async () => {
    const buffer = await createNotesZipBuffer([
      {
        id: 'n1',
        title: 'Raft Consensus',
        content: 'Leader election requires majority quorum.',
        tags: ['Distributed Systems'],
        summary: 'Summary of Raft.',
        updatedAt: '2026-11-24T00:00:00.000Z',
        courseRefs: [
          {
            type: 'COURSE',
            title: 'MIT 6.824 Distributed Systems',
            provider: 'MIT_OCW',
            summary: 'Lab 2 covers Raft.',
            url: 'https://pdos.csail.mit.edu/6.824/',
          },
        ],
      },
    ]);

    const zip = await JSZip.loadAsync(buffer);
    const files = Object.keys(zip.files);
    expect(files).toContain('notes/Raft-Consensus.md');
    expect(files).toContain('references.md');

    const refsContent = await zip.file('references.md')!.async('string');
    expect(refsContent).toContain('[開放課程]');
    expect(refsContent).toContain('MIT 6.824 Distributed Systems');
  });

  it('creates valid OOXML Word (.docx) archive containing note title, markdown content, and references', async () => {
    const docxBytes = await createNoteDocxBuffer({
      id: 'n-docx',
      title: 'Attention Mechanisms',
      content: '# Introduction\n\nSelf-attention scales quadratically with **sequence length**.\n\n- Key-value cache\n- FlashAttention',
      tags: ['Deep Learning', 'LLM'],
      summary: 'Notes on attention scaling.',
      updatedAt: '2026-11-24T00:00:00.000Z',
      courseRefs: [
        {
          type: 'COURSE',
          title: 'MIT 6.S191 Introduction to Deep Learning',
          provider: 'MIT_OCW',
          summary: 'Covers Transformers.',
          url: 'https://introtodeeplearning.com/',
        },
      ],
    });

    const docxZip = await JSZip.loadAsync(docxBytes);
    expect(Object.keys(docxZip.files)).toContain('word/document.xml');
    const docXml = await docxZip.file('word/document.xml')!.async('string');
    expect(docXml).toContain('Attention Mechanisms');
    expect(docXml).toContain('FlashAttention');
    expect(docXml).toContain('MIT 6.S191 Introduction to Deep Learning');
  });

  it('rejects export exceeding note count or byte limits', async () => {
    const dummyNote = {
      id: 'n',
      title: 'Note',
      content: 'Body',
      tags: [],
      summary: '',
      updatedAt: '2026-11-24T00:00:00.000Z',
      courseRefs: [],
    };

    await expect(createNotesZipBuffer([], { maxNotes: 50 })).rejects.toThrow();
    await expect(
      createNotesZipBuffer([dummyNote, dummyNote], { maxNotes: 1 }),
    ).rejects.toThrow();
    await expect(
      createNotesZipBuffer([{ ...dummyNote, content: 'x'.repeat(200) }], { maxBytes: 50 }),
    ).rejects.toThrow();
  });

  it('builds clean empty message in references.md when no refs pinned', () => {
    const md = buildReferencesMarkdown([
      {
        id: 'n1',
        title: 'Solo Note',
        content: 'Content',
        tags: [],
        summary: '',
        updatedAt: '2026-11-24T00:00:00.000Z',
        courseRefs: [],
      },
    ]);
    expect(md).toContain('尚未釘選');
  });

  it('embeds real PNG images into DOCX word/media without falling back to [圖片：貼上圖片]', async () => {
    // Valid 1x1 PNG (67 bytes)
    const samplePngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    const dataUrl = `data:image/png;base64,${samplePngBase64}`;

    const docxBytes = await createNoteDocxBuffer({
      id: 'n-img',
      title: '實驗截圖筆記',
      content: [
        '第一段說明文字',
        `![貼上圖片](${dataUrl})`,
        `行內附圖：![架構縮圖](${dataUrl}) 補充說明`,
      ].join('\n'),
      tags: ['實驗'],
      summary: '',
      updatedAt: '2026-11-25T00:00:00.000Z',
      courseRefs: [],
    });

    const docxZip = await JSZip.loadAsync(docxBytes);
    const mediaFiles = Object.keys(docxZip.files).filter((name) =>
      name.startsWith('word/media/'),
    );
    expect(mediaFiles.length).toBeGreaterThanOrEqual(1);

    const docXml = await docxZip.file('word/document.xml')!.async('string');
    expect(docXml).not.toContain('[圖片：貼上圖片]');
    expect(docXml).not.toContain('[圖片：架構縮圖]');
    expect(docXml).toContain('<w:drawing>');
  });

  it('renders single-newline and inline images cleanly in HTML and plain-text exports', async () => {
    const { buildNoteHtml, buildNotePlainText } = await import('../../src/lib/export/docx.ts');
    const samplePng =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

    const note = {
      id: 'n-html',
      title: '圖片排版測試',
      content: `前文說明\n![貼上圖片](${samplePng})\n後文段落`,
      tags: [],
      summary: '',
      updatedAt: '2026-11-25T00:00:00.000Z',
      courseRefs: [],
    };

    const html = buildNoteHtml(note);
    expect(html).toContain(`<img src="${samplePng}"`);
    expect(html).not.toContain('![貼上圖片]');

    const txt = buildNotePlainText(note);
    expect(txt).toContain('[圖片：貼上圖片]');
    expect(txt).not.toContain('![貼上圖片]');
  });
});
