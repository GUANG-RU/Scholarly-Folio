import { useRef, useState } from 'react';
import {
  Bold,
  ChevronRightSquare,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  ImagePlus,
  List,
  ListOrdered,
  Network,
  Redo2,
  Table2,
  Undo2,
  X,
} from 'lucide-react';
import { compressImageFileToDataUrl, isSafeImageSource } from '../lib/image-utils.ts';
import type { HighlightColor } from './MarkdownReader.tsx';

type EditorFormattingBarProps = {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onApplyLinePrefix: (prefix: string) => void;
  onWrapSelection: (before: string, after: string, placeholder: string) => void;
  onInsertBlock: (blockText: string) => void;
  onOpenMindMap: () => void;
  mindMapDisabled?: boolean;
};

const HIGHLIGHT_OPTIONS: Array<{
  color: HighlightColor;
  label: string;
  swatchClass: string;
}> = [
  { color: 'yellow', label: '琥珀黃', swatchClass: 'bg-amber-300 border-amber-400' },
  { color: 'green', label: '薄荷綠', swatchClass: 'bg-emerald-300 border-emerald-400' },
  { color: 'blue', label: '晴空藍', swatchClass: 'bg-sky-300 border-sky-400' },
  { color: 'pink', label: '珊瑚粉', swatchClass: 'bg-rose-300 border-rose-400' },
  { color: 'purple', label: '薰衣草紫', swatchClass: 'bg-violet-300 border-violet-400' },
];

