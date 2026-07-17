import { createChat, deleteChat, listChats, loadChat } from '@trafaelosborn/octave/storage';
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
    const body = await readJsonBody<{ workspaceId?: string; title?: string }>(request);
    const workspace = await getWorkspace(body.workspaceId);
    return Response.json({ chat: await createChat(workspace.rootPath, body.title) });
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
