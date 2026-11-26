import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, ImageOff, X } from 'lucide-react';
import { isSafeImageSource } from '../lib/image-utils.ts';

function isSafeHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple';

const HIGHLIGHT_CLASSES: Record<HighlightColor, string> = {
  yellow: 'bg-amber-200/85 text-amber-950',
  green: 'bg-emerald-200/80 text-emerald-950',
  blue: 'bg-sky-200/85 text-sky-950',
  pink: 'bg-rose-200/85 text-rose-950',
  purple: 'bg-violet-200/85 text-violet-950',
};

function ReaderInlineImage({
  src,
  alt,
  onOpen,
}: {
  src: string;
  alt: string;
  onOpen: () => void;
}) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-100 border border-zinc-200 text-xs text-zinc-600 align-middle">
        <ImageOff className="w-3 h-3 text-zinc-400" aria-hidden="true" />
        <span>{alt}</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className="inline-block my-1 align-middle rounded-lg overflow-hidden border border-zinc-200 hover:border-blue-400 transition-colors cursor-zoom-in"
    >
      <img
        src={src}
        alt={alt}
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className="max-h-60 w-auto object-contain bg-white"
      />
    </button>
  );
}

function ReaderBlockFigure({
  src,
  alt,
  onOpen,
}: {
  src: string;
  alt: string;
  onOpen: () => void;
}) {
  const [broken, setBroken] = useState(false);
  return (
    <figure className="my-5 space-y-2">
      {broken ? (
        <div className="py-8 px-4 rounded-xl border border-zinc-200 bg-white text-center space-y-1">
          <ImageOff className="w-6 h-6 text-zinc-400 mx-auto" aria-hidden="true" />
          <p className="text-xs font-medium text-zinc-700">{alt || '圖片無法載入'}</p>
        </div>
      ) : (
        <button
          type="button"
          onClick={onOpen}
          className="block max-w-full rounded-xl overflow-hidden border border-zinc-200 bg-white hover:border-blue-400 transition-colors cursor-zoom-in"
        >
          <img
            src={src}
            alt={alt || '研究筆記圖片'}
            referrerPolicy="no-referrer"
            onError={() => setBroken(true)}
            className="max-h-[460px] w-auto max-w-full object-contain mx-auto"
          />
        </button>
      )}
      {alt && <figcaption className="text-xs text-zinc-500 leading-relaxed">{alt}</figcaption>}
    </figure>
  );
}

