import { buildCitationEvidenceAudit, syncCitationCorpus } from '@trafaelosborn/octave/core';
import { scanCitations } from '../../lib/citations';
import { getWorkspace } from '../../lib/workspaces';
import { jsonError, readJsonBody } from '../../lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    const workspace = await getWorkspace(new URL(request.url).searchParams.get('workspaceId'));
    return Response.json(await scanCitations(workspace.rootPath, {
      unpaywallConfigured: Boolean(process.env.OCTAVE_SCHOLARLY_EMAIL?.trim()),
    }));
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJsonBody<{ workspaceId?: string; force?: boolean }>(request);
    if (body.force !== undefined && typeof body.force !== 'boolean') throw new Error('force must be a boolean.');
    const workspace = await getWorkspace(body.workspaceId);
    const email = process.env.OCTAVE_SCHOLARLY_EMAIL?.trim();
    const options: Parameters<typeof syncCitationCorpus>[1] = {};
    if (email) options.email = email;
    if (body.force !== undefined) options.force = body.force;
    await syncCitationCorpus(workspace.rootPath, options);
    await buildCitationEvidenceAudit(workspace.rootPath);
    return Response.json(await scanCitations(workspace.rootPath, {
      unpaywallConfigured: Boolean(email),
    }));
  } catch (error) {
    return jsonError(error);
  }
}
