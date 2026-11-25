import { describe, expect, it } from 'vitest';
import { autoOrganizeNote } from '../../src/lib/ai/organizer.ts';

const SAMPLE_TOPICS = [
  { id: 'topic-inbox', name: 'Inbox', isSystemInbox: true },
  { id: 'topic-ml', name: 'Machine Learning', isSystemInbox: false },
  { id: 'topic-sys', name: 'Distributed Systems', isSystemInbox: false },
];

describe('ai/autoOrganizeNote', () => {
  it('matches an existing topic and returns 1-3 tags', async () => {
    const result = await autoOrganizeNote(
      {
        title: 'Transformer Attention Scaling',
        content: 'Notes on multi-head self-attention complexity and flash attention kernels.',
        existingTopics: SAMPLE_TOPICS,
      },
      {
        generateFn: async () =>
          JSON.stringify({
            matchedTopicId: 'topic-ml',
            suggestedNewTopicName: null,
            tags: ['Transformer', 'Attention', 'Optimization'],
            summary: 'Explores attention complexity and memory-efficient kernels.',
          }),
      },
    );

    expect(result.degraded).toBe(false);
    expect(result.targetTopicId).toBe('topic-ml');
    expect(result.suggestedNewTopicName).toBeNull();
    expect(result.tags).toEqual(['Transformer', 'Attention', 'Optimization']);
  });

  it('allows at most 1 new topic when no existing topic fits', async () => {
    const result = await autoOrganizeNote(
      {
        title: 'Quantum Error Correction',
        content: 'Surface codes and stabilizer formalism basics.',
        existingTopics: SAMPLE_TOPICS,
      },
      {
        generateFn: async () =>
          JSON.stringify({
            matchedTopicId: null,
            suggestedNewTopicName: 'Quantum Computing',
            tags: ['Quantum', 'Error Correction'],
            summary: 'Introduces stabilizer formalism and surface codes.',
          }),
      },
    );

    expect(result.degraded).toBe(false);
    expect(result.suggestedNewTopicName).toBe('Quantum Computing');
    expect(result.tags).toHaveLength(2);
  });

  it('degrades gracefully to Inbox on LLM timeout or malformed JSON', async () => {
    const resultTimeout = await autoOrganizeNote(
      {
        title: 'Offline Resilience Note',
        content: 'Testing fallback path when AI times out.',
        existingTopics: SAMPLE_TOPICS,
      },
      {
        timeoutMs: 25,
        generateFn: (_prompt, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('Timeout')));
          }),
      },
    );

    expect(resultTimeout.degraded).toBe(true);
    expect(resultTimeout.targetTopicId).toBe('topic-inbox');
    expect(resultTimeout.suggestedNewTopicName).toBeNull();

    const resultMalformed = await autoOrganizeNote(
      {
        title: 'Invalid Response Note',
        content: 'Testing invalid JSON output.',
        existingTopics: SAMPLE_TOPICS,
      },
      {
        generateFn: async () => 'not valid json {{{',
      },
    );

    expect(resultMalformed.degraded).toBe(true);
    expect(resultMalformed.targetTopicId).toBe('topic-inbox');
  });
});
