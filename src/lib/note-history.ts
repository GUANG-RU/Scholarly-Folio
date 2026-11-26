export interface NoteSnapshot {
  title: string;
  content: string;
  selectionStart?: number;
  selectionEnd?: number;
}

export interface NoteHistoryState {
  past: NoteSnapshot[];
  present: NoteSnapshot;
  future: NoteSnapshot[];
  lastTypingAt: number;
  lastTypingOp: 'insert' | 'delete' | 'other' | null;
}

const MAX_HISTORY_ENTRIES = 60;
const TYPING_COALESCE_MS = 600;

export function createNoteHistory(initial: NoteSnapshot): NoteHistoryState {
  return {
    past: [],
    present: { ...initial },
    future: [],
    lastTypingAt: 0,
    lastTypingOp: null,
  };
}

export function canUndoHistory(state: NoteHistoryState | undefined | null): boolean {
  return Boolean(state && state.past.length > 0);
}

export function canRedoHistory(state: NoteHistoryState | undefined | null): boolean {
  return Boolean(state && state.future.length > 0);
}

export function recordNoteEdit(
  state: NoteHistoryState,
  next: NoteSnapshot,
  options: { mode: 'typing' | 'commit'; now?: number } = { mode: 'commit' },
): NoteHistoryState {
  const now = options.now ?? Date.now();
  const prev = state.present;

  if (next.title === prev.title && next.content === prev.content) {
    return {
      ...state,
      present: {
        ...prev,
        selectionStart: next.selectionStart ?? prev.selectionStart,
        selectionEnd: next.selectionEnd ?? prev.selectionEnd,
      },
    };
  }

  if (options.mode === 'typing') {
    const contentDelta = next.content.length - prev.content.length;
    const titleChanged = next.title !== prev.title;
    const op: 'insert' | 'delete' | 'other' = titleChanged
      ? 'other'
      : contentDelta > 0
        ? 'insert'
        : contentDelta < 0
          ? 'delete'
          : 'other';

    const canCoalesce =
      state.past.length > 0 &&
      now - state.lastTypingAt <= TYPING_COALESCE_MS &&
      op !== 'other' &&
      op === state.lastTypingOp &&
      Math.abs(contentDelta) <= 8;

    if (canCoalesce) {
      return {
        ...state,
        present: { ...next },
        future: [],
        lastTypingAt: now,
        lastTypingOp: op,
      };
    }

    const nextPast = [...state.past, prev].slice(-MAX_HISTORY_ENTRIES);
    return {
      past: nextPast,
      present: { ...next },
      future: [],
      lastTypingAt: now,
      lastTypingOp: op,
    };
  }

  const nextPast = [...state.past, prev].slice(-MAX_HISTORY_ENTRIES);
  return {
    past: nextPast,
    present: { ...next },
    future: [],
    lastTypingAt: 0,
    lastTypingOp: null,
  };
}

export function undoNoteHistory(state: NoteHistoryState): {
  nextState: NoteHistoryState;
  snapshot: NoteSnapshot | null;
} {
  if (state.past.length === 0) {
    return { nextState: state, snapshot: null };
  }
  const previous = state.past[state.past.length - 1];
  const nextPast = state.past.slice(0, -1);
  const nextFuture = [state.present, ...state.future].slice(0, MAX_HISTORY_ENTRIES);
  return {
    nextState: {
      past: nextPast,
      present: previous,
      future: nextFuture,
      lastTypingAt: 0,
      lastTypingOp: null,
    },
    snapshot: previous,
  };
}

export function redoNoteHistory(state: NoteHistoryState): {
  nextState: NoteHistoryState;
  snapshot: NoteSnapshot | null;
} {
  if (state.future.length === 0) {
    return { nextState: state, snapshot: null };
  }
  const next = state.future[0];
  const nextFuture = state.future.slice(1);
  const nextPast = [...state.past, state.present].slice(-MAX_HISTORY_ENTRIES);
  return {
    nextState: {
      past: nextPast,
      present: next,
      future: nextFuture,
      lastTypingAt: 0,
      lastTypingOp: null,
    },
    snapshot: next,
  };
}
