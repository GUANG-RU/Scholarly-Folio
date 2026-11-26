import type {
  DriveExportFormat,
  DriveFolderItem,
  DriveReadableFileItem,
  DriveUploadedFileItem,
  MindMapResult,
  NoteItem,
} from '../types/workspace.ts';
import { auth, getMemoryDriveAccessToken, requestGoogleDriveAccessToken } from './firebase.ts';
import { convertLegacyWebpImagesInMarkdown } from './image-utils.ts';

async function getBearerHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('UNAUTHENTICATED');
  }
  const token = await user.getIdToken();
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function getOptionalBearerHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) {
    return {
      'Content-Type': 'application/json',
    };
  }
  const token = await user.getIdToken();
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function serializeNotesForServer(notes: NoteItem[]) {
  return Promise.all(
    notes.map(async (note) => ({
      id: note.id,
      title: note.title,
      content: await convertLegacyWebpImagesInMarkdown(note.content),
      tags: note.tags,
      summary: note.summary,
      updatedAt: note.updatedAt,
      courseRefs: note.courseRefs.map((ref) => ({
        type: ref.type,
        title: ref.title,
        provider: ref.provider,
        summary: ref.summary,
        url: ref.url,
      })),
    })),
  );
}

async function parseJsonResponse<T>(
  response: Response,
  fallbackError: string,
): Promise<T> {
  const rawText = await response.text();
  const trimmed = rawText.trim();
  const looksLikeHtml =
    trimmed.toLowerCase().startsWith('<!doctype') ||
    trimmed.toLowerCase().startsWith('<html');

  if (looksLikeHtml) {
    if (response.status === 413) {
      throw new Error('上傳檔案過大，請縮減檔案大小後再試一次。');
    }
    throw new Error(
      '無法連接伺服器功能（伺服器回傳網頁而非資料），請重新整理頁面後再試一次。',
    );
  }

  let parsed: unknown = null;
  if (trimmed) {
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      if (!response.ok) {
        const err = new Error(fallbackError) as Error & { status?: number; code?: string };
        err.status = response.status;
        throw err;
      }
      throw new Error('伺服器回應格式異常，請重新整理頁面後再試一次。');
    }
  }

  if (!response.ok) {
    const payload = (parsed ?? {}) as { error?: string; code?: string };
    const err = new Error(payload.error || fallbackError) as Error & {
      status?: number;
      code?: string;
    };
    err.status = response.status;
    err.code = payload.code;
    throw err;
  }

  return parsed as T;
}

export async function apiFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = await getBearerHeaders();
  const response = await fetch(url, {
    ...init,
    cache: 'no-store',
    headers: {
      ...headers,
      ...(init.headers as Record<string, string> | undefined),
    },
  });

  return parseJsonResponse<T>(response, `HTTP ${response.status}`);
}

export async function apiSearchCourses<T>(body: unknown): Promise<T> {
  const headers = await getOptionalBearerHeaders();
  const response = await fetch('/api/courses/search', {
    method: 'POST',
    cache: 'no-store',
    headers,
    body: JSON.stringify(body),
  });

  return parseJsonResponse<T>(response, `HTTP ${response.status}`);
}

export async function apiTranscribeAudio(payload: {
  audioBase64: string;
  mimeType: string;
  mode: 'verbatim' | 'structured';
}): Promise<{ transcript: string; mimeType: string }> {
  const headers = await getOptionalBearerHeaders();
  const response = await fetch('/api/audio/transcribe', {
    method: 'POST',
    cache: 'no-store',
    headers,
    body: JSON.stringify(payload),
  });

  return parseJsonResponse<{ transcript: string; mimeType: string }>(
    response,
    '語音轉逐字稿失敗',
  );
}

export async function apiDownloadZip(notes: NoteItem[]): Promise<Blob> {
  const headers = await getOptionalBearerHeaders();
  const serializedNotes = await serializeNotesForServer(notes);
  const response = await fetch('/api/export/zip', {
    method: 'POST',
    cache: 'no-store',
    headers,
    body: JSON.stringify({ notes: serializedNotes }),
  });

  if (!response.ok) {
    let message = '壓縮檔下載失敗';
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) message = payload.error;
    } catch {
      // Keep default message
    }
    throw new Error(message);
  }

  return response.blob();
}

export async function apiDownloadDocx(note: NoteItem): Promise<{ blob: Blob; filename: string }> {
  const headers = await getOptionalBearerHeaders();
  const serializedNotes = await serializeNotesForServer([note]);
  const response = await fetch('/api/export/docx', {
    method: 'POST',
    cache: 'no-store',
    headers,
    body: JSON.stringify({ note: serializedNotes[0] }),
  });

  if (!response.ok) {
    let message = 'Word (.docx) 匯出失敗';
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) message = payload.error;
    } catch {
      // Keep default message
    }
    throw new Error(message);
  }

  const disposition = response.headers.get('Content-Disposition') || '';
  const match = /filename\*=UTF-8''([^;]+)/.exec(disposition);
  const filename = match ? decodeURIComponent(match[1]) : 'research-note.docx';
  return { blob: await response.blob(), filename };
}

async function getDriveHeaders(): Promise<Record<string, string>> {
  const base = await getBearerHeaders();
  let driveToken = getMemoryDriveAccessToken();
  if (!driveToken) {
    driveToken = await requestGoogleDriveAccessToken();
  }
  return {
    ...base,
    'X-Drive-Access-Token': driveToken,
  };
}

