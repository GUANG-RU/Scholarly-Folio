import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';

export const MAX_AUDIO_BYTES = 15 * 1024 * 1024; // 15 MB decoded binary limit

const ALLOWED_BASE_MIME_TYPES = new Set([
  'audio/webm',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/mp3',
  'audio/mpeg',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/ogg',
  'audio/aac',
  'audio/flac',
]);

export function normalizeAudioMimeType(rawMime: string): string | null {
  const base = rawMime.split(';')[0].trim().toLowerCase();
  if (!base || !ALLOWED_BASE_MIME_TYPES.has(base)) {
    return null;
  }
  if (base === 'audio/x-wav' || base === 'audio/wave') return 'audio/wav';
  if (base === 'audio/x-m4a' || base === 'audio/m4a') return 'audio/mp4';
  if (base === 'audio/mp3') return 'audio/mpeg';
  return base;
}

export const TranscribeInputSchema = z.object({
  audioBase64: z.string().min(16, '音訊內容為空'),
  mimeType: z.string().trim().min(1),
  mode: z.enum(['verbatim', 'structured']).default('verbatim'),
});

export type TranscribeResult = {
  transcript: string;
  mimeType: string;
};

export type TranscribeFn = (
  audioBase64: string,
  mimeType: string,
  mode: 'verbatim' | 'structured',
  signal: AbortSignal,
) => Promise<string>;

export class TranscriptionError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'TranscriptionError';
    this.status = status;
  }
}

function buildTranscriptionPrompt(mode: 'verbatim' | 'structured'): string {
  if (mode === 'structured') {
    return [
      '請將這段音訊精確轉錄為逐字稿，並依語意進行適當分段，以利學術筆記整理。',
      '規則：',
      '1. 若講者使用中文，請一律輸出繁體中文並加上正確標點符號；若夾雜英文或學術專有名詞請保留原文。',
      '2. 忠實轉錄實際說出的內容，不可自行捏造或補充未說出的資訊；若某處完全聽不清楚，可用 [聽不清楚] 標示。',
      '3. 僅輸出轉錄後的逐字稿正文，不要包含開場白或額外解釋。',
    ].join('\n');
  }

  return [
    '請將這段音訊精確轉錄為逐字稿。',
    '若講者使用中文，請輸出繁體中文並加上適當標點符號與段落；若夾雜英文學術專有名詞或外語請保留原文。',
    '請忠實轉錄實際語音內容，不要加入多餘的開場白、評論或說明。',
  ].join('\n');
}

function mapGeminiError(error: unknown): TranscriptionError {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('timed out') || message.includes('AbortError')) {
    return new TranscriptionError('語音轉錄逾時，請改用較短的音訊片段再試一次。', 504);
  }
  if (message.includes('API_KEY_INVALID') || message.includes('PERMISSION_DENIED') || message.includes('403')) {
    return new TranscriptionError('Gemini API 金鑰無效或權限不足，請檢查設定。', 502);
  }
  if (message.includes('RESOURCE_EXHAUSTED') || message.includes('429')) {
    return new TranscriptionError('語音轉錄請求過於頻繁或配額已達上限，請稍後再試。', 429);
  }
  return new TranscriptionError(`語音轉逐字稿失敗：${message}`, 502);
}

function isModelNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('NOT_FOUND') ||
    message.includes('404') ||
    message.includes('is not found') ||
    message.includes('not supported for generateContent')
  );
}

function createDefaultTranscribeFn(): TranscribeFn {
  return async (audioBase64, mimeType, mode, signal) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new TranscriptionError(
        '伺服器尚未設定 GEMINI_API_KEY，無法執行語音轉逐字稿。',
        503,
      );
    }

    const aiBeta = new GoogleGenAI({
      apiKey,
      apiVersion: 'v1beta',
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const aiDefault = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const audioPart = {
      inlineData: {
        mimeType,
        data: audioBase64,
      },
    };
    const promptPart = { text: buildTranscriptionPrompt(mode) };

    const runWithModel = async (
      client: GoogleGenAI,
      model: string,
    ): Promise<string> => {
      const callPromise = client.models.generateContent({
        model,
        contents: {
          parts: [audioPart, promptPart],
        },
      });

      const abortPromise = new Promise<never>((_, reject) => {
        if (signal.aborted) {
          reject(new Error('Transcription timed out'));
          return;
        }
        signal.addEventListener('abort', () => reject(new Error('Transcription timed out')), {
          once: true,
        });
      });

      const response = await Promise.race([callPromise, abortPromise]);
      return (response.text ?? '').trim();
    };

    try {
      return await runWithModel(aiBeta, 'gemini-3.5-transcribe');
    } catch (primaryError) {
      if (isModelNotFoundError(primaryError)) {
        try {
          return await runWithModel(aiDefault, 'gemini-4-hydrogen');
        } catch (fallbackError) {
          throw mapGeminiError(fallbackError);
        }
      }
      throw mapGeminiError(primaryError);
    }
  };
}

export async function transcribeAudio(
  rawInput: z.input<typeof TranscribeInputSchema>,
  options: { transcribeFn?: TranscribeFn; timeoutMs?: number } = {},
): Promise<TranscribeResult> {
  const parsed = TranscribeInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new TranscriptionError('音訊格式或內容無效，請重新錄音或選擇音訊檔案。', 400);
  }

  const normalizedMime = normalizeAudioMimeType(parsed.data.mimeType);
  if (!normalizedMime) {
    throw new TranscriptionError(
      '不支援此音訊格式，請使用 WebM、MP3、WAV、M4A/MP4、OGG、AAC 或 FLAC。',
      400,
    );
  }

  // Strip optional data URL prefix if present
  const cleanBase64 = parsed.data.audioBase64
    .replace(/^data:[^;]+;base64,/, '')
    .replace(/\s+/g, '');

  const estimatedBytes = Buffer.byteLength(cleanBase64, 'base64');
  if (estimatedBytes === 0) {
    throw new TranscriptionError('錄音內容為空，請再試一次。', 400);
  }
  if (estimatedBytes > MAX_AUDIO_BYTES) {
    throw new TranscriptionError('音訊檔案過大（上限 15 MB），請分段錄製或剪輯後再上傳。', 413);
  }

  const timeoutMs = options.timeoutMs ?? 60000;
  const signal = AbortSignal.timeout(timeoutMs);
  const transcribeFn = options.transcribeFn ?? createDefaultTranscribeFn();

  const transcript = await transcribeFn(
    cleanBase64,
    normalizedMime,
    parsed.data.mode,
    signal,
  );

  if (!transcript.trim()) {
    throw new TranscriptionError('未偵測到清晰的語音內容，請靠近麥克風或確認音檔音量。', 422);
  }

  return {
    transcript: transcript.trim(),
    mimeType: normalizedMime,
  };
}
