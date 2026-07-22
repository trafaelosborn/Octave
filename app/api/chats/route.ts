import { createChat, deleteChat, listChats, loadChat, renameChat } from '@trafaelosborn/octave/storage';
import { getWorkspace } from '../../lib/workspaces';
import { jsonError, readJsonBody } from '../../lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const workspace = await getWorkspace(url.searchParams.get('workspaceId'));
    const chatId = url.searchParams.get('chatId');
    if (chatId) return Response.json({ chat: await loadChat(workspace.rootPath, chatId) });
    return Response.json({ chats: await listChats(workspace.rootPath) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJsonBody<{ workspaceId?: string; title?: string; scope?: 'workspace' | 'document'; documentPath?: string }>(request);
    const workspace = await getWorkspace(body.workspaceId);
    const options: { title?: string; scope?: 'workspace' | 'document'; documentPath?: string } = {};
    if (body.title !== undefined) options.title = body.title;
    if (body.scope !== undefined) options.scope = body.scope;
    if (body.documentPath !== undefined) options.documentPath = body.documentPath;
    return Response.json({ chat: await createChat(workspace.rootPath, options) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const workspace = await getWorkspace(url.searchParams.get('workspaceId'));
    const chatId = url.searchParams.get('chatId');
    if (!chatId) throw new Error('Chat ID is required.');
    return Response.json({ deleted: await deleteChat(workspace.rootPath, chatId) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const body = await readJsonBody<{ workspaceId?: string; chatId?: string; title?: string }>(request);
    const workspace = await getWorkspace(body.workspaceId);
    if (!body.chatId) throw new Error('Chat ID is required.');
    if (typeof body.title !== 'string') throw new Error('Chat title is required.');
    return Response.json({ chat: await renameChat(workspace.rootPath, body.chatId, body.title) });
  } catch (error) {
    return jsonError(error);
  }
}
