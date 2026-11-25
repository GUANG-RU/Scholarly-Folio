import { z } from 'zod';
import { type CourseReferenceItem, searchCuratedCourses } from './curatedCatalog.ts';
import { extractSearchKeywords } from './keywords.ts';
import { searchOpenAlex } from './openalex.ts';

export type { CourseReferenceItem };

export const CourseSearchInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().max(50000).optional().default(''),
  limit: z.number().int().min(1).max(5).default(4),
});

export type CourseSearchDeps = {
  searchCourses?: (
    query: string,
    signal: AbortSignal,
    limit: number,
  ) => Promise<CourseReferenceItem[]>;
  searchPapers?: (
    query: string,
    signal: AbortSignal,
    limit: number,
  ) => Promise<CourseReferenceItem[]>;
  timeoutMs?: number;
};

export async function fetchOnDemandCourseRefs(
  rawInput: z.input<typeof CourseSearchInputSchema>,
  deps: CourseSearchDeps = {},
): Promise<{
  keywords: string;
  items: CourseReferenceItem[];
  degraded: boolean;
  sources: { coursesOk: boolean; papersOk: boolean };
}> {
  const input = CourseSearchInputSchema.parse(rawInput);
  const keywords = extractSearchKeywords(input.title, input.content);
  const timeoutMs = deps.timeoutMs ?? 4000;
  const signal = AbortSignal.timeout(timeoutMs);

  const runCourses = deps.searchCourses ?? searchCuratedCourses;
  const runPapers = deps.searchPapers ?? searchOpenAlex;

  const [coursesResult, papersResult] = await Promise.allSettled([
    runCourses(keywords, signal, input.limit),
    runPapers(keywords, signal, input.limit),
  ]);

  const courses = coursesResult.status === 'fulfilled' ? coursesResult.value : [];
  const papers = papersResult.status === 'fulfilled' ? papersResult.value : [];

  const coursesOk = coursesResult.status === 'fulfilled';
  const papersOk = papersResult.status === 'fulfilled';

  const interleaved: CourseReferenceItem[] = [];
  const maxLen = Math.max(courses.length, papers.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < courses.length) interleaved.push(courses[i]);
    if (i < papers.length) interleaved.push(papers[i]);
  }

  return {
    keywords,
    items: interleaved,
    degraded: !coursesOk && !papersOk,
    sources: { coursesOk, papersOk },
  };
}
