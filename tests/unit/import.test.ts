import { describe, expect, it } from 'vitest';
import { createNoteDocxBuffer } from '../../src/lib/export/docx.ts';
import {
  ImportParseError,
  MAX_IMPORT_FILE_BYTES,
  MAX_NOTE_CONTENT_CHARS,
  parseImportedDocument,
} from '../../src/lib/import/parser.ts';

describe('Document Import Parser', () => {
  it('parses Markdown with YAML frontmatter and extracts clean title & body', async () => {
    const md = `---
title: "Bayesian Inference Lecture Notes"
tags: [math]
---

# Bayesian Inference Lecture Notes

## Prior & Likelihood

- Posterior is proportional to prior times likelihood.
`;
    const result = await parseImportedDocument({
      filename: 'draft-notes.md',
      mimeType: 'text/markdown',
      bytes: Buffer.from(md, 'utf8'),
    });

    expect(result.title).toBe('Bayesian Inference Lecture Notes');
    expect(result.formatLabel).toBe('Markdown (.md)');
    expect(result.content).toContain('## Prior & Likelihood');
    expect(result.content).not.toContain('tags: [math]');
    expect(result.truncated).toBe(false);
  });

  it('parses plain text files using filename as title fallback', async () => {
    const txt = '第一段研究觀察。\n\n第二段實驗記錄。';
    const result = await parseImportedDocument({
      filename: '量子計算導論筆記.txt',
      mimeType: 'text/plain',
      bytes: Buffer.from(txt, 'utf8'),
    });

    expect(result.title).toBe('量子計算導論筆記');
    expect(result.formatLabel).toBe('純文字 (.txt)');
    expect(result.content).toBe(txt);
  });

  it('converts HTML documents into clean Markdown and strips scripts', async () => {
    const html = `<!doctype html>
<html>
<head><title>Neural Scaling Laws</title><script>alert(1)</script></head>
<body>
  <h1>Neural Scaling Laws</h1>
  <p>Compute-optimal training balances <strong>model size</strong> and tokens.</p>
  <ul><li>Chinchilla scaling</li><li>Data quality</li></ul>
</body>
</html>`;

    const result = await parseImportedDocument({
      filename: 'scaling.html',
      mimeType: 'text/html',
      bytes: Buffer.from(html, 'utf8'),
    });

    expect(result.title).toBe('Neural Scaling Laws');
    expect(result.formatLabel).toBe('網頁 (.html)');
    expect(result.content).toContain('**model size**');
    expect(result.content).toContain('- Chinchilla scaling');
    expect(result.content).not.toContain('alert(1)');
  });

  it('round-trips a generated .docx document cleanly back into Markdown', async () => {
    const docxBytes = await createNoteDocxBuffer({
      id: 'n1',
      title: 'Attention Is All You Need 讀書心得',
      content: '## 核心架構\n\n- Self-Attention 取代循環網路\n\n實作推導完成。',
      tags: ['AI'],
      summary: '',
      updatedAt: new Date('2026-11-25T10:00:00Z'),
      courseRefs: [],
    });

    const result = await parseImportedDocument({
      filename: 'attention-notes.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: docxBytes,
    });

    expect(result.title).toBe('Attention Is All You Need 讀書心得');
    expect(result.formatLabel).toBe('Word (.docx)');
    expect(result.content).toContain('核心架構');
    expect(result.content).toContain('Self-Attention 取代循環網路');
    expect(result.content).toContain('實作推導完成。');
  });

  it('rejects empty, oversized, and unsupported files cleanly', async () => {
    await expect(
      parseImportedDocument({
        filename: 'empty.txt',
        mimeType: 'text/plain',
        bytes: Buffer.alloc(0),
      }),
    ).rejects.toBeInstanceOf(ImportParseError);

    await expect(
      parseImportedDocument({
        filename: 'too-big.txt',
        mimeType: 'text/plain',
        bytes: Buffer.alloc(MAX_IMPORT_FILE_BYTES + 1, 65),
      }),
    ).rejects.toThrow(/10 MB/);

    await expect(
      parseImportedDocument({
        filename: 'archive.exe',
        mimeType: 'application/octet-stream',
        bytes: Buffer.from('binary'),
      }),
    ).rejects.toBeInstanceOf(ImportParseError);
  });

  it('caps imported content at 100,000 characters and flags truncation', async () => {
    const longText = 'A'.repeat(MAX_NOTE_CONTENT_CHARS + 500);
    const result = await parseImportedDocument({
      filename: 'long.md',
      mimeType: 'text/markdown',
      bytes: Buffer.from(longText, 'utf8'),
    });

    expect(result.truncated).toBe(true);
    expect(result.content.length).toBe(MAX_NOTE_CONTENT_CHARS);
  });
});
