import { useEffect, useState } from 'react';
import {
  Check,
  Cloud,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Folder,
  FolderPlus,
  HardDriveUpload,
  Link2,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import {
  apiCreateDriveFolder,
  apiExportToDrive,
  apiListDriveFolders,
} from '../lib/client-api.ts';
import {
  getMemoryDriveAccessToken,
  requestGoogleDriveAccessToken,
  setMemoryDriveAccessToken,
} from '../lib/firebase.ts';
import type {
  DriveExportFormat,
  DriveFolderItem,
  DriveUploadedFileItem,
  NoteItem,
  ShareBundleItem,
  TopicItem,
} from '../types/workspace.ts';

type PackShareModalProps = {
  isOpen: boolean;
  isAuthenticated: boolean;
  initialTab?: 'drive' | 'share';
  notes: NoteItem[];
  topics: TopicItem[];
  activeNoteId: string | null;
  shareBundles: ShareBundleItem[];
  onClose: () => void;
  onRequestCloudLogin: (reason: string, targetTab: 'drive' | 'share') => void;
  onCreateShareBundle: (title: string, noteIds: string[]) => Promise<ShareBundleItem>;
  onDeleteShareBundle: (bundleId: string) => Promise<void>;
  onDownloadZip: (noteIds: string[]) => Promise<void>;
  onDownloadDocx: (noteId: string) => Promise<void>;
};

const FORMAT_OPTIONS: Array<{
  value: DriveExportFormat;
  label: string;
  desc: string;
}> = [
  { value: 'docx', label: 'Word 文件 (.docx)', desc: '預設推薦 · 完整標題、列表與附錄超連結' },
  { value: 'gdoc', label: 'Google 文件 (Docs)', desc: '上傳後自動轉成原生 Google Docs' },
  { value: 'md', label: 'Markdown (.md)', desc: '保留原始 Markdown 語法' },
  { value: 'txt', label: '純文字 (.txt)', desc: '輕量純文字格式' },
  { value: 'zip', label: '整合壓縮包 (.zip)', desc: '將選取筆記與 references.md 打包' },
];

export function PackShareModal({
  isOpen,
  isAuthenticated,
  initialTab,
  notes,
  topics,
  activeNoteId,
  shareBundles,
  onClose,
  onRequestCloudLogin,
  onCreateShareBundle,
  onDeleteShareBundle,
  onDownloadZip,
  onDownloadDocx,
}: PackShareModalProps) {
  const [activeTab, setActiveTab] = useState<'drive' | 'share'>(
    () => initialTab ?? (isAuthenticated ? 'drive' : 'share'),
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    activeNoteId ? [activeNoteId] : notes.slice(0, 1).map((n) => n.id),
  );
  const [bundleTitle, setBundleTitle] = useState('研究筆記精選分享包');
  const [busyAction, setBusyAction] = useState<'share' | 'zip' | 'docx' | 'drive' | null>(null);
  const [createdSlug, setCreatedSlug] = useState<string | null>(null);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Google Drive state
  const [driveConnected, setDriveConnected] = useState<boolean>(() =>
    Boolean(getMemoryDriveAccessToken()),
  );
  const [driveFoldersReady, setDriveFoldersReady] = useState(false);
  const [foldersAttempted, setFoldersAttempted] = useState(false);
  const [driveErrorCode, setDriveErrorCode] = useState<string | null>(null);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [driveFolders, setDriveFolders] = useState<DriveFolderItem[]>([]);
  const [folderSearch, setFolderSearch] = useState('');
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>(['root']);
  const [driveFormat, setDriveFormat] = useState<DriveExportFormat>('docx');
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [confirmDriveOpen, setConfirmDriveOpen] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<DriveUploadedFileItem[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    const validIds = new Set(notes.map((n) => n.id));
    setSelectedIds((prev) => {
      const kept = prev.filter((id) => validIds.has(id));
      if (kept.length > 0) return kept;
      if (activeNoteId && validIds.has(activeNoteId)) return [activeNoteId];
      return notes.slice(0, 1).map((n) => n.id);
    });
    if (initialTab) {
      setActiveTab(initialTab);
    } else if (!isAuthenticated) {
      setActiveTab('share');
    }
    setDriveConnected(isAuthenticated && Boolean(getMemoryDriveAccessToken()));
    setFoldersAttempted(false);
    setConfirmDriveOpen(false);
    setErrorMsg(null);
    setDriveErrorCode(null);
  }, [isOpen, activeNoteId, notes, isAuthenticated, initialTab]);

  const applyDriveError = (err: unknown, fallbackMessage: string) => {
    const typed = err as Error & { status?: number; code?: string };
    const status = typed.status;
    const code = typed.code ?? null;
    setDriveErrorCode(code);

    if (status === 401 || code === 'DRIVE_SCOPE_MISSING' || code === 'DRIVE_TOKEN_EXPIRED') {
      setMemoryDriveAccessToken(null);
      setDriveConnected(false);
      setDriveFoldersReady(false);
      setConfirmDriveOpen(false);
    } else if (code === 'DRIVE_API_DISABLED') {
      setDriveFoldersReady(false);
      setConfirmDriveOpen(false);
    }

    setErrorMsg(err instanceof Error ? err.message : fallbackMessage);
  };

  const loadDriveFolders = async (query = '') => {
    setFoldersLoading(true);
    setFoldersAttempted(true);
    setErrorMsg(null);
    setDriveErrorCode(null);
    try {
      const folders = await apiListDriveFolders(query);
      setDriveFolders(folders);
      setDriveConnected(true);
      setDriveFoldersReady(true);
    } catch (err) {
      setDriveFoldersReady(false);
      applyDriveError(err, '無法讀取 Google Drive 資料夾');
    } finally {
      setFoldersLoading(false);
    }
  };

  useEffect(() => {
    if (
      isOpen &&
      isAuthenticated &&
      activeTab === 'drive' &&
      getMemoryDriveAccessToken() &&
      !foldersAttempted
    ) {
      void loadDriveFolders();
    }
  }, [isOpen, isAuthenticated, activeTab, foldersAttempted]);

  if (!isOpen) {
    return null;
  }

  const topicMap = new Map(topics.map((t) => [t.id, t.name]));

  const toggleNote = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const toggleFolder = (folderId: string) => {
    setSelectedFolderIds((prev) =>
      prev.includes(folderId) ? prev.filter((id) => id !== folderId) : [...prev, folderId],
    );
  };

  const handleConnectDrive = async () => {
    setFoldersLoading(true);
    setErrorMsg(null);
    setDriveErrorCode(null);
    try {
      await requestGoogleDriveAccessToken();
      setDriveConnected(true);
      await loadDriveFolders(folderSearch);
    } catch (err) {
      setDriveFoldersReady(false);
      setErrorMsg(err instanceof Error ? err.message : 'Google Drive 授權失敗');
    } finally {
      setFoldersLoading(false);
    }
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    setCreatingFolder(true);
    setErrorMsg(null);
    setDriveErrorCode(null);
    try {
      const parentId =
        selectedFolderIds.find((id) => id !== 'root') ?? undefined;
      const created = await apiCreateDriveFolder(trimmed, parentId);
      setDriveFolders((prev) => [created, ...prev]);
      setSelectedFolderIds((prev) =>
        prev.includes(created.id) ? prev : [...prev.filter((id) => id !== 'root'), created.id],
      );
      setNewFolderName('');
    } catch (err) {
      applyDriveError(err, '無法建立資料夾');
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleConfirmDriveExport = async () => {
    setBusyAction('drive');
    setErrorMsg(null);
    setDriveErrorCode(null);
    try {
      const selectedNotes = notes.filter((n) => selectedIds.includes(n.id));
      const uploaded = await apiExportToDrive({
        notes: selectedNotes,
        folderIds: selectedFolderIds,
        format: driveFormat,
      });
      setUploadedFiles(uploaded);
      setConfirmDriveOpen(false);
    } catch (err) {
      setConfirmDriveOpen(false);
      applyDriveError(err, '匯出至 Google Drive 失敗');
    } finally {
      setBusyAction(null);
    }
  };

  const handleCreateLink = async () => {
    if (!isAuthenticated) {
      onRequestCloudLogin(
        '產生跨裝置唯讀分享連結需先登入 Google 帳號，登入後系統將自動同步您的筆記並建立公開連結。',
        'share',
      );
      return;
    }
    if (selectedIds.length === 0) {
      setErrorMsg('請至少勾選一篇筆記。');
      return;
    }
    setBusyAction('share');
    setErrorMsg(null);
    try {
      const bundle = await onCreateShareBundle(bundleTitle, selectedIds);
      setCreatedSlug(bundle.slug);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '建立分享連結失敗');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDownloadZip = async () => {
    if (selectedIds.length === 0) {
      setErrorMsg('請至少勾選一篇筆記。');
      return;
    }
    setBusyAction('zip');
    setErrorMsg(null);
    try {
      await onDownloadZip(selectedIds);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'ZIP 壓縮下載失敗');
    } finally {
      setBusyAction(null);
    }
  };

  const handleLocalDocxDownload = async () => {
    if (selectedIds.length === 0) {
      setErrorMsg('請先勾選一篇筆記以匯出 Word 檔。');
      return;
    }
    setBusyAction('docx');
    setErrorMsg(null);
    try {
      await onDownloadDocx(selectedIds[0]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Word 檔下載失敗');
    } finally {
      setBusyAction(null);
    }
  };

  const copyShareUrl = async (slug: string) => {
    const url = `${window.location.origin}/share/${slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedSlug(slug);
      setTimeout(() => setCopiedSlug(null), 2000);
    } catch {
      setErrorMsg(`請手動複製連結：${url}`);
    }
  };

  const folderNameMap = new Map<string, string>([
    ['root', '我的雲端硬碟（根目錄）'],
    ...driveFolders.map((f) => [f.id, f.name] as [string, string]),
  ]);

  const selectedFolderLabels = selectedFolderIds.map(
    (id) => folderNameMap.get(id) ?? id,
  );
  const selectedFormatLabel =
    FORMAT_OPTIONS.find((f) => f.value === driveFormat)?.label ?? driveFormat;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pack-share-title"
      className="fixed inset-0 z-50 bg-zinc-950/40 flex items-center justify-center p-4"
    >
      <div className="bg-white border border-zinc-200 rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between gap-4">
          <div>
            <h2 id="pack-share-title" className="font-serif text-lg font-semibold text-zinc-950">
              匯出、Google Drive 與唯讀分享
            </h2>
            <p className="text-xs text-zinc-500">
              可將筆記存成 Word (.docx) 至指定 Google Drive 資料夾，或產生唯讀分享連結與離線包。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉視窗"
            className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-950 hover:bg-zinc-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 pt-3 border-b border-zinc-200 bg-[#faf9f6] flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setActiveTab('drive');
              setErrorMsg(null);
            }}
            className={`px-4 py-2 text-xs font-medium rounded-t-lg border border-b-0 transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'drive'
                ? 'bg-white text-zinc-950 border-zinc-200'
                : 'bg-transparent text-zinc-600 border-transparent hover:text-zinc-900'
            }`}
          >
            儲存至 Google Drive
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('share');
              setErrorMsg(null);
            }}
            className={`px-4 py-2 text-xs font-medium rounded-t-lg border border-b-0 transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'share'
                ? 'bg-white text-zinc-950 border-zinc-200'
                : 'bg-transparent text-zinc-600 border-transparent hover:text-zinc-900'
            }`}
          >
            唯讀分享連結與本機下載
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {errorMsg && (
            <div
              role="alert"
              className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-900 space-y-2"
            >
              <p className="leading-relaxed">{errorMsg}</p>
              {driveErrorCode === 'DRIVE_API_DISABLED' && (
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <a
                    href="https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=1064014208988"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-blue-700 hover:underline"
                  >
                    <span>前往 Google Cloud Console 啟用 Google Drive API</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  <button
                    type="button"
                    disabled={foldersLoading}
                    onClick={() => void loadDriveFolders(folderSearch)}
                    className="px-2.5 py-1 rounded bg-white border border-red-200 text-red-900 hover:bg-red-100 cursor-pointer"
                  >
                    重試讀取
                  </button>
                </div>
              )}
              {(driveErrorCode === 'DRIVE_SCOPE_MISSING' ||
                driveErrorCode === 'DRIVE_TOKEN_EXPIRED') && (
                <div>
                  <button
                    type="button"
                    disabled={foldersLoading}
                    onClick={() => void handleConnectDrive()}
                    className="px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white font-medium cursor-pointer"
                  >
                    重新授權 Google Drive 權限
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Shared Note Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-zinc-600">
              <span className="font-medium text-zinc-800">
                1. 選取筆記（已選 <span className="tabular-nums font-mono">{selectedIds.length}</span> / {notes.length} 篇）
              </span>
              <button
                type="button"
                onClick={() =>
                  setSelectedIds(
                    selectedIds.length === notes.length ? [] : notes.map((n) => n.id),
                  )
                }
                className="text-blue-700 hover:underline cursor-pointer"
              >
                {selectedIds.length === notes.length ? '全部取消' : '全選'}
              </button>
            </div>

            <div className="border border-zinc-200 rounded-xl divide-y divide-zinc-200 max-h-40 overflow-y-auto">
              {notes.map((note) => {
                const checked = selectedIds.includes(note.id);
                return (
                  <label
                    key={note.id}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleNote(note.id)}
                      className="w-4 h-4 rounded border-zinc-300 text-blue-700"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-zinc-900 truncate">
                        {note.title || '未命名研究筆記'}
                      </p>
                      <p className="text-xs text-zinc-500 truncate">
                        {topicMap.get(note.topicId) ?? 'Inbox'} ·{' '}
                        {note.status === 'ARCHIVED'
                          ? '已歸檔'
                          : isAuthenticated
                            ? '雲端草稿'
                            : '本機草稿'}{' '}
                        · <span className="tabular-nums">{note.courseRefs.length}</span> 筆參考資料
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {activeTab === 'drive' ? (
            <div className="space-y-5">
              {/* Format Selector */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-zinc-800">2. 選擇存放檔案格式</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {FORMAT_OPTIONS.map((opt) => {
                    const active = driveFormat === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setDriveFormat(opt.value)}
                        className={`p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                          active
                            ? 'border-blue-700 bg-blue-50/50 text-zinc-950'
                            : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'
                        }`}
                      >
                        <p className="text-xs font-semibold">{opt.label}</p>
                        <p className="text-[11px] text-zinc-500 mt-0.5">{opt.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Google Drive Folder Multi-Picker */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-zinc-800">
                    3. 選擇 Google Drive 目標資料夾（可複選，已選{' '}
                    <span className="tabular-nums font-mono">{selectedFolderIds.length}</span> 個）
                  </p>
                  {driveConnected && (
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        disabled={foldersLoading}
                        onClick={() => void handleConnectDrive()}
                        className="text-xs text-zinc-600 hover:text-zinc-900 hover:underline cursor-pointer whitespace-nowrap"
                      >
                        重新授權
                      </button>
                      <button
                        type="button"
                        disabled={foldersLoading}
                        onClick={() => void loadDriveFolders(folderSearch)}
                        className="text-xs text-blue-700 hover:underline inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                      >
                        <RefreshCw className={`w-3 h-3 ${foldersLoading ? 'animate-spin' : ''}`} />
                        <span>重新整理</span>
                      </button>
                    </div>
                  )}
                </div>

                {!isAuthenticated ? (
                  <div className="p-5 rounded-xl border border-zinc-200 bg-[#faf9f6] space-y-3">
                    <p className="text-xs text-zinc-600 leading-relaxed">
                      儲存至 Google Drive 需先登入您的 Google 帳號。登入後系統將自動同步您目前的本機筆記，並讀取您的雲端硬碟資料夾供選擇。
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        onRequestCloudLogin(
                          '匯出筆記至 Google Drive 需先登入 Google 帳號，系統將自動同步您的筆記並連結雲端硬碟。',
                          'drive',
                        )
                      }
                      className="min-h-[40px] px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-medium inline-flex items-center gap-2 cursor-pointer"
                    >
                      <Cloud className="w-4 h-4" aria-hidden="true" />
                      <span>登入 Google 帳號以連結雲端硬碟</span>
                    </button>
                  </div>
                ) : !driveConnected ? (
                  <div className="p-5 rounded-xl border border-zinc-200 bg-[#faf9f6] space-y-3">
                    <p className="text-xs text-zinc-600 leading-relaxed">
                      請授權連結您的 Google Drive（需勾選「查看、編輯、建立及刪除您 Google 雲端硬碟中的所有檔案」），以讀取資料夾清單並匯出研究筆記。
                    </p>
                    <button
                      type="button"
                      disabled={foldersLoading}
                      onClick={() => void handleConnectDrive()}
                      className="min-h-[40px] px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-xs font-medium inline-flex items-center gap-2 cursor-pointer"
                    >
                      <HardDriveUpload className="w-4 h-4" />
                      <span>{foldersLoading ? '正在連結 Google Drive...' : '連結並授權 Google Drive'}</span>
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void loadDriveFolders(folderSearch);
                      }}
                      className="flex gap-2"
                    >
                      <input
                        type="search"
                        value={folderSearch}
                        onChange={(e) => setFolderSearch(e.target.value)}
                        placeholder="搜尋 Google Drive 資料夾名稱..."
                        className="flex-1 min-w-0 min-h-[36px] px-3 py-1.5 text-xs border border-zinc-200 rounded-lg"
                      />
                      <button
                        type="submit"
                        disabled={foldersLoading}
                        className="px-3 min-h-[36px] rounded-lg border border-zinc-200 text-xs font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer whitespace-nowrap"
                      >
                        搜尋
                      </button>
                    </form>

                    <div className="border border-zinc-200 rounded-xl divide-y divide-zinc-200 max-h-44 overflow-y-auto">
                      <label className="flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedFolderIds.includes('root')}
                          onChange={() => toggleFolder('root')}
                          className="w-4 h-4 rounded border-zinc-300 text-blue-700"
                        />
                        <Folder className="w-4 h-4 text-zinc-500 shrink-0" />
                        <span className="text-xs font-medium text-zinc-900">
                          我的雲端硬碟（根目錄）
                        </span>
                      </label>

                      {driveFolders.map((folder) => {
                        const checked = selectedFolderIds.includes(folder.id);
                        return (
                          <label
                            key={folder.id}
                            className="flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-50 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleFolder(folder.id)}
                              className="w-4 h-4 rounded border-zinc-300 text-blue-700"
                            />
                            <Folder className="w-4 h-4 text-blue-700 shrink-0" />
                            <span className="text-xs text-zinc-900 truncate flex-1">
                              {folder.name}
                            </span>
                          </label>
                        );
                      })}
                    </div>

                    <form onSubmit={(e) => void handleCreateFolder(e)} className="flex gap-2">
                      <input
                        type="text"
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        placeholder="或輸入名稱在 Drive 建立新資料夾..."
                        className="flex-1 min-w-0 min-h-[36px] px-3 py-1.5 text-xs border border-zinc-200 rounded-lg"
                      />
                      <button
                        type="submit"
                        disabled={creatingFolder || !newFolderName.trim()}
                        className="px-3 min-h-[36px] rounded-lg border border-zinc-200 text-xs font-medium text-zinc-800 hover:bg-zinc-100 disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                      >
                        <FolderPlus className="w-3.5 h-3.5" />
                        <span>{creatingFolder ? '建立中...' : '建立資料夾'}</span>
                      </button>
                    </form>
                  </div>
                )}
              </div>

              {/* Explicit Confirmation Before Uploading to Drive */}
              {confirmDriveOpen && (
                <div className="p-4 rounded-xl border border-blue-200 bg-blue-50/70 space-y-3">
                  <p className="text-xs font-semibold text-blue-950">
                    請確認即將寫入您的 Google Drive：
                  </p>
                  <p className="text-xs text-blue-900 leading-relaxed">
                    將 <span className="font-mono font-semibold">{selectedIds.length}</span> 篇研究筆記，以{' '}
                    <span className="font-semibold">{selectedFormatLabel}</span> 格式儲存至資料夾：{' '}
                    <span className="font-semibold">{selectedFolderLabels.join('、')}</span>
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={busyAction === 'drive'}
                      onClick={() => void handleConfirmDriveExport()}
                      className="min-h-[36px] px-4 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-xs font-medium cursor-pointer"
                    >
                      {busyAction === 'drive' ? '正在上傳儲存...' : '確認上傳儲存'}
                    </button>
                    <button
                      type="button"
                      disabled={busyAction === 'drive'}
                      onClick={() => setConfirmDriveOpen(false)}
                      className="min-h-[36px] px-3 py-1.5 rounded-lg text-xs text-zinc-700 hover:bg-white cursor-pointer"
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}

              {/* Uploaded Result Links */}
              {uploadedFiles.length > 0 && (
                <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/60 space-y-2">
                  <p className="text-xs font-semibold text-emerald-950">
                    已成功儲存 {uploadedFiles.length} 個檔案至 Google Drive
                  </p>
                  <ul className="space-y-1.5">
                    {uploadedFiles.map((file) => (
                      <li
                        key={`${file.folderId}-${file.id}`}
                        className="flex items-center justify-between gap-3 text-xs text-emerald-900"
                      >
                        <span className="truncate">
                          {file.name}（{folderNameMap.get(file.folderId) ?? 'Drive'}）
                        </span>
                        {file.webViewLink && (
                          <a
                            href={file.webViewLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-blue-700 hover:underline whitespace-nowrap shrink-0"
                          >
                            <span>開啟</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              {createdSlug && (
                <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-200 space-y-2">
                  <p className="text-xs font-semibold text-blue-900">
                    已產生免登入唯讀分享連結
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="flex-1 min-w-0 truncate font-mono text-xs bg-white px-3 py-2 rounded-lg border border-blue-200 text-zinc-800">
                      {`${window.location.origin}/share/${createdSlug}`}
                    </code>
                    <button
                      type="button"
                      onClick={() => void copyShareUrl(createdSlug)}
                      className="min-h-[36px] px-3 py-1.5 rounded-lg bg-white border border-blue-200 text-xs font-medium text-blue-900 hover:bg-blue-100 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {copiedSlug === createdSlug ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedSlug === createdSlug ? '已複製' : '複製連結'}</span>
                    </button>
                    <a
                      href={`/share/${createdSlug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-[36px] px-3 py-1.5 rounded-lg bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                    >
                      <span>開啟預覽</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <label htmlFor="bundle-title-input" className="block text-xs font-medium text-zinc-700">
                  唯讀分享包標題
                </label>
                <input
                  id="bundle-title-input"
                  type="text"
                  value={bundleTitle}
                  onChange={(e) => setBundleTitle(e.target.value)}
                  className="w-full min-h-[40px] px-3 py-2 text-sm border border-zinc-200 rounded-lg text-zinc-900"
                />
              </div>

              {shareBundles.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-zinc-200">
                  <h3 className="text-xs font-semibold text-zinc-700">現有公開唯讀分享連結</h3>
                  <div className="divide-y divide-zinc-200 border border-zinc-200 rounded-xl">
                    {shareBundles.map((bundle) => (
                      <div
                        key={bundle.id}
                        className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="font-medium text-zinc-900 truncate">{bundle.title}</p>
                          <p className="font-mono text-zinc-500 truncate">/share/{bundle.slug}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => void copyShareUrl(bundle.slug)}
                            className="px-2.5 py-1.5 rounded-lg border border-zinc-200 hover:bg-zinc-100 text-zinc-700 whitespace-nowrap cursor-pointer"
                          >
                            {copiedSlug === bundle.slug ? '已複製' : '複製'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void onDeleteShareBundle(bundle.id)}
                            aria-label={`撤銷分享 ${bundle.title}`}
                            className="p-1.5 rounded-lg text-zinc-500 hover:text-red-700 hover:bg-red-50 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-zinc-200 bg-[#faf9f6] flex flex-wrap items-center justify-end gap-3">
          {activeTab === 'drive' ? (
            !isAuthenticated ? (
              <button
                type="button"
                onClick={() =>
                  onRequestCloudLogin(
                    '匯出筆記至 Google Drive 需先登入 Google 帳號，系統將自動同步您的筆記並連結雲端硬碟。',
                    'drive',
                  )
                }
                className="min-h-[40px] px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-medium inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Cloud className="w-4 h-4" aria-hidden="true" />
                <span>登入並匯出至 Google Drive</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={
                  !driveConnected ||
                  !driveFoldersReady ||
                  foldersLoading ||
                  busyAction !== null ||
                  selectedIds.length === 0 ||
                  selectedFolderIds.length === 0
                }
                onClick={() => setConfirmDriveOpen(true)}
                className="min-h-[40px] px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-xs font-medium inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <HardDriveUpload className="w-4 h-4" aria-hidden="true" />
                <span>匯出至選定資料夾</span>
              </button>
            )
          ) : (
            <>
              <button
                type="button"
                disabled={busyAction !== null || selectedIds.length === 0}
                onClick={() => void handleLocalDocxDownload()}
                className="min-h-[40px] px-4 py-2 rounded-lg bg-white border border-zinc-300 text-zinc-800 hover:bg-zinc-100 disabled:opacity-50 text-xs font-medium inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FileText className="w-4 h-4" aria-hidden="true" />
                <span>{busyAction === 'docx' ? '產生 Word 中...' : '下載 Word (.docx)'}</span>
              </button>
              <button
                type="button"
                disabled={busyAction !== null || selectedIds.length === 0}
                onClick={() => void handleDownloadZip()}
                className="min-h-[40px] px-4 py-2 rounded-lg bg-white border border-zinc-300 text-zinc-800 hover:bg-zinc-100 disabled:opacity-50 text-xs font-medium inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="w-4 h-4" aria-hidden="true" />
                <span>{busyAction === 'zip' ? '正在打包...' : '下載 .zip 離線包'}</span>
              </button>
              <button
                type="button"
                disabled={busyAction !== null || selectedIds.length === 0}
                onClick={() => void handleCreateLink()}
                className="min-h-[40px] px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-xs font-medium inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Link2 className="w-4 h-4" aria-hidden="true" />
                <span>{busyAction === 'share' ? '產生連結中...' : '產生唯讀分享連結'}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
