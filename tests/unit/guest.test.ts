import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearGuestWorkspace,
  hasStoredGuestWorkspace,
  isSubstantialGuestNote,
  loadGuestWorkspace,
  saveGuestWorkspace,
} from '../../src/lib/guest-workspace.ts';
import type { NoteItem, TopicItem } from '../../src/types/workspace.ts';

function makeNote(overrides: Partial<NoteItem> = {}): NoteItem {
  const now = new Date().toISOString();
  return {
    id: 'guest-note-1',
    topicId: 'inbox',
    title: '未命名研究筆記',
    content: '',
    status: 'DRAFT',
    tags: [],
    summary: '',
    createdAt: now,
    updatedAt: now,
    courseRefs: [],
    ...overrides,
  };
}

describe('guest-workspace helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detects substantial guest notes vs empty default placeholder', () => {
    expect(isSubstantialGuestNote(makeNote())).toBe(false);
    expect(isSubstantialGuestNote(makeNote({ title: '  未命名研究筆記  ', content: '   ' }))).toBe(false);

    expect(isSubstantialGuestNote(makeNote({ content: 'Some research draft' }))).toBe(true);
    expect(isSubstantialGuestNote(makeNote({ title: '自訂研究標題' }))).toBe(true);
    expect(
      isSubstantialGuestNote(
        makeNote({
          courseRefs: [
            {
              id: 'ref-1',
              noteId: 'guest-note-1',
              type: 'COURSE',
              title: 'MIT 18.06',
              provider: 'MIT_OCW',
              summary: 'Linear Algebra',
              url: 'https://ocw.mit.edu',
              createdAt: new Date().toISOString(),
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it('persists and clears guest workspace in sessionStorage', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
      },
    });

    const initial = loadGuestWorkspace();
    expect(initial.topics).toHaveLength(1);
    expect(initial.topics[0].id).toBe('inbox');
    expect(hasStoredGuestWorkspace()).toBe(false);

    const customTopics: TopicItem[] = [
      ...initial.topics,
      {
        id: 'guest-topic-1',
        name: '量子計算',
        slug: 'quantum',
        sortOrder: 1,
        isSystemInbox: false,
        createdAt: new Date().toISOString(),
      },
    ];
    const customNotes: NoteItem[] = [
      makeNote({ title: 'Quantum Error Correction', content: 'Surface codes notes', topicId: 'guest-topic-1' }),
    ];

    saveGuestWorkspace(customTopics, customNotes);
    expect(hasStoredGuestWorkspace()).toBe(true);

    const loaded = loadGuestWorkspace();
    expect(loaded.topics).toHaveLength(2);
    expect(loaded.notes[0].title).toBe('Quantum Error Correction');

    clearGuestWorkspace();
    expect(hasStoredGuestWorkspace()).toBe(false);
  });
});
