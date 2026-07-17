import { listProjectFiles } from '@trafaelosborn/octave/core';
import { getWorkspace } from '../../lib/workspaces';
import { jsonError } from '../../lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    const workspaceId = new URL(request.url).searchParams.get('workspaceId');
    const workspace = await getWorkspace(workspaceId);
    const files = await listProjectFiles(workspace.rootPath);
    return Response.json({ workspace, files });
  } catch (error) {
    return jsonError(error);
  }
}
