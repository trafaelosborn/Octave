import { scanCitations } from '../../lib/citations';
import { getWorkspace } from '../../lib/workspaces';
import { jsonError } from '../../lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    const workspace = await getWorkspace(new URL(request.url).searchParams.get('workspaceId'));
    return Response.json(await scanCitations(workspace.rootPath));
  } catch (error) {
    return jsonError(error);
  }
}
