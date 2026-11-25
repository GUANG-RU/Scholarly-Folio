import crypto from 'node:crypto';
import {
  buildNoteHtml,
  buildNotePlainText,
  createNoteDocxBuffer,
} from '../export/docx.ts';
import {
  buildNoteMarkdown,
  createNotesZipBuffer,
  type ExportableNote,
  sanitizeFilename,
} from '../export/packager.ts';

export type DriveExportFormat = 'docx' | 'gdoc' | 'md' | 'txt' | 'zip';

export type DriveFolder = {
  id: string;
  name: string;
  parents?: string[];
  modifiedTime?: string;
  capabilities?: {
    canAddChildren?: boolean;
  };
};

export type DriveUploadedFile = {
  id: string;
  name: string;
  folderId: string;
  webViewLink?: string;
  mimeType: string;
};

export class DriveApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function parseGoogleDriveError(
  status: number,
  rawBody: string,
  actionLabel: string,
): DriveApiError {
  console.error(`Google Drive API error (${actionLabel}, HTTP ${status}):`, rawBody);

  const reasons: string[] = [];
  let apiMessage = '';
  try {
    const parsed = JSON.parse(rawBody) as {
      error?: {
        message?: string;
        status?: string;
        errors?: Array<{ reason?: string; message?: string }>;
        details?: Array<{ reason?: string; metadata?: Record<string, string> }>;
      };
    };
    apiMessage = parsed.error?.message || '';
    if (parsed.error?.status) reasons.push(parsed.error.status);
    for (const item of parsed.error?.errors ?? []) {
      if (item.reason) reasons.push(item.reason);
    }
    for (const item of parsed.error?.details ?? []) {
      if (item.reason) reasons.push(item.reason);
    }
  } catch {
    apiMessage = rawBody.slice(0, 240);
  }

  const lowerMsg = apiMessage.toLowerCase();
  const reasonSet = new Set(reasons.map((r) => r.toLowerCase()));
  const primaryReason = reasons[0] || '';

  if (status === 401) {
    return new DriveApiError('Google Drive 授權已過期，請重新連結。', 401, 'DRIVE_TOKEN_EXPIRED');
  }

  if (
    reasonSet.has('accessnotconfigured') ||
    reasonSet.has('service_disabled') ||
    lowerMsg.includes('drive api has not been used') ||
    lowerMsg.includes('has not been used in project') ||
    lowerMsg.includes('is disabled')
  ) {
    return new DriveApiError(
      `Google Cloud 專案尚未啟用 Google Drive API（drive.googleapis.com），請啟用後等待數分鐘再試。（${apiMessage}）`,
      403,
      'DRIVE_API_DISABLED',
    );
  }

  if (
    reasonSet.has('insufficientpermissions') ||
    reasonSet.has('access_token_scope_insufficient') ||
    lowerMsg.includes('insufficient authentication scopes') ||
    lowerMsg.includes('insufficient permission')
  ) {
    return new DriveApiError(
      '目前的登入憑證未包含 Google Drive 寫入權限，請點擊「重新授權 Google Drive」並勾選雲端硬碟存取權限。',
      403,
      'DRIVE_SCOPE_MISSING',
    );
  }

  if (
    reasonSet.has('insufficientfilepermissions') ||
    reasonSet.has('cannotaddparent') ||
    reasonSet.has('domainpolicy')
  ) {
    return new DriveApiError(
      `您對選取的資料夾沒有寫入權限（可能是唯讀共用資料夾），請改選您擁有的資料夾。（${apiMessage}）`,
      403,
      'DRIVE_FOLDER_READONLY',
    );
  }

  return new DriveApiError(
    `${actionLabel}失敗（HTTP ${status}）：${apiMessage || '請稍後再試'}`,
    status === 403 ? 403 : 502,
    primaryReason || undefined,
  );
}

export async function listDriveFolders(
  accessToken: string,
  searchTerm = '',
): Promise<DriveFolder[]> {
  const escapedSearch = searchTerm.trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const qParts = [
    "mimeType = 'application/vnd.google-apps.folder'",
    'trashed = false',
  ];
  if (escapedSearch) {
    qParts.push(`name contains '${escapedSearch}'`);
  }

  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('q', qParts.join(' and '));
  url.searchParams.set('fields', 'files(id,name,parents,modifiedTime,capabilities(canAddChildren))');
  url.searchParams.set('orderBy', 'modifiedTime desc');
  url.searchParams.set('pageSize', '80');
  url.searchParams.set('supportsAllDrives', 'true');
  url.searchParams.set('includeItemsFromAllDrives', 'true');

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw parseGoogleDriveError(response.status, errText, '讀取 Google Drive 資料夾');
  }

  const payload = (await response.json()) as { files?: DriveFolder[] };
  const files = Array.isArray(payload.files) ? payload.files : [];
  return files.filter((f) => f.capabilities?.canAddChildren !== false);
}

