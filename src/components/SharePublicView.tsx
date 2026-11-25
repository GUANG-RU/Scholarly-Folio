import { useEffect, useState } from 'react';
import { BookOpen, ExternalLink } from 'lucide-react';
import { getPublicFirestoreShareBundle } from '../lib/firestore-workspace.ts';
import type { PublicShareBundle } from '../types/workspace.ts';
import { MarkdownReader } from './MarkdownReader.tsx';

export function SharePublicView({ slug }: { slug: string }) {
  const [bundle, setBundle] = useState<PublicShareBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let active = true;
    const loadBundle = async () => {
      setLoading(true);
      setNotFound(false);
      try {
        const fetched = await getPublicFirestoreShareBundle(slug);
        if (!fetched) {
          if (active) setNotFound(true);
          return;
        }
        if (active) setBundle(fetched);
      } catch {
        if (active) setNotFound(true);
      } finally {
        if (active) setLoading(false);
      }
    };
    void loadBundle();
    return () => {
      active = false;
    };
  }, [slug]);

  return (
    <div className="min-h-screen bg-[#faf9f6] text-zinc-900">
      <header className="border-b border-zinc-200 bg-white">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between gap-8">
          <span className="font-serif text-lg font-semibold tracking-tight text-zinc-950 whitespace-nowrap shrink-0">
            Scholarly Folio
          </span>
          <span className="text-xs text-zinc-500 whitespace-nowrap shrink-0">
            唯讀研究分享 · 免登入閱讀
          </span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10 sm:py-14">
        {loading && (
          <div className="space-y-4 animate-pulse" aria-busy="true">
            <div className="h-8 w-2/3 bg-zinc-200 rounded" />
            <div className="h-4 w-1/3 bg-zinc-200 rounded" />
            <div className="h-64 w-full bg-white border border-zinc-200 rounded-xl mt-8" />
          </div>
        )}

        {!loading && notFound && (
          <div className="max-w-lg mx-auto bg-white border border-zinc-200 rounded-xl p-8 text-center space-y-3">
            <BookOpen className="w-6 h-6 text-zinc-400 mx-auto" aria-hidden="true" />
            <h1 className="font-serif text-xl font-semibold text-zinc-950">
              找不到此分享筆記包
            </h1>
            <p className="text-sm text-zinc-600 leading-relaxed">
              該分享連結可能已失效、輸入網址不完整，或已被原作者撤銷公開分享。
            </p>
          </div>
        )}

        {!loading && bundle && (
          <div className="space-y-10">
            <div className="pb-6 border-b border-zinc-200 space-y-2">
              <p className="text-xs text-zinc-500">
                研究筆記分享集 · 共 <span className="tabular-nums font-mono">{bundle.notes.length}</span> 篇 · 建立於{' '}
                {new Date(bundle.createdAt).toLocaleDateString('zh-TW')}
              </p>
              <h1 className="font-serif text-3xl sm:text-4xl font-semibold text-zinc-950 tracking-tight">
                {bundle.title}
              </h1>
            </div>

            {bundle.notes.length > 1 && (
              <nav aria-label="分享筆記目錄" className="bg-white border border-zinc-200 rounded-xl p-5">
                <h2 className="text-xs font-semibold text-zinc-500 mb-3">目錄索引</h2>
                <ol className="space-y-1.5 text-sm">
                  {bundle.notes.map((n, idx) => (
                    <li key={n.id}>
                      <a
                        href={`#shared-note-${n.id}`}
                        className="text-zinc-800 hover:text-blue-700 underline underline-offset-4 decoration-zinc-300"
                      >
                        <span className="font-mono text-xs text-zinc-500 mr-2 tabular-nums">
                          {String(idx + 1).padStart(2, '0')}.
                        </span>
                        {n.title}
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            )}

            <div className="space-y-12">
              {bundle.notes.map((note) => (
                <article
                  key={note.id}
                  id={`shared-note-${note.id}`}
                  className="bg-white border border-zinc-200 rounded-xl p-6 sm:p-10 space-y-6"
                >
                  <header className="space-y-2 pb-5 border-b border-zinc-100">
                    <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-zinc-950 tracking-tight">
                      {note.title}
                    </h2>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                      <span>更新於 {new Date(note.updatedAt).toLocaleDateString('zh-TW')}</span>
                      {note.tags.length > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{note.tags.join(' / ')}</span>
                        </>
                      )}
                    </div>
                  </header>

                  <MarkdownReader content={note.content} />

                  {note.courseRefs.length > 0 && (
                    <section className="pt-6 border-t border-zinc-200 space-y-3">
                      <h3 className="text-sm font-semibold text-zinc-900">
                        附錄：釘選課程與學術文獻參考
                      </h3>
                      <div className="divide-y divide-zinc-100 border border-zinc-200 rounded-xl">
                        {note.courseRefs.map((ref) => (
                          <div key={ref.id} className="p-4 space-y-1">
                            <div className="flex items-center gap-2 text-xs text-zinc-500">
                              <span className="font-medium text-blue-700">
                                {ref.type === 'COURSE' ? '[開放課程]' : '[學術文獻]'}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span>{ref.provider}</span>
                            </div>
                            <a
                              href={ref.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-900 hover:text-blue-700 underline underline-offset-4"
                            >
                              <span>{ref.title}</span>
                              <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            </a>
                            {ref.summary && (
                              <p className="text-xs text-zinc-600 leading-relaxed">{ref.summary}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                </article>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
