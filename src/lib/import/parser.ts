import JSZip from 'jszip';

export const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_NOTE_TITLE_CHARS = 200;
export const MAX_NOTE_CONTENT_CHARS = 100000;

export class ImportParseError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type ParsedImportResult = {
  title: string;
  content: string;
  truncated: boolean;
  charCount: number;
  formatLabel: string;
};

const SUPPORTED_EXTENSIONS = new Set(['md', 'markdown', 'txt', 'docx', 'html', 'htm']);

function getFileExtension(filename: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(filename.trim());
  return match ? match[1].toLowerCase() : '';
}

function stripFileExtension(filename: string): string {
  const base = filename.trim().split(/[/\\]/).pop() || '';
  return base.replace(/\.[a-z0-9]+$/i, '').trim();
}

function decodeXmlAndHtmlEntities(raw: string): string {
  return raw
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'");
}

function extractParagraphTextFromDocxXml(paragraphXml: string): string {
  const tokenRegex = /<w:(?:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|br\b[^>]*\/>|tab\b[^>]*\/>)/g;
  const parts: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(paragraphXml)) !== null) {
    const whole = match[0];
    if (whole.startsWith('<w:br')) {
      parts.push('\n');
    } else if (whole.startsWith('<w:tab')) {
      parts.push('  ');
    } else if (match[1] !== undefined) {
      parts.push(decodeXmlAndHtmlEntities(match[1]));
    }
  }

  return parts.join('').replace(/\u00a0/g, ' ').trim();
}

export async function extractMarkdownFromDocxBuffer(
  bytes: Uint8Array | Buffer,
): Promise<{ detectedTitle: string | null; markdown: string }> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new ImportParseError('無法解析 Word (.docx) 檔案，請確認檔案未損毀且為標準 .docx 格式。', 422);
  }

  const docEntry = zip.file('word/document.xml');
  if (!docEntry) {
    throw new ImportParseError('此 .docx 檔案缺少正文內容（word/document.xml）。', 422);
  }

  const xml = await docEntry.async('string');
  const paragraphMatches = xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) ?? [];
  const lines: string[] = [];
  let detectedTitle: string | null = null;

  for (const pXml of paragraphMatches) {
    const text = extractParagraphTextFromDocxXml(pXml);
    if (!text) continue;

    const styleMatch = /<w:pStyle\b[^>]*w:val="([^"]+)"/i.exec(pXml);
    const styleVal = (styleMatch?.[1] ?? '').toLowerCase();
    const isList = /<w:numPr\b/i.test(pXml);

    if (styleVal === 'title' && !detectedTitle) {
      detectedTitle = text;
      continue;
    }

    if (styleVal === 'heading1' || styleVal === 'heading 1' || styleVal === '1') {
      lines.push(`# ${text}`);
    } else if (styleVal === 'heading2' || styleVal === 'heading 2' || styleVal === '2') {
      lines.push(`## ${text}`);
    } else if (styleVal === 'heading3' || styleVal === 'heading 3' || styleVal === '3') {
      lines.push(`### ${text}`);
    } else if (styleVal.startsWith('heading') || styleVal === 'subtitle') {
      lines.push(`#### ${text}`);
    } else if (isList) {
      lines.push(`- ${text}`);
    } else {
      lines.push(text);
    }
  }

  return {
    detectedTitle,
    markdown: lines.join('\n\n'),
  };
}

export function convertHtmlToMarkdown(htmlRaw: string): {
  detectedTitle: string | null;
  markdown: string;
} {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(htmlRaw);
  const detectedTitle = titleMatch
    ? decodeXmlAndHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, '')).trim() || null
    : null;

  let body = htmlRaw;
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(htmlRaw);
  if (bodyMatch) {
    body = bodyMatch[1];
  }

  body = body
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  body = body
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_m, inner: string) => {
      const clean = decodeXmlAndHtmlEntities(inner.replace(/<[^>]+>/g, '')).trim();
      return `\n\n\`\`\`\n${clean}\n\`\`\`\n\n`;
    })
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_m, inner: string) => `\n\n# ${inner.replace(/<[^>]+>/g, '').trim()}\n\n`)
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_m, inner: string) => `\n\n## ${inner.replace(/<[^>]+>/g, '').trim()}\n\n`)
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_m, inner: string) => `\n\n### ${inner.replace(/<[^>]+>/g, '').trim()}\n\n`)
    .replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, (_m, inner: string) => `\n\n#### ${inner.replace(/<[^>]+>/g, '').trim()}\n\n`)
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner: string) => {
      const clean = inner.replace(/<[^>]+>/g, '').trim();
      return `\n\n> ${clean.replace(/\n+/g, '\n> ')}\n\n`;
    })
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner: string) => `\n- ${inner.replace(/<[^>]+>/g, '').trim()}`)
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
      const cleanLabel = label.replace(/<[^>]+>/g, '').trim();
      if (/^https?:\/\//i.test(href)) {
        return `[${cleanLabel || href}](${href})`;
      }
      return cleanLabel;
    })
    .replace(/<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, '**$1**')
    .replace(/<(?:em|i)[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, '*$1*')
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|section|article|tr|ul|ol)>/gi, '\n\n')
    .replace(/<hr\s*\/?>/gi, '\n\n---\n\n');

  const stripped = decodeXmlAndHtmlEntities(body.replace(/<[^>]+>/g, ''))
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    detectedTitle,
    markdown: stripped,
  };
}