function renderInline(
  text: string,
  keyPrefix: string,
  onOpenImage?: (src: string, alt: string) => void,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern =
    /(!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)|==(?:\[(yellow|green|blue|pink|purple)\])?([\s\S]+?)==|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    if (match[3] !== undefined) {
      // Inline image ![alt](src)
      const alt = (match[2] ?? '').trim() || '研究筆記圖片';
      const src = match[3].trim();
      if (isSafeImageSource(src)) {
        nodes.push(
          <ReaderInlineImage
            key={`${keyPrefix}-img-${idx}`}
            src={src}
            alt={alt}
            onOpen={() => onOpenImage?.(src, alt)}
          />,
        );
      } else {
        nodes.push(`[圖片：${alt}]`);
      }
    } else if (match[4] !== undefined && match[5] !== undefined) {
      // Hyperlink [label](href)
      const label = match[4];
      const href = match[5].trim();
      if (isSafeHttpUrl(href)) {
        nodes.push(
          <a
            key={`${keyPrefix}-link-${idx}`}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-700 underline underline-offset-4 decoration-blue-300 hover:decoration-blue-700 transition-colors"
          >
            {label}
          </a>,
        );
      } else {
        nodes.push(label);
      }
    } else if (match[7] !== undefined) {
      // 5-color highlighter ==[color]text== or ==text==
      const color = (match[6] as HighlightColor | undefined) ?? 'yellow';
      const inner = match[7];
      nodes.push(
        <mark
          key={`${keyPrefix}-hl-${idx}`}
          className={`px-1 py-0.5 rounded-sm ${HIGHLIGHT_CLASSES[color]}`}
        >
          {inner}
        </mark>,
      );
    } else if (match[8] !== undefined) {
      // Inline code
      nodes.push(
        <code
          key={`${keyPrefix}-code-${idx}`}
          className="font-mono text-[0.875em] px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-900 border border-zinc-200"
        >
          {match[8]}
        </code>,
      );
    } else if (match[9] !== undefined) {
      // Bold
      nodes.push(
        <strong key={`${keyPrefix}-bold-${idx}`} className="font-semibold text-zinc-950">
          {match[9]}
        </strong>,
      );
    } else if (match[10] !== undefined) {
      // Italic
      nodes.push(
        <em key={`${keyPrefix}-em-${idx}`} className="italic">
          {match[10]}
        </em>,
      );
    }

    lastIndex = pattern.lastIndex;
    idx += 1;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

type ListNode = {
  ordered: boolean;
  items: Array<{ text: string; children: ListNode[] }>;
};

function parseIndentedList(
  lines: string[],
  startIndex: number,
  baseIndent: number,
): { node: ListNode; nextIndex: number } {
  const firstTrimmed = lines[startIndex].trimStart();
  const ordered = /^\d+\.\s+/.test(firstTrimmed);
  const items: Array<{ text: string; children: ListNode[] }> = [];
  let i = startIndex;

  while (i < lines.length) {
    const raw = lines[i];
    if (!raw.trim()) {
      break;
    }
    const indent = raw.length - raw.trimStart().length;
    const trimmed = raw.trimStart();
    const isBullet = /^[-*+]\s+/.test(trimmed);
    const isNumbered = /^\d+\.\s+/.test(trimmed);

    if (!isBullet && !isNumbered) {
      break;
    }
    if (indent < baseIndent) {
      break;
    }
    if (indent > baseIndent) {
      if (items.length === 0) break;
      const sub = parseIndentedList(lines, i, indent);
      items[items.length - 1].children.push(sub.node);
      i = sub.nextIndex;
      continue;
    }
    if (isNumbered !== ordered) {
      break;
    }

    const itemText = ordered
      ? trimmed.replace(/^\d+\.\s+/, '')
      : trimmed.replace(/^[-*+]\s+/, '');
    items.push({ text: itemText, children: [] });
    i += 1;
  }

  return { node: { ordered, items }, nextIndex: i };
}

function renderListNode(
  node: ListNode,
  keyPrefix: string,
  onOpenImage: (src: string, alt: string) => void,
): ReactNode {
  const Tag = node.ordered ? 'ol' : 'ul';
  const listClass = node.ordered
    ? 'my-3 pl-5 list-decimal space-y-1.5 text-zinc-800 leading-relaxed'
    : 'my-3 pl-5 list-disc space-y-1.5 text-zinc-800 leading-relaxed';

  return (
    <Tag key={keyPrefix} className={listClass}>
      {node.items.map((item, idx) => (
        <li key={`${keyPrefix}-item-${idx}`}>
          <span>{renderInline(item.text, `${keyPrefix}-item-${idx}`, onOpenImage)}</span>
          {item.children.map((child, cIdx) =>
            renderListNode(child, `${keyPrefix}-item-${idx}-sub-${cIdx}`, onOpenImage),
          )}
        </li>
      ))}
    </Tag>
  );
}

function splitTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
  return trimmed.split('|').map((cell) => cell.trim());
}

function isTableSeparatorLine(line: string): boolean {
  const cells = splitTableRow(line);
  if (cells.length === 0) return false;
  return cells.every((c) => /^:?-{2,}:?$/.test(c));
}

function parseTableAlignments(line: string): Array<'left' | 'center' | 'right'> {
  return splitTableRow(line).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    return 'left';
  });
}

type ParsedBlock =
  | {
      kind: 'heading';
      id: string;
      level: 1 | 2 | 3 | 4;
      text: string;
      defaultCollapsed: boolean;
      isExplicitCollapsible: boolean;
    }
  | {
      kind: 'details';
      id: string;
      summary: string;
      innerMarkdown: string;
    }
  | {
      kind: 'element';
      id: string;
      render: (onOpenImage: (src: string, alt: string) => void) => ReactNode;
    };

type SectionNode = {
  id: string;
  heading?: Extract<ParsedBlock, { kind: 'heading' }>;
  blocks: Array<ParsedBlock | SectionNode>;
};

