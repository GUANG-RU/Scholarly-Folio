import { describe, expect, it } from 'vitest';
import { fetchOnDemandCourseRefs } from '../../src/lib/courses/index.ts';
import { extractSearchKeywords, sanitizeExternalUrl } from '../../src/lib/courses/keywords.ts';

describe('courses/keywords', () => {
  it('sanitizes URLs and blocks javascript/data/file schemes', () => {
    expect(sanitizeExternalUrl('https://ocw.mit.edu/courses/18-06')).toBe(
      'https://ocw.mit.edu/courses/18-06',
    );
    expect(sanitizeExternalUrl('http://example.org/paper')).toBe('http://example.org/paper');
    expect(sanitizeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeExternalUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(sanitizeExternalUrl('/relative/path')).toBeNull();
    expect(sanitizeExternalUrl('')).toBeNull();
  });

  it('extracts meaningful keywords without markdown noise', () => {
    const keywords = extractSearchKeywords(
      'Distributed Consensus in Raft',
      '# Header\nStudying `leader election` and **fault tolerance** in distributed systems.',
    );
    expect(keywords).toContain('Distributed');
    expect(keywords).toContain('Consensus');
    expect(keywords).not.toContain('#');
  });
});

describe('courses/fetchOnDemandCourseRefs', () => {
  it('isolates single-source failure and returns available source', async () => {
    const result = await fetchOnDemandCourseRefs(
      { title: 'Distributed Systems Raft' },
      {
        searchCourses: async () => [
          {
            externalId: 'mit-6-824',
            type: 'COURSE',
            title: 'MIT 6.824',
            provider: 'MIT_OCW',
            summary: 'Distributed systems course',
            url: 'https://pdos.csail.mit.edu/6.824/',
          },
        ],
        searchPapers: async () => {
          throw new Error('OpenAlex network error');
        },
      },
    );

    expect(result.degraded).toBe(false);
    expect(result.sources.coursesOk).toBe(true);
    expect(result.sources.papersOk).toBe(false);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].type).toBe('COURSE');
  });

  it('handles timeout gracefully when external provider stalls', async () => {
    const result = await fetchOnDemandCourseRefs(
      { title: 'Linear Algebra' },
      {
        timeoutMs: 30,
        searchCourses: (_q, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('Aborted')));
          }),
        searchPapers: (_q, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('Aborted')));
          }),
      },
    );

    expect(result.degraded).toBe(true);
    expect(result.items).toEqual([]);
  });
});