function stripFrontmatterAndLeadingTitle(
  rawText: string,
  fallbackTitle: string,
): { title: string; content: string } {
  let working = rawText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  let title = fallbackTitle;

  const fmMatch = /^---\n([\s\S]*?)\n---\n?/.exec(working);
  if (fmMatch) {
    const fmTitleMatch = /^title:\s*["']?(.+?)["']?\s*$/m.exec(fmMatch[1]);
    if (fmTitleMatch && fmTitleMatch[1].trim()) {
      title = fmTitleMatch[1].trim();
    }
    working = working.slice(fmMatch[0].length);
  }

  const trimmedStart = working.trimStart();
  const h1Match = /^#\s+([^\n]+)\n*/.exec(trimmedStart);
  if (h1Match) {
    const h1Text = h1Match[1].trim();
    if (!title || title === '未命名研究筆記' || h1Text.toLowerCase() === title.toLowerCase()) {
      title = h1Text;
      working = trimmedStart.slice(h1Match[0].length);
    }
  }

  return {
    title: title.trim().slice(0, MAX_NOTE_TITLE_CHARS) || '匯入的研究筆記',
    content: working.trim(),
  };
}

export async function parseImportedDocument(input: {
  filename: string;
  mimeType?: string;
  bytes: Uint8Array | Buffer;
}): Promise<ParsedImportResult> {
  const byteLength = input.bytes.byteLength;
  if (byteLength === 0) {
    throw new ImportParseError('匯入的檔案為空，請選擇有文字內容的筆記檔案。', 400);
  }
  if (byteLength > MAX_IMPORT_FILE_BYTES) {
    throw new ImportParseError('檔案大小超過 10 MB 上限，請精簡或拆分後再匯入。', 413);
  }

  const ext = getFileExtension(input.filename);
  const mime = (input.mimeType ?? '').toLowerCase();
  const baseNameTitle = stripFileExtension(input.filename) || '匯入的研究筆記';

  const isDocx =
    ext === 'docx' ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const isHtml = ext === 'html' || ext === 'htm' || mime.includes('text/html');
  const isMarkdown = ext === 'md' || ext === 'markdown' || mime.includes('markdown');
  const isText = ext === 'txt' || mime.startsWith('text/plain');

  if (ext && !SUPPORTED_EXTENSIONS.has(ext) && !isDocx && !isHtml && !isMarkdown && !isText) {
    throw new ImportParseError(
      '目前支援匯入 .md、.txt、.docx 與 .html 格式的筆記檔案。',
      415,
    );
  }

  if (!ext && !isDocx && !isHtml && !isMarkdown && !isText) {
    throw new ImportParseError(
      '無法辨識此檔案格式，請選擇 Google 文件或 .md / .txt / .docx / .html 檔案。',
      415,
    );
  }

  let resolvedTitle = baseNameTitle;
  let resolvedMarkdown = '';
  let formatLabel = '純文字 (.txt)';

  if (isDocx) {
    formatLabel = 'Word (.docx)';
    const extracted = await extractMarkdownFromDocxBuffer(input.bytes);
    if (extracted.detectedTitle) {
      resolvedTitle = extracted.detectedTitle;
    }
    const normalized = stripFrontmatterAndLeadingTitle(extracted.markdown, resolvedTitle);
    resolvedTitle = normalized.title;
    resolvedMarkdown = normalized.content;
  } else if (isHtml) {
    formatLabel = '網頁 (.html)';
    const rawHtml = Buffer.from(input.bytes).toString('utf8');
    const converted = convertHtmlToMarkdown(rawHtml);
    if (converted.detectedTitle) {
      resolvedTitle = converted.detectedTitle;
    }
    const normalized = stripFrontmatterAndLeadingTitle(converted.markdown, resolvedTitle);
    resolvedTitle = normalized.title;
    resolvedMarkdown = normalized.content;
  } else {
    formatLabel = isMarkdown ? 'Markdown (.md)' : '純文字 (.txt)';
    const rawText = Buffer.from(input.bytes).toString('utf8');
    const normalized = stripFrontmatterAndLeadingTitle(rawText, resolvedTitle);
    resolvedTitle = normalized.title;
    resolvedMarkdown = normalized.content;
  }

  if (!resolvedMarkdown.trim()) {
    throw new ImportParseError('無法從此檔案讀取到可編輯的文字內容。', 422);
  }

  const truncated = resolvedMarkdown.length > MAX_NOTE_CONTENT_CHARS;
  const boundedContent = truncated
    ? resolvedMarkdown.slice(0, MAX_NOTE_CONTENT_CHARS)
    : resolvedMarkdown;

  return {
    title: resolvedTitle.slice(0, MAX_NOTE_TITLE_CHARS) || '匯入的研究筆記',
    content: boundedContent,
    truncated,
    charCount: boundedContent.length,
    formatLabel,
  };
}
