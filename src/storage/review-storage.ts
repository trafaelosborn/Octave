import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  isReviewMemo,
  MAX_REVIEW_CONTENT_CHARS,
  normalizeReviewTitle,
  type ReviewMemo,
  type ReviewMemoMeta,
} from '../core/review.js';

const REVIEWS_DIRECTORY = path.join('.octave', 'reviews');
const REVIEW_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;
const REVIEW_HEADER = '<!-- octave-review';

export interface CreateReviewInput {
  content: string;
  sourceChatId: string;
  sourceMessageTs: string;
  sourceMessageIndex: number;
  title?: string;
  documentPath?: string;
  providerId?: string;
  modelId?: string;
}

export async function ensureReviewDirectory(workspaceRoot: string): Promise<string> {
  const directory = path.join(path.resolve(workspaceRoot), REVIEWS_DIRECTORY);
  await fs.mkdir(directory, { recursive: true });
  return directory;
}

export async function createReview(workspaceRoot: string, input: CreateReviewInput): Promise<ReviewMemo> {
  const content = input.content.trim();
  if (!content) throw new Error('A review memo cannot be empty.');
  if (content.length > MAX_REVIEW_CONTENT_CHARS) {
    throw new Error(`Review memo exceeds the ${MAX_REVIEW_CONTENT_CHARS.toLocaleString()} character limit.`);
  }
  if (!Number.isSafeInteger(input.sourceMessageIndex) || input.sourceMessageIndex < 0) {
    throw new Error('A valid source message index is required.');
  }

  const id = randomUUID();
  const artifactPath = path.posix.join('.octave', 'reviews', `${id}.md`);
  const contentTitle = deriveTitle(content);
  const fallbackTitle = input.documentPath
    ? `${path.posix.basename(input.documentPath)} — ${contentTitle}`
    : contentTitle;
  const memo: ReviewMemo = {
    id,
    title: normalizeReviewTitle(input.title ?? '', fallbackTitle),
    createdAt: new Date().toISOString(),
    sourceChatId: input.sourceChatId,
    sourceMessageTs: input.sourceMessageTs,
    sourceMessageIndex: input.sourceMessageIndex,
    artifactPath,
    content,
  };
  if (input.documentPath !== undefined) memo.documentPath = input.documentPath;
  if (input.providerId !== undefined) memo.providerId = input.providerId;
  if (input.modelId !== undefined) memo.modelId = input.modelId;
  if (!isReviewMemo(memo)) throw new Error('Cannot create an invalid review memo.');

  const directory = await ensureReviewDirectory(workspaceRoot);
  const destination = path.join(directory, `${id}.md`);
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, serializeReview(memo), 'utf8');
  await fs.rename(temporary, destination);
  return memo;
}

export async function listReviews(workspaceRoot: string): Promise<ReviewMemoMeta[]> {
  const directory = await ensureReviewDirectory(workspaceRoot);
  const files = await fs.readdir(directory).catch(() => []);
  const reviews: ReviewMemoMeta[] = [];

  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const reviewId = file.slice(0, -'.md'.length);
    if (!REVIEW_ID_PATTERN.test(reviewId)) continue;
    try {
      const review = await readReview(path.join(directory, file));
      if (review.id !== reviewId) continue;
      reviews.push(toMetadata(review));
    } catch {
      // A malformed review artifact should not hide neighboring memos.
    }
  }

  return reviews.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function loadReview(workspaceRoot: string, reviewId: string): Promise<ReviewMemo | null> {
  assertValidReviewId(reviewId);
  try {
    const review = await readReview(await reviewFilePath(workspaceRoot, reviewId));
    if (review.id !== reviewId) throw new Error('Review memo ID does not match its artifact name.');
    return review;
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

export async function deleteReview(workspaceRoot: string, reviewId: string): Promise<boolean> {
  assertValidReviewId(reviewId);
  try {
    await fs.unlink(await reviewFilePath(workspaceRoot, reviewId));
    return true;
  } catch (error) {
    if (isMissingFileError(error)) return false;
    throw error;
  }
}

export function assertValidReviewId(reviewId: string): void {
  if (!REVIEW_ID_PATTERN.test(reviewId)) throw new Error('Invalid review ID.');
}

function serializeReview(review: ReviewMemo): string {
  const metadata = toMetadata(review);
  return `${REVIEW_HEADER}\n${JSON.stringify(metadata, null, 2)}\n-->\n\n# ${review.title}\n\n${review.content}\n`;
}

async function readReview(filePath: string): Promise<ReviewMemo> {
  const raw = await fs.readFile(filePath, 'utf8');
  const match = raw.match(/^<!-- octave-review\r?\n([\s\S]*?)\r?\n-->\r?\n\r?\n# [^\r\n]+\r?\n\r?\n/);
  if (!match?.[1]) throw new Error(`Invalid review artifact: ${path.basename(filePath)}`);

  let metadata: unknown;
  try {
    metadata = JSON.parse(match[1]);
  } catch {
    throw new Error(`Invalid review metadata: ${path.basename(filePath)}`);
  }

  const review = { ...(metadata as object), content: raw.slice(match[0].length).trimEnd() };
  if (!isReviewMemo(review)) throw new Error(`Invalid review memo: ${path.basename(filePath)}`);
  return review;
}

async function reviewFilePath(workspaceRoot: string, reviewId: string): Promise<string> {
  assertValidReviewId(reviewId);
  return path.join(await ensureReviewDirectory(workspaceRoot), `${reviewId}.md`);
}

function toMetadata(review: ReviewMemo): ReviewMemoMeta {
  const metadata: ReviewMemoMeta = {
    id: review.id,
    title: review.title,
    createdAt: review.createdAt,
    sourceChatId: review.sourceChatId,
    sourceMessageTs: review.sourceMessageTs,
    sourceMessageIndex: review.sourceMessageIndex,
    artifactPath: review.artifactPath,
  };
  if (review.documentPath !== undefined) metadata.documentPath = review.documentPath;
  if (review.providerId !== undefined) metadata.providerId = review.providerId;
  if (review.modelId !== undefined) metadata.modelId = review.modelId;
  return metadata;
}

function deriveTitle(content: string): string {
  const heading = content.match(/^#{1,6}\s+(.+)$/m)?.[1];
  if (heading) return heading.replace(/[*_`]/g, '').trim();
  const firstLine = content.split(/\r?\n/).find((line) => line.trim()) ?? 'Saved review';
  return firstLine.replace(/^[-*>\s]+/, '').replace(/[*_`]/g, '').trim();
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
