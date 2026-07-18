import { listPinnedPaths, savePinnedPaths } from '../../lib/context-store';
import { getWorkspace } from '../../lib/workspaces';
import { jsonError, readJsonBody } from '../../lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    const workspace = await getWorkspace(new URL(request.url).searchParams.get('workspaceId'));
    return Response.json({ pinnedPaths: await listPinnedPaths(workspace.rootPath) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const body = await readJsonBody<{ workspaceId?: string; pinnedPaths?: string[] }>(request);
    const workspace = await getWorkspace(body.workspaceId);
    const pinnedPaths = await savePinnedPaths(workspace.rootPath, body.pinnedPaths ?? []);
    return Response.json({ pinnedPaths });
  } catch (error) {
    return jsonError(error);
  }
}
