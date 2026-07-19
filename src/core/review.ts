export const MAX_REVIEW_TITLE_CHARS = 120;
export const MAX_REVIEW_CONTENT_CHARS = 500_000;

export interface ReviewMemo {
  id: string;
  title: string;
  createdAt: string;
  sourceChatId: string;
  sourceMessageTs: string;
  sourceMessageIndex: number;
  artifactPath: string;
  content: string;
  documentPath?: string;
  providerId?: string;
  modelId?: string;
}

export type ReviewMemoMeta = Omit<ReviewMemo, 'content'>;

export function normalizeReviewTitle(title: string, fallback = 'Saved review'): string {
  const normalized = title.trim().replace(/\s+/g, ' ');
  const selected = normalized || fallback.trim().replace(/\s+/g, ' ') || 'Saved review';
  return selected.length > MAX_REVIEW_TITLE_CHARS
    ? `${selected.slice(0, MAX_REVIEW_TITLE_CHARS - 3)}...`
    : selected;
}

export function isReviewMemo(value: unknown): value is ReviewMemo {
  if (!value || typeof value !== 'object') return false;
  const memo = value as Partial<ReviewMemo>;
  return (
    typeof memo.id === 'string' && Boolean(memo.id) &&
    typeof memo.title === 'string' && Boolean(memo.title.trim()) && memo.title.length <= MAX_REVIEW_TITLE_CHARS &&
    typeof memo.createdAt === 'string' && Boolean(memo.createdAt) &&
    typeof memo.sourceChatId === 'string' && Boolean(memo.sourceChatId) &&
    typeof memo.sourceMessageTs === 'string' && Boolean(memo.sourceMessageTs) &&
    typeof memo.sourceMessageIndex === 'number' && Number.isSafeInteger(memo.sourceMessageIndex) && memo.sourceMessageIndex >= 0 &&
    typeof memo.artifactPath === 'string' && Boolean(memo.artifactPath) &&
    typeof memo.content === 'string' && Boolean(memo.content.trim()) && memo.content.length <= MAX_REVIEW_CONTENT_CHARS &&
    (memo.documentPath === undefined || typeof memo.documentPath === 'string') &&
    (memo.providerId === undefined || (typeof memo.providerId === 'string' && Boolean(memo.providerId.trim()))) &&
    (memo.modelId === undefined || (typeof memo.modelId === 'string' && Boolean(memo.modelId.trim())))
  );
}
