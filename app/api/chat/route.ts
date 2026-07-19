import { sendChatMessage } from '@trafaelosborn/octave/core';
import { createChat, loadChat } from '@trafaelosborn/octave/storage';
import { listPinnedPaths } from '../../lib/context-store';
import { jsonError, readJsonBody } from '../../lib/http';
import { createProvider } from '../../lib/providers';
import { getWorkspace } from '../../lib/workspaces';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJsonBody<{
      workspaceId?: string;
      chatId?: string;
      prompt?: string;
      documentPath?: string;
      provider?: string;
      model?: string;
      attachmentPaths?: string[];
      includeCitationEvidence?: boolean;
    }>(request);
    const prompt = body.prompt?.trim() ?? '';
    if (!prompt) throw new Error('A prompt is required.');
    if (body.attachmentPaths !== undefined && (
      !Array.isArray(body.attachmentPaths) ||
      body.attachmentPaths.some((attachmentPath) => typeof attachmentPath !== 'string')
    )) {
      throw new Error('attachmentPaths must be an array of workspace-relative file paths.');
    }
    if (body.includeCitationEvidence !== undefined && typeof body.includeCitationEvidence !== 'boolean') {
      throw new Error('includeCitationEvidence must be a boolean.');
    }

    const workspace = await getWorkspace(body.workspaceId);
    const provider = createProvider(body.provider ?? process.env.OCTAVE_DEFAULT_PROVIDER ?? 'ollama', body.model);
    if (provider.isAvailable && !(await provider.isAvailable())) {
      return jsonError(new Error(`${provider.name} is not available. Check its local service or credentials.`), 503);
    }

    const existingChat = body.chatId ? await loadChat(workspace.rootPath, body.chatId) : null;
    const newChatOptions: { scope: 'workspace' | 'document'; documentPath?: string } = {
      scope: body.documentPath ? 'document' : 'workspace',
    };
    if (body.documentPath !== undefined) newChatOptions.documentPath = body.documentPath;
    const chat = existingChat ?? await createChat(workspace.rootPath, newChatOptions);
    const scopedDocumentPath = chat.scope === 'document' ? chat.documentPath : undefined;
    const pinnedFiles = await listPinnedPaths(workspace.rootPath);
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const options: Parameters<typeof sendChatMessage>[0] = {
          workspaceRoot: workspace.rootPath,
          chatId: chat.id,
          userMessage: prompt,
          provider,
          pinnedFiles,
        };
        if (scopedDocumentPath !== undefined) options.currentDocumentPath = scopedDocumentPath;
        if (body.model !== undefined) options.model = body.model;
        if (body.attachmentPaths !== undefined) options.attachmentPaths = body.attachmentPaths;
        if (body.includeCitationEvidence !== undefined) options.includeCitationEvidence = body.includeCitationEvidence;

        sendChatMessage(options, (delta) => {
          controller.enqueue(encoder.encode(delta));
        }).then(() => {
          controller.close();
        }).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          controller.enqueue(encoder.encode(`\n\n[Octave error: ${message}]`));
          controller.close();
        });
      },
    });

    return new Response(stream, {
      headers: {
        'Cache-Control': 'no-cache, no-transform',
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Accel-Buffering': 'no',
        'X-Octave-Chat-Id': chat.id,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
