import { useState } from 'react';
import { ExternalLink, Pin, Check, RefreshCw, X } from 'lucide-react';
import type { CourseRefItem, CourseSearchResultItem } from '../types/workspace.ts';

type ReferenceDrawerProps = {
  isOpen: boolean;
  isLoading: boolean;
  keywords: string;
  items: CourseSearchResultItem[];
  degraded: boolean;
  errorMessage: string | null;
  pinnedRefs: CourseRefItem[];
  onClose: () => void;
  onRefreshSearch: (customQuery?: string) => void;
  onPinRef: (item: CourseSearchResultItem) => Promise<void>;
};

const PROVIDER_LABELS: Record<CourseSearchResultItem['provider'], string> = {
  MIT_OCW: 'MIT OpenCourseWare',
  CURATED_OCW: '大學開放課程索引',
  OPENALEX: 'OpenAlex 學術索引',
};

export function ReferenceDrawer({
  isOpen,
  isLoading,
  keywords,
  items,
  degraded,
  errorMessage,
  pinnedRefs,
  onClose,
  onRefreshSearch,
  onPinRef,
}: ReferenceDrawerProps) {
  const [customQuery, setCustomQuery] = useState('');
  const [pinningUrl, setPinningUrl] = useState<string | null>(null);

  if (!isOpen) {
    return null;
  }

  const pinnedUrlSet = new Set(pinnedRefs.map((r) => r.url));

  const handlePin = async (item: CourseSearchResultItem) => {
    setPinningUrl(item.url);
    try {
      await onPinRef(item);
    } finally {
      setPinningUrl(null);
    }
  };

  return (
    <aside
      aria-label="外部課程與文獻參考抽屜"
      className="fixed inset-y-0 right-0 z-40 w-full max-w-[380px] bg-[#f4f4f2] border-l border-zinc-200 flex flex-col shadow-lg md:static md:shadow-none md:w-[360px] md:shrink-0"
    >
      <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between gap-4 bg-white">
        <div className="min-w-0">
          <h2 className="font-serif text-base font-semibold text-zinc-950 truncate">
            外部課程與文獻參考
          </h2>
          <p className="text-xs text-zinc-500 truncate">
            僅於主動觸發時檢索 · 絕不自動推播
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
    </aside>
  );
}
