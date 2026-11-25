import { useState } from 'react';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { ArrowRight, BookOpen, Lock } from 'lucide-react';
import { auth, googleAuthProvider, setMemoryDriveAccessToken } from '../lib/firebase.ts';
import { performZeroResidueLogout } from '../lib/logout.ts';

type LoginViewProps = {
  externalError?: string | null;
  onAuthenticated: () => void;
};

export function LoginView({ externalError, onAuthenticated }: LoginViewProps) {
  const [signingIn, setSigningIn] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(externalError ?? null);

  const handleGoogleSignIn = async () => {
    setSigningIn(true);
    setErrorMessage(null);

    try {
      const credential = await signInWithPopup(auth, googleAuthProvider);
      const oauthCred = GoogleAuthProvider.credentialFromResult(credential);
      if (oauthCred?.accessToken) {
        setMemoryDriveAccessToken(oauthCred.accessToken);
      }
      const token = await credential.user.getIdToken();

      const verifyRes = await fetch('/api/auth/verify', {
        method: 'GET',
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!verifyRes.ok) {
        const body = (await verifyRes.json().catch(() => ({}))) as { error?: string };
        await performZeroResidueLogout(false);
        setErrorMessage(
          body.error || '登入失敗：請使用已完成信箱驗證的 Google 帳號登入。',
        );
        return;
      }

      if (window.location.pathname === '/login') {
        window.history.replaceState(null, '', '/');
      }
      onAuthenticated();
    } catch (err) {
      const message =
        err instanceof Error && err.message.includes('popup-closed-by-user')
          ? '已取消 Google 登入視窗。'
          : '無法完成 Google 登入，請確認瀏覽器允許彈出式視窗後再試一次。';
      setErrorMessage(message);
    } finally {
      setSigningIn(false);
    }
  };

  const activeError = errorMessage ?? externalError;

  return (
    <div className="min-h-screen bg-[#faf9f6] text-zinc-900 flex flex-col justify-between px-6 py-8 sm:px-12">
      <header className="max-w-5xl w-full mx-auto flex items-center justify-between gap-8">
        <span className="font-serif text-lg font-semibold tracking-tight text-zinc-950 whitespace-nowrap shrink-0">
          Scholarly Folio
        </span>
        <span className="text-xs text-zinc-500 whitespace-nowrap shrink-0">
          私人研究工作台
        </span>
      </header>

      <main className="max-w-xl w-full mx-auto py-16">
        <p className="text-xs font-medium text-zinc-500 tracking-wide mb-4">
          學術研究筆記 · 跨裝置雲端同步
        </p>
        <h1 className="font-serif text-3xl sm:text-4xl font-semibold text-zinc-950 tracking-tight leading-tight mb-5">
          零社交干擾的研究寫作空間
        </h1>
        <p className="text-[15px] text-zinc-600 leading-relaxed mb-10 max-w-lg">
          寫作時保持介面完全安靜，僅在主動喚醒時並陳檢索開放課程與學術文獻；寫完自動歸檔分類，支援行動端純淨閱讀與單鍵唯讀分享。
        </p>

        {activeError && (
          <div
            role="alert"
            className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-900 leading-relaxed"
          >
            {activeError}
          </div>
        )}

        <div className="bg-white border border-zinc-200 rounded-xl p-6 sm:p-8">
          <div className="flex items-start gap-3 mb-6">
            <Lock className="w-5 h-5 text-zinc-700 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-semibold text-zinc-950 mb-1">
                Google 研究者帳號驗證
              </h2>
              <p className="text-xs text-zinc-600 leading-relaxed">
                每位登入者的筆記與主題目錄皆獨立隔離儲存；未登入不載入任何資料，登出後即刻清除本機儲存與對話狀態。
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleGoogleSignIn()}
            disabled={signingIn}
            className="w-full min-h-[44px] px-5 py-2.5 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span>{signingIn ? '正在驗證 Google 身分...' : '使用 Google 帳號登入工作台'}</span>
            <ArrowRight className="w-4 h-4 shrink-0" aria-hidden="true" />
          </button>
        </div>
      </main>

      <footer className="max-w-5xl w-full mx-auto pt-8 border-t border-zinc-200/80 flex flex-wrap items-center justify-between gap-4 text-xs text-zinc-500">
        <div className="inline-flex items-center gap-2">
          <BookOpen className="w-3.5 h-3.5 text-zinc-400" aria-hidden="true" />
          <span>按需檢索課程 · 自動主題歸檔 · 離線打包</span>
        </div>
        <span>各自獨立的研究空間</span>
      </footer>
    </div>
  );
}
