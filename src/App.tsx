import { Component, type ErrorInfo, type ReactNode, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { LoginView } from './components/LoginView.tsx';
import { SharePublicView } from './components/SharePublicView.tsx';
import { WorkspaceView } from './components/WorkspaceView.tsx';
import { auth } from './lib/firebase.ts';
import { performZeroResidueLogout } from './lib/logout.ts';

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error.message || '發生未預期的應用程式錯誤' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Application ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#faf9f6] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-zinc-200 rounded-xl p-6 space-y-4">
            <h1 className="font-serif text-lg font-semibold text-zinc-950">
              工作區載入發生異常
            </h1>
            <p className="text-xs text-zinc-600 leading-relaxed break-words">
              請重新整理頁面再試一次；若持續發生，請重新登入。
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="min-h-[40px] px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-medium cursor-pointer"
            >
              重新載入
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function getShareSlugFromPath(pathname: string): string | null {
  const match = /^\/share\/([A-Za-z0-9_-]{12,64})\/?$/.exec(pathname);
  return match ? match[1] : null;
}

export default function App() {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';
  const shareSlug = getShareSlugFromPath(pathname);

  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [verifiedTick, setVerifiedTick] = useState(0);
  const wasAuthenticatedRef = useRef(false);

  useEffect(() => {
    if (shareSlug) {
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      if (nextUser) {
        wasAuthenticatedRef.current = true;
      }
      setUser(nextUser);
      setAuthReady(true);
    });

    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted && wasAuthenticatedRef.current && !auth.currentUser) {
        window.location.replace('/');
      }
    };

    window.addEventListener('pageshow', handlePageShow);
    return () => {
      unsubscribe();
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [shareSlug]);

  // Public read-only share route (/share/[slug]) never touches owner auth or workspace state
  if (shareSlug) {
    return (
      <AppErrorBoundary>
        <SharePublicView slug={shareSlug} />
      </AppErrorBoundary>
    );
  }

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#faf9f6] flex items-center justify-center">
        <p className="font-serif text-base text-zinc-700">Scholarly Folio</p>
      </div>
    );
  }

  if (pathname === '/login' && !user) {
    return (
      <AppErrorBoundary>
        <LoginView
          externalError={authError}
          onAuthenticated={() => {
            setAuthError(null);
            setVerifiedTick((t) => t + 1);
          }}
        />
      </AppErrorBoundary>
    );
  }

  return (
    <AppErrorBoundary>
      <WorkspaceView
        key={`workspace-root-${verifiedTick}`}
        user={user}
        onUnauthorized={(msg) => {
          setAuthError(msg ?? '工作階段已失效或帳號無權存取，請重新登入。');
          void performZeroResidueLogout(false).then(() => {
            setUser(null);
          });
        }}
      />
    </AppErrorBoundary>
  );
}
