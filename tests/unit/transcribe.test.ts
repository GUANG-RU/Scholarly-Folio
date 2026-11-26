import { describe, expect, it } from 'vitest';
import {
  MAX_AUDIO_BYTES,
  normalizeAudioMimeType,
  transcribeAudio,
  TranscriptionError,
} from '../../src/lib/ai/transcribe.ts';

describe('audio transcription helpers', () => {
  it('normalizes supported audio MIME types with codec parameters', () => {
    expect(normalizeAudioMimeType('audio/webm;codecs=opus')).toBe('audio/webm');
    expect(normalizeAudioMimeType('audio/mp4; codecs=mp4a.40.2')).toBe('audio/mp4');
    expect(normalizeAudioMimeType('audio/x-m4a')).toBe('audio/mp4');
    expect(normalizeAudioMimeType('audio/x-wav')).toBe('audio/wav');
    expect(normalizeAudioMimeType('audio/mp3')).toBe('audio/mpeg');
    expect(normalizeAudioMimeType('video/mp4')).toBeNull();
    expect(normalizeAudioMimeType('application/pdf')).toBeNull();
  });

  it('rejects unsupported MIME types and oversized payloads', async () => {
    await expect(
      transcribeAudio({
        audioBase64: Buffer.from('hello world audio bytes').toString('base64'),
        mimeType: 'text/plain',
        mode: 'verbatim',
      }),
    ).rejects.toMatchObject({ status: 400 });

    const oversized = Buffer.alloc(MAX_AUDIO_BYTES + 1024).toString('base64');
    await expect(
      transcribeAudio({
        audioBase64: oversized,
        mimeType: 'audio/webm',
        mode: 'verbatim',
      }),
    ).rejects.toMatchObject({ status: 413 });
  });

  it('returns trimmed transcript and propagates upstream failures', async () => {
    const sampleBase64 = Buffer.from('fake-webm-binary-content').toString('base64');

    const ok = await transcribeAudio(
      {
        audioBase64: `data:audio/webm;base64,${sampleBase64}`,
        mimeType: 'audio/webm;codecs=opus',
        mode: 'structured',
      },
      {
        transcribeFn: async (_base64, mimeType, mode) => {
          expect(mimeType).toBe('audio/webm');
          expect(mode).toBe('structured');
          return '  今天我們討論量子糾錯碼的基本原理。  ';
        },
      },
    );
    expect(ok).toEqual({
      transcript: '今天我們討論量子糾錯碼的基本原理。',
      mimeType: 'audio/webm',
    });

    await expect(
      transcribeAudio(
        {
          audioBase64: sampleBase64,
          mimeType: 'audio/mp3',
          mode: 'verbatim',
        },
        {
          transcribeFn: async () => '',
        },
      ),
    ).rejects.toBeInstanceOf(TranscriptionError);
  });
});
