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
});
