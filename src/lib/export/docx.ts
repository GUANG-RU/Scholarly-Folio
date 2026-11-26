import {
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
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

const DOCX_HIGHLIGHT_MAP: Record<
  string,
  'yellow' | 'green' | 'cyan' | 'magenta' | 'lightGray'
> = {
  yellow: 'yellow',
  green: 'green',
  blue: 'cyan',
  pink: 'magenta',
  purple: 'lightGray',
};

const GENERIC_IMAGE_ALTS = new Set(['貼上圖片', '圖片', '附圖', 'note-image', 'image']);

function parseImageDimensions(
  buffer: Buffer,
  fmt: 'png' | 'jpg' | 'gif',
): { width: number; height: number } | null {
  try {
    if (fmt === 'png') {
      if (
        buffer.length >= 24 &&
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47
      ) {
        const width = buffer.readUInt32BE(16);
        const height = buffer.readUInt32BE(20);
        if (width > 0 && height > 0) return { width, height };
      }
      return null;
    }

    if (fmt === 'gif') {
      if (buffer.length >= 10 && buffer.toString('ascii', 0, 3) === 'GIF') {
        const width = buffer.readUInt16LE(6);
        const height = buffer.readUInt16LE(8);
        if (width > 0 && height > 0) return { width, height };
      }
      return null;
    }

    // JPEG SOF marker scan
    if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
      let offset = 2;
      while (offset + 1 < buffer.length) {
        if (buffer[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        while (offset < buffer.length && buffer[offset] === 0xff) {
          offset += 1;
        }
        if (offset >= buffer.length) break;
        const marker = buffer[offset];
        offset += 1;

        if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
          continue;
        }
        if (marker === 0xda) {
          break;
        }
        if (offset + 2 > buffer.length) break;
        const segmentLength = buffer.readUInt16BE(offset);
        const isSof =
          (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf);
        if (isSof && offset + 7 <= buffer.length) {
          const height = buffer.readUInt16BE(offset + 3);
          const width = buffer.readUInt16BE(offset + 5);
          if (width > 0 && height > 0) return { width, height };
        }
        if (segmentLength < 2) break;
        offset += segmentLength;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function computeDocxImageSize(
  buffer: Buffer,
  fmt: 'png' | 'jpg' | 'gif',
): { width: number; height: number } {
  const natural = parseImageDimensions(buffer, fmt);
  if (!natural) {
    return { width: 440, height: 300 };
  }
  const maxWidth = 460;
  const maxHeight = 560;
  const scale = Math.min(1, maxWidth / natural.width, maxHeight / natural.height);
  return {
    width: Math.max(1, Math.round(natural.width * scale)),
    height: Math.max(1, Math.round(natural.height * scale)),
  };
}

function tryBuildDocxImageRun(src: string, alt: string): ImageRun | null {
  const dataMatch = /^data:image\/(png|jpeg|jpg|gif);base64,([A-Za-z0-9+/=]+)$/i.exec(
    src.trim(),
  );
  if (!dataMatch) {
    return null;
  }
  const rawFmt = dataMatch[1].toLowerCase();
  const fmt = rawFmt === 'jpeg' ? 'jpg' : (rawFmt as 'png' | 'jpg' | 'gif');
  try {
    const buffer = Buffer.from(dataMatch[2], 'base64');
    if (buffer.length === 0) return null;
    const transformation = computeDocxImageSize(buffer, fmt);
    const label = alt.trim() || '研究筆記圖片';
    return new ImageRun({
      type: fmt,
      data: buffer,
      transformation,
      altText: {
        title: label,
        description: label,
        name: label,
      },
    });
  } catch {
    return null;
  }
}

function parseInlineRuns(text: string): Array<TextRun | ExternalHyperlink | ImageRun> {
  const runs: Array<TextRun | ExternalHyperlink | ImageRun> = [];
  const pattern =
    /(!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)|==(?:\[(yellow|green|blue|pink|purple)\])?([\s\S]+?)==|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      runs.push(new TextRun({ text: text.slice(lastIndex, match.index) }));
    }

    if (match[3] !== undefined) {
      const alt = (match[2] ?? '').trim();
      const src = match[3].trim();
      const embedded = tryBuildDocxImageRun(src, alt);
      if (embedded) {
        runs.push(embedded);
      } else {
        const displayAlt = alt || '附圖';
        runs.push(
          new TextRun({
            text: `[圖片：${displayAlt}]${isSafeHttpUrl(src) ? ` (${src})` : ''}`,
            italics: true,
            color: '52525B',
          }),
        );
      }
    } else if (match[4] !== undefined && match[5] !== undefined) {
      const label = match[4];
      const href = match[5].trim();
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
    } else if (match[7] !== undefined) {
      const colorKey = match[6] ?? 'yellow';
      const highlight = DOCX_HIGHLIGHT_MAP[colorKey] ?? 'yellow';
      runs.push(new TextRun({ text: match[7], highlight }));
    } else if (match[8] !== undefined) {
      runs.push(
        new TextRun({
          text: match[8],
          font: 'Consolas',
          size: 20,
        }),
      );
    } else if (match[9] !== undefined) {
      runs.push(new TextRun({ text: match[9], bold: true }));
    } else if (match[10] !== undefined) {
      runs.push(new TextRun({ text: match[10], italics: true }));
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

function splitTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
  return trimmed.split('|').map((cell) => cell.trim());
}

function isTableSeparatorLine(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

function tryBuildDocxImageParagraph(src: string, alt: string): Paragraph | null {
  const imageRun = tryBuildDocxImageRun(src, alt);
  if (!imageRun) {
    return null;
  }
  return new Paragraph({
    children: [imageRun],
    spacing: { before: 120, after: 120 },
  });
}

export async function createNoteDocxBuffer(note: ExportableNote): Promise<Uint8Array> {
  const updatedStr =
    note.updatedAt instanceof Date
      ? note.updatedAt.toLocaleString('zh-TW')
      : new Date(note.updatedAt).toLocaleString('zh-TW');
  const tagsStr = note.tags.length > 0 ? note.tags.join(' / ') : '無標籤';

  const children: Array<Paragraph | Table> = [
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
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
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

    if (trimmed === '') {
      i += 1;
      continue;
    }

    if (/^---+$/.test(trimmed)) {
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

    // Standalone image block
    const imgMatch = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(trimmed);
    if (imgMatch) {
      const alt = imgMatch[1].trim();
      const src = imgMatch[2].trim();
      const imgPara = tryBuildDocxImageParagraph(src, alt);
      if (imgPara) {
        children.push(imgPara);
        if (alt && !GENERIC_IMAGE_ALTS.has(alt)) {
          children.push(
            new Paragraph({
              children: [new TextRun({ text: alt, size: 18, color: '52525B', italics: true })],
              spacing: { after: 140 },
            }),
          );
        }
      } else {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `[圖片：${alt || '附圖'}]${isSafeHttpUrl(src) ? ` (${src})` : ''}`,
                color: '52525B',
                italics: true,
              }),
            ],
            spacing: { after: 140 },
          }),
        );
      }
      i += 1;
      continue;
    }

    // Markdown pipe table
    if (trimmed.includes('|') && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1])) {
      const headers = splitTableRow(lines[i]);
      i += 2;
      const bodyRows: string[][] = [];
      while (i < lines.length && lines[i].trim().includes('|') && lines[i].trim() !== '') {
        bodyRows.push(splitTableRow(lines[i]));
        i += 1;
      }

      const tableRows: TableRow[] = [
        new TableRow({
          children: headers.map(
            (h) =>
              new TableCell({
                children: [
                  new Paragraph({
                    children: [new TextRun({ text: h, bold: true, size: 20 })],
                  }),
                ],
              }),
          ),
        }),
        ...bodyRows.map(
          (row) =>
            new TableRow({
              children: headers.map(
                (_h, colIdx) =>
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: parseInlineRuns(row[colIdx] ?? ''),
                      }),
                    ],
                  }),
              ),
            }),
        ),
      ];

      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: tableRows,
        }),
      );
      children.push(new Paragraph({ text: '', spacing: { after: 100 } }));
      continue;
    }

    // Headings (both # and #> collapsible syntax)
    const headingMatch = /^(#{1,4})>?\s+(.+)$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length;
      children.push(
        new Paragraph({
          children: parseInlineRuns(headingMatch[2].trim()),
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

    if (trimmed.startsWith('>')) {
      const quoteText = trimmed.replace(/^>\s?/, '');
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

    if (/^[-*+]\s+/.test(trimmed)) {
      const indentSpaces = line.length - line.trimStart().length;
      const itemText = trimmed.replace(/^[-*+]\s+/, '');
      children.push(
        new Paragraph({
          children: parseInlineRuns(itemText),
          bullet: { level: indentSpaces >= 2 ? 1 : 0 },
          spacing: { after: 80 },
        }),
      );
      i += 1;
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      children.push(
        new Paragraph({
          children: parseInlineRuns(trimmed),
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

function renderHtmlInlineImagesAndMarks(raw: string): string {
  const imagePattern = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let result = '';
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  const formatTextSegment = (text: string) =>
    escapeHtml(text).replace(
      /==(?:\[(yellow|green|blue|pink|purple)\])?([\s\S]+?)==/g,
      (_m, _c, inner: string) => `<mark>${inner}</mark>`,
    );

  while ((match = imagePattern.exec(raw)) !== null) {
    if (match.index > lastIdx) {
      result += formatTextSegment(raw.slice(lastIdx, match.index));
    }
    const alt = escapeHtml(match[1].trim());
    const src = match[2].trim();
    if (
      isSafeHttpUrl(src) ||
      /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(src)
    ) {
      result += `<img src="${escapeHtml(src)}" alt="${alt}" style="max-width:100%;height:auto"/>`;
    } else {
      result += escapeHtml(`[圖片：${match[1].trim() || '附圖'}]`);
    }
    lastIdx = imagePattern.lastIndex;
  }

  if (lastIdx < raw.length) {
    result += formatTextSegment(raw.slice(lastIdx));
  }

  return result;
}

export function buildNoteHtml(note: ExportableNote): string {
  const lines = note.content.replace(/\r\n/g, '\n').split('\n');
  const htmlBlocks: string[] = [];
  let paragraphLines: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    const body = paragraphLines.map((l) => renderHtmlInlineImagesAndMarks(l)).join('<br/>');
    htmlBlocks.push(`<p>${body}</p>`);
    paragraphLines = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      continue;
    }

    const standaloneImg = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(trimmed);
    if (standaloneImg) {
      flushParagraph();
      const rawAlt = standaloneImg[1].trim();
      const alt = escapeHtml(rawAlt);
      const src = standaloneImg[2].trim();
      if (
        isSafeHttpUrl(src) ||
        /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(src)
      ) {
        const caption =
          rawAlt && !GENERIC_IMAGE_ALTS.has(rawAlt) ? `<figcaption>${alt}</figcaption>` : '';
        htmlBlocks.push(
          `<figure><img src="${escapeHtml(src)}" alt="${alt}" style="max-width:100%;height:auto"/>${caption}</figure>`,
        );
      } else {
        htmlBlocks.push(`<p><em>${escapeHtml(`[圖片：${rawAlt || '附圖'}]`)}</em></p>`);
      }
      continue;
    }

    const hMatch = /^(#{1,3})>?\s+(.+)$/.exec(trimmed);
    if (hMatch) {
      flushParagraph();
      const level = hMatch[1].length;
      htmlBlocks.push(`<h${level}>${escapeHtml(hMatch[2])}</h${level}>`);
      continue;
    }

    paragraphLines.push(line);
  }
  flushParagraph();

  const paragraphs = htmlBlocks.join('\n');

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
  const cleanContent = note.content
    .replace(/!\[([^\]]*)\]\(data:image\/[^)]+\)/gi, (_m, alt: string) =>
      alt.trim() ? `[圖片：${alt.trim()}]` : '[圖片]',
    )
    .replace(/data:image\/[a-zA-Z0-9+]+;base64,[A-Za-z0-9+/=]+/g, '[圖片]')
    .replace(/==(?:\[(?:yellow|green|blue|pink|purple)\])?([\s\S]+?)==/g, '$1');
  const parts = [note.title, '='.repeat(Math.min(note.title.length * 2, 48)), '', cleanContent];
  if (note.courseRefs.length > 0) {
    parts.push('', '--- 參考課程與學術文獻 ---');
    for (const ref of note.courseRefs) {
      const kind = ref.type === 'COURSE' ? '[開放課程]' : '[學術文獻]';
      parts.push(`- ${kind} ${ref.title} (${ref.provider}): ${ref.url}`);
    }
  }
  return `${parts.join('\n')}\n`;
}
