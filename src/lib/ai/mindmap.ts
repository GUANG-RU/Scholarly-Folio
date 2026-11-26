import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { z } from 'zod';

export const MindMapInputSchema = z.object({
  title: z.string().trim().max(200).optional().default(''),
  text: z.string().trim().min(10, '請至少提供 10 個字元的筆記或語音內容再生成心智圖').max(30000),
  sourceType: z.enum(['note', 'selection', 'voice']).default('note'),
});

export type MindMapBranchColor = 'blue' | 'emerald' | 'amber' | 'rose' | 'violet';

export type MindMapNode = {
  id: string;
  label: string;
  detail?: string;
  color: MindMapBranchColor;
  children: MindMapNode[];
};

export type MindMapResult = {
  root: MindMapNode;
  nodeCount: number;
};

export class MindMapError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

const BRANCH_COLORS: MindMapBranchColor[] = ['blue', 'emerald', 'amber', 'rose', 'violet'];

type RawModelMindMap = {
  rootLabel?: string;
  rootDetail?: string;
  branches?: Array<{
    label?: string;
    detail?: string;
    color?: string;
    children?: Array<{
      label?: string;
      detail?: string;
      children?: Array<{
        label?: string;
        detail?: string;
      }>;
    }>;
  }>;
};

export function normalizeMindMapPayload(
  raw: RawModelMindMap,
  fallbackTitle: string,
): MindMapResult {
  let seq = 0;
  const nextId = () => {
    seq += 1;
    return `mm-node-${seq}`;
  };

  const branchesRaw = Array.isArray(raw.branches) ? raw.branches.slice(0, 7) : [];
  if (branchesRaw.length === 0) {
    throw new MindMapError('無法從目前內容整理出心智圖分支，請補充更多段落內容後再試。', 422);
  }

  let totalCount = 1;
  const branches: MindMapNode[] = branchesRaw
    .map((branch, idx): MindMapNode | null => {
      const color = BRANCH_COLORS.includes(branch.color as MindMapBranchColor)
        ? (branch.color as MindMapBranchColor)
        : BRANCH_COLORS[idx % BRANCH_COLORS.length];
      const label = (branch.label ?? '').trim().slice(0, 48);
      if (!label) return null;
      totalCount += 1;

      const level2Raw = Array.isArray(branch.children) ? branch.children.slice(0, 6) : [];
      const level2: MindMapNode[] = level2Raw
        .map((sub): MindMapNode | null => {
          const subLabel = (sub.label ?? '').trim().slice(0, 48);
          if (!subLabel) return null;
          totalCount += 1;

          const level3Raw = Array.isArray(sub.children) ? sub.children.slice(0, 5) : [];
          const level3: MindMapNode[] = level3Raw
            .map((leaf): MindMapNode | null => {
              const leafLabel = (leaf.label ?? '').trim().slice(0, 48);
              if (!leafLabel) return null;
              totalCount += 1;
              return {
                id: nextId(),
                label: leafLabel,
                detail: leaf.detail?.trim().slice(0, 140) || undefined,
                color,
                children: [],
              };
            })
            .filter((item): item is MindMapNode => item !== null);

          return {
            id: nextId(),
            label: subLabel,
            detail: sub.detail?.trim().slice(0, 140) || undefined,
            color,
            children: level3,
          };
        })
        .filter((item): item is MindMapNode => item !== null);

      return {
        id: nextId(),
        label,
        detail: branch.detail?.trim().slice(0, 140) || undefined,
        color,
        children: level2,
      };
    })
    .filter((item): item is MindMapNode => item !== null);

  if (branches.length === 0) {
    throw new MindMapError('無法從目前內容整理出有效的心智圖節點。', 422);
  }

  const rootLabel = (raw.rootLabel ?? '').trim().slice(0, 56) || fallbackTitle || '研究筆記心智圖';
  return {
    root: {
      id: 'mm-root',
      label: rootLabel,
      detail: raw.rootDetail?.trim().slice(0, 160) || undefined,
      color: 'blue',
      children: branches,
    },
    nodeCount: totalCount,
  };
}

export function stripInlineImageDataUrls(text: string): string {
  return text.replace(
    /!\[([^\]]*)\]\(data:image\/[^)]+\)/g,
    (_m, alt: string) => (alt.trim() ? `[圖片：${alt.trim()}]` : '[圖片]'),
  ).replace(/data:image\/[a-zA-Z0-9+]+;base64,[A-Za-z0-9+/=]+/g, '[圖片]');
}

export function extractJsonObjectText(rawText: string): string {
  let clean = rawText.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(clean);
  if (fenced) {
    clean = fenced[1].trim();
  }
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return clean.slice(firstBrace, lastBrace + 1);
  }
  return clean;
}

export const MindMapRawInputSchema = z.object({
  title: z.string().trim().max(200).optional().default(''),
  text: z.string().max(100000),
  sourceType: z.enum(['note', 'selection', 'voice']).default('note'),
});

