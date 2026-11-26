import { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Cloud,
  ExternalLink,
  FilePlus2,
  FileText,
  FileUp,
  HardDrive,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import {
  apiImportDriveFile,
  apiListDriveFiles,
  apiParseLocalNoteFile,
} from '../lib/client-api.ts';
import {
  getMemoryDriveAccessToken,
  requestGoogleDriveAccessToken,
  setMemoryDriveAccessToken,
} from '../lib/firebase.ts';
import type {
  DriveReadableFileItem,
  ImportedDocumentPreview,
} from '../types/workspace.ts';

export type ImportUseMode = 'new_note' | 'insert_current' | 'reference';

type ImportNoteModalProps = {
  isOpen: boolean;
  isAuthenticated: boolean;
  hasActiveNote: boolean;
  initialTab?: 'local' | 'drive';
  onClose: () => void;
  onRequestCloudLogin: (reason: string) => void;
  onApplyImport: (doc: ImportedDocumentPreview, mode: ImportUseMode) => Promise<void>;
};

const MAX_LOCAL_BYTES = 10 * 1024 * 1024;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function describeDriveMimeType(file: DriveReadableFileItem): string {
  if (file.mimeType === 'application/vnd.google-apps.document') {
    return 'Google 文件';
  }
  if (
    file.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    file.name.toLowerCase().endsWith('.docx')
  ) {
    return 'Word (.docx)';
  }
  if (file.name.toLowerCase().endsWith('.md') || file.name.toLowerCase().endsWith('.markdown')) {
    return 'Markdown (.md)';
  }
  if (file.name.toLowerCase().endsWith('.html') || file.name.toLowerCase().endsWith('.htm')) {
    return '網頁 (.html)';
  }
  return '純文字 (.txt)';
}

export function ImportNoteModal({
  isOpen,
  isAuthenticated,
  hasActiveNote,
  initialTab,
  onClose,
  onRequestCloudLogin,
  onApplyImport,
}: ImportNoteModalProps) {
  const [activeTab, setActiveTab] = useState<'local' | 'drive'>(() => initialTab ?? 'local');
  const [isDragging, setIsDragging] = useState(false);
  const [parsingLocal, setParsingLocal] = useState(false);

  // Google Drive listing state
  const [driveConnected, setDriveConnected] = useState<boolean>(() =>
    Boolean(getMemoryDriveAccessToken()),
  );
  const [filesAttempted, setFilesAttempted] = useState(false);
  const [filesLoading, setFilesLoading] = useState(false);
  const [importingFileId, setImportingFileId] = useState<string | null>(null);
  const [driveFiles, setDriveFiles] = useState<DriveReadableFileItem[]>([]);
  const [fileSearch, setFileSearch] = useState('');
  const [driveErrorCode, setDriveErrorCode] = useState<string | null>(null);

  // Parsed preview & action state
  const [preview, setPreview] = useState<ImportedDocumentPreview | null>(null);
  const [editableTitle, setEditableTitle] = useState('');
  const [applyingMode, setApplyingMode] = useState<ImportUseMode | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    if (initialTab) {
      setActiveTab(initialTab);
    }
    setDriveConnected(isAuthenticated && Boolean(getMemoryDriveAccessToken()));
    setFilesAttempted(false);
    setErrorMsg(null);
    setDriveErrorCode(null);
    setPreview(null);
    setEditableTitle('');
    setApplyingMode(null);
    setImportingFileId(null);
    setParsingLocal(false);
  }, [isOpen, initialTab, isAuthenticated]);

  const applyDriveError = (err: unknown, fallbackMessage: string) => {
    const typed = err as Error & { status?: number; code?: string };
    const status = typed.status;
    const code = typed.code ?? null;
    setDriveErrorCode(code);

    if (status === 401 || code === 'DRIVE_SCOPE_MISSING' || code === 'DRIVE_TOKEN_EXPIRED') {
      setMemoryDriveAccessToken(null);
      setDriveConnected(false);
    }

    setErrorMsg(err instanceof Error ? err.message : fallbackMessage);
  };

  const loadDriveFiles = async (query = '') => {
    setFilesLoading(true);
    setFilesAttempted(true);
    setErrorMsg(null);
    setDriveErrorCode(null);
    try {
      const files = await apiListDriveFiles(query);
      setDriveFiles(files);
      setDriveConnected(true);
    } catch (err) {
      applyDriveError(err, '無法讀取 Google Drive 筆記檔案');
    } finally {
      setFilesLoading(false);
    }
  };

  useEffect(() => {
    if (
      isOpen &&
      isAuthenticated &&
      activeTab === 'drive' &&
      getMemoryDriveAccessToken() &&
      !filesAttempted
    ) {
      void loadDriveFiles();
    }
  }, [isOpen, isAuthenticated, activeTab, filesAttempted]);

  if (!isOpen) {
    return null;
  }

  const handleLocalFile = async (file: File) => {
    setErrorMsg(null);
    setDriveErrorCode(null);
    if (file.size === 0) {
      setErrorMsg('選取的檔案為空，請選擇有內容的筆記檔案。');
      return;
    }
    if (file.size > MAX_LOCAL_BYTES) {
      setErrorMsg('檔案大小超過 10 MB 上限，請縮減後再匯入。');
      return;
    }

    setParsingLocal(true);
    try {
      const buffer = await file.arrayBuffer();
      const base64 = arrayBufferToBase64(buffer);
      const parsed = await apiParseLocalNoteFile({
        filename: file.name,
        mimeType: file.type,
        base64,
      });
      setPreview({
        ...parsed,
        sourceKind: 'local',
        sourceName: file.name,
      });
      setEditableTitle(parsed.title);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '解析本地檔案失敗');
    } finally {
      setParsingLocal(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleConnectDrive = async () => {
    setFilesLoading(true);
    setErrorMsg(null);
    setDriveErrorCode(null);
    try {
      await requestGoogleDriveAccessToken();
      setDriveConnected(true);
      await loadDriveFiles(fileSearch);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Google Drive 授權失敗');
    } finally {
      setFilesLoading(false);
    }
  };

  const handleSelectDriveFile = async (file: DriveReadableFileItem) => {
    setImportingFileId(file.id);
    setErrorMsg(null);
    setDriveErrorCode(null);
    try {
      const imported = await apiImportDriveFile(file.id);
      setPreview({
        title: imported.title,
        content: imported.content,
        truncated: imported.truncated,
        charCount: imported.charCount,
        formatLabel: imported.formatLabel,
        sourceKind: 'drive',
        sourceName: imported.sourceName,
        webViewLink: imported.webViewLink,
      });
      setEditableTitle(imported.title);
    } catch (err) {
      applyDriveError(err, '讀取 Google Drive 檔案失敗');
    } finally {
      setImportingFileId(null);
    }
  };

  const handleExecuteMode = async (mode: ImportUseMode) => {
    if (!preview) return;
    setApplyingMode(mode);
    setErrorMsg(null);
    try {
      const finalTitle = editableTitle.trim().slice(0, 200) || preview.title;
      await onApplyImport({ ...preview, title: finalTitle }, mode);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '匯入筆記失敗');
    } finally {
      setApplyingMode(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-note-modal-title"
      className="fixed inset-0 z-50 bg-zinc-950/40 flex items-center justify-center p-4"
    >
      <div className="bg-white border border-zinc-200 rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h2
              id="import-note-modal-title"
              className="font-serif text-lg font-semibold text-zinc-950 truncate"
            >
              匯入筆記檔案進行撰寫或參考
            </h2>
            <p className="text-xs text-zinc-500 truncate">
              支援本地或 Google Drive 檔案（Google 文件、Word .docx、Markdown、純文字、網頁）
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉匯入視窗"
            className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-950 hover:bg-zinc-100 shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Source tabs */}
        <div className="px-6 pt-3 border-b border-zinc-200 bg-[#faf9f6] flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setActiveTab('local');
              setErrorMsg(null);
              setDriveErrorCode(null);
            }}
            className={`px-4 py-2 text-xs font-medium rounded-t-lg border border-b-0 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              activeTab === 'local'
                ? 'bg-white text-zinc-950 border-zinc-200'
                : 'bg-transparent text-zinc-600 border-transparent hover:text-zinc-900'
            }`}
          >
            本地電腦檔案
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('drive');
              setErrorMsg(null);
              setDriveErrorCode(null);
            }}
            className={`px-4 py-2 text-xs font-medium rounded-t-lg border border-b-0 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              activeTab === 'drive'
                ? 'bg-white text-zinc-950 border-zinc-200'
                : 'bg-transparent text-zinc-600 border-transparent hover:text-zinc-900'
            }`}
          >
            從 Google Drive 匯入
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {errorMsg && (
            <div
              role="alert"
              className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-900 space-y-2"
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
                    disabled={filesLoading}
                    onClick={() => void loadDriveFiles(fileSearch)}
                    className="px-2.5 py-1 rounded bg-white border border-red-200 text-red-900 hover:bg-red-100 cursor-pointer whitespace-nowrap shrink-0"
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
                    disabled={filesLoading}
                    onClick={() => void handleConnectDrive()}
                    className="px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white font-medium cursor-pointer whitespace-nowrap shrink-0"
                  >
                    重新授權 Google Drive 權限
                  </button>
                </div>
              )}
            </div>
          )}

          {!preview ? (
            activeTab === 'local' ? (
              <div className="space-y-4">
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    const file = e.dataTransfer.files?.[0];
                    if (file) {
                      void handleLocalFile(file);
                    }
                  }}
                  className={`border border-dashed rounded-xl p-8 text-center space-y-3 transition-colors ${
                    isDragging
                      ? 'border-blue-700 bg-blue-50/50'
                      : 'border-zinc-300 bg-[#faf9f6]'
                  }`}
                >
                  <FileUp className="w-8 h-8 text-zinc-400 mx-auto" aria-hidden="true" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-zinc-900">
                      拖放筆記檔案至此，或點擊選取檔案
                    </p>
                    <p className="text-xs text-zinc-500">
                      支援 .docx · .md · .markdown · .txt · .html（檔案上限 10 MB）
                    </p>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".md,.markdown,.txt,.docx,.html,.htm,text/markdown,text/plain,text/html,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        void handleLocalFile(file);
                      }
                    }}
                    className="hidden"
                  />
                  <button
                    type="button"
                    disabled={parsingLocal}
                    onClick={() => fileInputRef.current?.click()}
                    className="min-h-[40px] px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-xs font-medium inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <FileUp className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{parsingLocal ? '正在解析檔案...' : '選擇本機檔案'}</span>
                  </button>
                </div>
              </div>
            ) : !isAuthenticated ? (
              <div className="p-5 rounded-xl border border-zinc-200 bg-[#faf9f6] space-y-3">
                <p className="text-xs text-zinc-600 leading-relaxed">
                  瀏覽與匯入 Google Drive 中的文件需先登入您的 Google 帳號。登入後系統也會自動同步您目前的本機筆記。
                </p>
                <button
                  type="button"
                  onClick={() =>
                    onRequestCloudLogin(
                      '從 Google Drive 讀取筆記檔案需先登入 Google 帳號，系統將自動同步您目前的筆記並連結雲端硬碟。',
                    )
                  }
                  className="min-h-[40px] px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-medium inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Cloud className="w-4 h-4" aria-hidden="true" />
                  <span>登入 Google 帳號以讀取雲端硬碟</span>
                </button>
              </div>
            ) : !driveConnected ? (
              <div className="p-5 rounded-xl border border-zinc-200 bg-[#faf9f6] space-y-3">
                <p className="text-xs text-zinc-600 leading-relaxed">
                  請授權連結您的 Google Drive（勾選雲端硬碟存取權限），即可瀏覽您的 Google 文件、Word (.docx) 與 Markdown 筆記。
                </p>
                <button
                  type="button"
                  disabled={filesLoading}
                  onClick={() => void handleConnectDrive()}
                  className="min-h-[40px] px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-xs font-medium inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <HardDrive className="w-4 h-4" aria-hidden="true" />
                  <span>{filesLoading ? '正在連結 Google Drive...' : '連結並授權 Google Drive'}</span>
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void loadDriveFiles(fileSearch);
                    }}
                    className="flex-1 flex gap-2"
                  >
                    <div className="relative flex-1 min-w-0">
                      <Search
                        className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                        aria-hidden="true"
                      />
                      <input
                        type="search"
                        value={fileSearch}
                        onChange={(e) => setFileSearch(e.target.value)}
                        placeholder="搜尋 Google Drive 檔名..."
                        className="w-full min-h-[38px] pl-8 pr-3 py-1.5 text-xs border border-zinc-200 rounded-lg text-zinc-900 placeholder:text-zinc-400"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={filesLoading}
                      className="min-h-[38px] px-3 py-1.5 rounded-lg border border-zinc-200 text-xs font-medium text-zinc-700 hover:bg-zinc-50 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      搜尋
                    </button>
                  </form>
                  <button
                    type="button"
                    disabled={filesLoading}
                    onClick={() => void loadDriveFiles(fileSearch)}
                    aria-label="重新整理 Google Drive 檔案列表"
                    className="min-h-[38px] px-3 py-1.5 rounded-lg border border-zinc-200 text-xs text-blue-700 hover:bg-zinc-50 inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${filesLoading ? 'animate-spin' : ''}`} />
                    <span>重新整理</span>
                  </button>
                </div>

                {filesLoading && driveFiles.length === 0 ? (
                  <div className="py-10 text-center text-xs text-zinc-500">
                    正在讀取您的 Google Drive 文件清單...
                  </div>
                ) : driveFiles.length === 0 ? (
                  <div className="p-6 rounded-xl border border-zinc-200 bg-[#faf9f6] text-center text-xs text-zinc-600">
                    找不到可匯入的筆記檔案（支援 Google 文件、.docx、.md、.txt、.html）。
                  </div>
                ) : (
                  <div className="border border-zinc-200 rounded-xl divide-y divide-zinc-200 max-h-72 overflow-y-auto">
                    {driveFiles.map((file) => {
                      const isImporting = importingFileId === file.id;
                      const modifiedStr = file.modifiedTime
                        ? new Date(file.modifiedTime).toLocaleDateString('zh-TW')
                        : null;
                      return (
                        <div
                          key={file.id}
                          className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-zinc-50"
                        >
                          <div className="min-w-0 flex items-center gap-3">
                            <FileText className="w-4 h-4 text-zinc-500 shrink-0" aria-hidden="true" />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-zinc-900 truncate">
                                {file.name}
                              </p>
                              <p className="text-xs text-zinc-500 truncate">
                                {describeDriveMimeType(file)}
                                {modifiedStr ? ` · ${modifiedStr}` : ''}
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={importingFileId !== null}
                            onClick={() => void handleSelectDriveFile(file)}
                            className="min-h-[36px] px-3 py-1.5 rounded-lg bg-white border border-zinc-300 hover:bg-zinc-100 disabled:opacity-50 text-xs font-medium text-zinc-800 whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            {isImporting ? '讀取中...' : '選取讀取'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-zinc-500 truncate">
                  {preview.sourceKind === 'drive' ? 'Google Drive' : '本地檔案'} ·{' '}
                  {preview.formatLabel} ·{' '}
                  <span className="font-mono tabular-nums">{preview.charCount}</span> 字元
                </p>
                <button
                  type="button"
                  disabled={applyingMode !== null}
                  onClick={() => {
                    setPreview(null);
                    setErrorMsg(null);
                  }}
                  className="text-xs text-blue-700 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                >
                  重新選擇檔案
                </button>
              </div>

              {preview.truncated && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 leading-relaxed">
                  此文件字數超過單篇筆記上限（100,000 字元），系統已自動擷取前 100,000 字元供匯入。
                </div>
              )}

              <div className="space-y-1.5">
                <label
                  htmlFor="imported-note-title-input"
                  className="block text-xs font-medium text-zinc-700"
                >
                  筆記 / 參考標題
                </label>
                <input
                  id="imported-note-title-input"
                  type="text"
                  maxLength={200}
                  value={editableTitle}
                  onChange={(e) => setEditableTitle(e.target.value)}
                  className="w-full min-h-[40px] px-3 py-2 text-sm border border-zinc-200 rounded-lg text-zinc-950 font-medium"
                />
              </div>

              <div className="space-y-1.5">
                <span className="block text-xs font-medium text-zinc-700">內容預覽</span>
                <div className="border border-zinc-200 rounded-xl bg-[#faf9f6] p-4 max-h-56 overflow-y-auto">
                  <pre className="whitespace-pre-wrap text-xs text-zinc-800 font-sans leading-relaxed">
                    {preview.content.slice(0, 3000)}
                    {preview.content.length > 3000 ? '\n\n…（預覽前 3,000 字元，匯入後顯示完整全文）' : ''}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-zinc-200 bg-[#faf9f6] flex flex-wrap items-center justify-end gap-2.5">
          {preview ? (
            <>
              <button
                type="button"
                disabled={applyingMode !== null}
                onClick={() => void handleExecuteMode('reference')}
                className="min-h-[40px] px-4 py-2 rounded-lg bg-white border border-zinc-300 text-zinc-800 hover:bg-zinc-100 disabled:opacity-50 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <BookOpen className="w-3.5 h-3.5 text-blue-700" aria-hidden="true" />
                <span>{applyingMode === 'reference' ? '開啟中...' : '開啟為右側對照參考'}</span>
              </button>

              <button
                type="button"
                disabled={applyingMode !== null || !hasActiveNote}
                onClick={() => void handleExecuteMode('insert_current')}
                title={!hasActiveNote ? '請先選擇或建立一篇筆記' : undefined}
                className="min-h-[40px] px-4 py-2 rounded-lg bg-white border border-zinc-300 text-zinc-800 hover:bg-zinc-100 disabled:opacity-50 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{applyingMode === 'insert_current' ? '插入中...' : '插入目前筆記編輯'}</span>
              </button>

              <button
                type="button"
                disabled={applyingMode !== null}
                onClick={() => void handleExecuteMode('new_note')}
                className="min-h-[40px] px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FilePlus2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{applyingMode === 'new_note' ? '建立中...' : '建立為新筆記並撰寫'}</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="min-h-[40px] px-4 py-2 rounded-lg bg-white border border-zinc-200 text-zinc-700 hover:bg-zinc-100 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
            >
              關閉
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
