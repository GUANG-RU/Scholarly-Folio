const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'into',
  'about',
  'what',
  'when',
  'where',
  'which',
  'how',
  'why',
  'are',
  'was',
  'were',
  'have',
  'has',
  'had',
  'not',
  'but',
  'can',
  'will',
  'use',
  'using',
  'used',
  'note',
  'notes',
  'study',
  'research',
  'paper',
  'course',
  '的',
  '了',
  '在',
  '是',
  '與',
  '和',
  '或',
  '及',
  '對',
  '於',
  '從',
  '由',
  '為',
  '如何',
  '什麼',
  '筆記',
  '研究',
]);

export function sanitizeExternalUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return null;
  }
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

export function extractSearchKeywords(title: string, content = ''): string {
  const cleanText = `${title} ${content.slice(0, 1200)}`
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_~|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleanText) {
    return 'computer science research methods';
  }

  const tokens = cleanText
    .split(/[\s,.;:!?()[\]{}"'「」『』、。，；：？！/\\]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t.toLowerCase()));

  const uniqueTokens: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const key = token.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      uniqueTokens.push(token);
      if (uniqueTokens.length >= 8) {
        break;
      }
    }
  }

  return uniqueTokens.join(' ') || title.trim().slice(0, 80);
}