export function EditorFormattingBar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onApplyLinePrefix,
  onWrapSelection,
  onInsertBlock,
  onOpenMindMap,
  mindMapDisabled,
}: EditorFormattingBarProps) {
  const [highlightOpen, setHighlightOpen] = useState(false);
  const [tableMenuOpen, setTableMenuOpen] = useState(false);
  const [imagePanelOpen, setImagePanelOpen] = useState(false);
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [imageCaptionInput, setImageCaptionInput] = useState('');
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  const imageFileInputRef = useRef<HTMLInputElement | null>(null);

  const handleInsertTable = (cols: number, rows: number) => {
    const headerCells = Array.from({ length: cols }, (_, idx) => `欄位 ${idx + 1}`).join(' | ');
    const sepCells = Array.from({ length: cols }, () => '---').join(' | ');
    const bodyRows = Array.from({ length: rows }, (_, rIdx) =>
      `| ${Array.from({ length: cols }, (_, cIdx) => `內容 ${rIdx + 1}-${cIdx + 1}`).join(' | ')} |`,
    );
    const tableMd = [`| ${headerCells} |`, `| ${sepCells} |`, ...bodyRows].join('\n');
    onInsertBlock(tableMd);
    setTableMenuOpen(false);
  };

  const handlePickLocalImage = async (file: File) => {
    setImageError(null);
    setImageBusy(true);
    try {
      const { dataUrl } = await compressImageFileToDataUrl(file);
      const caption =
        imageCaptionInput.trim() || file.name.replace(/\.[a-z0-9]+$/i, '') || '筆記圖片';
      onInsertBlock(`![${caption}](${dataUrl})`);
      setImageCaptionInput('');
      setImagePanelOpen(false);
    } catch (err) {
      setImageError(err instanceof Error ? err.message : '圖片處理失敗');
    } finally {
      setImageBusy(false);
      if (imageFileInputRef.current) {
        imageFileInputRef.current.value = '';
      }
    }
  };

  const handleInsertExternalImageUrl = (e: React.FormEvent) => {
    e.preventDefault();
    setImageError(null);
    const trimmedUrl = imageUrlInput.trim();
    if (!isSafeImageSource(trimmedUrl)) {
      setImageError('請輸入有效的 http:// 或 https:// 圖片網址。');
      return;
    }
    const caption = imageCaptionInput.trim() || '研究附圖';
    onInsertBlock(`![${caption}](${trimmedUrl})`);
    setImageUrlInput('');
    setImageCaptionInput('');
    setImagePanelOpen(false);
  };

  const closeOtherPopovers = (keep: 'highlight' | 'table' | 'image' | null) => {
    if (keep !== 'highlight') setHighlightOpen(false);
    if (keep !== 'table') setTableMenuOpen(false);
    if (keep !== 'image') setImagePanelOpen(false);
  };

  return (
    <div className="space-y-2">
      <div
        role="toolbar"
        aria-label="文字排版與研究工具列"
        className="flex flex-wrap items-center gap-1 p-1.5 rounded-xl bg-white border border-zinc-200 relative"
      >
        <button
          type="button"
          disabled={!canUndo}
          onClick={() => {
            closeOtherPopovers(null);
            onUndo();
          }}
          title="上一步 (Ctrl/Cmd+Z)"
          aria-label="上一步"
          className="min-h-[34px] px-2 py-1 rounded-lg text-xs font-medium text-zinc-700 hover:text-zinc-950 hover:bg-zinc-100 disabled:opacity-35 disabled:pointer-events-none inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
          <span>上一步</span>
        </button>

        <button
          type="button"
          disabled={!canRedo}
          onClick={() => {
            closeOtherPopovers(null);
            onRedo();
          }}
          title="下一步 (Ctrl/Cmd+Shift+Z)"
          aria-label="下一步"
          className="min-h-[34px] px-2 py-1 rounded-lg text-xs font-medium text-zinc-700 hover:text-zinc-950 hover:bg-zinc-100 disabled:opacity-35 disabled:pointer-events-none inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Redo2 className="w-3.5 h-3.5" aria-hidden="true" />
          <span>下一步</span>
        </button>

        <span className="w-px h-5 bg-zinc-200 mx-0.5" aria-hidden="true" />

        <button
          type="button"
          onClick={() => {
            closeOtherPopovers(null);
            onApplyLinePrefix('# ');
          }}
          title="大標題 (H1)"
          className="min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-medium text-zinc-700 hover:text-zinc-950 hover:bg-zinc-100 inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Heading1 className="w-3.5 h-3.5" aria-hidden="true" />
          <span>大標題</span>
        </button>

        <button
          type="button"
          onClick={() => {
            closeOtherPopovers(null);
            onApplyLinePrefix('## ');
          }}
          title="中標題 (H2)"
          className="min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-medium text-zinc-700 hover:text-zinc-950 hover:bg-zinc-100 inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Heading2 className="w-3.5 h-3.5" aria-hidden="true" />
          <span>中標題</span>
        </button>

        <button
          type="button"
          onClick={() => {
            closeOtherPopovers(null);
            onApplyLinePrefix('### ');
          }}
          title="小標題 (H3)"
          className="min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-medium text-zinc-700 hover:text-zinc-950 hover:bg-zinc-100 inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Heading3 className="w-3.5 h-3.5" aria-hidden="true" />
          <span>小標題</span>
        </button>

        <button
          type="button"
          onClick={() => {
            closeOtherPopovers(null);
            onInsertBlock('##> 可收合段落標題\n\n在此撰寫可收合的詳細推導或補充筆記...');
          }}
          title="插入可收合的標題段落"
          className="min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-medium text-zinc-700 hover:text-zinc-950 hover:bg-zinc-100 inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <ChevronRightSquare className="w-3.5 h-3.5 text-blue-700" aria-hidden="true" />
          <span>可收合段落</span>
        </button>

        <span className="w-px h-5 bg-zinc-200 mx-0.5" aria-hidden="true" />

        <button
          type="button"
          onClick={() => {
            closeOtherPopovers(null);
            onWrapSelection('**', '**', '粗體文字');
          }}
          title="粗體"
          aria-label="粗體"
          className="min-h-[34px] px-2 py-1 rounded-lg text-xs font-medium text-zinc-700 hover:text-zinc-950 hover:bg-zinc-100 inline-flex items-center whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Bold className="w-3.5 h-3.5" aria-hidden="true" />
        </button>

        {/* 5-color highlighter popover */}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              const next = !highlightOpen;
              closeOtherPopovers(next ? 'highlight' : null);
              setHighlightOpen(next);
            }}
            aria-expanded={highlightOpen}
            className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              highlightOpen
                ? 'bg-amber-100 text-amber-950'
                : 'text-zinc-700 hover:text-zinc-950 hover:bg-zinc-100'
            }`}
          >
            <Highlighter className="w-3.5 h-3.5 text-amber-700" aria-hidden="true" />
            <span>螢光筆</span>
          </button>

          {highlightOpen && (
            <div
              role="menu"
              aria-label="選擇螢光筆顏色"
              className="absolute left-0 top-full mt-1.5 z-30 p-2 rounded-xl bg-white border border-zinc-200 shadow-md flex items-center gap-1.5"
            >
              {HIGHLIGHT_OPTIONS.map((opt) => (
                <button
                  key={opt.color}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onWrapSelection(`==[${opt.color}]`, '==', '重點標記');
                    setHighlightOpen(false);
                  }}
                  title={`${opt.label}螢光筆`}
                  className="px-2 py-1.5 rounded-lg hover:bg-zinc-100 inline-flex items-center gap-1.5 text-xs text-zinc-800 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <span
                    className={`w-3.5 h-3.5 rounded-sm border ${opt.swatchClass}`}
                    aria-hidden="true"
                  />
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            closeOtherPopovers(null);
            onApplyLinePrefix('- ');
          }}
          title="項目符號"
          className="min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-medium text-zinc-700 hover:text-zinc-950 hover:bg-zinc-100 inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <List className="w-3.5 h-3.5" aria-hidden="true" />
          <span>項目符號</span>
        </button>

        <button
          type="button"
          onClick={() => {
            closeOtherPopovers(null);
            onApplyLinePrefix('1. ');
          }}
          title="編號列表"
          className="min-h-[34px] px-2 py-1 rounded-lg text-xs font-medium text-zinc-700 hover:text-zinc-950 hover:bg-zinc-100 inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <ListOrdered className="w-3.5 h-3.5" aria-hidden="true" />
        </button>

        {/* Table presets popover */}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              const next = !tableMenuOpen;
              closeOtherPopovers(next ? 'table' : null);
              setTableMenuOpen(next);
            }}
            aria-expanded={tableMenuOpen}
            className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-medium inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer ${
              tableMenuOpen
                ? 'bg-zinc-100 text-zinc-950'
                : 'text-zinc-700 hover:text-zinc-950 hover:bg-zinc-100'
            }`}
          >
            <Table2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>表格</span>
          </button>

          {tableMenuOpen && (
            <div
              role="menu"
              aria-label="選擇表格大小"
              className="absolute left-0 top-full mt-1.5 z-30 p-2 rounded-xl bg-white border border-zinc-200 shadow-md flex items-center gap-1.5"
            >
              {[
                { cols: 2, rows: 2, label: '2 × 2 表格' },
                { cols: 3, rows: 3, label: '3 × 3 表格' },
                { cols: 4, rows: 3, label: '4 × 3 表格' },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  role="menuitem"
                  onClick={() => handleInsertTable(preset.cols, preset.rows)}
                  className="px-2.5 py-1.5 rounded-lg hover:bg-zinc-100 text-xs font-medium text-zinc-800 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Image insertion toggle */}
        <button
          type="button"
          onClick={() => {
            const next = !imagePanelOpen;
            closeOtherPopovers(next ? 'image' : null);
            setImageError(null);
            setImagePanelOpen(next);
          }}
          aria-expanded={imagePanelOpen}
          className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-medium inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer ${
            imagePanelOpen
              ? 'bg-blue-50 text-blue-800'
              : 'text-zinc-700 hover:text-zinc-950 hover:bg-zinc-100'
          }`}
        >
          <ImagePlus className="w-3.5 h-3.5 text-blue-700" aria-hidden="true" />
          <span>插入圖片</span>
        </button>

        <span className="w-px h-5 bg-zinc-200 mx-0.5" aria-hidden="true" />

        <button
          type="button"
          disabled={mindMapDisabled}
          onClick={() => {
            closeOtherPopovers(null);
            onOpenMindMap();
          }}
          className="min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-40 inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Network className="w-3.5 h-3.5" aria-hidden="true" />
          <span>轉成心智圖</span>
        </button>
      </div>

      {/* Lightweight inline image insert bar */}
      {imagePanelOpen && (
        <div className="p-3.5 rounded-xl bg-white border border-zinc-200 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-zinc-800">
              插入圖片（支援直接貼上截圖、上傳圖片檔案或貼上圖片網址）
            </p>
            <button
              type="button"
              onClick={() => setImagePanelOpen(false)}
              aria-label="關閉圖片插入面板"
              className="p-1 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={imageCaptionInput}
              onChange={(e) => setImageCaptionInput(e.target.value)}
              placeholder="圖片說明文字（選填）"
              className="min-h-[36px] w-48 px-3 py-1.5 text-xs border border-zinc-200 rounded-lg text-zinc-900 placeholder:text-zinc-400"
            />

            <input
              ref={imageFileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handlePickLocalImage(file);
              }}
              className="hidden"
            />
            <button
              type="button"
              disabled={imageBusy}
              onClick={() => imageFileInputRef.current?.click()}
              className="min-h-[36px] px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ImagePlus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{imageBusy ? '壓縮處理中...' : '上傳圖片檔案'}</span>
            </button>

            <form
              onSubmit={handleInsertExternalImageUrl}
              className="flex-1 min-w-[220px] flex items-center gap-1.5"
            >
              <input
                type="url"
                value={imageUrlInput}
                onChange={(e) => setImageUrlInput(e.target.value)}
                placeholder="或貼上 https:// 圖片網址..."
                className="flex-1 min-w-0 min-h-[36px] px-3 py-1.5 text-xs border border-zinc-200 rounded-lg text-zinc-900 placeholder:text-zinc-400"
              />
              <button
                type="submit"
                disabled={!imageUrlInput.trim()}
                className="min-h-[36px] px-3 py-1.5 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 disabled:opacity-50 text-xs font-medium text-zinc-800 whitespace-nowrap shrink-0 cursor-pointer"
              >
                插入網址
              </button>
            </form>
          </div>

          {imageError && (
            <p role="alert" className="text-xs text-red-700">
              {imageError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
