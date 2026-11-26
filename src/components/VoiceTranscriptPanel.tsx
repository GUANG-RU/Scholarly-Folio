import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Mic, Network, Plus, Square, Upload, X } from 'lucide-react';
import { apiTranscribeAudio } from '../lib/client-api.ts';

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

type VoiceTranscriptPanelProps = {
  isOpen: boolean;
  onClose: () => void;
  onInsertTranscript: (text: string) => void;
  onConvertToMindMap?: (text: string) => void;
};

function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const secs = (seconds % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}

function inferMimeFromFile(file: File): string {
  if (file.type && file.type.startsWith('audio/')) {
    return file.type;
  }
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.m4a') || lower.endsWith('.mp4')) return 'audio/mp4';
  if (lower.endsWith('.webm')) return 'audio/webm';
  if (lower.endsWith('.ogg')) return 'audio/ogg';
  if (lower.endsWith('.aac')) return 'audio/aac';
  if (lower.endsWith('.flac')) return 'audio/flac';
  return file.type || 'audio/webm';
}

function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      if (commaIdx === -1) {
        reject(new Error('音訊編碼失敗'));
        return;
      }
      resolve(result.slice(commaIdx + 1));
    };
    reader.onerror = () => reject(new Error('無法讀取音訊資料'));
    reader.readAsDataURL(blob);
  });
}

