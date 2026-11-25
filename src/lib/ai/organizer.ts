import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { z } from 'zod';

export const OrganizeInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().max(100000),
  existingTopics: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      isSystemInbox: z.boolean(),
    }),
  ),
});

export const OrganizeModelOutputSchema = z.object({
  matchedTopicId: z.string().nullable().optional(),
  suggestedNewTopicName: z.string().trim().max(48).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(24)).min(1).max(3),
  summary: z.string().trim().min(1).max(260),
});

export type OrganizeResult = {
  targetTopicId: string;
  suggestedNewTopicName: string | null;
  tags: string[];
  summary: string;
  degraded: boolean;
};

export type AiGenerateFn = (prompt: string, signal: AbortSignal) => Promise<string>;

function createDefaultAiGenerator(): AiGenerateFn {
  return async (prompt: string, signal: AbortSignal) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY missing');
    }
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const callPromise = ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        systemInstruction:
          'You are a scholarly research librarian. Classify the research note into an existing topic whenever possible; only propose at most ONE concise new topic name if no existing topic fits. Always return 1 to 3 concise academic tags and a 1-sentence summary in the same language as the note.',
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            matchedTopicId: {
              type: Type.STRING,
              nullable: true,
              description: 'Exact id of the best matching existing non-Inbox topic, or null.',
            },
            suggestedNewTopicName: {
              type: Type.STRING,
              nullable: true,
              description: 'At most ONE concise new topic name if matchedTopicId is null.',
            },
            tags: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '1 to 3 concise academic topic tags.',
            },
            summary: {
              type: Type.STRING,
              description: 'A concise 1-sentence abstract of the research note.',
            },
          },
          required: ['tags', 'summary'],
        },
      },
    });

    const abortPromise = new Promise<never>((_, reject) => {
      if (signal.aborted) {
        reject(new Error('AI classification timed out'));
        return;
      }
      signal.addEventListener('abort', () => reject(new Error('AI classification timed out')), {
        once: true,
      });
    });

    const response = await Promise.race([callPromise, abortPromise]);
    return (response.text ?? '').trim();
  };
}

export function buildOrganizePrompt(input: z.infer<typeof OrganizeInputSchema>): string {
  const nonInboxTopics = input.existingTopics.filter((t) => !t.isSystemInbox);
  const topicCatalog =
    nonInboxTopics.length > 0
      ? nonInboxTopics.map((t) => `- id: "${t.id}", name: "${t.name}"`).join('\n')
      : '(無既有分類主題)';

  return [
    `筆記標題：${input.title}`,
    `筆記摘要內容（前 1500 字）：\n${input.content.slice(0, 1500)}`,
    `既有研究主題清單：\n${topicCatalog}`,
    '請優先從「既有研究主題清單」選擇最契合的 matchedTopicId；僅在清單完全不適用時，才在 suggestedNewTopicName 提出最多 1 個簡潔主題名稱（此時 matchedTopicId 設為 null）。請提供 1 至 3 個標籤與 1 句話摘要。',
  ].join('\n\n');
}

export function buildFallbackSummary(title: string, content: string): string {
  const plain = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) {
    return `${title} — 研究筆記草稿`;
  }
  return plain.length <= 120 ? plain : `${plain.slice(0, 117)}...`;
}

export async function autoOrganizeNote(
  rawInput: z.input<typeof OrganizeInputSchema>,
  options: { generateFn?: AiGenerateFn; timeoutMs?: number } = {},
): Promise<OrganizeResult> {
  const input = OrganizeInputSchema.parse(rawInput);
  const inbox = input.existingTopics.find((t) => t.isSystemInbox) ?? input.existingTopics[0];

  if (!inbox) {
    throw new Error('At least one fallback Inbox topic is required.');
  }

  const validTopicIds = new Set(
    input.existingTopics.filter((t) => !t.isSystemInbox).map((t) => t.id),
  );
  const timeoutMs = options.timeoutMs ?? 5000;
  const signal = AbortSignal.timeout(timeoutMs);
  const generateFn = options.generateFn ?? createDefaultAiGenerator();

  try {
    const prompt = buildOrganizePrompt(input);
    const rawJson = await generateFn(prompt, signal);
    const parsedJson: unknown = JSON.parse(rawJson);
    const parsed = OrganizeModelOutputSchema.parse(parsedJson);

    const matchedId =
      parsed.matchedTopicId && validTopicIds.has(parsed.matchedTopicId)
        ? parsed.matchedTopicId
        : null;

    const newTopicName =
      !matchedId && parsed.suggestedNewTopicName
        ? parsed.suggestedNewTopicName.trim().slice(0, 48) || null
        : null;

    const cleanTags = Array.from(
      new Set(parsed.tags.map((t) => t.trim()).filter(Boolean)),
    ).slice(0, 3);

    return {
      targetTopicId: matchedId ?? inbox.id,
      suggestedNewTopicName: newTopicName,
      tags: cleanTags.length > 0 ? cleanTags : ['研究筆記'],
      summary: parsed.summary,
      degraded: false,
    };
  } catch {
    return {
      targetTopicId: inbox.id,
      suggestedNewTopicName: null,
      tags: ['待整理'],
      summary: buildFallbackSummary(input.title, input.content),
      degraded: true,
    };
  }
}
