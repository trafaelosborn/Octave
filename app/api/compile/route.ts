import { compileDocument, type CompileEngine } from '@trafaelosborn/octave/core';
import { getWorkspace } from '../../lib/workspaces';
import { jsonError, readJsonBody } from '../../lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJsonBody<{
      workspaceId?: string;
      path?: string;
      engine?: CompileEngine;
    }>(request);
    const workspace = await getWorkspace(body.workspaceId);
    const result = await compileDocument(body.path ?? '', workspace.rootPath, {
      engine: body.engine ?? 'pdflatex',
    });
    return Response.json(result, { status: result.ok ? 200 : 422 });
  } catch (error) {
    return jsonError(error);
  }
}
