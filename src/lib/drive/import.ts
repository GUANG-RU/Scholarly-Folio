import {
  MAX_IMPORT_FILE_BYTES,
  parseImportedDocument,
  type ParsedImportResult,
} from '../import/parser.ts';
import { DriveApiError, parseGoogleDriveError } from './upload.ts';

export type DriveReadableFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  webViewLink?: string;
};

export type DriveImportedDocument = ParsedImportResult & {
  sourceName: string;
  mimeType: string;
  webViewLink?: string;
};

const SUPPORTED_DRIVE_MIME_TYPES = new Set([
  'application/vnd.google-apps.document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/markdown',
  'text/x-markdown',
  'text/plain',
  'text/html',
]);

function isSupportedDriveFile(file: DriveReadableFile): boolean {
  if (SUPPORTED_DRIVE_MIME_TYPES.has(file.mimeType)) {
    return true;
  }
  const lowerName = file.name.toLowerCase();
  return (
    lowerName.endsWith('.md') ||
    lowerName.endsWith('.markdown') ||
    lowerName.endsWith('.txt') ||
    lowerName.endsWith('.docx') ||
    lowerName.endsWith('.html') ||
    lowerName.endsWith('.htm')
  );
}

export async function listDriveReadableFiles(
  accessToken: string,
  searchTerm = '',
): Promise<DriveReadableFile[]> {
  const escapedSearch = searchTerm.trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const typeClauses = [
    "mimeType = 'application/vnd.google-apps.document'",
    "mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'",
    "mimeType = 'text/markdown'",
    "mimeType = 'text/x-markdown'",
    "mimeType = 'text/plain'",
    "mimeType = 'text/html'",
    "name contains '.md'",
    "name contains '.txt'",
    "name contains '.docx'",
    "name contains '.html'",
  ].join(' or ');

  const qParts = [
    'trashed = false',
    "mimeType != 'application/vnd.google-apps.folder'",
    `(${typeClauses})`,
  ];
  if (escapedSearch) {
    qParts.push(`name contains '${escapedSearch}'`);
  }

  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('q', qParts.join(' and '));
  url.searchParams.set('fields', 'files(id,name,mimeType,modifiedTime,size,webViewLink)');
  url.searchParams.set('orderBy', 'modifiedTime desc');
  url.searchParams.set('pageSize', '60');
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
    throw parseGoogleDriveError(response.status, errText, '讀取 Google Drive 筆記檔案');
  }

  const payload = (await response.json()) as { files?: DriveReadableFile[] };
  const files = Array.isArray(payload.files) ? payload.files : [];
  return files.filter(isSupportedDriveFile);
}

export async function importDriveFileContent(
  accessToken: string,
  fileId: string,
): Promise<DriveImportedDocument> {
  const cleanId = fileId.trim();
  if (!/^[a-zA-Z0-9_-]{3,200}$/.test(cleanId)) {
    throw new DriveApiError('無效的 Google Drive 檔案編號。', 400);
  }

  const metaUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(cleanId)}`);
  metaUrl.searchParams.set('fields', 'id,name,mimeType,size,webViewLink');
  metaUrl.searchParams.set('supportsAllDrives', 'true');

  const metaRes = await fetch(metaUrl.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!metaRes.ok) {
    const errText = await metaRes.text().catch(() => '');
    throw parseGoogleDriveError(metaRes.status, errText, '讀取 Google Drive 檔案資訊');
  }

  const meta = (await metaRes.json()) as DriveReadableFile;
  if (!isSupportedDriveFile(meta)) {
    throw new DriveApiError(
      '此檔案格式暫不支援匯入，請選擇 Google 文件、Word (.docx)、Markdown (.md)、純文字 (.txt) 或網頁 (.html)。',
      415,
    );
  }

  if (meta.size && Number(meta.size) > MAX_IMPORT_FILE_BYTES) {
    throw new DriveApiError('檔案大小超過 10 MB 上限，請精簡後再匯入。', 413);
  }

  const isGoogleDoc = meta.mimeType === 'application/vnd.google-apps.document';
  const downloadUrl = isGoogleDoc
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        cleanId,
      )}/export?mimeType=application%2Fvnd.openxmlformats-officedocument.wordprocessingml.document`
    : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        cleanId,
      )}?alt=media&supportsAllDrives=true`;

  const downloadRes = await fetch(downloadUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!downloadRes.ok) {
    const errText = await downloadRes.text().catch(() => '');
    throw parseGoogleDriveError(
      downloadRes.status,
      errText,
      `下載 Google Drive 檔案「${meta.name}」`,
    );
  }

  const arrayBuffer = await downloadRes.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes.byteLength > MAX_IMPORT_FILE_BYTES) {
    throw new DriveApiError('檔案大小超過 10 MB 上限，請精簡後再匯入。', 413);
  }

  const parsed = await parseImportedDocument({
    filename: isGoogleDoc ? `${meta.name}.docx` : meta.name,
    mimeType: isGoogleDoc
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : meta.mimeType,
    bytes,
  });

  return {
    ...parsed,
    formatLabel: isGoogleDoc ? 'Google 文件' : parsed.formatLabel,
    sourceName: meta.name,
    mimeType: meta.mimeType,
    webViewLink: meta.webViewLink,
  };
}
