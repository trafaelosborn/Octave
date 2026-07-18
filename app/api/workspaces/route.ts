import { deleteWorkspace, listWorkspaces, upsertWorkspace } from '../../lib/workspaces';
import { jsonError, readJsonBody } from '../../lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    return Response.json({ workspaces: await listWorkspaces() });
  } catch (error) {
    return jsonError(error, 500);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJsonBody<{ rootPath?: string; name?: string }>(request);
    const input: { rootPath: string; name?: string } = { rootPath: body.rootPath ?? '' };
    if (body.name !== undefined) input.name = body.name;
    const workspace = await upsertWorkspace(input);
    return Response.json({ workspace, workspaces: await listWorkspaces() });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const workspaceId = new URL(request.url).searchParams.get('id');
    if (!workspaceId) throw new Error('Workspace ID is required.');
    return Response.json({ workspaces: await deleteWorkspace(workspaceId) });
  } catch (error) {
    return jsonError(error);
  }
}
