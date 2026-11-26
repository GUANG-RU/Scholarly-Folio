import { useEffect, useMemo, useRef, useState } from 'react';
import { ImageOff, Trash2, X, ZoomIn } from 'lucide-react';
import {
  applyTextSegmentEdit,
  findSegmentForGlobalOffset,
  parseEditorSegments,
  removeImageSegment,
  updateImageSegmentCaption,
  type EditorImageSegment,
  type EditorTextSegment,
} from '../lib/editor-segments.ts';

export type EditorSelectionRequest = {
  start: number;
  end: number;
  token: number;
};

type VisualMarkdownEditorProps = {
  content: string;
  placeholder: string;
  compact?: boolean;
  selectionRequest: EditorSelectionRequest | null;
  onChangeContent: (
    nextContent: string,
    selectionStart: number,
    selectionEnd: number,
  ) => void;
  onCommitContent: (
    nextContent: string,
    selectionStart: number,
    selectionEnd: number,
  ) => void;
  onSelectionChange: (start: number, end: number) => void;
  onPasteImage: (file: File, globalStart: number, globalEnd: number) => void;
};

function SegmentTextarea({
  segment,
  isOnlySegment,
  isLastSegment,
  compact,
  placeholder,
  registerRef,
  onSegmentChange,
  onSegmentSelection,
  onSegmentPasteImage,
  onNavigateSibling,
}: {
  segment: EditorTextSegment;
  isOnlySegment: boolean;
  isLastSegment: boolean;
  compact?: boolean;
  placeholder: string;
  registerRef: (id: string, el: HTMLTextAreaElement | null) => void;
  onSegmentChange: (
    segment: EditorTextSegment,
    value: string,
    localStart: number,
    localEnd: number,
  ) => void;
  onSegmentSelection: (
    segment: EditorTextSegment,
    localStart: number,
    localEnd: number,
  ) => void;
  onSegmentPasteImage: (
    file: File,
    segment: EditorTextSegment,
    localStart: number,
    localEnd: number,
  ) => void;
  onNavigateSibling: (segmentId: string, direction: 'prev' | 'next') => void;
}) {
  const localRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = localRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const minHeight = isOnlySegment
      ? compact
        ? 480
        : 440
      : isLastSegment
        ? 160
        : 32;
    el.style.height = `${Math.max(minHeight, el.scrollHeight)}px`;
  }, [segment.text, isOnlySegment, isLastSegment, compact]);

  const effectivePlaceholder = isOnlySegment
    ? placeholder
    : isLastSegment
      ? '繼續撰寫筆記內容（可直接貼上截圖）...'
      : '點擊可在此處補充文字...';

  return (
    <textarea
      ref={(el) => {
        localRef.current = el;
        registerRef(segment.id, el);
      }}
      rows={1}
      value={segment.text}
      onChange={(e) =>
        onSegmentChange(
          segment,
          e.target.value,
          e.target.selectionStart ?? e.target.value.length,
          e.target.selectionEnd ?? e.target.value.length,
        )
      }
      onSelect={(e) => {
        const target = e.currentTarget;
        onSegmentSelection(
          segment,
          target.selectionStart ?? 0,
          target.selectionEnd ?? 0,
        );
      }}
      onFocus={(e) => {
        const target = e.currentTarget;
        onSegmentSelection(
          segment,
          target.selectionStart ?? 0,
          target.selectionEnd ?? 0,
        );
      }}
      onKeyDown={(e) => {
        const target = e.currentTarget;
        const start = target.selectionStart ?? 0;
        const end = target.selectionEnd ?? 0;
        if (e.key === 'ArrowUp' && start === end && !target.value.slice(0, start).includes('\n')) {
          onNavigateSibling(segment.id, 'prev');
        } else if (
          e.key === 'ArrowDown' &&
          start === end &&
          !target.value.slice(start).includes('\n')
        ) {
          onNavigateSibling(segment.id, 'next');
        }
      }}
      onPaste={(e) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (const item of items) {
          if (item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (!file) continue;
            e.preventDefault();
            const target = e.currentTarget;
            onSegmentPasteImage(
              file,
              segment,
              target.selectionStart ?? target.value.length,
              target.selectionEnd ?? target.value.length,
            );
            return;
          }
        }
      }}
      placeholder={effectivePlaceholder}
      aria-label="研究筆記 Markdown 內容"
      className={`w-full bg-transparent text-zinc-800 leading-[1.75] placeholder:text-zinc-400 resize-none border-none focus:outline-none font-sans overflow-hidden ${
        compact ? 'text-[15px]' : 'text-[15px] sm:text-[16px]'
      }`}
    />
  );
}