export function VoiceTranscriptPanel({
  isOpen,
  onClose,
  onInsertTranscript,
  onConvertToMindMap,
}: VoiceTranscriptPanelProps) {
  const [mode, setMode] = useState<'verbatim' | 'structured'>('verbatim');
  const [recording, setRecording] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const discardOnStopRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stopStreamTracks = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        track.stop();
      }
      mediaStreamRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      discardOnStopRef.current = true;
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          // Ignore cleanup stop errors
        }
      }
      stopStreamTracks();
    };
  }, []);

  if (!isOpen) {
    return null;
  }

  const runTranscription = async (blob: Blob, mimeType: string, label: string) => {
    if (blob.size === 0) {
      setErrorMsg('錄音時間過短或音檔為空，請再試一次。');
      return;
    }
    if (blob.size > MAX_UPLOAD_BYTES) {
      setErrorMsg('音訊大小超過 15 MB 上限，請分段錄製或剪輯後再上傳。');
      return;
    }

    setTranscribing(true);
    setErrorMsg(null);
    setSourceLabel(label);
    try {
      const audioBase64 = await blobToBase64(blob);
      const res = await apiTranscribeAudio({
        audioBase64,
        mimeType,
        mode,
      });
      setTranscript((prev) =>
        prev.trim() ? `${prev.trim()}\n\n${res.transcript}` : res.transcript,
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '語音轉逐字稿失敗');
    } finally {
      setTranscribing(false);
    }
  };

  const handleStartRecording = async () => {
    setErrorMsg(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setErrorMsg('目前瀏覽器不支援即時麥克風錄音，請改用「上傳音檔」功能。');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      chunksRef.current = [];
      discardOnStopRef.current = false;

      const preferredMime = pickRecorderMimeType();
      const recorder = preferredMime
        ? new MediaRecorder(stream, { mimeType: preferredMime })
        : new MediaRecorder(stream);

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const wasDiscarded = discardOnStopRef.current;
        const chunks = chunksRef.current;
        const mimeType = recorder.mimeType || preferredMime || 'audio/webm';
        stopStreamTracks();
        setRecording(false);
        mediaRecorderRef.current = null;

        if (!wasDiscarded && chunks.length > 0) {
          const blob = new Blob(chunks, { type: mimeType });
          void runTranscription(blob, mimeType, '麥克風錄音');
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start(500);
      setRecording(true);
      setElapsedSeconds(0);
      timerRef.current = window.setInterval(() => {
        setElapsedSeconds((s) => s + 1);
      }, 1000);
    } catch {
      stopStreamTracks();
      setRecording(false);
      setErrorMsg('無法存取麥克風，請確認瀏覽器已允許麥克風權限，或改用「上傳音檔」。');
    }
  };

  const handleStopAndTranscribe = () => {
    discardOnStopRef.current = false;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleCancelRecording = () => {
    discardOnStopRef.current = true;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    } else {
      stopStreamTracks();
      setRecording(false);
    }
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const mimeType = inferMimeFromFile(file);
    await runTranscription(file, mimeType, file.name);
  };

  const handleCopy = async () => {
    if (!transcript.trim()) return;
    try {
      await navigator.clipboard.writeText(transcript);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setErrorMsg('無法存取剪貼簿，請手動選取複製文字。');
    }
  };

  const handleInsert = () => {
    const clean = transcript.trim();
    if (!clean) return;
    onInsertTranscript(clean);
    setTranscript('');
    setSourceLabel(null);
  };

  return (
    <section
      aria-label="語音轉逐字稿工具"
      className="border border-zinc-200 rounded-xl bg-white p-4 sm:p-5 space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <h2 className="text-sm font-semibold text-zinc-950">語音轉逐字稿</h2>
          <p className="text-xs text-zinc-500">
            支援即時麥克風口述錄音或上傳課堂、訪談音檔（15 MB 以內）
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div
            role="group"
            aria-label="轉錄格式"
            className="flex items-center gap-1 p-1 bg-zinc-100 rounded-lg"
          >
            <button
              type="button"
              disabled={recording || transcribing}
              onClick={() => setMode('verbatim')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                mode === 'verbatim'
                  ? 'bg-white text-zinc-950 shadow-xs'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              原音逐字
            </button>
            <button
              type="button"
              disabled={recording || transcribing}
              onClick={() => setMode('structured')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                mode === 'structured'
                  ? 'bg-white text-zinc-950 shadow-xs'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              分段整理
            </button>
          </div>

          <button
            type="button"
            disabled={recording || transcribing}
            onClick={onClose}
            aria-label="關閉語音轉逐字稿面板"
            className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 disabled:opacity-40 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        {!recording ? (
          <>
            <button
              type="button"
              disabled={transcribing}
              onClick={() => void handleStartRecording()}
              className="min-h-[40px] px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-xs font-medium inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Mic className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>{transcribing ? '正在轉錄逐字稿...' : '開始麥克風錄音'}</span>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              onChange={(e) => void handleFileSelected(e)}
              className="hidden"
            />
            <button
              type="button"
              disabled={transcribing}
              onClick={() => fileInputRef.current?.click()}
              className="min-h-[40px] px-4 py-2 rounded-lg bg-white border border-zinc-200 hover:bg-zinc-50 disabled:opacity-50 text-zinc-800 text-xs font-medium inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>上傳音檔</span>
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={handleStopAndTranscribe}
              className="min-h-[40px] px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Square className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>停止並轉成逐字稿</span>
            </button>

            <button
              type="button"
              onClick={handleCancelRecording}
              className="min-h-[40px] px-3 py-2 rounded-lg border border-zinc-200 text-zinc-700 hover:bg-zinc-50 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
            >
              取消錄音
            </button>

            <span className="text-xs text-red-700 font-medium inline-flex items-center gap-1.5 px-1">
              <span>錄音中</span>
              <span className="font-mono tabular-nums">{formatElapsed(elapsedSeconds)}</span>
            </span>
          </>
        )}

        {transcribing && (
          <span className="text-xs text-zinc-500">
            正在辨識「{sourceLabel ?? '音訊'}」並生成逐字稿...
          </span>
        )}
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-900"
        >
          {errorMsg}
        </div>
      )}

      {transcript && (
        <div className="space-y-2.5 pt-2 border-t border-zinc-200">
          <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
            <span>逐字稿預覽（可先微調文字後再插入筆記）</span>
            {sourceLabel && <span className="truncate max-w-[200px]">來源：{sourceLabel}</span>}
          </div>
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            rows={5}
            aria-label="語音逐字稿預覽"
            className="w-full p-3 text-sm text-zinc-800 leading-relaxed bg-[#faf9f6] border border-zinc-200 rounded-lg focus:outline-none focus:border-blue-700 resize-y"
          />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setTranscript('');
                setSourceLabel(null);
              }}
              className="min-h-[36px] px-3 py-1.5 rounded-lg text-xs text-zinc-600 hover:bg-zinc-100 whitespace-nowrap shrink-0 cursor-pointer"
            >
              清除
            </button>
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="min-h-[36px] px-3 py-1.5 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 text-xs font-medium text-zinc-700 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? '已複製' : '複製'}</span>
            </button>
            {onConvertToMindMap && (
              <button
                type="button"
                onClick={() => onConvertToMindMap(transcript.trim())}
                className="min-h-[36px] px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50/70 hover:bg-blue-100 text-xs font-medium text-blue-800 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Network className="w-3.5 h-3.5" aria-hidden="true" />
                <span>轉成心智圖</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleInsert}
              className="min-h-[36px] px-4 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>插入至筆記</span>
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