function parseBlocks(content: string): ParsedBlock[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: ParsedBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '') {
      i += 1;
      continue;
    }

    // HTML <details><summary>...</summary>...</details>
    if (/^<details(?:\s+open)?>/i.test(trimmed)) {
      const startIdx = i;
      const detailsLines: string[] = [];
      while (i < lines.length) {
        detailsLines.push(lines[i]);
        if (/<\/details>/i.test(lines[i])) {
          i += 1;
          break;
        }
        i += 1;
      }
      const joined = detailsLines.join('\n');
      const summaryMatch = /<summary[^>]*>([\s\S]*?)<\/summary>/i.exec(joined);
      const summary = summaryMatch ? summaryMatch[1].replace(/<[^>]+>/g, '').trim() : '展開詳細內容';
      const inner = joined
        .replace(/^<details[^>]*>/i, '')
        .replace(/<\/details>\s*$/i, '')
        .replace(/<summary[^>]*>[\s\S]*?<\/summary>/i, '')
        .trim();
      blocks.push({
        kind: 'details',
        id: `details-${startIdx}`,
        summary,
        innerMarkdown: inner,
      });
      continue;
    }

    // Code fences
    if (trimmed.startsWith('```')) {
      const startIdx = i;
      const lang = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      const codeText = codeLines.join('\n');
      blocks.push({
        kind: 'element',
        id: `code-${startIdx}`,
        render: () => (
          <pre
            key={`code-${startIdx}`}
            className="my-5 p-4 rounded-lg bg-zinc-900 text-zinc-100 font-mono text-xs sm:text-sm overflow-x-auto leading-relaxed"
            aria-label={lang ? `${lang} code block` : 'code block'}
          >
            <code>{codeText}</code>
          </pre>
        ),
      });
      i += 1;
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(trimmed)) {
      const hrIdx = i;
      blocks.push({
        kind: 'element',
        id: `hr-${hrIdx}`,
        render: () => <hr key={`hr-${hrIdx}`} className="my-8 border-t border-zinc-200" />,
      });
      i += 1;
      continue;
    }

    // Standalone image block: ![alt](src)
    const blockImgMatch = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(trimmed);
    if (blockImgMatch) {
      const imgIdx = i;
      const alt = blockImgMatch[1].trim();
      const src = blockImgMatch[2].trim();
      blocks.push({
        kind: 'element',
        id: `figure-${imgIdx}`,
        render: (onOpenImage) =>
          isSafeImageSource(src) ? (
            <ReaderBlockFigure
              key={`figure-${imgIdx}`}
              src={src}
              alt={alt}
              onOpen={() => onOpenImage(src, alt || '研究筆記圖片')}
            />
          ) : (
            <p key={`figure-${imgIdx}`} className="my-3 text-xs text-zinc-500">
              [不支援的圖片來源：{alt || '圖片'}]
            </p>
          ),
      });
      i += 1;
      continue;
    }

    // Collapsible or regular headings: #>, ##>, ###>, #, ##, ###, ####
    const collapsibleHeadingMatch = /^(#{1,3})>\s+(.+)$/.exec(line);
    if (collapsibleHeadingMatch) {
      const level = collapsibleHeadingMatch[1].length as 1 | 2 | 3;
      blocks.push({
        kind: 'heading',
        id: `heading-${i}`,
        level,
        text: collapsibleHeadingMatch[2].trim(),
        defaultCollapsed: true,
        isExplicitCollapsible: true,
      });
      i += 1;
      continue;
    }

    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3 | 4;
      blocks.push({
        kind: 'heading',
        id: `heading-${i}`,
        level,
        text: headingMatch[2].trim(),
        defaultCollapsed: false,
        isExplicitCollapsible: false,
      });
      i += 1;
      continue;
    }

    // Markdown Pipe Table
    if (
      trimmed.includes('|') &&
      i + 1 < lines.length &&
      isTableSeparatorLine(lines[i + 1])
    ) {
      const tableIdx = i;
      const headers = splitTableRow(lines[i]);
      const alignments = parseTableAlignments(lines[i + 1]);
      i += 2;
      const bodyRows: string[][] = [];
      while (i < lines.length && lines[i].trim().includes('|') && lines[i].trim() !== '') {
        bodyRows.push(splitTableRow(lines[i]));
        i += 1;
      }

      blocks.push({
        kind: 'element',
        id: `table-${tableIdx}`,
        render: (onOpenImage) => (
          <div
            key={`table-${tableIdx}`}
            className="my-5 overflow-x-auto rounded-xl border border-zinc-200 bg-white"
          >
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-[#faf9f6] border-b border-zinc-200">
                  {headers.map((header, hIdx) => {
                    const align = alignments[hIdx] ?? 'left';
                    return (
                      <th
                        key={`th-${tableIdx}-${hIdx}`}
                        className={`px-4 py-2.5 text-xs font-semibold text-zinc-900 whitespace-nowrap ${
                          align === 'center'
                            ? 'text-center'
                            : align === 'right'
                              ? 'text-right'
                              : 'text-left'
                        }`}
                      >
                        {renderInline(header, `th-${tableIdx}-${hIdx}`, onOpenImage)}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                {bodyRows.map((row, rIdx) => (
                  <tr key={`tr-${tableIdx}-${rIdx}`} className="hover:bg-zinc-50/70">
                    {headers.map((_, cIdx) => {
                      const align = alignments[cIdx] ?? 'left';
                      const cell = row[cIdx] ?? '';
                      return (
                        <td
                          key={`td-${tableIdx}-${rIdx}-${cIdx}`}
                          className={`px-4 py-2.5 text-xs sm:text-sm text-zinc-800 align-top tabular-nums ${
                            align === 'center'
                              ? 'text-center'
                              : align === 'right'
                                ? 'text-right'
                                : 'text-left'
                          }`}
                        >
                          {renderInline(cell, `td-${tableIdx}-${rIdx}-${cIdx}`, onOpenImage)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ),
      });
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('>')) {
      const qIdx = i;
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      const quoteJoined = quoteLines.join(' ');
      blocks.push({
        kind: 'element',
        id: `quote-${qIdx}`,
        render: (onOpenImage) => (
          <blockquote
            key={`quote-${qIdx}`}
            className="my-5 px-4 py-3 rounded-lg bg-zinc-100/80 border border-zinc-200 text-zinc-700 text-[15px] leading-relaxed"
          >
            {renderInline(quoteJoined, `quote-${qIdx}`, onOpenImage)}
          </blockquote>
        ),
      });
      continue;
    }

    // Indented Bullet or Numbered List
    if (/^[-*+]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      const listIdx = i;
      const baseIndent = line.length - line.trimStart().length;
      const { node, nextIndex } = parseIndentedList(lines, i, baseIndent);
      i = nextIndex;
      blocks.push({
        kind: 'element',
        id: `list-${listIdx}`,
        render: (onOpenImage) => renderListNode(node, `list-${listIdx}`, onOpenImage),
      });
      continue;
    }

    // Paragraph
    const pIdx = i;
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].trim().startsWith('```') &&
      !/^<details(?:\s+open)?>/i.test(lines[i].trim()) &&
      !/^(#{1,4})>?\s+/.test(lines[i]) &&
      !lines[i].trim().startsWith('>') &&
      !/^[-*+]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim()) &&
      !/^---+$/.test(lines[i].trim()) &&
      !/^!\[([^\]]*)\]\(([^)]+)\)$/.test(lines[i].trim()) &&
      !(
        lines[i].trim().includes('|') &&
        i + 1 < lines.length &&
        isTableSeparatorLine(lines[i + 1])
      )
    ) {
      paraLines.push(lines[i]);
      i += 1;
    }
    const paraText = paraLines.join(' ');
    blocks.push({
      kind: 'element',
      id: `p-${pIdx}`,
      render: (onOpenImage) => (
        <p key={`p-${pIdx}`} className="my-4 text-[16px] text-zinc-800 leading-[1.75]">
          {renderInline(paraText, `p-${pIdx}`, onOpenImage)}
        </p>
      ),
    });
  }

  return blocks;
}

function buildSectionTree(blocks: ParsedBlock[]): SectionNode {
  const root: SectionNode = { id: 'root', blocks: [] };
  const stack: SectionNode[] = [root];

  for (const block of blocks) {
    if (block.kind === 'heading') {
      while (stack.length > 1) {
        const top = stack[stack.length - 1];
        if (top.heading && top.heading.level >= block.level) {
          stack.pop();
        } else {
          break;
        }
      }
      const section: SectionNode = {
        id: block.id,
        heading: block,
        blocks: [],
      };
      stack[stack.length - 1].blocks.push(section);
      stack.push(section);
    } else {
      stack[stack.length - 1].blocks.push(block);
    }
  }

  return root;
}

function collectHeadingIds(
  node: SectionNode,
): Array<{ id: string; defaultCollapsed: boolean }> {
  const out: Array<{ id: string; defaultCollapsed: boolean }> = [];
  for (const item of node.blocks) {
    if ('blocks' in item) {
      if (item.heading) {
        out.push({ id: item.heading.id, defaultCollapsed: item.heading.defaultCollapsed });
      }
      out.push(...collectHeadingIds(item));
    } else if (item.kind === 'details') {
      out.push({ id: item.id, defaultCollapsed: true });
    }
  }
  return out;
}

export function MarkdownReader({ content }: { content: string }) {
  const [collapsedOverrides, setCollapsedOverrides] = useState<Record<string, boolean>>({});
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt: string } | null>(null);

  const { tree, headingEntries } = useMemo(() => {
    const parsed = parseBlocks(content);
    const sectionTree = buildSectionTree(parsed);
    const headings = collectHeadingIds(sectionTree);
    return { tree: sectionTree, headingEntries: headings };
  }, [content]);

  const isSectionCollapsed = (id: string, defaultCollapsed: boolean): boolean => {
    if (Object.prototype.hasOwnProperty.call(collapsedOverrides, id)) {
      return collapsedOverrides[id];
    }
    return defaultCollapsed;
  };

  const toggleSection = (id: string, defaultCollapsed: boolean) => {
    const current = isSectionCollapsed(id, defaultCollapsed);
    setCollapsedOverrides((prev) => ({ ...prev, [id]: !current }));
  };

  const setAllCollapsed = (collapsed: boolean) => {
    const next: Record<string, boolean> = {};
    for (const h of headingEntries) {
      next[h.id] = collapsed;
    }
    setCollapsedOverrides(next);
  };

  const renderSectionNode = (node: SectionNode): ReactNode => {
    return node.blocks.map((item) => {
      if ('blocks' in item && item.heading) {
        const heading = item.heading;
        const collapsed = isSectionCollapsed(heading.id, heading.defaultCollapsed);
        const hasChildren = item.blocks.length > 0;

        const sizeClasses =
          heading.level === 1
            ? 'font-serif text-2xl sm:text-3xl font-semibold text-zinc-950 tracking-tight mt-7 mb-3 leading-snug'
            : heading.level === 2
              ? 'font-serif text-xl sm:text-2xl font-semibold text-zinc-900 tracking-tight mt-6 mb-2.5 leading-snug'
              : heading.level === 3
                ? 'font-serif text-lg font-semibold text-zinc-900 mt-5 mb-2 leading-snug'
                : 'font-serif text-base font-semibold text-zinc-800 mt-4 mb-1.5 leading-snug';

        const HeadingTag =
          heading.level === 1
            ? 'h1'
            : heading.level === 2
              ? 'h2'
              : heading.level === 3
                ? 'h3'
                : 'h4';

        return (
          <section key={heading.id} className="group">
            <div className={`flex items-baseline gap-2 ${sizeClasses}`}>
              {hasChildren && (
                <button
                  type="button"
                  onClick={() => toggleSection(heading.id, heading.defaultCollapsed)}
                  aria-expanded={!collapsed}
                  aria-label={collapsed ? `展開「${heading.text}」` : `收合「${heading.text}」`}
                  className={`inline-flex items-center justify-center w-6 h-6 -ml-1 rounded-md text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200/70 transition-colors shrink-0 cursor-pointer ${
                    heading.isExplicitCollapsible || collapsed
                      ? 'opacity-100'
                      : 'opacity-40 group-hover:opacity-100 focus:opacity-100'
                  }`}
                >
                  {collapsed ? (
                    <ChevronRight className="w-4 h-4" aria-hidden="true" />
                  ) : (
                    <ChevronDown className="w-4 h-4" aria-hidden="true" />
                  )}
                </button>
              )}
              <HeadingTag
                onClick={
                  hasChildren
                    ? () => toggleSection(heading.id, heading.defaultCollapsed)
                    : undefined
                }
                className={hasChildren ? 'cursor-pointer select-none flex-1 min-w-0' : 'flex-1 min-w-0'}
              >
                {renderInline(heading.text, heading.id, (src, alt) =>
                  setLightboxImage({ src, alt }),
                )}
              </HeadingTag>
            </div>

            {hasChildren && !collapsed && (
              <div className={heading.isExplicitCollapsible ? 'pl-5 mt-1 mb-4' : undefined}>
                {renderSectionNode(item)}
              </div>
            )}

            {hasChildren && collapsed && (
              <button
                type="button"
                onClick={() => toggleSection(heading.id, heading.defaultCollapsed)}
                className="mb-3 px-3 py-1.5 rounded-lg bg-[#f4f4f2] hover:bg-zinc-200/70 text-xs text-zinc-600 inline-flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                <span>已收合段落（點擊展開 {item.blocks.length} 個區塊）</span>
              </button>
            )}
          </section>
        );
      }

      const block = item as ParsedBlock;
      if (block.kind === 'details') {
        const collapsed = isSectionCollapsed(block.id, true);
        return (
          <div
            key={block.id}
            className="my-4 rounded-xl border border-zinc-200 bg-white overflow-hidden"
          >
            <button
              type="button"
              onClick={() => toggleSection(block.id, true)}
              aria-expanded={!collapsed}
              className="w-full px-4 py-3 text-left flex items-center gap-2 text-sm font-semibold text-zinc-900 hover:bg-zinc-50 cursor-pointer"
            >
              {collapsed ? (
                <ChevronRight className="w-4 h-4 text-zinc-500 shrink-0" aria-hidden="true" />
              ) : (
                <ChevronDown className="w-4 h-4 text-zinc-500 shrink-0" aria-hidden="true" />
              )}
              <span className="truncate">{block.summary}</span>
            </button>
            {!collapsed && (
              <div className="px-4 pb-4 pt-1 border-t border-zinc-100">
                <MarkdownReader content={block.innerMarkdown} />
              </div>
            )}
          </div>
        );
      }

      if (block.kind === 'element') {
        return block.render((src, alt) => setLightboxImage({ src, alt }));
      }
      return null;
    });
  };

  if (tree.blocks.length === 0) {
    return (
      <p className="text-zinc-500 text-[15px] italic py-4">
        此筆記尚無內文。
      </p>
    );
  }

  return (
    <div className="max-w-[68ch]">
      {headingEntries.length > 0 && (
        <div className="flex items-center justify-end gap-3 mb-2 text-xs text-zinc-500">
          <button
            type="button"
            onClick={() => setAllCollapsed(false)}
            className="hover:text-zinc-900 hover:underline whitespace-nowrap cursor-pointer"
          >
            全部展開
          </button>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={() => setAllCollapsed(true)}
            className="hover:text-zinc-900 hover:underline whitespace-nowrap cursor-pointer"
          >
            全部收合
          </button>
        </div>
      )}

      {renderSectionNode(tree)}

      {lightboxImage && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="圖片檢視"
          onClick={() => setLightboxImage(null)}
          className="fixed inset-0 z-50 bg-zinc-950/75 flex items-center justify-center p-6"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-4xl max-h-[90vh] bg-white rounded-xl p-3 space-y-2"
          >
            <button
              type="button"
              onClick={() => setLightboxImage(null)}
              aria-label="關閉圖片預覽"
              className="absolute top-3 right-3 min-h-[36px] min-w-[36px] rounded-lg bg-white/90 border border-zinc-200 text-zinc-700 hover:text-zinc-950 inline-flex items-center justify-center cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
            <img
              src={lightboxImage.src}
              alt={lightboxImage.alt}
              referrerPolicy="no-referrer"
              className="max-h-[80vh] max-w-full object-contain rounded-lg"
            />
            {lightboxImage.alt && (
              <p className="text-xs text-zinc-600 text-center px-2 pb-1">
                {lightboxImage.alt}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
