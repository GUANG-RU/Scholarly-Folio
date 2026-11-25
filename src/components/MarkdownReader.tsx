import type { ReactNode } from 'react';

function isSafeHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    if (match[2] !== undefined && match[3] !== undefined) {
      const label = match[2];
      const href = match[3].trim();
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
    } else if (match[4] !== undefined) {
      nodes.push(
        <code
          key={`${keyPrefix}-code-${idx}`}
          className="font-mono text-[0.875em] px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-900 border border-zinc-200"
        >
          {match[4]}
        </code>,
      );
    } else if (match[5] !== undefined) {
      nodes.push(
        <strong key={`${keyPrefix}-bold-${idx}`} className="font-semibold text-zinc-950">
          {match[5]}
        </strong>,
      );
    } else if (match[6] !== undefined) {
      nodes.push(
        <em key={`${keyPrefix}-em-${idx}`} className="italic">
          {match[6]}
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

export function MarkdownReader({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      blocks.push(
        <pre
          key={`code-${i}`}
          className="my-5 p-4 rounded-lg bg-zinc-900 text-zinc-100 font-mono text-xs sm:text-sm overflow-x-auto leading-relaxed"
          aria-label={lang ? `${lang} code block` : 'code block'}
        >
          <code>{codeLines.join('\n')}</code>
        </pre>,
      );
      i += 1;
      continue;
    }

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      blocks.push(<hr key={`hr-${i}`} className="my-8 border-t border-zinc-200" />);
      i += 1;
      continue;
    }

    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      if (level === 1) {
        blocks.push(
          <h1
            key={`h1-${i}`}
            className="font-serif text-2xl sm:text-3xl font-semibold text-zinc-950 tracking-tight mt-8 mb-4 leading-snug"
          >
            {renderInline(text, `h1-${i}`)}
          </h1>,
        );
      } else if (level === 2) {
        blocks.push(
          <h2
            key={`h2-${i}`}
            className="font-serif text-xl sm:text-2xl font-semibold text-zinc-900 tracking-tight mt-7 mb-3 leading-snug"
          >
            {renderInline(text, `h2-${i}`)}
          </h2>,
        );
      } else {
        blocks.push(
          <h3
            key={`h3-${i}`}
            className="font-serif text-lg font-semibold text-zinc-900 mt-6 mb-2 leading-snug"
          >
            {renderInline(text, `h3-${i}`)}
          </h3>,
        );
      }
      i += 1;
      continue;
    }

    if (line.trim().startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push(
        <blockquote
          key={`quote-${i}`}
          className="my-5 px-4 py-3 rounded-lg bg-zinc-100/80 border border-zinc-200 text-zinc-700 text-[15px] leading-relaxed"
        >
          {renderInline(quoteLines.join(' '), `quote-${i}`)}
        </blockquote>,
      );
      continue;
    }

    if (/^[-*]\s+/.test(line.trim())) {
      const listItems: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        listItems.push(lines[i].trim().replace(/^[-*]\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ul key={`ul-${i}`} className="my-4 pl-5 list-disc space-y-2 text-zinc-800 leading-relaxed">
          {listItems.map((item, idx) => (
            <li key={`li-${i}-${idx}`}>{renderInline(item, `ul-${i}-${idx}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s+/.test(line.trim())) {
      const listItems: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        listItems.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ol key={`ol-${i}`} className="my-4 pl-5 list-decimal space-y-2 text-zinc-800 leading-relaxed">
          {listItems.map((item, idx) => (
            <li key={`oli-${i}-${idx}`}>{renderInline(item, `ol-${i}-${idx}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].trim().startsWith('```') &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      !lines[i].trim().startsWith('>') &&
      !/^[-*]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim()) &&
      !/^---+$/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i]);
      i += 1;
    }
    blocks.push(
      <p key={`p-${i}`} className="my-4 text-[16px] text-zinc-800 leading-[1.75]">
        {renderInline(paraLines.join(' '), `p-${i}`)}
      </p>,
    );
  }

  if (blocks.length === 0) {
    return (
      <p className="text-zinc-500 text-[15px] italic py-4">
        此筆記尚無內文。
      </p>
    );
  }

  return <div className="max-w-[68ch]">{blocks}</div>;
}