export async function createDriveFolder(
  accessToken: string,
  name: string,
  parentId?: string,
): Promise<DriveFolder> {
  const metadata: Record<string, unknown> = {
    name: name.trim().slice(0, 120),
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId && parentId !== 'root') {
    metadata.parents = [parentId];
  }

  const response = await fetch(
    'https://www.googleapis.com/drive/v3/files?fields=id,name,parents,modifiedTime&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(metadata),
      signal: AbortSignal.timeout(8000),
    },
  );

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw parseGoogleDriveError(response.status, errText, '建立 Google Drive 資料夾');
  }

  return (await response.json()) as DriveFolder;
}

async function uploadSingleFileToDrive(
  accessToken: string,
  options: {
    name: string;
    targetMimeType: string;
    uploadMimeType: string;
    contentBytes: Uint8Array | Buffer;
    folderId: string;
  },
): Promise<DriveUploadedFile> {
  const metadata: Record<string, unknown> = {
    name: options.name,
    mimeType: options.targetMimeType,
  };
  if (options.folderId && options.folderId !== 'root') {
    metadata.parents = [options.folderId];
  }

  const boundary = `scholarly_drive_${crypto.randomBytes(8).toString('hex')}`;
  const header = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
      metadata,
    )}\r\n--${boundary}\r\nContent-Type: ${options.uploadMimeType}\r\n\r\n`,
    'utf8',
  );
  const footer = Buffer.from(`\r\n--${boundary}--`, 'utf8');
  const body = Buffer.concat([header, Buffer.from(options.contentBytes), footer]);

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,mimeType&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
      signal: AbortSignal.timeout(15000),
    },
  );

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw parseGoogleDriveError(
      response.status,
      errText,
      `上傳檔案「${options.name}」至 Google Drive`,
    );
  }

  const uploaded = (await response.json()) as {
    id: string;
    name: string;
    webViewLink?: string;
    mimeType: string;
  };

  return {
    id: uploaded.id,
    name: uploaded.name,
    folderId: options.folderId,
    webViewLink: uploaded.webViewLink,
    mimeType: uploaded.mimeType,
  };
}

export async function exportNotesToDriveFolders(
  accessToken: string,
  notes: ExportableNote[],
  folderIds: string[],
  format: DriveExportFormat,
): Promise<DriveUploadedFile[]> {
  const uniqueFolders = Array.from(new Set(folderIds.filter(Boolean))).slice(0, 10);
  if (uniqueFolders.length === 0) {
    throw new Error('請至少選擇一個目標 Google Drive 資料夾。');
  }

  const results: DriveUploadedFile[] = [];

  if (format === 'zip') {
    const zipBytes = await createNotesZipBuffer(notes);
    for (const folderId of uniqueFolders) {
      const uploaded = await uploadSingleFileToDrive(accessToken, {
        name: `research-notes-${new Date().toISOString().slice(0, 10)}.zip`,
        targetMimeType: 'application/zip',
        uploadMimeType: 'application/zip',
        contentBytes: zipBytes,
        folderId,
      });
      results.push(uploaded);
    }
    return results;
  }

  for (const note of notes) {
    const baseName = sanitizeFilename(note.title);
    let fileName = `${baseName}.docx`;
    let targetMimeType =
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    let uploadMimeType = targetMimeType;
    let contentBytes: Uint8Array | Buffer;

    if (format === 'docx') {
      contentBytes = await createNoteDocxBuffer(note);
    } else if (format === 'gdoc') {
      fileName = note.title.trim().slice(0, 120) || '未命名研究筆記';
      targetMimeType = 'application/vnd.google-apps.document';
      uploadMimeType = 'text/html; charset=UTF-8';
      contentBytes = Buffer.from(buildNoteHtml(note), 'utf8');
    } else if (format === 'md') {
      fileName = `${baseName}.md`;
      targetMimeType = 'text/markdown';
      uploadMimeType = 'text/markdown; charset=UTF-8';
      contentBytes = Buffer.from(buildNoteMarkdown(note), 'utf8');
    } else {
      fileName = `${baseName}.txt`;
      targetMimeType = 'text/plain';
      uploadMimeType = 'text/plain; charset=UTF-8';
      contentBytes = Buffer.from(buildNotePlainText(note), 'utf8');
    }

    for (const folderId of uniqueFolders) {
      const uploaded = await uploadSingleFileToDrive(accessToken, {
        name: fileName,
        targetMimeType,
        uploadMimeType,
        contentBytes,
        folderId,
      });
      results.push(uploaded);
    }
  }

  return results;
}
