import type { CourseReferenceItem } from './curatedCatalog.ts';
import { sanitizeExternalUrl } from './keywords.ts';

type OpenAlexWork = {
  id?: string;
  title?: string;
  publication_year?: number;
  doi?: string;
  primary_location?: {
    landing_page_url?: string;
    source?: {
      display_name?: string;
    };
  };
  abstract_inverted_index?: Record<string, number[]>;
};

export function reconstructAbstract(inverted?: Record<string, number[]>): string {
  if (!inverted || typeof inverted !== 'object') {
    return '';
  }
  const positions: Array<[number, string]> = [];
  for (const [word, idxs] of Object.entries(inverted)) {
    if (!Array.isArray(idxs)) continue;
    for (const pos of idxs) {
      if (typeof pos === 'number' && pos >= 0 && pos < 120) {
        positions.push([pos, word]);
      }
    }
  }
  positions.sort((a, b) => a[0] - b[0]);
  const text = positions.map(([, w]) => w).join(' ').trim();
  if (text.length <= 220) {
    return text;
  }
  return `${text.slice(0, 217)}...`;
}

export async function searchOpenAlex(
  query: string,
  signal: AbortSignal,
  limit = 4,
): Promise<CourseReferenceItem[]> {
  const endpoint = new URL('https://api.openalex.org/works');
  endpoint.searchParams.set('search', query);
  endpoint.searchParams.set('per-page', String(limit));
  endpoint.searchParams.set(
    'select',
    'id,title,publication_year,doi,primary_location,abstract_inverted_index',
  );

  const response = await fetch(endpoint.toString(), {
    method: 'GET',
    signal,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'ScholarlyFolio/1.0 (academic-research-workspace)',
    },
  });

  if (!response.ok) {
    throw new Error(`OpenAlex responded with HTTP ${response.status}`);
  }

  const data = (await response.json()) as { results?: OpenAlexWork[] };
  const works = Array.isArray(data.results) ? data.results : [];

  const items: CourseReferenceItem[] = [];
  for (const work of works) {
    if (!work.title) continue;
    const candidateUrl =
      work.primary_location?.landing_page_url || work.doi || work.id || '';
    const safeUrl = sanitizeExternalUrl(candidateUrl);
    if (!safeUrl) continue;

    const sourceName = work.primary_location?.source?.display_name;
    const yearStr = work.publication_year ? ` (${work.publication_year})` : '';
    const abstract = reconstructAbstract(work.abstract_inverted_index);
    const summary =
      abstract ||
      `${sourceName ? `${sourceName}${yearStr}` : `學術文獻${yearStr}`} — 來自 OpenAlex 開放學術索引。`;

    items.push({
      externalId: work.id || safeUrl,
      type: 'PAPER',
      title: `${work.title}${yearStr}`,
      provider: 'OPENALEX',
      summary,
      url: safeUrl,
    });
  }

  return items;
}
