import type {
  DriveExportFormat,
  DriveFolderItem,
  DriveUploadedFileItem,
  NoteItem,
} from '../types/workspace.ts';
import { auth, getMemoryDriveAccessToken, requestGoogleDriveAccessToken } from './firebase.ts';

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

function serializeNotesForServer(notes: NoteItem[]) {
  return notes.map((note) => ({
    id: note.id,
    title: note.title,
    content: note.content,
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
  }));
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

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) message = payload.error;
    } catch {
      // Ignore parse error and surface HTTP status
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = response.status;
    throw err;
  }

  return (await response.json()) as T;
}

export async function apiSearchCourses<T>(body: unknown): Promise<T> {
  const headers = await getOptionalBearerHeaders();
  const response = await fetch('/api/courses/search', {
    method: 'POST',
    cache: 'no-store',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) message = payload.error;
    } catch {
      // Ignore parse error
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = response.status;
    throw err;
  }

  return (await response.json()) as T;
}

export async function apiDownloadZip(notes: NoteItem[]): Promise<Blob> {
  const headers = await getOptionalBearerHeaders();
  const response = await fetch('/api/export/zip', {
    method: 'POST',
    cache: 'no-store',
    headers,
    body: JSON.stringify({ notes: serializeNotesForServer(notes) }),
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
  const response = await fetch('/api/export/docx', {
    method: 'POST',
    cache: 'no-store',
    headers,
    body: JSON.stringify({ note: serializeNotesForServer([note])[0] }),
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
  const response = await fetch('/api/drive/export', {
    method: 'POST',
    cache: 'no-store',
    headers,
    body: JSON.stringify({
      notes: serializeNotesForServer(payload.notes),
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
