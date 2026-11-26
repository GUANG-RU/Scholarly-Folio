import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  FilePlus2,
  ImagePlus,
  Network,
  Plus,
  RefreshCw,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { mindMapToMarkdown } from '../lib/ai/mindmap.ts';
import { apiGenerateMindMap } from '../lib/client-api.ts';
import {
  renderMindMapSvgToBlob,
  renderMindMapSvgToCompressedDataUrl,
} from '../lib/mindmap-image.ts';
import type { MindMapBranchColor, MindMapNode, MindMapResult } from '../types/workspace.ts';

type MindMapSourceOption = {
  id: 'selection' | 'note' | 'voice';
  label: string;
  text: string;
  title?: string;
};

type MindMapModalProps = {
  isOpen: boolean;
  hasActiveNote: boolean;
  sources: MindMapSourceOption[];
  initialSourceId: 'selection' | 'note' | 'voice';
  onClose: () => void;
  onInsertOutline: (markdown: string) => void;
  onInsertImage?: (imageMarkdown: string, title: string) => void;
  onCreateNoteFromOutline: (title: string, markdown: string) => Promise<void>;
};

const COLOR_STYLES: Record<
  MindMapBranchColor,
  { stroke: string; fill: string; border: string; text: string }
> = {
  blue: { stroke: '#2563eb', fill: '#eff6ff', border: '#93c5fd', text: '#1e3a8a' },
  emerald: { stroke: '#059669', fill: '#ecfdf5', border: '#6ee7b7', text: '#064e3b' },
  amber: { stroke: '#d97706', fill: '#fffbeb', border: '#fcd34d', text: '#78350f' },
  rose: { stroke: '#e11d48', fill: '#fff1f2', border: '#fda4af', text: '#881337' },
  violet: { stroke: '#7c3aed', fill: '#f5f3ff', border: '#c4b5fd', text: '#4c1d95' },
};