export async function generateMindMapFromText(
  rawInput: unknown,
  options: { timeoutMs?: number; maxRetries?: number } = {},
): Promise<MindMapResult> {
  const rawParsed = MindMapRawInputSchema.safeParse(rawInput);
  if (!rawParsed.success) {
    throw new MindMapError('請提供足夠的筆記或語音文字內容', 400);
  }

  const strippedText = stripInlineImageDataUrls(rawParsed.data.text).trim();
  const parsed = MindMapInputSchema.safeParse({
    title: rawParsed.data.title,
    text: strippedText.slice(0, 30000),
    sourceType: rawParsed.data.sourceType,
  });
  if (!parsed.success) {
    const firstMsg = parsed.error.issues[0]?.message || '請提供至少 10 個字元的文字內容再生成心智圖';
    throw new MindMapError(firstMsg, 400);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new MindMapError('尚未設定 Gemini API 金鑰，無法生成心智圖。', 503);
  }

  const { title, text, sourceType } = parsed.data;
  const sourceDesc =
    sourceType === 'voice'
      ? '語音口述逐字稿'
      : sourceType === 'selection'
        ? '筆記選取段落'
        : '完整研究筆記';

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const prompt = [
    `來源類型：${sourceDesc}`,
    title ? `參考標題：${title}` : '',
    `待整理內容：\n${text.slice(0, 20000)}`,
    '請將上述內容萃取出清楚、有層次的心智圖結構：1 個核心主題 (rootLabel)、3 至 6 個主要分支 (branches)，每個分支下包含 2 至 4 個子重點，必要時可再拆出第 3 層細節節點。每個節點標題請精簡扼要（約 4–18 字），並可在 detail 欄位附上一句核心補充說明。使用與原文相同的語言（繁體中文優先）。',
  ]
    .filter(Boolean)
    .join('\n\n');

  const maxRetries = options.maxRetries ?? 2;
  const timeoutMs = options.timeoutMs ?? 25000;
  const deadline = Date.now() + timeoutMs;

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 1500) {
      throw new MindMapError('心智圖生成逾時，請稍後再試或縮減文字範圍。', 504);
    }

    const signal = AbortSignal.timeout(remainingMs);
    const callPromise = ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        systemInstruction:
          'You are an academic knowledge architect. Transform lecture transcripts or research notes into a well-structured, concise hierarchical mind map in JSON format. Always output valid JSON matching the schema and preserve key terminology in the input language.',
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            rootLabel: {
              type: Type.STRING,
              description: 'Central mind map topic (concise, under 30 chars).',
            },
            rootDetail: {
              type: Type.STRING,
              description: 'One-sentence synthesis of the central topic.',
            },
            branches: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  label: { type: Type.STRING },
                  detail: { type: Type.STRING },
                  color: {
                    type: Type.STRING,
                    description: 'One of: blue, emerald, amber, rose, violet',
                  },
                  children: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        label: { type: Type.STRING },
                        detail: { type: Type.STRING },
                        children: {
                          type: Type.ARRAY,
                          items: {
                            type: Type.OBJECT,
                            properties: {
                              label: { type: Type.STRING },
                              detail: { type: Type.STRING },
                            },
                            required: ['label'],
                          },
                        },
                      },
                      required: ['label'],
                    },
                  },
                },
                required: ['label'],
              },
            },
          },
          required: ['rootLabel', 'branches'],
        },
      },
    });

    const abortPromise = new Promise<never>((_, reject) => {
      if (signal.aborted) {
        reject(new MindMapError('心智圖生成逾時，請稍後再試或縮減文字範圍。', 504));
        return;
      }
      signal.addEventListener(
        'abort',
        () => reject(new MindMapError('心智圖生成逾時，請稍後再試或縮減文字範圍。', 504)),
        { once: true },
      );
    });

    try {
      const response = await Promise.race([callPromise, abortPromise]);
      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        throw new MindMapError('AI 未回傳心智圖結構，請稍後再試。', 502);
      }
      const jsonText = extractJsonObjectText(rawText);
      const rawJson = JSON.parse(jsonText) as RawModelMindMap;
      return normalizeMindMapPayload(rawJson, title || '研究筆記心智圖');
    } catch (err) {
      lastError = err;
      // Do not retry validation errors (400 / 422) or missing key (503) or timeout (504)
      if (err instanceof MindMapError && (err.status === 400 || err.status === 422 || err.status === 503 || err.status === 504)) {
        throw err;
      }
      if (attempt < maxRetries) {
        const delayMs = 450 * (attempt + 1);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  if (lastError instanceof MindMapError) {
    throw lastError;
  }
  const message = lastError instanceof Error ? lastError.message : '生成心智圖時發生異常';
  if (/429|RESOURCE_EXHAUSTED/i.test(message)) {
    throw new MindMapError('目前 AI 生成請求次數較多，請稍候再試。', 429);
  }
  throw new MindMapError(`心智圖生成失敗：${message}`, 502);
}

export function mindMapToMarkdown(root: MindMapNode): string {
  const lines: string[] = [`# ${root.label}`];
  if (root.detail) {
    lines.push('', `> ${root.detail}`);
  }
  for (const branch of root.children) {
    lines.push('', `##> ${branch.label}`);
    if (branch.detail) {
      lines.push('', branch.detail);
    }
    if (branch.children.length > 0) {
      lines.push('');
      for (const child of branch.children) {
        lines.push(`- **${child.label}**${child.detail ? `：${child.detail}` : ''}`);
        for (const leaf of child.children) {
          lines.push(`  - ${leaf.label}${leaf.detail ? `（${leaf.detail}）` : ''}`);
        }
      }
    }
  }
  return lines.join('\n').trim();
}
