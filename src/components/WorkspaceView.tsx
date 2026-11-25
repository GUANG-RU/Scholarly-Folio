import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  Archive,
  BookOpen,
  Cloud,
  Compass,
  ExternalLink,
  Eye,
  FolderPlus,
  LogOut,
  Menu,
  Package,
  PenLine,
  Plus,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  apiDownloadDocx,
  apiDownloadZip,
  apiFetch,
  apiSearchCourses,
} from '../lib/client-api.ts';
import { auth } from '../lib/firebase.ts';
import {
  archiveFirestoreNoteWithTopic,
  bootstrapOwnerWorkspace,
  createFirestoreNote,
  createFirestoreShareBundle,
  createOrFindFirestoreTopic,
  deleteFirestoreNote,
  deleteFirestoreShareBundle,
  deleteFirestoreTopic,
  pinFirestoreCourseRef,
  unpinFirestoreCourseRef,
  updateFirestoreNote,
} from '../lib/firestore-workspace.ts';
import {
  hasStoredGuestWorkspace,
  isSubstantialGuestNote,
  loadGuestWorkspace,
  saveGuestWorkspace,
  syncGuestWorkspaceToFirestore,
} from '../lib/guest-workspace.ts';
import { performZeroResidueLogout } from '../lib/logout.ts';
import type {
  CourseRefItem,
  CourseSearchResultItem,
  NoteItem,
  ShareBundleItem,
  TopicItem,
} from '../types/workspace.ts';
import { CloudSignInModal } from './CloudSignInModal.tsx';
import { LogoutConfirmModal } from './LogoutConfirmModal.tsx';
import { MarkdownReader } from './MarkdownReader.tsx';
import { PackShareModal } from './PackShareModal.tsx';
import { ReferenceDrawer } from './ReferenceDrawer.tsx';

type PendingCloudAction = 'signin' | 'save' | 'archive' | 'pack_share' | 'pack_drive' | null;

type WorkspaceViewProps = {
  user: User | null;
  onUnauthorized: (msg?: string) => void;
};

