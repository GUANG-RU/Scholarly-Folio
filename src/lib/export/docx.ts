import {
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';
import type { ExportableNote } from './packager.ts';

function isSafeHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseInlineRuns(text: string): Array<TextRun | ExternalHyperlink> {
  const runs: Array<TextRun | ExternalHyperlink> = [];
  const pattern = /(\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      runs.push(new TextRun({ text: text.slice(lastIndex, match.index) }));
    }

    if (match[2] !== undefined && match[3] !== undefined) {
      const label = match[2];
      const href = match[3].trim();
      if (isSafeHttpUrl(href)) {
        runs.push(
          new ExternalHyperlink({
            link: href,
            children: [
              new TextRun({
                text: label,
                style: 'Hyperlink',
                color: '1D4ED8',
                underline: {},
              }),
            ],
          }),
        );
      } else {
        runs.push(new TextRun({ text: label }));
      }
    } else if (match[4] !== undefined) {
      runs.push(
        new TextRun({
          text: match[4],
          font: 'Consolas',
          size: 20,
        }),
      );
    } else if (match[5] !== undefined) {
      runs.push(new TextRun({ text: match[5], bold: true }));
    } else if (match[6] !== undefined) {
      runs.push(new TextRun({ text: match[6], italics: true }));
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    runs.push(new TextRun({ text: text.slice(lastIndex) }));
  }

  if (runs.length === 0) {
    runs.push(new TextRun({ text: '' }));
  }

  return runs;
}

export async function createNoteDocxBuffer(note: ExportableNote): Promise<Uint8Array> {
  const updatedStr =
    note.updatedAt instanceof Date
      ? note.updatedAt.toLocaleString('zh-TW')
      : new Date(note.updatedAt).toLocaleString('zh-TW');
  const tagsStr = note.tags.length > 0 ? note.tags.join(' / ') : '無標籤';

  const children: Paragraph[] = [
    new Paragraph({
      text: note.title,
      heading: HeadingLevel.TITLE,
      spacing: { after: 140 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `更新時間：${updatedStr}  ·  標籤：${tagsStr}`,
          color: '52525B',
          size: 20,
        }),
      ],
      spacing: { after: 280 },
      border: {
        bottom: {
          color: 'E4E4E7',
          space: 6,
          style: BorderStyle.SINGLE,
          size: 6,
        },
      },
    }),
  ];

  const lines = note.content.replace(/\r\n/g, '\n').split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      i += 1;
      const codeLines: string[] = [];
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      for (const codeLine of codeLines) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: codeLine || ' ',
                font: 'Consolas',
                size: 19,
                color: '18181B',
              }),
            ],
            spacing: { after: 40 },
            indent: { left: 360 },
          }),
        );
      }
      i += 1;
      continue;
    }

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      children.push(
        new Paragraph({
          text: '',
          spacing: { before: 120, after: 120 },
          border: {
            bottom: {
              color: 'D4D4D8',
              space: 4,
              style: BorderStyle.SINGLE,
              size: 4,
            },
          },
        }),
      );
      i += 1;
      continue;
    }

    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length;
      children.push(
        new Paragraph({
          children: parseInlineRuns(headingMatch[2]),
          heading:
            level === 1
              ? HeadingLevel.HEADING_1
              : level === 2
                ? HeadingLevel.HEADING_2
                : HeadingLevel.HEADING_3,
          spacing: { before: 220, after: 120 },
        }),
      );
      i += 1;
      continue;
    }

    if (line.trim().startsWith('>')) {
      const quoteText = line.trim().replace(/^>\s?/, '');
      children.push(
        new Paragraph({
          children: parseInlineRuns(quoteText),
          indent: { left: 420 },
          spacing: { after: 120 },
        }),
      );
      i += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line.trim())) {
      const itemText = line.trim().replace(/^[-*]\s+/, '');
      children.push(
        new Paragraph({
          children: parseInlineRuns(itemText),
          bullet: { level: 0 },
          spacing: { after: 80 },
        }),
      );
      i += 1;
      continue;
    }

    if (/^\d+\.\s+/.test(line.trim())) {
      children.push(
        new Paragraph({
          children: parseInlineRuns(line.trim()),
          indent: { left: 360 },
          spacing: { after: 80 },
        }),
      );
      i += 1;
      continue;
    }

    children.push(
      new Paragraph({
        children: parseInlineRuns(line),
        spacing: { after: 140, line: 340 },
      }),
    );
    i += 1;
  }

  if (note.courseRefs.length > 0) {
    children.push(
      new Paragraph({
        text: '參考課程與學術文獻',
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 320, after: 140 },
      }),
    );

    for (const ref of note.courseRefs) {
      const kind = ref.type === 'COURSE' ? '[開放課程]' : '[學術文獻]';
      const safeUrl = isSafeHttpUrl(ref.url) ? ref.url : null;
      const titleRuns: Array<TextRun | ExternalHyperlink> = [
        new TextRun({ text: `${kind} `, bold: true, color: '1D4ED8' }),
        safeUrl
          ? new ExternalHyperlink({
              link: safeUrl,
              children: [
                new TextRun({
                  text: ref.title,
                  bold: true,
                  color: '1D4ED8',
                  underline: {},
                }),
              ],
            })
          : new TextRun({ text: ref.title, bold: true }),
        new TextRun({ text: ` (${ref.provider})`, color: '52525B', size: 20 }),
      ];

      children.push(
        new Paragraph({
          children: titleRuns,
          bullet: { level: 0 },
          spacing: { after: 60 },
        }),
      );

      if (ref.summary) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: ref.summary, color: '52525B', size: 20 })],
            indent: { left: 720 },
            spacing: { after: 100 },
          }),
        );
      }
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return new Uint8Array(buffer);
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildNoteHtml(note: ExportableNote): string {
  const paragraphs = note.content
    .replace(/\r\n/g, '\n')
    .split('\n\n')
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br/>')}</p>`)
    .join('\n');

  const refsHtml =
    note.courseRefs.length > 0
      ? `<h2>參考課程與學術文獻</h2><ul>${note.courseRefs
          .map((ref) => {
            const kind = ref.type === 'COURSE' ? '[開放課程]' : '[學術文獻]';
            const safeUrl = isSafeHttpUrl(ref.url) ? escapeHtml(ref.url) : '#';
            return `<li><strong>${kind}</strong> <a href="${safeUrl}">${escapeHtml(ref.title)}</a> (${escapeHtml(ref.provider)})${
              ref.summary ? `<p>${escapeHtml(ref.summary)}</p>` : ''
            }</li>`;
          })
          .join('')}</ul>`
      : '';

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
    note.title,
  )}</title></head><body><h1>${escapeHtml(note.title)}</h1>${paragraphs}${refsHtml}</body></html>`;
}

export function buildNotePlainText(note: ExportableNote): string {
  const parts = [note.title, '='.repeat(Math.min(note.title.length * 2, 48)), '', note.content];
  if (note.courseRefs.length > 0) {
    parts.push('', '--- 參考課程與學術文獻 ---');
    for (const ref of note.courseRefs) {
      const kind = ref.type === 'COURSE' ? '[開放課程]' : '[學術文獻]';
      parts.push(`- ${kind} ${ref.title} (${ref.provider}): ${ref.url}`);
    }
  }
  return `${parts.join('\n')}\n`;
}
