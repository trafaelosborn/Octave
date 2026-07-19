'use client';

import type { ReviewMemo } from '../lib/client-types';
import { Icon } from './Icon';
import { MarkdownMessage } from './MarkdownMessage';

export function ReviewMemoPanel({
  review,
  deleting,
  onOpenSourceChat,
  onDelete,
}: {
  review: ReviewMemo | null;
  deleting: boolean;
  onOpenSourceChat: (chatId: string) => void;
  onDelete: (review: ReviewMemo) => void;
}) {
  if (!review) {
    return (
      <div className="empty-pane">
        <span className="review-mark"><Icon name="book" size={26}/></span>
        <h3>No saved review selected</h3>
        <p>Save a completed Octave response, then open it from the Reviews rail.</p>
      </div>
    );
  }

  return (
    <article className="review-memo-panel">
      <header>
        <div>
          <p className="eyebrow">Saved review memo</p>
          <h2>{review.title}</h2>
          <div className="review-memo-meta">
            <span>{formatDate(review.createdAt)}</span>
            <span>{review.documentPath ?? 'Project review'}</span>
            {review.providerId && <span>{review.providerId}{review.modelId ? ` · ${review.modelId}` : ''}</span>}
          </div>
        </div>
        <div className="review-memo-actions">
          <button className="button button-quiet" onClick={() => onOpenSourceChat(review.sourceChatId)}>
            <Icon name="chat" size={15}/>Source chat
          </button>
          <button className="button button-danger" disabled={deleting} onClick={() => onDelete(review)}>
            {deleting ? 'Deleting...' : 'Delete memo'}
          </button>
        </div>
      </header>
      <div className="review-artifact-path"><Icon name="file" size={13}/><span>{review.artifactPath}</span></div>
      <div className="review-memo-content"><MarkdownMessage content={review.content}/></div>
    </article>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}
