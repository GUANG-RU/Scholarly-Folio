import { describe, expect, it } from 'vitest';
import { DriveApiError, parseGoogleDriveError } from '../../src/lib/drive/upload.ts';

describe('parseGoogleDriveError', () => {
  it('classifies insufficientPermissions as DRIVE_SCOPE_MISSING (403)', () => {
    const raw = JSON.stringify({
      error: {
        code: 403,
        message: 'Request had insufficient authentication scopes.',
        errors: [
          {
            domain: 'global',
            reason: 'insufficientPermissions',
            message: 'Insufficient Permission',
          },
        ],
      },
    });
    const err = parseGoogleDriveError(403, raw, '上傳檔案「測試文獻.docx」至 Google Drive');
    expect(err).toBeInstanceOf(DriveApiError);
    expect(err.status).toBe(403);
    expect(err.code).toBe('DRIVE_SCOPE_MISSING');
  });

  it('classifies accessNotConfigured / SERVICE_DISABLED as DRIVE_API_DISABLED (403)', () => {
    const raw = JSON.stringify({
      error: {
        code: 403,
        message: 'Google Drive API has not been used in project 1064014208988 before or it is disabled.',
        errors: [{ reason: 'accessNotConfigured' }],
      },
    });
    const err = parseGoogleDriveError(403, raw, '讀取 Google Drive 資料夾');
    expect(err.status).toBe(403);
    expect(err.code).toBe('DRIVE_API_DISABLED');
  });

  it('classifies insufficientFilePermissions as DRIVE_FOLDER_READONLY (403)', () => {
    const raw = JSON.stringify({
      error: {
        code: 403,
        message: 'The user does not have sufficient permissions for this file.',
        errors: [{ reason: 'insufficientFilePermissions' }],
      },
    });
    const err = parseGoogleDriveError(403, raw, '上傳檔案「測試文獻.docx」至 Google Drive');
    expect(err.status).toBe(403);
    expect(err.code).toBe('DRIVE_FOLDER_READONLY');
  });

  it('classifies 401 as DRIVE_TOKEN_EXPIRED', () => {
    const err = parseGoogleDriveError(401, '{"error":{"message":"Invalid Credentials"}}', '讀取');
    expect(err.status).toBe(401);
    expect(err.code).toBe('DRIVE_TOKEN_EXPIRED');
  });
});
