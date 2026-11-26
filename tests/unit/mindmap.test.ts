import { describe, expect, it } from 'vitest';
import {
  extractJsonObjectText,
  MindMapError,
  mindMapToMarkdown,
  normalizeMindMapPayload,
  stripInlineImageDataUrls,
} from '../../src/lib/ai/mindmap.ts';
import {
  buildNoteHtml,
  buildNotePlainText,
  createNoteDocxBuffer,
} from '../../src/lib/export/docx.ts';
import { isSafeImageSource } from '../../src/lib/image-utils.ts';

describe('Mind Map Normalization & Rich Markdown Formatting', () => {
  it('normalizes AI mind map tree with colors, ids, and markdown outline', () => {
    const result = normalizeMindMapPayload(
      {
        rootLabel: 'Transformer 注意力機制',
        rootDetail: '以自注意力平行處理序列依賴關係。',
        branches: [
          {
            label: 'Scaled Dot-Product',
            detail: '除以 sqrt(d_k) 穩定梯度',
            color: 'blue',
            children: [
              {
                label: 'Query / Key / Value',
                children: [{ label: 'Softmax 權重正規化' }],
              },
            ],
          },
          {
            label: 'Multi-Head Attention',
            color: 'emerald',
            children: [{ label: '多子空間平行投影' }],
          },
        ],
      },
      'Fallback',
    );

    expect(result.root.label).toBe('Transformer 注意力機制');
    expect(result.nodeCount).toBe(6);
    expect(result.root.children[0].color).toBe('blue');
    expect(result.root.children[1].color).toBe('emerald');

    const md = mindMapToMarkdown(result.root);
    expect(md).toContain('# Transformer 注意力機制');
    expect(md).toContain('##> Scaled Dot-Product');
    expect(md).toContain('- **Query / Key / Value**');
    expect(md).toContain('  - Softmax 權重正規化');
  });

  it('rejects empty branch payloads cleanly', () => {
    expect(() =>
      normalizeMindMapPayload({ rootLabel: 'Empty', branches: [] }, 'Fallback'),
    ).toThrow(MindMapError);
  });

  it('strips embedded data-URL images and extracts JSON from fenced responses', () => {
    const withImage =
      '前置段落\n\n![系統架構](data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=)\n\n結論說明';
    const stripped = stripInlineImageDataUrls(withImage);
    expect(stripped).toContain('[圖片：系統架構]');
    expect(stripped).not.toContain('data:image/webp;base64');

    const fenced = '```json\n{"rootLabel":"核心","branches":[{"label":"分支一"}]}\n```';
    const parsed = JSON.parse(extractJsonObjectText(fenced)) as { rootLabel: string };
    expect(parsed.rootLabel).toBe('核心');
  });

  it('validates safe image sources and rejects SVG / javascript URIs', () => {
    expect(isSafeImageSource('https://example.com/diagram.png')).toBe(true);
    expect(
      isSafeImageSource('data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA='),
    ).toBe(true);
    expect(isSafeImageSource('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBe(false);
    expect(isSafeImageSource('javascript:alert(1)')).toBe(false);
  });

  it('exports 5-color highlights, collapsible headings, tables, and image placeholders to DOCX/HTML/TXT', async () => {
    const richNote = {
      id: 'rich-1',
      title: '實驗比較報告',
      content: [
        '##> 重要實驗結論',
        '',
        '採用 ==[yellow]黃色重點== 與 ==[blue]藍色重點== 標記核心觀察。',
        '',
        '| 模型 | 準確率 | 延遲 |',
        '| --- | :---: | ---: |',
        '| Model A | 94.2% | 18ms |',
        '',
        '![架構圖](https://example.com/arch.png)',
      ].join('\n'),
      tags: ['實驗'],
      summary: '',
      updatedAt: new Date('2026-11-25T10:00:00Z'),
      courseRefs: [],
    };

    const docxBytes = await createNoteDocxBuffer(richNote);
    expect(docxBytes.byteLength).toBeGreaterThan(500);

    const html = buildNoteHtml(richNote);
    expect(html).toContain('<h2>重要實驗結論</h2>');
    expect(html).toContain('<mark>黃色重點</mark>');
    expect(html).toContain('<img src="https://example.com/arch.png"');

    const txt = buildNotePlainText(richNote);
    expect(txt).toContain('採用 黃色重點 與 藍色重點 標記核心觀察');
  });
});
