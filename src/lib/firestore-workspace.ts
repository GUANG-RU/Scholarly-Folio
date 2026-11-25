import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import type {
  CourseRefItem,
  CourseSearchResultItem,
  NoteItem,
  PublicShareBundle,
  ShareBundleItem,
  TopicItem,
} from '../types/workspace.ts';
import { auth, db } from './firebase.ts';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

function toIsoString(value: unknown): string {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  return new Date().toISOString();
}

export function normalizeTopicSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  if (slug) return slug;
  return `topic-${Date.now().toString(36)}`;
}

function generateSafeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function generateShareSlug(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function sanitizeHttpUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export async function bootstrapOwnerWorkspace(
  uid: string,
  email: string,
): Promise<{
  topics: TopicItem[];
  notes: NoteItem[];
  shareBundles: ShareBundleItem[];
}> {
  const userDocRef = doc(db, 'users', uid);
  const inboxRef = doc(db, 'users', uid, 'topics', 'inbox');

  let userSnap;
  try {
    userSnap = await getDoc(userDocRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `users/${uid}`);
  }

  let inboxSnap;
  try {
    inboxSnap = await getDoc(inboxRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `users/${uid}/topics/inbox`);
  }

  if (!userSnap.exists()) {
    try {
      await setDoc(userDocRef, {
        uid,
        email,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${uid}`);
    }
  } else if (userSnap.data()?.email !== email) {
    try {
      await updateDoc(userDocRef, {
        email,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
    }
  }

  if (!inboxSnap.exists()) {
    try {
      await setDoc(inboxRef, {
        id: 'inbox',
        userId: uid,
        name: 'Inbox',
        slug: 'inbox',
        sortOrder: 0,
        isSystemInbox: true,
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${uid}/topics/inbox`);
    }
  }

  const topicsPath = `users/${uid}/topics`;
  let topicsSnap;
  try {
    topicsSnap = await getDocs(
      query(collection(db, topicsPath), where('userId', '==', uid)),
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, topicsPath);
  }

  const topics: TopicItem[] = topicsSnap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: String(data.id ?? d.id),
        name: String(data.name ?? 'Inbox'),
        slug: String(data.slug ?? 'inbox'),
        sortOrder: Number(data.sortOrder ?? 0),
        isSystemInbox: Boolean(data.isSystemInbox),
        createdAt: toIsoString(data.createdAt),
      };
    })
    .sort((a, b) => {
      if (a.isSystemInbox !== b.isSystemInbox) return a.isSystemInbox ? -1 : 1;
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.createdAt.localeCompare(b.createdAt);
    });

  const notesPath = `users/${uid}/notes`;
  let notesSnap;
  try {
    notesSnap = await getDocs(
      query(collection(db, notesPath), where('userId', '==', uid)),
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, notesPath);
  }

  const notes: NoteItem[] = await Promise.all(
    notesSnap.docs.map(async (d) => {
      const data = d.data();
      const noteId = String(data.id ?? d.id);
      const refsPath = `users/${uid}/notes/${noteId}/course_refs`;
      let refsSnap;
      try {
        refsSnap = await getDocs(
          query(collection(db, refsPath), where('userId', '==', uid)),
        );
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, refsPath);
      }

      const courseRefs: CourseRefItem[] = refsSnap.docs
        .map((r) => {
          const rData = r.data();
          return {
            id: String(rData.id ?? r.id),
            noteId,
            type: (rData.type === 'PAPER' ? 'PAPER' : 'COURSE') as 'COURSE' | 'PAPER',
            title: String(rData.title ?? ''),
            provider: (rData.provider === 'OPENALEX' || rData.provider === 'MIT_OCW'
              ? rData.provider
              : 'CURATED_OCW') as 'MIT_OCW' | 'CURATED_OCW' | 'OPENALEX',
            summary: String(rData.summary ?? ''),
            url: String(rData.url ?? ''),
            createdAt: toIsoString(rData.createdAt),
          };
        })
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

      return {
        id: noteId,
        topicId: String(data.topicId ?? 'inbox'),
        title: String(data.title ?? '未命名研究筆記'),
        content: String(data.content ?? ''),
        status: (data.status === 'ARCHIVED' ? 'ARCHIVED' : 'DRAFT') as 'DRAFT' | 'ARCHIVED',
        tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
        summary: String(data.summary ?? ''),
        createdAt: toIsoString(data.createdAt),
        updatedAt: toIsoString(data.updatedAt),
        courseRefs,
      };
    }),
  );

  notes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  let bundlesSnap;
  try {
    bundlesSnap = await getDocs(
      query(collection(db, 'share_bundles'), where('userId', '==', uid)),
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'share_bundles');
  }

  const shareBundles: ShareBundleItem[] = bundlesSnap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: String(data.id ?? d.id),
        slug: String(data.slug ?? d.id),
        title: String(data.title ?? ''),
        createdAt: toIsoString(data.createdAt),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return { topics, notes, shareBundles };
}

