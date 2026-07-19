import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_REVIEW_CONTENT_CHARS, MAX_REVIEW_TITLE_CHARS } from '../src/core/review.js';
import {
  createReview,
  deleteReview,
  ensureReviewDirectory,
  listReviews,
  loadReview,
} from '../src/storage/review-storage.js';

describe('workspace review storage', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'octave-reviews-'));
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('creates a readable Markdown artifact and round-trips its source metadata', async () => {
    const review = await createReview(workspaceRoot, {
      title: '  Invariant   review  ',
      content: '## Verdict\n\nThe invariant needs a stronger hypothesis.',
      sourceChatId: 'chat-1',
      sourceMessageTs: '2026-07-19T12:00:00.000Z',
      sourceMessageIndex: 3,
      documentPath: 'paper.tex',
      providerId: 'openai',
      modelId: 'gpt-test',
    });

    expect(review.title).toBe('Invariant review');
    expect(review.artifactPath).toBe(`.octave/reviews/${review.id}.md`);
    expect(await loadReview(workspaceRoot, review.id)).toEqual(review);
    expect(await listReviews(workspaceRoot)).toEqual([{ ...review, content: undefined }].map(({ content: _content, ...metadata }) => metadata));

    const raw = await fs.readFile(path.join(workspaceRoot, ...review.artifactPath.split('/')), 'utf8');
    expect(raw).toContain('<!-- octave-review');
    expect(raw).toContain('# Invariant review');
    expect(raw).toContain('The invariant needs a stronger hypothesis.');
  });

  it('derives and bounds titles while rejecting oversized content', async () => {
    const review = await createReview(workspaceRoot, {
      content: `# ${'Long heading '.repeat(20)}\n\nBody`,
      sourceChatId: 'chat-2',
      sourceMessageTs: '2026-07-19T12:00:00.000Z',
      sourceMessageIndex: 1,
    });
    expect(review.title.length).toBe(MAX_REVIEW_TITLE_CHARS);
    expect(review.title.endsWith('...')).toBe(true);

    await expect(createReview(workspaceRoot, {
      content: 'x'.repeat(MAX_REVIEW_CONTENT_CHARS + 1),
      sourceChatId: 'chat-2',
      sourceMessageTs: '2026-07-19T12:00:00.000Z',
      sourceMessageIndex: 1,
    })).rejects.toThrow('character limit');
  });

  it('isolates malformed artifacts and safely deletes valid memos', async () => {
    const review = await createReview(workspaceRoot, {
      content: 'A durable review.',
      sourceChatId: 'chat-3',
      sourceMessageTs: '2026-07-19T12:00:00.000Z',
      sourceMessageIndex: 1,
    });
    await fs.writeFile(path.join(await ensureReviewDirectory(workspaceRoot), 'broken.md'), 'not a review', 'utf8');

    expect(await listReviews(workspaceRoot)).toMatchObject([{ id: review.id }]);
    await expect(loadReview(workspaceRoot, '../outside')).rejects.toThrow('Invalid review ID');
    expect(await deleteReview(workspaceRoot, review.id)).toBe(true);
    expect(await deleteReview(workspaceRoot, review.id)).toBe(false);
  });
});
