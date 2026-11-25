import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { z } from 'zod';
import { autoOrganizeNote } from './src/lib/ai/organizer.ts';
import { fetchOnDemandCourseRefs } from './src/lib/courses/index.ts';
import {
  createDriveFolder,
  DriveApiError,
  exportNotesToDriveFolders,
  listDriveFolders,
} from './src/lib/drive/upload.ts';
import { createNoteDocxBuffer } from './src/lib/export/docx.ts';
import {
  createNotesZipBuffer,
  sanitizeFilename,
} from './src/lib/export/packager.ts';
import {
  type OwnerAuthRequest,
  requireOwnerSession,
  revokeIdToken,
} from './src/middleware/auth.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ExportCourseRefSchema = z.object({
  type: z.enum(['COURSE', 'PAPER']),
  title: z.string().trim().min(1).max(300),
  provider: z.enum(['MIT_OCW', 'CURATED_OCW', 'OPENALEX']),
  summary: z.string().max(600).default(''),
  url: z
    .string()
    .trim()
    .url()
    .refine((u) => u.startsWith('http://') || u.startsWith('https://'), 'Invalid URL scheme'),
});

const ExportNoteSchema = z.object({
  id: z.string().trim().min(1).max(128),
  title: z.string().max(200),
  content: z.string().max(100000),
  tags: z.array(z.string().max(24)).max(3).default([]),
  summary: z.string().max(300).default(''),
  updatedAt: z.string().max(64).default(() => new Date().toISOString()),
  courseRefs: z.array(ExportCourseRefSchema).max(25).default([]),
});

const OrganizeBodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().max(100000),
  existingTopics: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(128),
        name: z.string().trim().min(1).max(60),
        isSystemInbox: z.boolean(),
      }),
    )
    .max(200)
    .default([]),
});

const ExportZipSchema = z.object({
  notes: z.array(ExportNoteSchema).min(1).max(50),
});

const ExportDocxSchema = z.object({
  note: ExportNoteSchema,
});

const CreateDriveFolderSchema = z.object({
  name: z.string().trim().min(1).max(120),
  parentId: z.string().trim().optional(),
});