function wrapLabelLines(text: string, maxUnits = 22): string[] {
  const clean = text.trim();
  if (!clean) return ['未命名'];
  const lines: string[] = [];
  let current = '';
  let units = 0;

  for (const ch of clean) {
    const charUnits = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? 2 : 1.05;
    if (units + charUnits > maxUnits && current.length > 0) {
      lines.push(current);
      if (lines.length >= 2) {
        lines[1] = lines[1].slice(0, Math.max(1, lines[1].length - 1)) + '…';
        return lines;
      }
      current = ch;
      units = charUnits;
    } else {
      current += ch;
      units += charUnits;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines;
}

type PositionedNode = {
  node: MindMapNode;
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
  lines: string[];
  parent?: PositionedNode;
  collapsed: boolean;
  hiddenDescendantCount: number;
};

function countDescendants(node: MindMapNode): number {
  let count = 0;
  for (const c of node.children) {
    count += 1 + countDescendants(c);
  }
  return count;
}

function layoutMindMap(
  root: MindMapNode,
  collapsedIds: Set<string>,
): { nodes: PositionedNode[]; width: number; height: number } {
  const nodes: PositionedNode[] = [];
  const depthX = [32, 290, 540, 790];
  const nodeWidth = 196;
  const rowGap = 18;
  let cursorY = 36;

  function visit(node: MindMapNode, depth: number, parent?: PositionedNode): PositionedNode {
    const lines = wrapLabelLines(node.label, depth === 0 ? 20 : 22);
    const height = lines.length > 1 ? 56 : 42;
    const isCollapsed = collapsedIds.has(node.id);
    const visibleChildren = isCollapsed ? [] : node.children;

    const item: PositionedNode = {
      node,
      depth,
      x: depthX[Math.min(depth, depthX.length - 1)] ?? 32 + depth * 250,
      y: 0,
      width: depth === 0 ? 208 : nodeWidth,
      height,
      lines,
      parent,
      collapsed: isCollapsed,
      hiddenDescendantCount: isCollapsed ? countDescendants(node) : 0,
    };

    if (visibleChildren.length === 0) {
      item.y = cursorY;
      cursorY += height + rowGap;
    } else {
      const childItems = visibleChildren.map((child) => visit(child, depth + 1, item));
      const firstChild = childItems[0];
      const lastChild = childItems[childItems.length - 1];
      const spanCenter = (firstChild.y + lastChild.y + lastChild.height) / 2;
      item.y = Math.max(36, spanCenter - height / 2);
    }

    nodes.push(item);
    return item;
  }

  visit(root, 0);

  let maxX = 480;
  let maxY = 320;
  for (const item of nodes) {
    maxX = Math.max(maxX, item.x + item.width + 64);
    maxY = Math.max(maxY, item.y + item.height + 44);
  }

  return { nodes, width: maxX, height: maxY };
}

export function MindMapModal({
  isOpen,
  hasActiveNote,
  sources,
  initialSourceId,
  onClose,
  onInsertOutline,
  onInsertImage,
  onCreateNoteFromOutline,
}: MindMapModalProps) {
  const [selectedSourceId, setSelectedSourceId] = useState<'selection' | 'note' | 'voice'>(
    initialSourceId,
  );
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<{
    tone: 'neutral' | 'error';
    text: string;
  } | null>(null);
  const [result, setResult] = useState<MindMapResult | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [selectedNode, setSelectedNode] = useState<MindMapNode | null>(null);
  const [zoom, setZoom] = useState(1);
  const [savingNewNote, setSavingNewNote] = useState(false);
  const [exportBusy, setExportBusy] = useState<'png' | 'jpg' | 'copy' | 'insert' | null>(null);
  const [copiedImage, setCopiedImage] = useState(false);

  const svgRef = useRef<SVGSVGElement | null>(null);

  const activeSource = useMemo(
    () =>
      sources.find((s) => s.id === selectedSourceId) ??
      sources[0] ?? { id: 'note' as const, label: '筆記內容', text: '' },
    [sources, selectedSourceId],
  );

  const runGenerate = async (source: MindMapSourceOption) => {
    const cleanText = source.text
      .replace(/!\[([^\]]*)\]\(data:image\/[^)]+\)/g, '')
      .replace(/data:image\/[a-zA-Z0-9+]+;base64,[A-Za-z0-9+/=]+/g, '')
      .trim();
    if (cleanText.length < 10) {
      setErrorMsg('文字內容少於 10 個字元（不含圖片），請先撰寫或轉錄更多文字內容再生成心智圖。');
      setResult(null);
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setActionNotice(null);
    setCollapsedIds(new Set());
    try {
      const generated = await apiGenerateMindMap({
        title: source.title,
        text: source.text,
        sourceType: source.id,
      });
      setResult(generated);
      setSelectedNode(generated.root);
      setZoom(1);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '心智圖生成失敗');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setSelectedSourceId(initialSourceId);
    setActionNotice(null);
    setCopiedImage(false);
    const chosen = sources.find((s) => s.id === initialSourceId) ?? sources[0];
    if (chosen) {
      void runGenerate(chosen);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialSourceId]);

  const layout = useMemo(() => {
    if (!result) return null;
    return layoutMindMap(result.root, collapsedIds);
  }, [result, collapsedIds]);

  if (!isOpen) {
    return null;
  }

  const toggleCollapse = (nodeId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const handleDownloadRaster = async (format: 'png' | 'jpeg') => {
    if (!svgRef.current || !result || !layout) return;
    setActionNotice(null);
    setExportBusy(format === 'jpeg' ? 'jpg' : 'png');
    try {
      const blob = await renderMindMapSvgToBlob(
        svgRef.current,
        layout.width,
        layout.height,
        format,
        2,
      );
      const url = URL.createObjectURL(blob);
      const ext = format === 'jpeg' ? 'jpg' : 'png';
      const safeName = (result.root.label || 'mindmap').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeName}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setActionNotice({ tone: 'neutral', text: `已下載 ${ext.toUpperCase()} 格式心智圖圖片。` });
    } catch (err) {
      setActionNotice({
        tone: 'error',
        text: err instanceof Error ? err.message : '圖片匯出失敗',
      });
    } finally {
      setExportBusy(null);
    }
  };

  const handleCopyPngToClipboard = async () => {
    if (!svgRef.current || !result || !layout) return;
    setActionNotice(null);
    setExportBusy('copy');
    try {
      const pngBlob = await renderMindMapSvgToBlob(
        svgRef.current,
        layout.width,
        layout.height,
        'png',
        2,
      );
      if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
        throw new Error('此瀏覽器環境不支援剪貼簿圖片寫入，請改用「下載 PNG」或「插入圖片至筆記」。');
      }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
      setCopiedImage(true);
      setActionNotice({
        tone: 'neutral',
        text: '已複製 PNG 圖片到剪貼簿，可直接貼上至筆記、Word 或簡報使用。',
      });
      window.setTimeout(() => setCopiedImage(false), 2500);
    } catch (err) {
      setActionNotice({
        tone: 'error',
        text:
          err instanceof Error
            ? err.message
            : '複製圖片失敗，請改用「下載 PNG」或「插入圖片至筆記」。',
      });
    } finally {
      setExportBusy(null);
    }
  };

  const handleInsertImageIntoNote = async () => {
    if (!svgRef.current || !result || !layout || !onInsertImage) return;
    setActionNotice(null);
    setExportBusy('insert');
    try {
      const dataUrl = await renderMindMapSvgToCompressedDataUrl(
        svgRef.current,
        layout.width,
        layout.height,
      );
      const cleanLabel = result.root.label.replace(/[\r\n[\]]/g, ' ').trim() || '心智圖';
      onInsertImage(`![心智圖：${cleanLabel}](${dataUrl})`, cleanLabel);
      onClose();
    } catch (err) {
      setActionNotice({
        tone: 'error',
        text: err instanceof Error ? err.message : '插入心智圖圖片失敗',
      });
    } finally {
      setExportBusy(null);
    }
  };

  const handleInsertOutline = () => {
    if (!result) return;
    onInsertOutline(mindMapToMarkdown(result.root));
    onClose();
  };

  const handleCreateNewNote = async () => {
    if (!result) return;
    setSavingNewNote(true);
    try {
      await onCreateNoteFromOutline(
        `${result.root.label}（心智圖大綱）`,
        mindMapToMarkdown(result.root),
      );
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '建立心智圖筆記失敗');
    } finally {
      setSavingNewNote(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mindmap-modal-title"
      className="fixed inset-0 z-50 bg-zinc-950/45 flex items-center justify-center p-4"
    >
      <div className="bg-white border border-zinc-200 rounded-xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h2
              id="mindmap-modal-title"
              className="font-serif text-lg font-semibold text-zinc-950 truncate"
            >
              結構化心智圖
            </h2>
            <p className="text-xs text-zinc-500 truncate">
              點擊節點可檢視補充說明、收合或展開分支，也可一鍵轉回可收合筆記大綱
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉心智圖視窗"
            className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-950 hover:bg-zinc-100 shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Source switch & Zoom toolbar */}
        <div className="px-6 py-2.5 border-b border-zinc-200 bg-[#faf9f6] flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {sources.length > 1 && (
              <div
                role="group"
                aria-label="選擇轉換來源"
                className="flex items-center gap-1 p-1 bg-zinc-200/70 rounded-lg"
              >
                {sources.map((src) => (
                  <button
                    key={src.id}
                    type="button"
                    disabled={loading}
                    onClick={() => {
                      setSelectedSourceId(src.id);
                      void runGenerate(src);
                    }}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      activeSource.id === src.id
                        ? 'bg-white text-zinc-950 shadow-xs'
                        : 'text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    {src.label}
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              disabled={loading}
              onClick={() => void runGenerate(activeSource)}
              className="min-h-[34px] px-3 py-1 rounded-lg bg-white border border-zinc-200 hover:bg-zinc-100 disabled:opacity-50 text-xs font-medium text-zinc-800 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>{loading ? '整理結構中...' : '重新整理心智圖'}</span>
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.55, Number((z - 0.15).toFixed(2))))}
              aria-label="縮小"
              className="min-h-[34px] min-w-[34px] rounded-lg bg-white border border-zinc-200 hover:bg-zinc-100 text-zinc-700 inline-flex items-center justify-center cursor-pointer"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="font-mono tabular-nums text-xs text-zinc-600 w-12 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(1.8, Number((z + 0.15).toFixed(2))))}
              aria-label="放大"
              className="min-h-[34px] min-w-[34px] rounded-lg bg-white border border-zinc-200 hover:bg-zinc-100 text-zinc-700 inline-flex items-center justify-center cursor-pointer"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setZoom(1)}
              aria-label="重設縮放"
              className="min-h-[34px] min-w-[34px] rounded-lg bg-white border border-zinc-200 hover:bg-zinc-100 text-zinc-700 inline-flex items-center justify-center cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Main Canvas */}
        <div className="flex-1 overflow-auto bg-[#faf9f6] p-4 min-h-[360px] flex items-center justify-center">
          {loading ? (
            <div className="text-center space-y-3 py-12">
              <Network className="w-8 h-8 text-blue-700 mx-auto" aria-hidden="true" />
              <p className="text-sm font-medium text-zinc-900">
                正在萃取核心脈絡並繪製心智圖...
              </p>
              <p className="text-xs text-zinc-500">來源：{activeSource.label}</p>
            </div>
          ) : errorMsg ? (
            <div className="max-w-md w-full p-5 rounded-xl bg-white border border-red-200 text-xs text-red-900 space-y-3">
              <p className="leading-relaxed">{errorMsg}</p>
              <button
                type="button"
                onClick={() => void runGenerate(activeSource)}
                className="min-h-[36px] px-3.5 py-1.5 rounded-lg bg-blue-700 text-white font-medium cursor-pointer"
              >
                重試生成
              </button>
            </div>
          ) : layout ? (
            <div className="w-full h-full overflow-auto">
              <svg
                ref={svgRef}
                xmlns="http://www.w3.org/2000/svg"
                width={layout.width * zoom}
                height={layout.height * zoom}
                viewBox={`0 0 ${layout.width} ${layout.height}`}
                className="mx-auto bg-white rounded-xl border border-zinc-200"
              >
                {/* Edges */}
                {layout.nodes.map((item) => {
                  if (!item.parent) return null;
                  const p = item.parent;
                  const x1 = p.x + p.width;
                  const y1 = p.y + p.height / 2;
                  const x2 = item.x;
                  const y2 = item.y + item.height / 2;
                  const dx = Math.max(28, (x2 - x1) * 0.5);
                  const style = COLOR_STYLES[item.node.color];
                  return (
                    <path
                      key={`edge-${item.node.id}`}
                      d={`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
                      fill="none"
                      stroke={style.stroke}
                      strokeOpacity={0.55}
                      strokeWidth={item.depth === 1 ? 2.2 : 1.6}
                    />
                  );
                })}

                {/* Nodes */}
                {layout.nodes.map((item) => {
                  const isRoot = item.depth === 0;
                  const isSelected = selectedNode?.id === item.node.id;
                  const style = COLOR_STYLES[item.node.color];
                  const fill = isRoot ? '#1d4ed8' : style.fill;
                  const stroke = isRoot ? '#1e40af' : isSelected ? style.stroke : style.border;
                  const textColor = isRoot ? '#ffffff' : style.text;
                  const hasChildren = item.node.children.length > 0;

                  return (
                    <g
                      key={item.node.id}
                      transform={`translate(${item.x}, ${item.y})`}
                      onClick={() => setSelectedNode(item.node)}
                      style={{ cursor: 'pointer' }}
                    >
                      <rect
                        width={item.width}
                        height={item.height}
                        rx={10}
                        fill={fill}
                        stroke={stroke}
                        strokeWidth={isSelected ? 2.2 : 1.2}
                      />
                      {item.lines.map((lineText, idx) => (
                        <text
                          key={`${item.node.id}-line-${idx}`}
                          x={14}
                          y={item.lines.length === 1 ? 25 : 22 + idx * 17}
                          fill={textColor}
                          fontSize={isRoot ? 13 : 12}
                          fontWeight={isRoot || item.depth === 1 ? 600 : 500}
                          fontFamily="system-ui, -apple-system, sans-serif"
                        >
                          {lineText}
                        </text>
                      ))}

                      {hasChildren && (
                        <g
                          transform={`translate(${item.width - 10}, ${item.height / 2 - 10})`}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleCollapse(item.node.id);
                          }}
                          style={{ cursor: 'pointer' }}
                        >
                          <rect
                            width={22}
                            height={20}
                            rx={6}
                            fill="#ffffff"
                            stroke={style.stroke}
                            strokeWidth={1.2}
                          />
                          <text
                            x={11}
                            y={14}
                            textAnchor="middle"
                            fill={style.text}
                            fontSize={11}
                            fontWeight={600}
                            fontFamily="monospace"
                          >
                            {item.collapsed ? `+${item.hiddenDescendantCount}` : '−'}
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>
          ) : null}
        </div>

        {/* Selected Node Detail Inspector */}
        {selectedNode && result && !loading && !errorMsg && (
          <div className="px-6 py-3 border-t border-zinc-200 bg-white flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="min-w-0 space-y-0.5">
              <p className="font-semibold text-zinc-950 truncate">
                節點：{selectedNode.label}
              </p>
              <p className="text-zinc-600 truncate">
                {selectedNode.detail || '此節點沒有額外附註；點擊右側展開或收合按鈕可切換分支。'}
              </p>
            </div>
            <span className="font-mono tabular-nums text-zinc-500 shrink-0">
              共 {result.nodeCount} 個概念節點
            </span>
          </div>
        )}

        {actionNotice && !loading && !errorMsg && (
          <div
            role="status"
            className={`px-6 py-2 border-t text-xs ${
              actionNotice.tone === 'error'
                ? 'bg-red-50 border-red-200 text-red-900'
                : 'bg-blue-50/70 border-blue-200/70 text-blue-900'
            }`}
          >
            {actionNotice.text}
          </div>
        )}

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-zinc-200 bg-[#faf9f6] flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!result || loading || exportBusy !== null}
              onClick={() => void handleCopyPngToClipboard()}
              className="min-h-[38px] px-3.5 py-2 rounded-lg bg-white border border-zinc-300 hover:bg-zinc-100 disabled:opacity-50 text-zinc-800 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copiedImage ? (
                <Check className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
              ) : (
                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span>{exportBusy === 'copy' ? '複製中...' : copiedImage ? '已複製圖片' : '複製圖片'}</span>
            </button>

            <button
              type="button"
              disabled={!result || loading || exportBusy !== null}
              onClick={() => void handleDownloadRaster('png')}
              className="min-h-[38px] px-3.5 py-2 rounded-lg bg-white border border-zinc-300 hover:bg-zinc-100 disabled:opacity-50 text-zinc-800 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{exportBusy === 'png' ? '匯出中...' : '下載 PNG'}</span>
            </button>

            <button
              type="button"
              disabled={!result || loading || exportBusy !== null}
              onClick={() => void handleDownloadRaster('jpeg')}
              className="min-h-[38px] px-3.5 py-2 rounded-lg bg-white border border-zinc-300 hover:bg-zinc-100 disabled:opacity-50 text-zinc-800 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{exportBusy === 'jpg' ? '匯出中...' : '下載 JPG'}</span>
            </button>

            {onInsertImage && (
              <button
                type="button"
                disabled={!result || loading || !hasActiveNote || exportBusy !== null}
                onClick={() => void handleInsertImageIntoNote()}
                className="min-h-[38px] px-3.5 py-2 rounded-lg bg-white border border-blue-200 hover:bg-blue-50 disabled:opacity-50 text-blue-800 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <ImagePlus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{exportBusy === 'insert' ? '插入中...' : '插入圖片至筆記'}</span>
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!result || loading || savingNewNote}
              onClick={() => void handleCreateNewNote()}
              className="min-h-[38px] px-3.5 py-2 rounded-lg bg-white border border-zinc-300 hover:bg-zinc-100 disabled:opacity-50 text-zinc-800 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FilePlus2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{savingNewNote ? '建立中...' : '轉存為新筆記'}</span>
            </button>

            <button
              type="button"
              disabled={!result || loading || !hasActiveNote}
              onClick={handleInsertOutline}
              className="min-h-[38px] px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>插入大綱至目前筆記</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
