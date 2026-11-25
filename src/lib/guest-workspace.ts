import type { NoteItem, ShareBundleItem, TopicItem } from '../types/workspace.ts';
import {
  bootstrapOwnerWorkspace,
  createFirestoreNote,
  createOrFindFirestoreTopic,
  pinFirestoreCourseRef,
} from './firestore-workspace.ts';

const GUEST_STORAGE_KEY = 'scholarly_folio_guest_workspace_v1';

function createInitialGuestState(): { topics: TopicItem[]; notes: NoteItem[] } {
  const nowIso = new Date().toISOString();
  return {
    topics: [
      {
        id: 'inbox',
        name: 'Inbox',
        slug: 'inbox',
        sortOrder: 0,
        isSystemInbox: true,
        createdAt: nowIso,
      },
    ],
    notes: [
      {
        id: `guest-note-${Date.now().toString(36)}`,
        topicId: 'inbox',
        title: '未命名研究筆記',
        content: '',
        status: 'DRAFT',
        tags: [],
        summary: '',
        createdAt: nowIso,
        updatedAt: nowIso,
        courseRefs: [],
      },
    ],
  };
}

export function loadGuestWorkspace(): { topics: TopicItem[]; notes: NoteItem[] } {
  if (typeof window === 'undefined') {
    return createInitialGuestState();
  }
  try {
    const raw = window.sessionStorage.getItem(GUEST_STORAGE_KEY);
    if (!raw) {
      return createInitialGuestState();
    }
    const parsed = JSON.parse(raw) as { topics?: TopicItem[]; notes?: NoteItem[] };
    if (!Array.isArray(parsed.topics) || !Array.isArray(parsed.notes) || parsed.topics.length === 0) {
      return createInitialGuestState();
    }
    return {
      topics: parsed.topics,
      notes: parsed.notes,
    };
  } catch {
    return createInitialGuestState();
  }
}

export function saveGuestWorkspace(topics: TopicItem[], notes: NoteItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(
      GUEST_STORAGE_KEY,
      JSON.stringify({ topics, notes }),
    );
  } catch {
    // Ignore restricted sessionStorage
  }
}

export function hasStoredGuestWorkspace(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.sessionStorage.getItem(GUEST_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { notes?: NoteItem[] };
    return Array.isArray(parsed.notes) && parsed.notes.some(isSubstantialGuestNote);
  } catch {
    return false;
  }
}

export function clearGuestWorkspace(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(GUEST_STORAGE_KEY);
  } catch {
    // Ignore restricted sessionStorage
  }
}

export function isSubstantialGuestNote(note: NoteItem): boolean {
  return (
    note.content.trim().length > 0 ||
    (note.title.trim().length > 0 && note.title.trim() !== '未命名研究筆記') ||
    note.courseRefs.length > 0
  );
}

export async function syncGuestWorkspaceToFirestore(
  uid: string,
  email: string,
  guestTopics: TopicItem[],
  guestNotes: NoteItem[],
  activeGuestNoteId: string | null,
): Promise<{
  topics: TopicItem[];
  notes: NoteItem[];
  shareBundles: ShareBundleItem[];
  syncedCount: number;
  mappedActiveNoteId: string | null;
}> {
  const cloud = await bootstrapOwnerWorkspace(uid, email);
  const currentTopics = [...cloud.topics];
  const topicIdMap = new Map<string, string>([['inbox', 'inbox']]);

  for (const guestTopic of guestTopics) {
    if (guestTopic.isSystemInbox || guestTopic.id === 'inbox') {
      topicIdMap.set(guestTopic.id, 'inbox');
      continue;
    }
    const hasNotesInTopic = guestNotes.some(
      (n) => n.topicId === guestTopic.id && isSubstantialGuestNote(n),
    );
    if (!hasNotesInTopic) continue;
    const syncedTopic = await createOrFindFirestoreTopic(
      uid,
      guestTopic.name,
      currentTopics,
    );
    if (!currentTopics.some((t) => t.id === syncedTopic.id)) {
      currentTopics.push(syncedTopic);
    }
    topicIdMap.set(guestTopic.id, syncedTopic.id);
  }

  const syncedNotes: NoteItem[] = [];
  let mappedActiveNoteId: string | null = null;

  for (const guestNote of guestNotes) {
    if (!isSubstantialGuestNote(guestNote)) {
      continue;
    }
    const targetTopicId = topicIdMap.get(guestNote.topicId) ?? 'inbox';
    const created = await createFirestoreNote(uid, {
      title: guestNote.title,
      content: guestNote.content,
      topicId: targetTopicId,
    });

    const pinnedRefs = [];
    for (const ref of guestNote.courseRefs) {
      const pinned = await pinFirestoreCourseRef(
        uid,
        created.id,
        {
          externalId: ref.id,
          type: ref.type,
          title: ref.title,
          provider: ref.provider,
          summary: ref.summary,
          url: ref.url,
        },
        pinnedRefs,
      );
      pinnedRefs.push(pinned);
    }

    const hydrated: NoteItem = {
      ...created,
      courseRefs: pinnedRefs,
    };
    syncedNotes.push(hydrated);
    if (guestNote.id === activeGuestNoteId) {
      mappedActiveNoteId = hydrated.id;
    }
  }

  clearGuestWorkspace();

  const mergedNotes = [...syncedNotes, ...cloud.notes];
  if (!mappedActiveNoteId && mergedNotes.length > 0) {
    mappedActiveNoteId = mergedNotes[0].id;
  }

  return {
    topics: currentTopics,
    notes: mergedNotes,
    shareBundles: cloud.shareBundles,
    syncedCount: syncedNotes.length,
    mappedActiveNoteId,
  };
}