export function WorkspaceView({ user, onUnauthorized }: WorkspaceViewProps) {
  const isAuthenticated = Boolean(user && user.email && user.emailVerified);

  const [loading, setLoading] = useState<boolean>(() => Boolean(user));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ownerEmail, setOwnerEmail] = useState<string>('');
  const [topics, setTopics] = useState<TopicItem[]>([]);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [shareBundles, setShareBundles] = useState<ShareBundleItem[]>([]);

  const [selectedTopicFilter, setSelectedTopicFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);

  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');

  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false,
  );
  const [isReadMode, setIsReadMode] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false,
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [newTopicOpen, setNewTopicOpen] = useState(false);
  const [newTopicName, setNewTopicName] = useState('');

  const [savingDraft, setSavingDraft] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [feedbackNotice, setFeedbackNotice] = useState<{
    tone: 'neutral' | 'warn' | 'error';
    text: string;
  } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // On-demand Reference Drawer state (strictly closed & silent by default)
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerKeywords, setDrawerKeywords] = useState('');
  const [drawerItems, setDrawerItems] = useState<CourseSearchResultItem[]>([]);
  const [drawerDegraded, setDrawerDegraded] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);

  const [packModalOpen, setPackModalOpen] = useState(false);
  const [packInitialTab, setPackInitialTab] = useState<'drive' | 'share' | undefined>(undefined);
  const [logoutModalOpen, setLogoutModalOpen] = useState(false);
  const [loggingOutWithSave, setLoggingOutWithSave] = useState(false);

  // On-demand Cloud Sign-In modal state
  const [signInModalOpen, setSignInModalOpen] = useState(false);
  const [signInModalReason, setSignInModalReason] = useState<string | null>(null);
  const [pendingCloudAction, setPendingCloudAction] = useState<PendingCloudAction>(null);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const signInModalOpenRef = useRef(false);
  const prevUserUidRef = useRef<string | null | undefined>(undefined);

  const activeNote = useMemo(
    () => notes.find((n) => n.id === activeNoteId) ?? null,
    [notes, activeNoteId],
  );

  const isDirty = useMemo(() => {
    if (!activeNote || !isAuthenticated) return false;
    return draftTitle !== activeNote.title || draftContent !== activeNote.content;
  }, [activeNote, isAuthenticated, draftTitle, draftContent]);

  const hasUnsavedGuestNotes = useMemo(
    () => !isAuthenticated && notes.some(isSubstantialGuestNote),
    [isAuthenticated, notes],
  );

  const openCloudLoginModal = useCallback(
    (reason: string, action: PendingCloudAction) => {
      signInModalOpenRef.current = true;
      setSignInModalReason(reason);
      setPendingCloudAction(action);
      setSignInModalOpen(true);
    },
    [],
  );

  const closeCloudLoginModal = useCallback(() => {
    signInModalOpenRef.current = false;
    setSignInModalOpen(false);
    setSignInModalReason(null);
    setPendingCloudAction(null);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const handleChange = (e: MediaQueryListEvent) => {
      setIsMobileViewport(e.matches);
      if (e.matches) {
        setIsReadMode(true);
        setDrawerOpen(false);
      }
    };
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, []);

  const loadLocalGuestState = useCallback(() => {
    const guest = loadGuestWorkspace();
    setOwnerEmail('');
    setTopics(guest.topics);
    setNotes(guest.notes);
    setShareBundles([]);
    setSelectedTopicFilter('ALL');
    setSearchQuery('');
    if (guest.notes.length > 0) {
      setActiveNoteId(guest.notes[0].id);
      setDraftTitle(guest.notes[0].title);
      setDraftContent(guest.notes[0].content);
    } else {
      setActiveNoteId(null);
      setDraftTitle('');
      setDraftContent('');
    }
    setLoadError(null);
    setLoading(false);
  }, []);

  const fetchCloudWorkspace = useCallback(
    async (targetUser: User) => {
      setLoading(true);
      setLoadError(null);
      try {
        if (!targetUser.email || !targetUser.emailVerified) {
          onUnauthorized('請使用已完成 Email 驗證的 Google 帳號登入');
          return;
        }
        if (hasStoredGuestWorkspace()) {
          const guest = loadGuestWorkspace();
          const synced = await syncGuestWorkspaceToFirestore(
            targetUser.uid,
            targetUser.email,
            guest.topics,
            guest.notes,
            guest.notes[0]?.id ?? null,
          );
          setOwnerEmail(targetUser.email);
          setTopics(synced.topics);
          setNotes(synced.notes);
          setShareBundles(synced.shareBundles);
          const targetActive =
            synced.notes.find((n) => n.id === synced.mappedActiveNoteId) ??
            synced.notes[0] ??
            null;
          setActiveNoteId(targetActive?.id ?? null);
          setDraftTitle(targetActive?.title ?? '');
          setDraftContent(targetActive?.content ?? '');
        } else {
          const data = await bootstrapOwnerWorkspace(targetUser.uid, targetUser.email);
          setOwnerEmail(targetUser.email);
          setTopics(data.topics);
          setNotes(data.notes);
          setShareBundles(data.shareBundles);
          if (data.notes.length > 0) {
            const first = data.notes[0];
            setActiveNoteId(first.id);
            setDraftTitle(first.title);
            setDraftContent(first.content);
          } else {
            setActiveNoteId(null);
            setDraftTitle('');
            setDraftContent('');
          }
        }
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : '無法載入工作區');
      } finally {
        setLoading(false);
      }
    },
    [onUnauthorized],
  );

  useEffect(() => {
    const nextUid = user?.uid ?? null;
    const prevUid = prevUserUidRef.current;
    prevUserUidRef.current = nextUid;

    if (!user) {
      if (prevUid !== undefined && prevUid !== null) {
        // Transitioned from signed-in to signed-out
        loadLocalGuestState();
      } else if (prevUid === undefined) {
        // Initial mount in guest mode
        loadLocalGuestState();
      }
      return;
    }

    if (!user.email || !user.emailVerified) {
      onUnauthorized('請使用已完成 Email 驗證的 Google 帳號登入');
      return;
    }

    // When CloudSignInModal is actively handling the guest -> cloud transition,
    // let handleCloudAuthenticated own the sync to avoid duplicate calls.
    if (signInModalOpenRef.current) {
      return;
    }

    if (prevUid !== nextUid) {
      void fetchCloudWorkspace(user);
    }
  }, [user, loadLocalGuestState, fetchCloudWorkspace, onUnauthorized]);

  const selectNote = useCallback(
    (note: NoteItem) => {
      setActiveNoteId(note.id);
      setDraftTitle(note.title);
      setDraftContent(note.content);
      setConfirmDeleteId(null);
      setFeedbackNotice(null);
      if (isMobileViewport) {
        setMobileNavOpen(false);
        setIsReadMode(true);
      }
    },
    [isMobileViewport],
  );

  const handleDraftTitleChange = useCallback(
    (nextTitle: string) => {
      setDraftTitle(nextTitle);
      if (!isAuthenticated && activeNoteId) {
        const nowIso = new Date().toISOString();
        setNotes((prev) => {
          const updated = prev.map((n) =>
            n.id === activeNoteId ? { ...n, title: nextTitle, updatedAt: nowIso } : n,
          );
          saveGuestWorkspace(topics, updated);
          return updated;
        });
      }
    },
    [isAuthenticated, activeNoteId, topics],
  );

  const handleDraftContentChange = useCallback(
    (nextContent: string) => {
      setDraftContent(nextContent);
      if (!isAuthenticated && activeNoteId) {
        const nowIso = new Date().toISOString();
        setNotes((prev) => {
          const updated = prev.map((n) =>
            n.id === activeNoteId ? { ...n, content: nextContent, updatedAt: nowIso } : n,
          );
          saveGuestWorkspace(topics, updated);
          return updated;
        });
      }
    },
    [isAuthenticated, activeNoteId, topics],
  );

  const handleCreateNote = useCallback(async () => {
    const targetTopicId = selectedTopicFilter !== 'ALL' ? selectedTopicFilter : 'inbox';

    if (!isAuthenticated) {
      const nowIso = new Date().toISOString();
      const guestNote: NoteItem = {
        id: `guest-note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        topicId: targetTopicId,
        title: '未命名研究筆記',
        content: '',
        status: 'DRAFT',
        tags: [],
        summary: '',
        createdAt: nowIso,
        updatedAt: nowIso,
        courseRefs: [],
      };
      setNotes((prev) => {
        const next = [guestNote, ...prev];
        saveGuestWorkspace(topics, next);
        return next;
      });
      setActiveNoteId(guestNote.id);
      setDraftTitle(guestNote.title);
      setDraftContent(guestNote.content);
      setIsReadMode(false);
      setMobileNavOpen(false);
      setFeedbackNotice({ tone: 'neutral', text: '已建立新本機筆記草稿' });
      return;
    }

    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      const createdNote = await createFirestoreNote(uid, {
        title: '未命名研究筆記',
        content: '',
        topicId: targetTopicId,
      });
      setNotes((prev) => [createdNote, ...prev]);
      setActiveNoteId(createdNote.id);
      setDraftTitle(createdNote.title);
      setDraftContent(createdNote.content);
      setIsReadMode(false);
      setMobileNavOpen(false);
      setFeedbackNotice({ tone: 'neutral', text: '已建立新筆記草稿' });
    } catch (err) {
      setFeedbackNotice({
        tone: 'error',
        text: err instanceof Error ? err.message : '無法建立筆記',
      });
    }
  }, [isAuthenticated, selectedTopicFilter, topics]);

  const handleSaveDraft = useCallback(async (): Promise<boolean> => {
    if (!activeNote) return false;
    if (!isAuthenticated) {
      openCloudLoginModal(
        '目前為本機撰寫模式，登入 Google 帳號後即可將筆記同步儲存至您的個人雲端空間。',
        'save',
      );
      return false;
    }
    const uid = auth.currentUser?.uid;
    if (!uid) return false;
    setSavingDraft(true);
    setFeedbackNotice(null);
    try {
      const updatedAt = await updateFirestoreNote(uid, activeNote.id, {
        title: draftTitle,
        content: draftContent,
      });
      const cleanTitle = draftTitle.trim().slice(0, 200) || '未命名研究筆記';
      setNotes((prev) =>
        prev.map((n) =>
          n.id === activeNote.id
            ? { ...n, title: cleanTitle, content: draftContent, updatedAt }
            : n,
        ),
      );
      setDraftTitle(cleanTitle);
      setFeedbackNotice({ tone: 'neutral', text: '草稿已儲存至雲端' });
      return true;
    } catch (err) {
      setFeedbackNotice({
        tone: 'error',
        text: err instanceof Error ? err.message : '儲存失敗',
      });
      return false;
    } finally {
      setSavingDraft(false);
    }
  }, [activeNote, isAuthenticated, openCloudLoginModal, draftTitle, draftContent]);

  const runAiArchiveForNote = useCallback(
    async (
      uid: string,
      targetNote: NoteItem,
      titleToArchive: string,
      contentToArchive: string,
      currentTopics: TopicItem[],
    ) => {
      setOrganizing(true);
      setFeedbackNotice(null);
      try {
        await updateFirestoreNote(uid, targetNote.id, {
          title: titleToArchive,
          content: contentToArchive,
        });

        let aiResult: {
          targetTopicId: string;
          suggestedNewTopicName: string | null;
          tags: string[];
          summary: string;
          degraded: boolean;
        };
        try {
          aiResult = await apiFetch('/api/ai/organize', {
            method: 'POST',
            body: JSON.stringify({
              title: titleToArchive,
              content: contentToArchive,
              existingTopics: currentTopics.map((t) => ({
                id: t.id,
                name: t.name,
                isSystemInbox: t.isSystemInbox,
              })),
            }),
          });
        } catch {
          aiResult = {
            targetTopicId: 'inbox',
            suggestedNewTopicName: null,
            tags: [],
            summary: '',
            degraded: true,
          };
        }

        const persisted = await archiveFirestoreNoteWithTopic(uid, targetNote.id, {
          title: titleToArchive,
          content: contentToArchive,
          targetTopicId: aiResult.targetTopicId,
          suggestedNewTopicName: aiResult.suggestedNewTopicName,
          tags: aiResult.tags,
          summary: aiResult.summary,
          degraded: aiResult.degraded,
          existingTopics: currentTopics,
        });

        const nextTopics = persisted.createdTopic
          ? [...currentTopics, persisted.createdTopic]
          : currentTopics;
        setTopics(nextTopics);

        const cleanTitle = titleToArchive.trim().slice(0, 200) || '未命名研究筆記';
        setNotes((prev) =>
          prev.map((n) =>
            n.id === targetNote.id
              ? {
                  ...n,
                  title: cleanTitle,
                  content: contentToArchive,
                  topicId: persisted.finalTopicId,
                  status: 'ARCHIVED',
                  tags: aiResult.tags,
                  summary: aiResult.summary,
                  updatedAt: persisted.updatedAt,
                }
              : n,
          ),
        );
        setDraftTitle(cleanTitle);

        const targetTopic = nextTopics.find((t) => t.id === persisted.finalTopicId);
        if (aiResult.degraded) {
          setFeedbackNotice({
            tone: 'warn',
            text: 'AI 分類連線超時，筆記已完整存回雲端並暫存於 Inbox，可隨時手動改移主題。',
          });
        } else {
          setFeedbackNotice({
            tone: 'neutral',
            text: `已歸檔至「${targetTopic?.name ?? 'Inbox'}」並標記標籤。`,
          });
        }
      } catch (err) {
        setFeedbackNotice({
          tone: 'error',
          text: err instanceof Error ? err.message : '歸檔失敗，請先儲存草稿',
        });
      } finally {
        setOrganizing(false);
      }
    },
    [],
  );

  const handleOrganizeAndArchive = useCallback(async () => {
    if (!activeNote) return;
    if (!draftTitle.trim()) {
      setFeedbackNotice({ tone: 'warn', text: '請先填寫筆記標題再進行自動歸檔。' });
      return;
    }
    if (!isAuthenticated) {
      openCloudLoginModal(
        '「完成並歸檔」會使用 AI 自動分類主題並將筆記儲存至雲端，請先登入 Google 帳號。',
        'archive',
      );
      return;
    }
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await runAiArchiveForNote(uid, activeNote, draftTitle, draftContent, topics);
  }, [
    activeNote,
    draftTitle,
    draftContent,
    isAuthenticated,
    openCloudLoginModal,
    runAiArchiveForNote,
    topics,
  ]);

  const handleCloudAuthenticated = useCallback(
    async ({ uid, email }: { uid: string; email: string }) => {
      const actionAfterSync = pendingCloudAction;
      const latestNotes = notes.map((n) =>
        n.id === activeNoteId ? { ...n, title: draftTitle, content: draftContent } : n,
      );

      const synced = await syncGuestWorkspaceToFirestore(
        uid,
        email,
        topics,
        latestNotes,
        activeNoteId,
      );

      setOwnerEmail(email);
      setTopics(synced.topics);
      setNotes(synced.notes);
      setShareBundles(synced.shareBundles);

      const syncedActiveNote =
        synced.notes.find((n) => n.id === synced.mappedActiveNoteId) ??
        synced.notes[0] ??
        null;
      setActiveNoteId(syncedActiveNote?.id ?? null);
      setDraftTitle(syncedActiveNote?.title ?? '');
      setDraftContent(syncedActiveNote?.content ?? '');

      closeCloudLoginModal();

      if (
        actionAfterSync === 'archive' &&
        syncedActiveNote &&
        syncedActiveNote.title.trim()
      ) {
        await runAiArchiveForNote(
          uid,
          syncedActiveNote,
          syncedActiveNote.title,
          syncedActiveNote.content,
          synced.topics,
        );
        return;
      }

      if (actionAfterSync === 'pack_share' || actionAfterSync === 'pack_drive') {
        setPackInitialTab(actionAfterSync === 'pack_drive' ? 'drive' : 'share');
        setPackModalOpen(true);
      }

      setFeedbackNotice({
        tone: 'neutral',
        text:
          synced.syncedCount > 0
            ? `已登入雲端帳號（${email}），並自動同步 ${synced.syncedCount} 篇本機筆記至雲端。`
            : `已登入雲端帳號（${email}）。`,
      });
    },
    [
      pendingCloudAction,
      notes,
      activeNoteId,
      draftTitle,
      draftContent,
      topics,
      closeCloudLoginModal,
      runAiArchiveForNote,
    ],
  );

  const handleMoveTopic = async (topicId: string) => {
    if (!activeNote || topicId === activeNote.topicId) return;
    if (!isAuthenticated) {
      const nowIso = new Date().toISOString();
      setNotes((prev) => {
        const next = prev.map((n) =>
          n.id === activeNote.id ? { ...n, topicId, updatedAt: nowIso } : n,
        );
        saveGuestWorkspace(topics, next);
        return next;
      });
      const target = topics.find((t) => t.id === topicId);
      setFeedbackNotice({
        tone: 'neutral',
        text: `已移動至「${target?.name ?? 'Inbox'}」`,
      });
      return;
    }

    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      const updatedAt = await updateFirestoreNote(uid, activeNote.id, { topicId });
      setNotes((prev) =>
        prev.map((n) =>
          n.id === activeNote.id ? { ...n, topicId, updatedAt } : n,
        ),
      );
      const target = topics.find((t) => t.id === topicId);
      setFeedbackNotice({
        tone: 'neutral',
        text: `已移動至「${target?.name ?? 'Inbox'}」`,
      });
    } catch (err) {
      setFeedbackNotice({
        tone: 'error',
        text: err instanceof Error ? err.message : '移動主題失敗',
      });
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    if (!isAuthenticated) {
      const remaining = notes.filter((n) => n.id !== noteId);
      setNotes(remaining);
      saveGuestWorkspace(topics, remaining);
      setConfirmDeleteId(null);
      if (activeNoteId === noteId) {
        if (remaining.length > 0) {
          setActiveNoteId(remaining[0].id);
          setDraftTitle(remaining[0].title);
          setDraftContent(remaining[0].content);
        } else {
          setActiveNoteId(null);
          setDraftTitle('');
          setDraftContent('');
        }
      }
      setFeedbackNotice({ tone: 'neutral', text: '已刪除本機筆記' });
      return;
    }

    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      const target = notes.find((n) => n.id === noteId);
      await deleteFirestoreNote(uid, noteId, target?.courseRefs ?? []);
      const remaining = notes.filter((n) => n.id !== noteId);
      setNotes(remaining);
      setConfirmDeleteId(null);
      if (activeNoteId === noteId) {
        if (remaining.length > 0) {
          setActiveNoteId(remaining[0].id);
          setDraftTitle(remaining[0].title);
          setDraftContent(remaining[0].content);
        } else {
          setActiveNoteId(null);
          setDraftTitle('');
          setDraftContent('');
        }
      }
      setFeedbackNotice({ tone: 'neutral', text: '已刪除筆記' });
    } catch (err) {
      setFeedbackNotice({
        tone: 'error',
        text: err instanceof Error ? err.message : '刪除失敗',
      });
    }
  };

  const handleCreateTopic = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newTopicName.trim();
    if (!trimmed) return;

    if (!isAuthenticated) {
      const existing = topics.find(
        (t) => t.name.toLowerCase() === trimmed.toLowerCase(),
      );
      if (!existing) {
        const guestTopic: TopicItem = {
          id: `guest-topic-${Date.now().toString(36)}`,
          name: trimmed,
          slug: trimmed.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-') || 'topic',
          sortOrder: topics.length,
          isSystemInbox: false,
          createdAt: new Date().toISOString(),
        };
        const nextTopics = [...topics, guestTopic];
        setTopics(nextTopics);
        saveGuestWorkspace(nextTopics, notes);
      }
      setNewTopicName('');
      setNewTopicOpen(false);
      return;
    }

    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      const topic = await createOrFindFirestoreTopic(uid, trimmed, topics);
      setTopics((prev) => {
        if (prev.some((t) => t.id === topic.id)) return prev;
        return [...prev, topic];
      });
      setNewTopicName('');
      setNewTopicOpen(false);
    } catch (err) {
      setFeedbackNotice({
        tone: 'error',
        text: err instanceof Error ? err.message : '建立主題失敗',
      });
    }
  };

  const handleDeleteTopic = async (topicId: string) => {
    if (!isAuthenticated) {
      const target = topics.find((t) => t.id === topicId);
      if (!target || target.isSystemInbox) return;
      const nextTopics = topics.filter((t) => t.id !== topicId);
      const nextNotes = notes.map((n) =>
        n.topicId === topicId ? { ...n, topicId: 'inbox' } : n,
      );
      setTopics(nextTopics);
      setNotes(nextNotes);
      saveGuestWorkspace(nextTopics, nextNotes);
      if (selectedTopicFilter === topicId) {
        setSelectedTopicFilter('ALL');
      }
      return;
    }

    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      await deleteFirestoreTopic(uid, topicId, notes);
      setTopics((prev) => prev.filter((t) => t.id !== topicId));
      setNotes((prev) =>
        prev.map((n) => (n.topicId === topicId ? { ...n, topicId: 'inbox' } : n)),
      );
      if (selectedTopicFilter === topicId) {
        setSelectedTopicFilter('ALL');
      }
    } catch (err) {
      setFeedbackNotice({
        tone: 'error',
        text: err instanceof Error ? err.message : '無法刪除主題',
      });
    }
  };

  const triggerCourseSearch = useCallback(
    async (customQuery?: string) => {
      if (!activeNote) return;
      setDrawerOpen(true);
      setDrawerLoading(true);
      setDrawerError(null);
      setDrawerDegraded(false);
      try {
        const res = await apiSearchCourses<{
          keywords: string;
          items: CourseSearchResultItem[];
          degraded: boolean;
        }>({
          title: customQuery || draftTitle || activeNote.title,
          content: customQuery ? '' : draftContent,
          limit: 4,
        });
        setDrawerKeywords(res.keywords);
        setDrawerItems(res.items);
        setDrawerDegraded(res.degraded);
      } catch (err) {
        setDrawerError(
          err instanceof Error ? err.message : '外部課程檢索發生錯誤',
        );
      } finally {
        setDrawerLoading(false);
      }
    },
    [activeNote, draftTitle, draftContent],
  );

  const handlePinRef = async (item: CourseSearchResultItem) => {
    if (!activeNote) return;
    if (!isAuthenticated) {
      const localRef: CourseRefItem = {
        id: item.externalId || `guest-ref-${Date.now().toString(36)}`,
        noteId: activeNote.id,
        type: item.type,
        title: item.title,
        provider: item.provider,
        summary: item.summary,
        url: item.url,
        createdAt: new Date().toISOString(),
      };
      setNotes((prev) => {
        const next = prev.map((n) =>
          n.id === activeNote.id
            ? {
                ...n,
                courseRefs: n.courseRefs.some((r) => r.url === localRef.url)
                  ? n.courseRefs
                  : [...n.courseRefs, localRef],
              }
            : n,
        );
        saveGuestWorkspace(topics, next);
        return next;
      });
      return;
    }

    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const pinnedRef = await pinFirestoreCourseRef(
      uid,
      activeNote.id,
      item,
      activeNote.courseRefs,
    );
    setNotes((prev) =>
      prev.map((n) =>
        n.id === activeNote.id
          ? {
              ...n,
              courseRefs: n.courseRefs.some((r) => r.id === pinnedRef.id)
                ? n.courseRefs
                : [...n.courseRefs, pinnedRef],
            }
          : n,
      ),
    );
  };

  const handleUnpinRef = async (refId: string) => {
    if (!activeNote) return;
    if (!isAuthenticated) {
      setNotes((prev) => {
        const next = prev.map((n) =>
          n.id === activeNote.id
            ? { ...n, courseRefs: n.courseRefs.filter((r) => r.id !== refId) }
            : n,
        );
        saveGuestWorkspace(topics, next);
        return next;
      });
      return;
    }

    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      await unpinFirestoreCourseRef(uid, activeNote.id, refId);
      setNotes((prev) =>
        prev.map((n) =>
          n.id === activeNote.id
            ? { ...n, courseRefs: n.courseRefs.filter((r) => r.id !== refId) }
            : n,
        ),
      );
    } catch (err) {
      setFeedbackNotice({
        tone: 'error',
        text: err instanceof Error ? err.message : '移除參考資料失敗',
      });
    }
  };

  // Keyboard shortcuts: Ctrl/Cmd+S to save draft, Alt+R to summon reference drawer on demand
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (activeNote && !isReadMode) {
          if (isAuthenticated) {
            void handleSaveDraft();
          } else {
            saveGuestWorkspace(topics, notes);
            setFeedbackNotice({
              tone: 'neutral',
              text: '已暫存於本機瀏覽器；若需雲端備份，請點擊「儲存至雲端」。',
            });
          }
        }
      } else if (e.altKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        if (activeNote) {
          void triggerCourseSearch();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeNote, isReadMode, isAuthenticated, topics, notes, handleSaveDraft, triggerCourseSearch]);

  const handleLogoutRequest = () => {
    if (isDirty) {
      setLogoutModalOpen(true);
      return;
    }
    void performZeroResidueLogout(true);
  };

  const handleSaveAndLogout = async () => {
    setLoggingOutWithSave(true);
    const saved = await handleSaveDraft();
    setLoggingOutWithSave(false);
    if (saved) {
      setLogoutModalOpen(false);
      await performZeroResidueLogout(true);
    }
  };

  const handleCreateShareBundle = async (title: string, noteIds: string[]) => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      throw new Error('請先登入');
    }
    const selectedNotes = notes.filter((n) => noteIds.includes(n.id));
    const bundle = await createFirestoreShareBundle(uid, title, selectedNotes);
    setShareBundles((prev) => [bundle, ...prev]);
    return bundle;
  };

  const handleDeleteShareBundle = async (bundleId: string) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await deleteFirestoreShareBundle(uid, bundleId);
    setShareBundles((prev) => prev.filter((b) => b.id !== bundleId));
  };

  const handleDownloadZip = async (noteIds: string[]) => {
    const selectedNotes = notes.filter((n) => noteIds.includes(n.id));
    const blob = await apiDownloadZip(selectedNotes);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'research-notes-bundle.zip';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleDownloadDocx = async (noteId: string) => {
    const target = notes.find((n) => n.id === noteId);
    if (!target) {
      throw new Error('找不到該筆記');
    }
    const { blob, filename } = await apiDownloadDocx(target);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const filteredNotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return notes.filter((note) => {
      if (selectedTopicFilter !== 'ALL' && note.topicId !== selectedTopicFilter) {
        return false;
      }
      if (!q) return true;
      const inTitle = note.title.toLowerCase().includes(q);
      const inContent = note.content.toLowerCase().includes(q);
      const inTags = note.tags.some((tag) => tag.toLowerCase().includes(q));
      return inTitle || inContent || inTags;
    });
  }, [notes, selectedTopicFilter, searchQuery]);

  const topicMap = useMemo(
    () => new Map(topics.map((t) => [t.id, t])),
    [topics],
  );

  const wordCount = useMemo(() => {
    const clean = draftContent.trim();
    if (!clean) return 0;
    return clean.split(/\s+/).length;
  }, [draftContent]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#faf9f6] flex items-center justify-center p-8">
        <div className="space-y-3 text-center">
          <p className="font-serif text-lg text-zinc-900">Scholarly Folio</p>
          <p className="text-xs text-zinc-500">正在從雲端同步您的研究筆記...</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-[#faf9f6] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-zinc-200 rounded-xl p-6 space-y-4">
          <h1 className="font-serif text-lg font-semibold text-zinc-950">載入工作區失敗</h1>
          <p className="text-sm text-zinc-600">{loadError}</p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                if (user) {
                  void fetchCloudWorkspace(user);
                } else {
                  loadLocalGuestState();
                }
              }}
              className="min-h-[40px] px-4 py-2 rounded-lg bg-blue-700 text-white text-xs font-medium cursor-pointer"
            >
              重新連線
            </button>
            <button
              type="button"
              onClick={() => void performZeroResidueLogout(true)}
              className="min-h-[40px] px-4 py-2 rounded-lg border border-zinc-200 text-zinc-700 text-xs font-medium cursor-pointer"
            >
              登出帳號
            </button>
          </div>
        </div>
      </div>
    );
  }

  const sidebarBody = (
    <div className="flex flex-col h-full bg-[#f4f4f2] border-r border-zinc-200">
      <div className="px-4 py-4 border-b border-zinc-200 flex items-center justify-between gap-2">
        <span className="font-serif text-base font-semibold tracking-tight text-zinc-950 whitespace-nowrap truncate">
          Scholarly Folio
        </span>
        {isMobileViewport && (
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            aria-label="關閉目錄"
            className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-200/70"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="p-3 space-y-2 border-b border-zinc-200">
        <button
          type="button"
          onClick={() => void handleCreateNote()}
          className="w-full min-h-[40px] px-3 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-medium inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
        >
          <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>新增研究筆記</span>
        </button>

        <div className="relative">
          <Search
            className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            ref={searchInputRef}
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜尋標題、內文或標籤..."
            aria-label="搜尋研究筆記"
            className="w-full min-h-[40px] pl-8 pr-3 py-1.5 text-xs bg-white border border-zinc-200 rounded-lg text-zinc-900 placeholder:text-zinc-400"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-5">
        <section aria-label="研究主題目錄" className="space-y-1">
          <div className="px-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold text-zinc-500">研究主題</h2>
            <button
              type="button"
              onClick={() => setNewTopicOpen((v) => !v)}
              aria-label="新增研究主題"
              className="p-1 rounded text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200/60 cursor-pointer"
            >
              <FolderPlus className="w-3.5 h-3.5" />
            </button>
          </div>

          {newTopicOpen && (
            <form onSubmit={(e) => void handleCreateTopic(e)} className="px-1 py-1.5 flex gap-1.5">
              <input
                type="text"
                value={newTopicName}
                onChange={(e) => setNewTopicName(e.target.value)}
                placeholder="新主題名稱..."
                className="flex-1 min-w-0 min-h-[34px] px-2.5 text-xs bg-white border border-zinc-200 rounded-lg"
              />
              <button
                type="submit"
                className="px-2.5 min-h-[34px] rounded-lg bg-zinc-900 text-white text-xs cursor-pointer whitespace-nowrap"
              >
                建立
              </button>
            </form>
          )}

          <button
            type="button"
            onClick={() => setSelectedTopicFilter('ALL')}
            className={`w-full min-h-[36px] px-2.5 py-1.5 rounded-lg text-left text-xs flex items-center justify-between transition-colors cursor-pointer ${
              selectedTopicFilter === 'ALL'
                ? 'bg-white text-zinc-950 font-medium border border-zinc-200'
                : 'text-zinc-600 hover:bg-zinc-200/50'
            }`}
          >
            <span className="truncate">全部研究筆記</span>
            <span className="font-mono text-[11px] text-zinc-500 tabular-nums">{notes.length}</span>
          </button>

          {topics.map((topic) => {
            const count = notes.filter((n) => n.topicId === topic.id).length;
            const active = selectedTopicFilter === topic.id;
            return (
              <div key={topic.id} className="group flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSelectedTopicFilter(topic.id)}
                  className={`flex-1 min-w-0 min-h-[36px] px-2.5 py-1.5 rounded-lg text-left text-xs flex items-center justify-between transition-colors cursor-pointer ${
                    active
                      ? 'bg-white text-zinc-950 font-medium border border-zinc-200'
                      : 'text-zinc-600 hover:bg-zinc-200/50'
                  }`}
                >
                  <span className="truncate">{topic.name}</span>
                  <span className="font-mono text-[11px] text-zinc-500 tabular-nums shrink-0">
                    {count}
                  </span>
                </button>
                {!topic.isSystemInbox && (
                  <button
                    type="button"
                    onClick={() => void handleDeleteTopic(topic.id)}
                    aria-label={`刪除主題 ${topic.name}`}
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1.5 rounded text-zinc-400 hover:text-red-700 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}
        </section>

        <section aria-label="筆記列表" className="space-y-1.5">
          <h2 className="px-2 text-xs font-semibold text-zinc-500">
            筆記清單（<span className="tabular-nums font-mono">{filteredNotes.length}</span>）
          </h2>

          {filteredNotes.length === 0 ? (
            <p className="px-2 py-3 text-xs text-zinc-500 leading-relaxed">
              {searchQuery ? '沒有符合關鍵字的筆記。' : '此分類目前沒有筆記。'}
            </p>
          ) : (
            <div className="space-y-1">
              {filteredNotes.map((note) => {
                const isSelected = note.id === activeNoteId;
                const topicName = topicMap.get(note.topicId)?.name ?? 'Inbox';
                return (
                  <button
                    key={note.id}
                    type="button"
                    onClick={() => selectNote(note)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors cursor-pointer space-y-1 ${
                      isSelected
                        ? 'bg-white border border-zinc-300 text-zinc-950'
                        : 'hover:bg-white/70 border border-transparent text-zinc-800'
                    }`}
                  >
                    <p className="text-xs font-semibold truncate">
                      {note.title || '未命名研究筆記'}
                    </p>
                    <p className="text-[11px] text-zinc-500 truncate">
                      {note.status === 'ARCHIVED'
                        ? '已歸檔'
                        : isAuthenticated
                          ? '雲端草稿'
                          : '本機草稿'}{' '}
                      · {topicName} · {new Date(note.updatedAt).toLocaleDateString('zh-TW')}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <div className="p-3 border-t border-zinc-200 space-y-2 bg-[#f4f4f2]">
        <button
          type="button"
          disabled={notes.length === 0}
          onClick={() => {
            setPackInitialTab(undefined);
            setPackModalOpen(true);
          }}
          className="w-full min-h-[40px] px-3 py-2 rounded-lg bg-white border border-zinc-200 hover:bg-zinc-50 disabled:opacity-50 text-zinc-800 text-xs font-medium inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
        >
          <Package className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>打包與唯讀分享</span>
        </button>

        {isAuthenticated ? (
          <div className="flex items-center justify-between gap-2 px-1 pt-1">
            <span className="text-[11px] text-zinc-500 truncate" title={ownerEmail}>
              {ownerEmail}
            </span>
            <button
              type="button"
              onClick={handleLogoutRequest}
              className="min-h-[34px] px-2.5 py-1 rounded-lg text-xs text-zinc-600 hover:text-red-700 hover:bg-red-50 inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
              <span>登出</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 px-1 pt-1">
            <span className="text-[11px] text-zinc-500 truncate">本機撰寫（未登入）</span>
            <button
              type="button"
              onClick={() =>
                openCloudLoginModal(
                  '登入 Google 帳號後即可將本機筆記同步儲存至雲端工作區，並於不同裝置存取。',
                  'signin',
                )
              }
              className="min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-medium text-blue-700 hover:bg-blue-50 inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Cloud className="w-3.5 h-3.5" aria-hidden="true" />
              <span>登入雲端儲存</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#faf9f6] text-zinc-900 flex flex-col md:flex-row">
      {/* Desktop persistent sidebar */}
      <aside className="hidden md:block w-[272px] shrink-0 h-screen sticky top-0">
        {sidebarBody}
      </aside>

      {/* Mobile slide-over navigation drawer */}
      {isMobileViewport && mobileNavOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="w-[290px] max-w-[85vw] h-full">{sidebarBody}</div>
          <button
            type="button"
            aria-label="關閉背景"
            onClick={() => setMobileNavOpen(false)}
            className="flex-1 bg-zinc-950/30"
          />
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col min-h-screen">
        {/* Mobile pure reading header (<= 56px height, < 15% of 844px mobile viewport) */}
        <header className="md:hidden h-14 px-4 border-b border-zinc-200 bg-white sticky top-0 z-30 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            aria-label="開啟目錄與搜尋"
            className="min-h-[44px] min-w-[44px] -ml-2 inline-flex items-center justify-center rounded-lg text-zinc-700 hover:bg-zinc-100"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="font-serif text-sm font-semibold text-zinc-950 truncate">
            {activeNote ? activeNote.title || '未命名研究筆記' : 'Scholarly Folio'}
          </span>
          {isAuthenticated ? (
            <button
              type="button"
              onClick={handleLogoutRequest}
              aria-label="安全登出"
              className="min-h-[44px] min-w-[44px] -mr-2 inline-flex items-center justify-center rounded-lg text-zinc-600 hover:text-red-700"
            >
              <LogOut className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() =>
                openCloudLoginModal(
                  '登入 Google 帳號後即可將本機筆記同步儲存至您的個人雲端空間。',
                  'signin',
                )
              }
              aria-label="登入雲端儲存"
              className="min-h-[44px] min-w-[44px] -mr-2 inline-flex items-center justify-center rounded-lg text-blue-700 hover:bg-blue-50"
            >
              <Cloud className="w-4 h-4" />
            </button>
          )}
        </header>

        {/* Desktop distraction-free toolbar (hidden on < 768px mobile pure reading mode) */}
        {activeNote && !isMobileViewport && (
          <div className="hidden md:flex items-center justify-between gap-4 px-8 py-3 border-b border-zinc-200/80 bg-[#faf9f6] sticky top-0 z-20">
            <div className="flex items-center gap-2 min-w-0">
              <label htmlFor="topic-move-select" className="sr-only">
                移動筆記主題
              </label>
              <select
                id="topic-move-select"
                value={activeNote.topicId}
                onChange={(e) => void handleMoveTopic(e.target.value)}
                className="min-h-[38px] max-w-[180px] px-2.5 py-1.5 text-xs bg-white border border-zinc-200 rounded-lg text-zinc-800 cursor-pointer"
              >
                {topics.map((t) => (
                  <option key={t.id} value={t.id}>
                    主題：{t.name}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => setIsReadMode((v) => !v)}
                className="min-h-[38px] px-3 py-1.5 rounded-lg bg-white border border-zinc-200 hover:bg-zinc-100 text-zinc-700 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {isReadMode ? (
                  <>
                    <PenLine className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>繼續編輯</span>
                  </>
                ) : (
                  <>
                    <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>純淨閱讀</span>
                  </>
                )}
              </button>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => void triggerCourseSearch()}
                className="min-h-[38px] px-3.5 py-1.5 rounded-lg bg-white border border-zinc-200 hover:bg-zinc-100 text-zinc-800 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                title="快捷鍵 Alt+R"
              >
                <Compass className="w-3.5 h-3.5 text-blue-700" aria-hidden="true" />
                <span>尋找參考課程</span>
              </button>

              <button
                type="button"
                disabled={isAuthenticated ? savingDraft || !isDirty : savingDraft}
                onClick={() => void handleSaveDraft()}
                className="min-h-[38px] px-3.5 py-1.5 rounded-lg bg-white border border-zinc-200 hover:bg-zinc-100 disabled:opacity-50 text-zinc-800 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  {!isAuthenticated
                    ? '儲存至雲端'
                    : savingDraft
                      ? '儲存中...'
                      : '儲存草稿'}
                </span>
              </button>

              <button
                type="button"
                disabled={organizing}
                onClick={() => void handleOrganizeAndArchive()}
                className="min-h-[38px] px-4 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Archive className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{organizing ? '歸檔整理中...' : '完成並歸檔'}</span>
              </button>

              {confirmDeleteId === activeNote.id ? (
                <div className="inline-flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void handleDeleteNote(activeNote.id)}
                    className="min-h-[38px] px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-medium whitespace-nowrap cursor-pointer"
                  >
                    確認刪除
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(null)}
                    className="min-h-[38px] px-2.5 py-1.5 rounded-lg text-xs text-zinc-600 hover:bg-zinc-200/60 whitespace-nowrap cursor-pointer"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(activeNote.id)}
                  aria-label="刪除筆記"
                  className="min-h-[38px] min-w-[38px] inline-flex items-center justify-center rounded-lg text-zinc-400 hover:text-red-700 hover:bg-red-50 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Main Workspace Canvas + On-Demand Drawer */}
        <div className="flex-1 flex min-h-0">
          <main className="flex-1 min-w-0 px-5 py-7 sm:px-10 sm:py-10">
            {!activeNote ? (
              <div className="max-w-lg mx-auto py-16 text-center space-y-4">
                <BookOpen className="w-8 h-8 text-zinc-400 mx-auto" aria-hidden="true" />
                <h1 className="font-serif text-2xl font-semibold text-zinc-950">
                  開始第一篇研究筆記
                </h1>
                <p className="text-sm text-zinc-600 leading-relaxed">
                  這裡沒有動態牆或演算法推播。點擊下方按鈕建立筆記，寫作卡關時可隨時喚醒開放課程與學術文獻參考。
                </p>
                {!isMobileViewport && (
                  <button
                    type="button"
                    onClick={() => void handleCreateNote()}
                    className="min-h-[42px] px-5 py-2.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium inline-flex items-center gap-2 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" aria-hidden="true" />
                    <span>建立第一篇筆記</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="max-w-[740px] mx-auto space-y-6">
                {feedbackNotice && (
                  <div
                    role="status"
                    className={`px-4 py-2.5 rounded-lg text-xs border ${
                      feedbackNotice.tone === 'error'
                        ? 'bg-red-50 border-red-200 text-red-900'
                        : feedbackNotice.tone === 'warn'
                          ? 'bg-amber-50 border-amber-200 text-amber-900'
                          : 'bg-white border-zinc-200 text-zinc-700'
                    }`}
                  >
                    {feedbackNotice.text}
                  </div>
                )}

                {/* Title & Quiet Unboxed Metadata */}
                <header className="space-y-2.5 pb-4 border-b border-zinc-200">
                  {isReadMode ? (
                    <h1 className="font-serif text-2xl sm:text-3xl font-semibold text-zinc-950 tracking-tight leading-snug">
                      {draftTitle || '未命名研究筆記'}
                    </h1>
                  ) : (
                    <input
                      type="text"
                      value={draftTitle}
                      onChange={(e) => handleDraftTitleChange(e.target.value)}
                      placeholder="輸入研究筆記標題..."
                      aria-label="研究筆記標題"
                      className="w-full bg-transparent font-serif text-2xl sm:text-3xl font-semibold text-zinc-950 tracking-tight leading-snug placeholder:text-zinc-300 border-none focus:outline-none"
                    />
                  )}

                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <span>
                      {!isAuthenticated
                        ? '本機草稿（未同步雲端）'
                        : activeNote.status === 'ARCHIVED'
                          ? '已歸檔'
                          : '雲端草稿'}
                      {isAuthenticated && isDirty ? '（有未存變更）' : ''}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{topicMap.get(activeNote.topicId)?.name ?? 'Inbox'}</span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums font-mono">{wordCount} tokens</span>
                    {activeNote.tags.length > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{activeNote.tags.join(' / ')}</span>
                      </>
                    )}
                  </div>
                </header>

                {/* Writing Canvas vs Pure Reading View */}
                {isReadMode ? (
                  <div className="py-1">
                    <MarkdownReader content={draftContent} />
                  </div>
                ) : (
                  <div>
                    <textarea
                      value={draftContent}
                      onChange={(e) => handleDraftContentChange(e.target.value)}
                      placeholder="以 Markdown 專心書寫您的研究構想、實驗觀察或推導筆記...&#10;&#10;卡關時可點擊右上角「尋找參考課程」（或按 Alt+R）按需檢索公開課程與學術論文。"
                      aria-label="研究筆記 Markdown 內容"
                      className="w-full min-h-[440px] bg-transparent text-[15px] sm:text-[16px] text-zinc-800 leading-[1.75] placeholder:text-zinc-400 resize-y border-none focus:outline-none font-sans"
                    />
                  </div>
                )}

                {/* Pinned Course & Paper References Appendix */}
                {activeNote.courseRefs.length > 0 && (
                  <section
                    aria-label="已釘選參考資料"
                    className="pt-6 border-t border-zinc-200 space-y-3"
                  >
                    <h2 className="text-sm font-semibold text-zinc-900">
                      已釘選課程與學術文獻（<span className="tabular-nums font-mono">{activeNote.courseRefs.length}</span>）
                    </h2>
                    <div className="divide-y divide-zinc-200 border border-zinc-200 rounded-xl bg-white">
                      {activeNote.courseRefs.map((ref) => (
                        <div
                          key={ref.id}
                          className="p-4 flex items-start justify-between gap-4"
                        >
                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2 text-xs text-zinc-500">
                              <span className="font-medium text-blue-700">
                                {ref.type === 'COURSE' ? '[開放課程]' : '[學術文獻]'}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span>{ref.provider}</span>
                            </div>
                            <a
                              href={ref.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-950 hover:text-blue-700 underline underline-offset-4"
                            >
                              <span>{ref.title}</span>
                              <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            </a>
                            {ref.summary && (
                              <p className="text-xs text-zinc-600 leading-relaxed">
                                {ref.summary}
                              </p>
                            )}
                          </div>

                          {!isReadMode && !isMobileViewport && (
                            <button
                              type="button"
                              onClick={() => void handleUnpinRef(ref.id)}
                              aria-label={`移除參考 ${ref.title}`}
                              className="p-1.5 rounded-lg text-zinc-400 hover:text-red-700 hover:bg-red-50 shrink-0 cursor-pointer"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}
          </main>

          {/* On-Demand Right Reference Drawer (never mounts/requests until triggered) */}
          <ReferenceDrawer
            isOpen={drawerOpen}
            isLoading={drawerLoading}
            keywords={drawerKeywords}
            items={drawerItems}
            degraded={drawerDegraded}
            errorMessage={drawerError}
            pinnedRefs={activeNote?.courseRefs ?? []}
            onClose={() => setDrawerOpen(false)}
            onRefreshSearch={(q) => void triggerCourseSearch(q)}
            onPinRef={handlePinRef}
          />
        </div>
      </div>

      <PackShareModal
        isOpen={packModalOpen}
        isAuthenticated={isAuthenticated}
        initialTab={packInitialTab}
        notes={notes}
        topics={topics}
        activeNoteId={activeNoteId}
        shareBundles={shareBundles}
        onClose={() => setPackModalOpen(false)}
        onRequestCloudLogin={(reason, targetTab) => {
          setPackModalOpen(false);
          openCloudLoginModal(
            reason,
            targetTab === 'drive' ? 'pack_drive' : 'pack_share',
          );
        }}
        onCreateShareBundle={handleCreateShareBundle}
        onDeleteShareBundle={handleDeleteShareBundle}
        onDownloadZip={handleDownloadZip}
        onDownloadDocx={handleDownloadDocx}
      />

      <CloudSignInModal
        isOpen={signInModalOpen}
        reason={signInModalReason}
        hasUnsavedGuestNotes={hasUnsavedGuestNotes}
        onClose={closeCloudLoginModal}
        onAuthenticated={handleCloudAuthenticated}
      />

      <LogoutConfirmModal
        isOpen={logoutModalOpen}
        isSaving={loggingOutWithSave}
        onSaveAndLogout={() => void handleSaveAndLogout()}
        onDiscardAndLogout={() => {
          setLogoutModalOpen(false);
          void performZeroResidueLogout(true);
        }}
        onCancel={() => setLogoutModalOpen(false)}
      />
    </div>
  );
}