export async function apiListDriveFolders(query = ''): Promise<DriveFolderItem[]> {
  const headers = await getDriveHeaders();
  const url = query.trim()
    ? `/api/drive/folders?q=${encodeURIComponent(query.trim())}`
    : '/api/drive/folders';
  const response = await fetch(url, {
    method: 'GET',
    cache: 'no-store',
    headers,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
    const err = new Error(body.error || '無法讀取 Google Drive 資料夾') as Error & {
      status?: number;
      code?: string;
    };
    err.status = response.status;
    err.code = body.code;
    throw err;
  }

  const data = (await response.json()) as { folders: DriveFolderItem[] };
  return data.folders;
}

export async function apiCreateDriveFolder(
  name: string,
  parentId?: string,
): Promise<DriveFolderItem> {
  const headers = await getDriveHeaders();
  const response = await fetch('/api/drive/folders', {
    method: 'POST',
    cache: 'no-store',
    headers,
    body: JSON.stringify({ name, parentId }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
    const err = new Error(body.error || '建立 Google Drive 資料夾失敗') as Error & {
      status?: number;
      code?: string;
    };
    err.status = response.status;
    err.code = body.code;
    throw err;
  }

  const data = (await response.json()) as { folder: DriveFolderItem };
  return data.folder;
}

export async function apiExportToDrive(payload: {
  notes: NoteItem[];
  folderIds: string[];
  format: DriveExportFormat;
}): Promise<DriveUploadedFileItem[]> {
  const headers = await getDriveHeaders();
  const serializedNotes = await serializeNotesForServer(payload.notes);
  const response = await fetch('/api/drive/export', {
    method: 'POST',
    cache: 'no-store',
    headers,
    body: JSON.stringify({
      notes: serializedNotes,
      folderIds: payload.folderIds,
      format: payload.format,
    }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
    const err = new Error(body.error || '匯出至 Google Drive 失敗') as Error & {
      status?: number;
      code?: string;
    };
    err.status = response.status;
    err.code = body.code;
    throw err;
  }

  const data = (await response.json()) as { uploaded: DriveUploadedFileItem[] };
  return data.uploaded;
}

export async function apiParseLocalNoteFile(payload: {
  filename: string;
  mimeType: string;
  base64: string;
}): Promise<{
  title: string;
  content: string;
  truncated: boolean;
  charCount: number;
  formatLabel: string;
}> {
  const headers = await getOptionalBearerHeaders();
  const response = await fetch('/api/import/parse', {
    method: 'POST',
    cache: 'no-store',
    headers,
    body: JSON.stringify(payload),
  });

  return parseJsonResponse(response, '解析本地筆記檔案失敗');
}

export async function apiListDriveFiles(query = ''): Promise<DriveReadableFileItem[]> {
  const headers = await getDriveHeaders();
  const url = query.trim()
    ? `/api/drive/files?q=${encodeURIComponent(query.trim())}`
    : '/api/drive/files';
  const response = await fetch(url, {
    method: 'GET',
    cache: 'no-store',
    headers,
  });

  const data = await parseJsonResponse<{ files: DriveReadableFileItem[] }>(
    response,
    '無法讀取 Google Drive 筆記檔案',
  );
  return data.files;
}

export async function apiImportDriveFile(fileId: string): Promise<{
  title: string;
  content: string;
  truncated: boolean;
  charCount: number;
  formatLabel: string;
  sourceName: string;
  mimeType: string;
  webViewLink?: string;
}> {
  const headers = await getDriveHeaders();
  const response = await fetch('/api/drive/import', {
    method: 'POST',
    cache: 'no-store',
    headers,
    body: JSON.stringify({ fileId }),
  });

  return parseJsonResponse(response, '從 Google Drive 匯入檔案失敗');
}

export async function apiGenerateMindMap(payload: {
  title?: string;
  text: string;
  sourceType: 'note' | 'selection' | 'voice';
}): Promise<MindMapResult> {
  const headers = await getOptionalBearerHeaders();
  const cleanPayload = {
    ...payload,
    text: payload.text
      .replace(/!\[([^\]]*)\]\(data:image\/[^)]+\)/g, (_m, alt: string) =>
        alt.trim() ? `[圖片：${alt.trim()}]` : '[圖片]',
      )
      .replace(/data:image\/[a-zA-Z0-9+]+;base64,[A-Za-z0-9+/=]+/g, '[圖片]'),
  };

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch('/api/ai/mindmap', {
        method: 'POST',
        cache: 'no-store',
        headers,
        body: JSON.stringify(cleanPayload),
      });

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (
        attempt < 2 &&
        (response.status === 502 ||
          response.status === 503 ||
          response.status === 504 ||
          contentType.includes('text/html'))
      ) {
        await new Promise((r) => setTimeout(r, 550 * (attempt + 1)));
        continue;
      }

      return await parseJsonResponse<MindMapResult>(response, '心智圖生成失敗');
    } catch (err) {
      lastError = err;
      const typed = err as { status?: number };
      if (typed.status === 400 || typed.status === 422) {
        throw err;
      }
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 550 * (attempt + 1)));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('心智圖生成失敗，請稍後再試。');
}


