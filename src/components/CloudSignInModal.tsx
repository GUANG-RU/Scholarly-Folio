import { useState } from 'react';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { Cloud, X } from 'lucide-react';
import { auth, googleAuthProvider, setMemoryDriveAccessToken } from '../lib/firebase.ts';
import { performZeroResidueLogout } from '../lib/logout.ts';

type CloudSignInModalProps = {
  isOpen: boolean;
  reason: string | null;
  hasUnsavedGuestNotes: boolean;
  onClose: () => void;
  onAuthenticated: (user: { uid: string; email: string }) => Promise<void>;
};

export function CloudSignInModal({
  isOpen,
  reason,
  hasUnsavedGuestNotes,
  onClose,
  onAuthenticated,
}: CloudSignInModalProps) {
  const [signingIn, setSigningIn] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) {
    return null;
  }

  const handleSignIn = async () => {
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

      if (!credential.user.email) {
        await performZeroResidueLogout(false);
        setErrorMessage('無法取得已驗證的 Google Email，請改用其他帳號登入。');
        return;
      }

      await onAuthenticated({
        uid: credential.user.uid,
        email: credential.user.email,
      });
    } catch (err) {
      const message =
        err instanceof Error && err.message.includes('popup-closed-by-user')
          ? '已取消 Google 登入視窗，您可以繼續在本機撰寫筆記。'
          : '無法完成 Google 登入，請確認瀏覽器允許彈出式視窗後再試一次。';
      setErrorMessage(message);
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cloud-signin-title"
      className="fixed inset-0 z-50 bg-zinc-950/40 flex items-center justify-center p-4"
    >
      <div className="bg-white border border-zinc-200 rounded-xl w-full max-w-md p-6 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Cloud className="w-5 h-5 text-blue-700 shrink-0" aria-hidden="true" />
            <h2 id="cloud-signin-title" className="font-serif text-lg font-semibold text-zinc-950">
              登入以儲存至雲端
            </h2>
          </div>
          <button
            type="button"
            disabled={signingIn}
            onClick={onClose}
            aria-label="關閉視窗"
            className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-950 hover:bg-zinc-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-2 text-xs text-zinc-600 leading-relaxed">
          <p>
            {reason || '您可以不登入直接書寫筆記；當需要儲存至雲端、跨裝置同步、使用 AI 自動歸檔或建立公開分享連結時，才需登入 Google 帳號。'}
          </p>
          {hasUnsavedGuestNotes && (
            <p className="text-zinc-800 font-medium">
              您目前已撰寫的本機筆記與釘選參考資料，登入後將會自動同步儲存至您的雲端空間。
            </p>
          )}
        </div>

        {errorMessage && (
          <div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-900">
            {errorMessage}
          </div>
        )}

        <div className="space-y-2.5">
          <button
            type="button"
            disabled={signingIn}
            onClick={() => void handleSignIn()}
            className="w-full min-h-[44px] px-4 py-2.5 rounded-lg bg-white border border-zinc-300 hover:bg-zinc-50 disabled:opacity-60 text-zinc-900 text-sm font-medium inline-flex items-center justify-center gap-3 cursor-pointer transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path
                fill="#EA4335"
                d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
              />
              <path
                fill="#4285F4"
                d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
              />
              <path
                fill="#FBBC05"
                d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
              />
              <path
                fill="#34A853"
                d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
              />
            </svg>
            <span>{signingIn ? '正在登入並同步筆記...' : 'Sign in with Google 並同步至雲端'}</span>
          </button>

          <button
            type="button"
            disabled={signingIn}
            onClick={onClose}
            className="w-full min-h-[38px] px-4 py-2 rounded-lg text-xs text-zinc-600 hover:bg-zinc-100 cursor-pointer"
          >
            先繼續本機撰寫（暫不登入）
          </button>
        </div>
      </div>
    </div>
  );
}