export async function createOrFindFirestoreTopic(
  uid: string,
  name: string,
  existingTopics: TopicItem[],
): Promise<TopicItem> {
  const cleanName = name.trim().slice(0, 60) || 'Topic';
  const slug = normalizeTopicSlug(cleanName);
  const existing = existingTopics.find(
    (t) => t.slug === slug || t.name.toLowerCase() === cleanName.toLowerCase(),
  );
  if (existing) {
    return existing;
  }

  const topicId = generateSafeId();
  const sortOrder = Math.min(10000, existingTopics.length + 1);
  const path = `users/${uid}/topics/${topicId}`;
  const batch = writeBatch(db);
  batch.set(doc(db, path), {
    id: topicId,
    userId: uid,
    name: cleanName,
    slug,
    sortOrder,
    isSystemInbox: false,
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }

  return {
    id: topicId,
    name: cleanName,
    slug,
    sortOrder,
    isSystemInbox: false,
    createdAt: new Date().toISOString(),
  };
}

export async function deleteFirestoreTopic(
  uid: string,
  topicId: string,
  notes: NoteItem[],
): Promise<void> {
  if (topicId === 'inbox') {
    throw new Error('系統 Inbox 不可刪除');
  }
  const batch = writeBatch(db);
  for (const note of notes) {
    if (note.topicId === topicId) {
      batch.update(doc(db, `users/${uid}/notes/${note.id}`), {
        topicId: 'inbox',
        updatedAt: serverTimestamp(),
      });
    }
  }
  const path = `users/${uid}/topics/${topicId}`;
  batch.delete(doc(db, path));
  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function createFirestoreNote(
  uid: string,
  input: { title?: string; content?: string; topicId?: string },
): Promise<NoteItem> {
  const noteId = generateSafeId();
  const title = (input.title || '未命名研究筆記').trim().slice(0, 200) || '未命名研究筆記';
  const content = (input.content || '').slice(0, 100000);
  const topicId = input.topicId || 'inbox';
  const path = `users/${uid}/notes/${noteId}`;

  const batch = writeBatch(db);
  batch.set(doc(db, path), {
    id: noteId,
    userId: uid,
    topicId,
    title,
    content,
    status: 'DRAFT',
    tags: [],
    summary: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }

  const nowIso = new Date().toISOString();
  return {
    id: noteId,
    topicId,
    title,
    content,
    status: 'DRAFT',
    tags: [],
    summary: '',
    createdAt: nowIso,
    updatedAt: nowIso,
    courseRefs: [],
  };
}

export async function updateFirestoreNote(
  uid: string,
  noteId: string,
  patch: { title?: string; content?: string; topicId?: string },
): Promise<string> {
  const path = `users/${uid}/notes/${noteId}`;
  const updatePayload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  if (patch.title !== undefined) {
    updatePayload.title = patch.title.trim().slice(0, 200) || '未命名研究筆記';
  }
  if (patch.content !== undefined) {
    updatePayload.content = patch.content.slice(0, 100000);
  }
  if (patch.topicId !== undefined) {
    updatePayload.topicId = patch.topicId;
  }

  const batch = writeBatch(db);
  batch.update(doc(db, path), updatePayload);

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }

  return new Date().toISOString();
}

export async function archiveFirestoreNoteWithTopic(
  uid: string,
  noteId: string,
  payload: {
    title: string;
    content: string;
    targetTopicId: string;
    suggestedNewTopicName: string | null;
    tags: string[];
    summary: string;
    degraded: boolean;
    existingTopics: TopicItem[];
  },
): Promise<{
  finalTopicId: string;
  createdTopic: TopicItem | null;
  updatedAt: string;
}> {
  const cleanTitle = payload.title.trim().slice(0, 200) || '未命名研究筆記';
  const cleanContent = payload.content.slice(0, 100000);
  const cleanTags = payload.tags.map((t) => t.trim().slice(0, 24)).filter(Boolean).slice(0, 3);
  const cleanSummary = payload.summary.slice(0, 300);

  let finalTopicId = payload.targetTopicId || 'inbox';
  let createdTopic: TopicItem | null = null;

  if (payload.suggestedNewTopicName && !payload.degraded) {
    const cleanName = payload.suggestedNewTopicName.trim().slice(0, 60) || 'Topic';
    const slug = normalizeTopicSlug(cleanName);
    const existing = payload.existingTopics.find(
      (t) => t.slug === slug || t.name.toLowerCase() === cleanName.toLowerCase(),
    );
    if (existing) {
      finalTopicId = existing.id;
    } else {
      const topicId = generateSafeId();
      const sortOrder = Math.min(10000, payload.existingTopics.length + 1);
      const topicPath = `users/${uid}/topics/${topicId}`;
      try {
        await setDoc(doc(db, topicPath), {
          id: topicId,
          userId: uid,
          name: cleanName,
          slug,
          sortOrder,
          isSystemInbox: false,
          createdAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, topicPath);
      }
      createdTopic = {
        id: topicId,
        name: cleanName,
        slug,
        sortOrder,
        isSystemInbox: false,
        createdAt: new Date().toISOString(),
      };
      finalTopicId = topicId;
    }
  } else if (payload.degraded) {
    finalTopicId = 'inbox';
  }

  const notePath = `users/${uid}/notes/${noteId}`;
  try {
    await updateDoc(doc(db, notePath), {
      title: cleanTitle,
      content: cleanContent,
      topicId: finalTopicId,
      status: 'ARCHIVED',
      tags: cleanTags,
      summary: cleanSummary,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, notePath);
  }

  return {
    finalTopicId,
    createdTopic,
    updatedAt: new Date().toISOString(),
  };
}

export async function deleteFirestoreNote(
  uid: string,
  noteId: string,
  courseRefs: CourseRefItem[],
): Promise<void> {
  const batch = writeBatch(db);
  for (const ref of courseRefs) {
    batch.delete(doc(db, `users/${uid}/notes/${noteId}/course_refs/${ref.id}`));
  }
  const path = `users/${uid}/notes/${noteId}`;
  batch.delete(doc(db, path));
  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function pinFirestoreCourseRef(
  uid: string,
  noteId: string,
  item: CourseSearchResultItem,
  existingRefs: CourseRefItem[],
): Promise<CourseRefItem> {
  const safeUrl = sanitizeHttpUrl(item.url);
  if (!safeUrl) {
    throw new Error('僅允許 http 或 https 安全連結');
  }
  const dup = existingRefs.find((r) => r.url === safeUrl);
  if (dup) return dup;

  const refId = generateSafeId();
  const path = `users/${uid}/notes/${noteId}/course_refs/${refId}`;
  const batch = writeBatch(db);
  batch.set(doc(db, path), {
    id: refId,
    noteId,
    userId: uid,
    type: item.type,
    title: item.title.trim().slice(0, 300),
    provider: item.provider,
    summary: item.summary.slice(0, 600),
    url: safeUrl.slice(0, 1000),
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }

  return {
    id: refId,
    noteId,
    type: item.type,
    title: item.title.trim().slice(0, 300),
    provider: item.provider,
    summary: item.summary.slice(0, 600),
    url: safeUrl.slice(0, 1000),
    createdAt: new Date().toISOString(),
  };
}

export async function unpinFirestoreCourseRef(
  uid: string,
  noteId: string,
  refId: string,
): Promise<void> {
  const path = `users/${uid}/notes/${noteId}/course_refs/${refId}`;
  const batch = writeBatch(db);
  batch.delete(doc(db, path));
  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function createFirestoreShareBundle(
  uid: string,
  title: string,
  selectedNotes: NoteItem[],
): Promise<ShareBundleItem> {
  const cleanTitle = title.trim().slice(0, 120);
  if (!cleanTitle || selectedNotes.length === 0 || selectedNotes.length > 50) {
    throw new Error('請至少選取一篇筆記並填寫分享包標題');
  }

  const slug = generateShareSlug();
  const bundlePath = `share_bundles/${slug}`;

  try {
    await setDoc(doc(db, bundlePath), {
      id: slug,
      slug,
      userId: uid,
      title: cleanTitle,
      noteCount: selectedNotes.length,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, bundlePath);
  }

  const batch = writeBatch(db);
  selectedNotes.forEach((note, index) => {
    const cleanRefs = note.courseRefs
      .slice(0, 25)
      .map((r) => ({
        id: r.id,
        type: r.type,
        title: r.title.slice(0, 300),
        provider: r.provider,
        summary: r.summary.slice(0, 600),
        url: sanitizeHttpUrl(r.url) ?? 'https://ocw.mit.edu',
      }));

    batch.set(doc(db, `share_bundles/${slug}/items/${note.id}`), {
      id: note.id,
      bundleSlug: slug,
      userId: uid,
      title: note.title.slice(0, 200),
      content: note.content.slice(0, 100000),
      tags: note.tags.map((t) => t.slice(0, 24)).slice(0, 3),
      summary: note.summary.slice(0, 300),
      updatedAtIso: note.updatedAt.slice(0, 64),
      sortOrder: index,
      courseRefs: cleanRefs,
    });
  });

  try {
    await batch.commit();
  } catch (error) {
    await deleteDoc(doc(db, bundlePath)).catch(() => undefined);
    handleFirestoreError(error, OperationType.CREATE, `${bundlePath}/items`);
  }

  return {
    id: slug,
    slug,
    title: cleanTitle,
    createdAt: new Date().toISOString(),
  };
}

export async function deleteFirestoreShareBundle(
  uid: string,
  slug: string,
): Promise<void> {
  const itemsPath = `share_bundles/${slug}/items`;
  let itemsSnap;
  try {
    itemsSnap = await getDocs(
      query(collection(db, itemsPath), where('userId', '==', uid)),
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, itemsPath);
  }

  const batch = writeBatch(db);
  for (const itemDoc of itemsSnap.docs) {
    batch.delete(itemDoc.ref);
  }
  const bundlePath = `share_bundles/${slug}`;
  batch.delete(doc(db, bundlePath));

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, bundlePath);
  }
}

export async function getPublicFirestoreShareBundle(
  slug: string,
): Promise<PublicShareBundle | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(slug)) {
    return null;
  }
  const bundlePath = `share_bundles/${slug}`;
  let bundleSnap;
  try {
    bundleSnap = await getDoc(doc(db, bundlePath));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, bundlePath);
  }

  if (!bundleSnap.exists()) {
    return null;
  }

  const bundleData = bundleSnap.data();
  const itemsPath = `share_bundles/${slug}/items`;
  let itemsSnap;
  try {
    itemsSnap = await getDocs(collection(db, itemsPath));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, itemsPath);
  }

  const notes = itemsSnap.docs
    .map((d) => {
      const data = d.data();
      return {
        sortOrder: Number(data.sortOrder ?? 0),
        id: String(data.id ?? d.id),
        title: String(data.title ?? ''),
        content: String(data.content ?? ''),
        tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
        summary: String(data.summary ?? ''),
        updatedAt: String(data.updatedAtIso ?? toIsoString(bundleData.createdAt)),
        courseRefs: Array.isArray(data.courseRefs)
          ? (data.courseRefs as PublicShareBundle['notes'][number]['courseRefs'])
          : [],
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(({ sortOrder: _sortOrder, ...rest }) => rest);

  return {
    slug: String(bundleData.slug ?? slug),
    title: String(bundleData.title ?? ''),
    createdAt: toIsoString(bundleData.createdAt),
    notes,
  };
}