const DriveExportSchema = z.object({
  notes: z.array(ExportNoteSchema).min(1).max(25),
  folderIds: z.array(z.string().trim().min(1)).min(1).max(10),
  format: z.enum(['docx', 'gdoc', 'md', 'txt', 'zip']).default('docx'),
});

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '6mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/auth/logout', (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice('Bearer '.length).trim();
      if (token) {
        revokeIdToken(token);
      }
    }
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Clear-Site-Data', '"cookies", "storage", "cache"');
    res.json({ ok: true });
  });

  app.get('/api/auth/verify', requireOwnerSession, (req: OwnerAuthRequest, res) => {
    return res.json({
      ok: true,
      uid: req.owner!.uid,
      email: req.owner!.email,
    });
  });

  app.post('/api/courses/search', async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    try {
      const result = await fetchOnDemandCourseRefs(req.body);
      return res.json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: '請先輸入筆記標題再尋找參考資料' });
      }
      console.error('POST /api/courses/search failed:', error);
      return res.status(500).json({ error: '參考資料檢索發生異常' });
    }
  });

  app.post('/api/ai/organize', requireOwnerSession, async (req: OwnerAuthRequest, res) => {
    const parsed = OrganizeBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: '請填寫筆記標題後再進行歸檔' });
    }

    try {
      const aiResult = await autoOrganizeNote({
        title: parsed.data.title,
        content: parsed.data.content,
        existingTopics: parsed.data.existingTopics,
      });
      return res.json(aiResult);
    } catch (error) {
      console.error('POST /api/ai/organize failed:', error);
      return res.status(500).json({ error: 'AI 自動歸檔失敗' });
    }
  });

  app.post('/api/export/zip', async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    const parsed = ExportZipSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: '請選取 1 至 50 篇筆記進行打包下載' });
    }
    try {
      const zipUint8 = await createNotesZipBuffer(parsed.data.notes);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="research-notes-bundle.zip"');
      return res.send(Buffer.from(zipUint8));
    } catch (error) {
      console.error('POST /api/export/zip failed:', error);
      return res.status(400).json({
        error: error instanceof Error ? error.message : '打包匯出失敗',
      });
    }
  });

  app.post('/api/export/docx', async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    const parsed = ExportDocxSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: '請選擇一篇筆記進行 Word 匯出' });
    }
    try {
      const note = parsed.data.note;
      const docxBytes = await createNoteDocxBuffer(note);
      const safeName = `${sanitizeFilename(note.title)}.docx`;
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="note.docx"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
      );
      return res.send(Buffer.from(docxBytes));
    } catch (error) {
      console.error('POST /api/export/docx failed:', error);
      return res.status(500).json({ error: 'Word (.docx) 產生失敗' });
    }
  });

  app.get('/api/drive/folders', requireOwnerSession, async (req: OwnerAuthRequest, res) => {
    const driveToken = req.header('X-Drive-Access-Token')?.trim();
    if (!driveToken) {
      return res.status(401).json({
        error: '請先授權 Google Drive 存取權限',
        code: 'DRIVE_TOKEN_EXPIRED',
      });
    }
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      const folders = await listDriveFolders(driveToken, q);
      return res.json({ folders });
    } catch (error) {
      console.error('GET /api/drive/folders failed:', error);
      if (error instanceof DriveApiError) {
        return res.status(error.status).json({ error: error.message, code: error.code });
      }
      return res.status(502).json({
        error: error instanceof Error ? error.message : '無法讀取 Google Drive 資料夾',
      });
    }
  });

  app.post('/api/drive/folders', requireOwnerSession, async (req: OwnerAuthRequest, res) => {
    const driveToken = req.header('X-Drive-Access-Token')?.trim();
    if (!driveToken) {
      return res.status(401).json({
        error: '請先授權 Google Drive 存取權限',
        code: 'DRIVE_TOKEN_EXPIRED',
      });
    }
    const parsed = CreateDriveFolderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: '資料夾名稱無效' });
    }
    try {
      const folder = await createDriveFolder(
        driveToken,
        parsed.data.name,
        parsed.data.parentId,
      );
      return res.status(201).json({ folder });
    } catch (error) {
      console.error('POST /api/drive/folders failed:', error);
      if (error instanceof DriveApiError) {
        return res.status(error.status).json({ error: error.message, code: error.code });
      }
      return res.status(502).json({
        error: error instanceof Error ? error.message : '建立 Google Drive 資料夾失敗',
      });
    }
  });

  app.post('/api/drive/export', requireOwnerSession, async (req: OwnerAuthRequest, res) => {
    const driveToken = req.header('X-Drive-Access-Token')?.trim();
    if (!driveToken) {
      return res.status(401).json({
        error: '請先授權 Google Drive 存取權限',
        code: 'DRIVE_TOKEN_EXPIRED',
      });
    }
    const parsed = DriveExportSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: '請選取筆記、目標資料夾與匯出格式' });
    }
    try {
      const uploaded = await exportNotesToDriveFolders(
        driveToken,
        parsed.data.notes,
        parsed.data.folderIds,
        parsed.data.format,
      );
      return res.status(201).json({ uploaded });
    } catch (error) {
      console.error('POST /api/drive/export failed:', error);
      if (error instanceof DriveApiError) {
        return res.status(error.status).json({ error: error.message, code: error.code });
      }
      return res.status(502).json({
        error: error instanceof Error ? error.message : '匯出至 Google Drive 失敗',
      });
    }
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distPath, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found');
      }
    });
  }

  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`Scholarly Folio server listening on http://0.0.0.0:${port}`);
  });
}

void startServer();
