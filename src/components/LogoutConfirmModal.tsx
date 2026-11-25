type LogoutConfirmModalProps = {
  isOpen: boolean;
  isSaving: boolean;
  onSaveAndLogout: () => void;
  onDiscardAndLogout: () => void;
  onCancel: () => void;
};

export function LogoutConfirmModal({
  isOpen,
  isSaving,
  onSaveAndLogout,
  onDiscardAndLogout,
  onCancel,
}: LogoutConfirmModalProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="logout-confirm-title"
      className="fixed inset-0 z-50 bg-zinc-950/40 flex items-center justify-center p-4"
    >
      <div className="bg-white border border-zinc-200 rounded-xl max-w-md w-full p-6 space-y-4">
        <h2 id="logout-confirm-title" className="font-serif text-lg font-semibold text-zinc-950">
          編輯區尚有未同步至雲端的變更
        </h2>
        <p className="text-sm text-zinc-600 leading-relaxed">
          登出將會即時清除所有瀏覽器儲存空間與記憶體狀態，以保護您的研究筆記隱私。請問要如何處理目前尚未存檔的內容？
        </p>

        <div className="pt-2 flex flex-col gap-2.5">
          <button
            type="button"
            disabled={isSaving}
            onClick={onSaveAndLogout}
            className="w-full min-h-[42px] px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-sm font-medium cursor-pointer whitespace-nowrap"
          >
            {isSaving ? '正在存回雲端並安全登出...' : '先存回雲端再登出'}
          </button>
          <button
            type="button"
            disabled={isSaving}
            onClick={onDiscardAndLogout}
            className="w-full min-h-[42px] px-4 py-2 rounded-lg bg-white border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-60 text-sm font-medium cursor-pointer whitespace-nowrap"
          >
            不存直接清空登出
          </button>
          <button
            type="button"
            disabled={isSaving}
            onClick={onCancel}
            className="w-full min-h-[40px] px-4 py-2 rounded-lg text-zinc-600 hover:bg-zinc-100 text-sm font-medium cursor-pointer whitespace-nowrap"
          >
            取消，繼續寫作
          </button>
        </div>
      </div>
    </div>
  );
}