function EditorImageCard({
  segment,
  onOpenLightbox,
  onUpdateCaption,
  onRemove,
}: {
  segment: EditorImageSegment;
  onOpenLightbox: (src: string, alt: string) => void;
  onUpdateCaption: (segment: EditorImageSegment, nextAlt: string) => void;
  onRemove: (segment: EditorImageSegment) => void;
}) {
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    setBroken(false);
  }, [segment.src]);

  return (
    <figure className="my-3 rounded-xl border border-zinc-200 bg-white p-3 space-y-2.5">
      {broken ? (
        <div className="py-10 px-4 rounded-lg bg-[#faf9f6] border border-zinc-200/80 text-center space-y-1.5">
          <ImageOff className="w-6 h-6 text-zinc-400 mx-auto" aria-hidden="true" />
          <p className="text-xs font-medium text-zinc-700">
            {segment.alt || '圖片無法預覽'}
          </p>
          <p className="text-[11px] text-zinc-500 break-all max-w-md mx-auto">
            {segment.src.startsWith('data:') ? '圖片編碼無法解碼，請重新貼上或上傳圖片。' : segment.src}
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onOpenLightbox(segment.src, segment.alt || '筆記圖片')}
          className="block w-full rounded-lg overflow-hidden bg-[#faf9f6] hover:opacity-95 transition-opacity cursor-zoom-in"
        >
          <img
            src={segment.src}
            alt={segment.alt || '筆記圖片'}
            referrerPolicy="no-referrer"
            onError={() => setBroken(true)}
            className="max-h-[420px] w-auto max-w-full object-contain mx-auto"
          />
        </button>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-zinc-100">
        <input
          type="text"
          value={segment.alt}
          onChange={(e) => onUpdateCaption(segment, e.target.value)}
          placeholder="新增圖片說明文字..."
          aria-label="圖片說明文字"
          className="flex-1 min-w-[160px] min-h-[32px] px-2.5 py-1 text-xs text-zinc-700 bg-[#faf9f6] border border-zinc-200 rounded-lg placeholder:text-zinc-400 focus:outline-none focus:border-blue-600"
        />

        <div className="flex items-center gap-1.5 shrink-0">
          {!broken && (
            <button
              type="button"
              onClick={() => onOpenLightbox(segment.src, segment.alt || '筆記圖片')}
              className="min-h-[32px] px-2.5 py-1 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 text-xs font-medium text-zinc-700 inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ZoomIn className="w-3.5 h-3.5" aria-hidden="true" />
              <span>放大</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => onRemove(segment)}
            aria-label={`移除圖片 ${segment.alt || ''}`.trim()}
            className="min-h-[32px] px-2.5 py-1 rounded-lg border border-zinc-200 bg-white hover:bg-red-50 hover:border-red-200 text-xs font-medium text-zinc-600 hover:text-red-700 inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>移除</span>
          </button>
        </div>
      </div>
    </figure>
  );
}

export function VisualMarkdownEditor({
  content,
  placeholder,
  compact,
  selectionRequest,
  onChangeContent,
  onCommitContent,
  onSelectionChange,
  onPasteImage,
}: VisualMarkdownEditorProps) {
  const segments = useMemo(() => parseEditorSegments(content), [content]);
  const textareaRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt: string } | null>(null);

  const registerRef = (id: string, el: HTMLTextAreaElement | null) => {
    if (el) {
      textareaRefs.current.set(id, el);
    } else {
      textareaRefs.current.delete(id);
    }
  };

  useEffect(() => {
    if (!selectionRequest) return;
    const target = findSegmentForGlobalOffset(segments, selectionRequest.start);
    if (!target) return;
    const el = textareaRefs.current.get(target.segment.id);
    if (!el) return;
    window.requestAnimationFrame(() => {
      el.focus();
      const localStart = target.localOffset;
      const rawEnd = selectionRequest.end - target.segment.startOffset;
      const localEnd = Math.max(localStart, Math.min(target.segment.text.length, rawEnd));
      el.setSelectionRange(localStart, localEnd);
    });
  }, [selectionRequest, segments]);

  const handleSegmentChange = (
    segment: EditorTextSegment,
    newValue: string,
    localStart: number,
    localEnd: number,
  ) => {
    const { nextContent, prefixLength } = applyTextSegmentEdit(content, segment, newValue);
    const globalStart = segment.startOffset + prefixLength + localStart;
    const globalEnd = segment.startOffset + prefixLength + localEnd;
    onChangeContent(nextContent, globalStart, globalEnd);
  };

  const handleSegmentSelection = (
    segment: EditorTextSegment,
    localStart: number,
    localEnd: number,
  ) => {
    onSelectionChange(segment.startOffset + localStart, segment.startOffset + localEnd);
  };

  const handleSegmentPasteImage = (
    file: File,
    segment: EditorTextSegment,
    localStart: number,
    localEnd: number,
  ) => {
    const globalStart = segment.startOffset + localStart;
    const globalEnd = segment.startOffset + localEnd;
    onPasteImage(file, globalStart, globalEnd);
  };

  const handleNavigateSibling = (segmentId: string, direction: 'prev' | 'next') => {
    const textSegments = segments.filter(
      (s): s is EditorTextSegment => s.kind === 'text',
    );
    const idx = textSegments.findIndex((s) => s.id === segmentId);
    if (idx === -1) return;
    const target = direction === 'prev' ? textSegments[idx - 1] : textSegments[idx + 1];
    if (!target) return;
    const el = textareaRefs.current.get(target.id);
    if (!el) return;
    window.requestAnimationFrame(() => {
      el.focus();
      const pos = direction === 'prev' ? target.text.length : 0;
      el.setSelectionRange(pos, pos);
    });
  };

  const handleUpdateCaption = (segment: EditorImageSegment, nextAlt: string) => {
    const nextContent = updateImageSegmentCaption(content, segment, nextAlt);
    onChangeContent(nextContent, segment.startOffset, segment.startOffset);
  };

  const handleRemoveImage = (segment: EditorImageSegment) => {
    const { nextContent, nextCursorOffset } = removeImageSegment(content, segment);
    onCommitContent(nextContent, nextCursorOffset, nextCursorOffset);
  };

  const isOnlyText = segments.length === 1 && segments[0].kind === 'text';

  return (
    <div className="space-y-1">
      {segments.map((seg, idx) =>
        seg.kind === 'text' ? (
          <SegmentTextarea
            key={seg.id}
            segment={seg}
            isOnlySegment={isOnlyText}
            isLastSegment={idx === segments.length - 1}
            compact={compact}
            placeholder={placeholder}
            registerRef={registerRef}
            onSegmentChange={handleSegmentChange}
            onSegmentSelection={handleSegmentSelection}
            onSegmentPasteImage={handleSegmentPasteImage}
            onNavigateSibling={handleNavigateSibling}
          />
        ) : (
          <EditorImageCard
            key={seg.id}
            segment={seg}
            onOpenLightbox={(src, alt) => setLightboxImage({ src, alt })}
            onUpdateCaption={handleUpdateCaption}
            onRemove={handleRemoveImage}
          />
        ),
      )}

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
