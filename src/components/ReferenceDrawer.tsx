import { useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  FilePlus2,
  Pin,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import type {
  CourseRefItem,
  CourseSearchResultItem,
  ImportedReferenceDoc,
} from '../types/workspace.ts';
import { MarkdownReader } from './MarkdownReader.tsx';

type ReferenceDrawerProps = {
  isOpen: boolean;
  drawerMode: 'courses' | 'doc';
  importedRefDoc: ImportedReferenceDoc | null;
  hasActiveNote: boolean;
  isLoading: boolean;
  keywords: string;
  items: CourseSearchResultItem[];
  degraded: boolean;
  errorMessage: string | null;
  pinnedRefs: CourseRefItem[];
  onChangeMode: (mode: 'courses' | 'doc') => void;
  onClose: () => void;
  onRefreshSearch: (customQuery?: string) => void;
  onPinRef: (item: CourseSearchResultItem) => Promise<void>;
  onInsertRefDocToNote: (doc: ImportedReferenceDoc) => void;
  onCreateNoteFromRefDoc: (doc: ImportedReferenceDoc) => Promise<void>;
  onClearImportedRefDoc: () => void;
};

const PROVIDER_LABELS: Record<CourseSearchResultItem['provider'], string> = {
  MIT_OCW: 'MIT OpenCourseWare',
  CURATED_OCW: '大學開放課程索引',
  OPENALEX: 'OpenAlex 學術索引',
};

export function ReferenceDrawer({
  isOpen,
  drawerMode,
  importedRefDoc,
  hasActiveNote,
  isLoading,
  keywords,
  items,
  degraded,
  errorMessage,
  pinnedRefs,
  onChangeMode,
  onClose,
  onRefreshSearch,
  onPinRef,
  onInsertRefDocToNote,
  onCreateNoteFromRefDoc,
  onClearImportedRefDoc,
}: ReferenceDrawerProps) {
  const [customQuery, setCustomQuery] = useState('');
  const [pinningUrl, setPinningUrl] = useState<string | null>(null);
  const [copiedDoc, setCopiedDoc] = useState(false);
  const [creatingNote, setCreatingNote] = useState(false);

  if (!isOpen) {
    return null;
  }

  const effectiveMode = drawerMode === 'doc' && importedRefDoc ? 'doc' : 'courses';
  const pinnedUrlSet = new Set(pinnedRefs.map((r) => r.url));

  const handlePin = async (item: CourseSearchResultItem) => {
    setPinningUrl(item.url);
    try {
      await onPinRef(item);
    } finally {
      setPinningUrl(null);
    }
  };

  const handleCopyDoc = async () => {
    if (!importedRefDoc) return;
    try {
      await navigator.clipboard.writeText(importedRefDoc.content);
      setCopiedDoc(true);
      setTimeout(() => setCopiedDoc(false), 2000);
    } catch {
      // Fallback ignored if clipboard denied
    }
  };

  const handleCreateNote = async () => {
    if (!importedRefDoc) return;
    setCreatingNote(true);
    try {
      await onCreateNoteFromRefDoc(importedRefDoc);
    } finally {
      setCreatingNote(false);
    }
  };

  return (
    <aside
      aria-label="對照參考與文獻抽屜"
      className={`fixed inset-y-0 right-0 z-40 w-full max-w-[440px] bg-[#f4f4f2] border-l border-zinc-200 flex flex-col shadow-lg md:static md:shadow-none md:shrink-0 ${
        effectiveMode === 'doc' ? 'md:w-[420px]' : 'md:w-[360px]'
      }`}
    >
      <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between gap-4 bg-white">
        <div className="min-w-0">
          <h2 className="font-serif text-base font-semibold text-zinc-950 truncate">
            {effectiveMode === 'doc' ? '對照參考筆記' : '外部課程與文獻參考'}
          </h2>
          <p className="text-xs text-zinc-500 truncate">
            {effectiveMode === 'doc'
              ? importedRefDoc?.sourceLabel || '已匯入參考文件'
              : '僅於主動觸發時檢索 · 絕不自動推播'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="關閉參考抽屜"
          className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg text-zinc-600 hover:text-zinc-950 hover:bg-zinc-100 transition-colors cursor-pointer shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {importedRefDoc && (
        <div className="px-5 py-2.5 border-b border-zinc-200 bg-[#faf9f6] flex items-center gap-1.5">
          <div className="flex-1 flex items-center gap-1 p-1 bg-zinc-200/70 rounded-lg">
            <button
              type="button"
              onClick={() => onChangeMode('doc')}
              className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                effectiveMode === 'doc'
                  ? 'bg-white text-zinc-950 shadow-sm'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              參考文件全文
            </button>
            <button
              type="button"
              onClick={() => onChangeMode('courses')}
              className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                effectiveMode === 'courses'
                  ? 'bg-white text-zinc-950 shadow-sm'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              課程與文獻搜尋
            </button>
          </div>
        </div>
      )}

      {effectiveMode === 'doc' && importedRefDoc ? (
        <>
          <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-white">
            <header className="space-y-2 pb-3 border-b border-zinc-200">
              <h3 className="font-serif text-lg font-semibold text-zinc-950 leading-snug">
                {importedRefDoc.title}
              </h3>
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                <span>{importedRefDoc.sourceLabel}</span>
                {importedRefDoc.webViewLink && (
                  <>
                    <span aria-hidden="true">·</span>
                    <a
                      href={importedRefDoc.webViewLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-blue-700 hover:underline whitespace-nowrap"
                    >
                      <span>在雲端硬碟檢視</span>
                      <ExternalLink className="w-3 h-3" aria-hidden="true" />
                    </a>
                  </>
                )}
              </div>
            </header>

            <MarkdownReader content={importedRefDoc.content} />
          </div>

          <div className="p-4 border-t border-zinc-200 bg-[#faf9f6] space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!hasActiveNote}
                onClick={() => onInsertRefDocToNote(importedRefDoc)}
                className="flex-1 min-h-[38px] px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-xs font-medium inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>插入目前筆記</span>
              </button>

              <button
                type="button"
                disabled={creatingNote}
                onClick={() => void handleCreateNote()}
                className="min-h-[38px] px-3 py-1.5 rounded-lg bg-white border border-zinc-300 hover:bg-zinc-100 disabled:opacity-50 text-zinc-800 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FilePlus2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>{creatingNote ? '建立中...' : '轉存為新筆記'}</span>
              </button>
            </div>

            <div className="flex items-center justify-between gap-2 pt-0.5">
              <button
                type="button"
                onClick={() => void handleCopyDoc()}
                className="min-h-[34px] px-2.5 py-1 rounded-lg text-xs text-zinc-700 hover:bg-zinc-200/60 inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                {copiedDoc ? (
                  <Check className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                ) : (
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>{copiedDoc ? '已複製全文' : '複製全文'}</span>
              </button>

              <button
                type="button"
                onClick={onClearImportedRefDoc}
                className="min-h-[34px] px-2.5 py-1 rounded-lg text-xs text-zinc-500 hover:text-red-700 hover:bg-red-50 whitespace-nowrap cursor-pointer"
              >
                移除參考文件
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onRefreshSearch(customQuery.trim() || undefined);
            }}
            className="px-5 py-3 border-b border-zinc-200 bg-[#faf9f6] flex items-center gap-2"
          >
            <input
              type="text"
              value={customQuery}
              onChange={(e) => setCustomQuery(e.target.value)}
              placeholder={keywords || '輸入關鍵字重新檢索...'}
              aria-label="微調參考檢索關鍵字"
              className="flex-1 min-w-0 min-h-[40px] px-3 py-1.5 text-xs bg-white border border-zinc-200 rounded-lg text-zinc-900 placeholder:text-zinc-400"
            />
            <button
              type="submit"
              disabled={isLoading}
              className="min-h-[40px] px-3 py-1.5 text-xs font-medium rounded-lg bg-white border border-zinc-200 text-zinc-800 hover:bg-zinc-100 disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>檢索</span>
            </button>
          </form>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {keywords && !isLoading && (
              <p className="text-xs text-zinc-500">
                檢索詞彙：<span className="font-mono text-zinc-700">{keywords}</span>
              </p>
            )}

            {isLoading && (
              <div className="space-y-3" aria-busy="true" aria-label="正在檢索外部課程與文獻">
                {[1, 2, 3].map((n) => (
                  <div
                    key={n}
                    className="p-4 rounded-xl bg-white border border-zinc-200 animate-pulse space-y-2.5"
                  >
                    <div className="h-3 w-28 bg-zinc-200 rounded" />
                    <div className="h-4 w-5/6 bg-zinc-200 rounded" />
                    <div className="h-12 w-full bg-zinc-100 rounded" />
                  </div>
                ))}
              </div>
            )}

            {!isLoading && errorMessage && (
              <div className="p-4 rounded-xl bg-white border border-red-200 text-xs text-red-800 leading-relaxed">
                {errorMessage}
              </div>
            )}

            {!isLoading && !errorMessage && degraded && items.length === 0 && (
              <div className="p-4 rounded-xl bg-white border border-zinc-200 text-xs text-zinc-600 leading-relaxed">
                外部課程與學術資料庫目前連線逾時或暫時無法回應，您仍可繼續專心寫作並儲存筆記。
              </div>
            )}

            {!isLoading && !errorMessage && !degraded && items.length === 0 && (
              <div className="p-4 rounded-xl bg-white border border-zinc-200 text-xs text-zinc-600 leading-relaxed">
                尚未找到相關參考項目，請嘗試輸入英文或更具體的領域關鍵字重新檢索。
              </div>
            )}

            {!isLoading &&
              items.map((item) => {
                const isPinned = pinnedUrlSet.has(item.url);
                const isPinning = pinningUrl === item.url;
                const kindLabel = item.type === 'COURSE' ? '[開放課程]' : '[學術文獻]';
                const providerLabel = PROVIDER_LABELS[item.provider];

                return (
                  <article
                    key={`${item.provider}-${item.externalId}`}
                    className="p-4 rounded-xl bg-white border border-zinc-200 space-y-2.5"
                  >
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      <span
                        className={
                          item.type === 'COURSE'
                            ? 'font-medium text-blue-700'
                            : 'font-medium text-zinc-700'
                        }
                      >
                        {kindLabel}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="truncate">{providerLabel}</span>
                    </div>

                    <h3 className="text-sm font-semibold text-zinc-950 leading-snug">
                      {item.title}
                    </h3>

                    {item.summary && (
                      <p className="text-xs text-zinc-600 leading-relaxed line-clamp-4">
                        {item.summary}
                      </p>
                    )}

                    <div className="pt-2 flex items-center justify-between gap-3 border-t border-zinc-100">
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-zinc-600 hover:text-blue-700 underline underline-offset-4 whitespace-nowrap shrink-0"
                      >
                        <span>開啟來源</span>
                        <ExternalLink className="w-3 h-3" aria-hidden="true" />
                      </a>

                      <button
                        type="button"
                        disabled={isPinned || isPinning}
                        onClick={() => void handlePin(item)}
                        className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                          isPinned
                            ? 'bg-zinc-100 text-zinc-500 cursor-default'
                            : 'bg-blue-700 hover:bg-blue-800 text-white'
                        }`}
                      >
                        {isPinned ? (
                          <>
                            <Check className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>已釘選</span>
                          </>
                        ) : (
                          <>
                            <Pin className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>{isPinning ? '釘選中...' : '釘選至筆記'}</span>
                          </>
                        )}
                      </button>
                    </div>
                  </article>
                );
              })}
          </div>
        </>
      )}
    </aside>
  );
}
