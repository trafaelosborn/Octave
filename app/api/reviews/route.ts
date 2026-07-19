import {
  createReview,
  deleteReview,
  listReviews,
  loadChat,
  loadReview,
} from '@trafaelosborn/octave/storage';
import { getWorkspace } from '../../lib/workspaces';
import { jsonError, readJsonBody } from '../../lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const workspace = await getWorkspace(url.searchParams.get('workspaceId'));
    const reviewId = url.searchParams.get('reviewId');
    if (reviewId) return Response.json({ review: await loadReview(workspace.rootPath, reviewId) });
    return Response.json({ reviews: await listReviews(workspace.rootPath) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJsonBody<{
      workspaceId?: string;
      chatId?: string;
      messageIndex?: number;
      title?: string;
    }>(request);
    if (!body.chatId) throw new Error('Chat ID is required.');
    if (!Number.isSafeInteger(body.messageIndex) || (body.messageIndex ?? -1) < 0) {
      throw new Error('A valid assistant message index is required.');
    }
    if (body.title !== undefined && typeof body.title !== 'string') {
      throw new Error('Review title must be a string.');
    }

    const workspace = await getWorkspace(body.workspaceId);
    const chat = await loadChat(workspace.rootPath, body.chatId);
    if (!chat) throw new Error('Chat session was not found.');
    const messageIndex = body.messageIndex as number;
    const message = chat.messages[messageIndex];
    if (!message || message.role !== 'assistant' || !message.content.trim()) {
      throw new Error('Only a completed assistant response can be saved as a review.');
    }

    const existing = (await listReviews(workspace.rootPath)).find((review) => (
      review.sourceChatId === chat.id &&
      review.sourceMessageTs === message.ts &&
      review.sourceMessageIndex === messageIndex
    ));
    if (existing) {
      const existingReview = await loadReview(workspace.rootPath, existing.id);
      if (existingReview) return Response.json({ review: existingReview, created: false });
    }

    const input: Parameters<typeof createReview>[1] = {
      content: message.content,
      sourceChatId: chat.id,
      sourceMessageTs: message.ts,
      sourceMessageIndex: messageIndex,
    };
    if (body.title !== undefined) input.title = body.title;
    if (chat.documentPath !== undefined) input.documentPath = chat.documentPath;
    if (message.providerId !== undefined) input.providerId = message.providerId;
    if (message.modelId !== undefined) input.modelId = message.modelId;

    return Response.json({ review: await createReview(workspace.rootPath, input), created: true });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const workspace = await getWorkspace(url.searchParams.get('workspaceId'));
    const reviewId = url.searchParams.get('reviewId');
    if (!reviewId) throw new Error('Review ID is required.');
    return Response.json({ deleted: await deleteReview(workspace.rootPath, reviewId) });
  } catch (error) {
    return jsonError(error);
  }
}
