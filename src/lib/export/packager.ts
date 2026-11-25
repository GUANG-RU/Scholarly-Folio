import JSZip from 'jszip';

export const MAX_EXPORT_NOTES = 50;
export const MAX_EXPORT_BYTES = 10 * 1024 * 1024;

export type ExportableCourseRef = {
  type: 'COURSE' | 'PAPER';
  title: string;
  provider: string;
  summary: string;
  url: string;
};

export type ExportableNote = {
  id: string;
  title: string;
  content: string;
  tags: string[];
  summary: string;
  updatedAt: Date | string;
  courseRefs: ExportableCourseRef[];
};

export function sanitizeFilename(rawName: string): string {
  const withoutTraversal = rawName
    .replace(/\.\.+/g, '-')
    .replace(/[/\\:*?"<>|\x00-\x1f]/g, '-')
    .replace(/^\.+/, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return withoutTraversal.slice(0, 80) || 'untitled-note';
}

export function buildNoteMarkdown(note: ExportableNote): string {
  const updatedStr =
    note.updatedAt instanceof Date ? note.updatedAt.toISOString() : String(note.updatedAt);
  const tagsLine = note.tags.length > 0 ? note.tags.join(', ') : '無標籤';

  const parts: string[] = [
    `# ${note.title}`,
    '',
    `> 更新時間：${updatedStr} | 標籤：${tagsLine}`,
    '',
    note.content.trim(),
  ];

  if (note.courseRefs.length > 0) {
    parts.push('', '---', '', '## 參考課程與學術文獻', '');
    for (const ref of note.courseRefs) {
      const kind = ref.type === 'COURSE' ? '[開放課程]' : '[學術文獻]';
      parts.push(`- ${kind} **${ref.title}** (${ref.provider})`);
      if (ref.summary) {
        parts.push(`  - 摘要：${ref.summary}`);
      }
      parts.push(`  - 連結：${ref.url}`);
    }
  }

  return `${parts.join('\n')}\n`;
}

export function buildReferencesMarkdown(notes: ExportableNote[]): string {
  const lines: string[] = ['# 參考資料總覽 (References)', ''];
  let totalRefs = 0;

  for (const note of notes) {
    if (note.courseRefs.length === 0) continue;
    lines.push(`## ${note.title}`, '');
    for (const ref of note.courseRefs) {
      totalRefs += 1;
      const kind = ref.type === 'COURSE' ? '[開放課程]' : '[學術文獻]';
      lines.push(`- ${kind} [${ref.title}](${ref.url}) — *${ref.provider}*`);
      if (ref.summary) {
        lines.push(`  > ${ref.summary}`);
      }
    }
    lines.push('');
  }

  if (totalRefs === 0) {
    lines.push('本匯出筆記集目前尚未釘選外部課程或學術文獻參考。', '');
  }

  return lines.join('\n');
}

export async function createNotesZipBuffer(
  notes: ExportableNote[],
  options: { maxNotes?: number; maxBytes?: number } = {},
): Promise<Uint8Array> {
  const maxNotes = options.maxNotes ?? MAX_EXPORT_NOTES;
  const maxBytes = options.maxBytes ?? MAX_EXPORT_BYTES;

  if (notes.length === 0) {
    throw new Error('請至少選取一篇筆記進行匯出。');
  }
  if (notes.length > maxNotes) {
    throw new Error(`單次匯出不可超過 ${maxNotes} 篇筆記。`);
  }

  const zip = new JSZip();
  const usedNames = new Map<string, number>();
  let totalBytes = 0;

  for (const note of notes) {
    const baseName = sanitizeFilename(note.title);
    const count = usedNames.get(baseName) ?? 0;
    usedNames.set(baseName, count + 1);
    const fileName = count === 0 ? `${baseName}.md` : `${baseName}-${count + 1}.md`;

    const markdown = buildNoteMarkdown(note);
    totalBytes += Buffer.byteLength(markdown, 'utf8');
    if (totalBytes > maxBytes) {
      throw new Error('匯出內容總大小超過上限。');
    }

    zip.file(`notes/${fileName}`, markdown);
  }

  const refsMd = buildReferencesMarkdown(notes);
  totalBytes += Buffer.byteLength(refsMd, 'utf8');
  if (totalBytes > maxBytes) {
    throw new Error('匯出內容總大小超過上限。');
  }
  zip.file('references.md', refsMd);

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
