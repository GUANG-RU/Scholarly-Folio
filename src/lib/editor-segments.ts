import { isSafeImageSource } from './image-utils.ts';

export type EditorTextSegment = {
  kind: 'text';
  id: string;
  startOffset: number;
  endOffset: number;
  text: string;
  virtualPrefix?: string;
  virtualSuffix?: string;
};

export type EditorImageSegment = {
  kind: 'image';
  id: string;
  startOffset: number;
  endOffset: number;
  alt: string;
  src: string;
  raw: string;
};

export type EditorSegment = EditorTextSegment | EditorImageSegment;

function getFencedCodeRanges(content: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const lineStartIndices: number[] = [0];
  for (let i = 0; i < content.length; i += 1) {
    if (content[i] === '\n') {
      lineStartIndices.push(i + 1);
    }
  }

  let openStart: number | null = null;
  for (let i = 0; i < lineStartIndices.length; i += 1) {
    const start = lineStartIndices[i];
    const end =
      i + 1 < lineStartIndices.length ? lineStartIndices[i + 1] - 1 : content.length;
    const line = content.slice(start, end).trimStart();
    if (line.startsWith('```')) {
      if (openStart === null) {
        openStart = start;
      } else {
        ranges.push([openStart, end]);
        openStart = null;
      }
    }
  }
  if (openStart !== null) {
    ranges.push([openStart, content.length]);
  }
  return ranges;
}

function isInsideRanges(pos: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([start, end]) => pos >= start && pos <= end);
}

export function parseEditorSegments(content: string): EditorSegment[] {
  const fencedRanges = getFencedCodeRanges(content);
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const matches: Array<{
    start: number;
    end: number;
    alt: string;
    src: string;
    raw: string;
  }> = [];

  let match: RegExpExecArray | null;
  while ((match = imageRegex.exec(content)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    const alt = match[1];
    const src = match[2].trim();

    if (isInsideRanges(start, fencedRanges)) {
      continue;
    }
    if (!isSafeImageSource(src)) {
      continue;
    }
    matches.push({ start, end, alt, src, raw: match[0] });
  }

  if (matches.length === 0) {
    return [
      {
        kind: 'text',
        id: 'text-0',
        startOffset: 0,
        endOffset: content.length,
        text: content,
      },
    ];
  }

  const segments: EditorSegment[] = [];
  let cursor = 0;

  for (let i = 0; i < matches.length; i += 1) {
    const m = matches[i];
    const rawBefore = content.slice(cursor, m.start);

    let trimBefore = 0;
    if (rawBefore.endsWith('\n\n')) {
      trimBefore = 2;
    } else if (rawBefore.endsWith('\n')) {
      trimBefore = 1;
    }

    const textEnd = m.start - trimBefore;
    const textValue = content.slice(cursor, textEnd);
    const segIdx = segments.length;

    segments.push({
      kind: 'text',
      id: `text-${segIdx}`,
      startOffset: cursor,
      endOffset: textEnd,
      text: textValue,
      virtualSuffix: textValue === '' && trimBefore === 0 ? '\n\n' : undefined,
    });

    segments.push({
      kind: 'image',
      id: `img-${segments.length}`,
      startOffset: m.start,
      endOffset: m.end,
      alt: m.alt,
      src: m.src,
      raw: m.raw,
    });

    const after = content.slice(m.end);
    if (after.startsWith('\n\n')) {
      cursor = m.end + 2;
    } else if (after.startsWith('\n')) {
      cursor = m.end + 1;
    } else {
      cursor = m.end;
    }
  }

  const tail = content.slice(cursor);
  if (tail.length > 0 || cursor < content.length) {
    segments.push({
      kind: 'text',
      id: `text-${segments.length}`,
      startOffset: cursor,
      endOffset: content.length,
      text: tail,
    });
  } else {
    const lastMatchEnd = matches[matches.length - 1].end;
    const trailingChars = content.slice(lastMatchEnd);
    const virtualPrefix =
      trailingChars === '\n\n' ? '' : trailingChars === '\n' ? '\n' : '\n\n';
    segments.push({
      kind: 'text',
      id: `text-${segments.length}`,
      startOffset: content.length,
      endOffset: content.length,
      text: '',
      virtualPrefix,
    });
  }

  return segments;
}

export function applyTextSegmentEdit(
  content: string,
  segment: EditorTextSegment,
  newText: string,
): { nextContent: string; prefixLength: number } {
  const prefix =
    segment.text === '' && newText !== '' && segment.virtualPrefix
      ? segment.virtualPrefix
      : '';
  const suffix =
    segment.text === '' && newText !== '' && segment.virtualSuffix
      ? segment.virtualSuffix
      : '';
  const replacement = `${prefix}${newText}${suffix}`;
  const nextContent =
    content.slice(0, segment.startOffset) + replacement + content.slice(segment.endOffset);
  return {
    nextContent,
    prefixLength: prefix.length,
  };
}

export function updateImageSegmentCaption(
  content: string,
  segment: EditorImageSegment,
  nextAlt: string,
): string {
  const safeAlt = nextAlt.replace(/[\r\n[\]]/g, ' ');
  const replacement = `![${safeAlt}](${segment.src})`;
  return content.slice(0, segment.startOffset) + replacement + content.slice(segment.endOffset);
}

export function removeImageSegment(
  content: string,
  segment: EditorImageSegment,
): { nextContent: string; nextCursorOffset: number } {
  const before = content.slice(0, segment.startOffset).replace(/\n+$/, '');
  const after = content.slice(segment.endOffset).replace(/^\n+/, '');
  if (before && after) {
    return {
      nextContent: `${before}\n\n${after}`,
      nextCursorOffset: before.length,
    };
  }
  const nextContent = before || after;
  return {
    nextContent,
    nextCursorOffset: before ? before.length : 0,
  };
}

export function findSegmentForGlobalOffset(
  segments: EditorSegment[],
  globalOffset: number,
): { segment: EditorTextSegment; localOffset: number } | null {
  const textSegments = segments.filter(
    (s): s is EditorTextSegment => s.kind === 'text',
  );
  if (textSegments.length === 0) return null;

  for (const seg of textSegments) {
    if (globalOffset >= seg.startOffset && globalOffset <= seg.endOffset) {
      return {
        segment: seg,
        localOffset: Math.max(0, Math.min(seg.text.length, globalOffset - seg.startOffset)),
      };
    }
  }

  // Fallback to closest preceding or last text segment
  let best = textSegments[0];
  for (const seg of textSegments) {
    if (seg.startOffset <= globalOffset) {
      best = seg;
    }
  }
  const clamped = Math.max(0, Math.min(best.text.length, globalOffset - best.startOffset));
  return { segment: best, localOffset: clamped };
}
