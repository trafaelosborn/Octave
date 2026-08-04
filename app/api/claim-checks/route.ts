import { buildClaimCheckReport } from '@trafaelosborn/octave/core';
import {
  listClaimChecks,
  listEvidenceMaps,
  loadCitationCheck,
  loadClaimCheck,
  loadEvidenceMap,
  saveClaimCheck,
} from '@trafaelosborn/octave/storage';
import { getWorkspace } from '../../lib/workspaces';
import { jsonError, readJsonBody } from '../../lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const workspace = await getWorkspace(url.searchParams.get('workspaceId'));
    const reportId = url.searchParams.get('reportId');
    if (reportId) return Response.json({ report: await loadClaimCheck(workspace.rootPath, reportId) });
    return Response.json({ reports: await listClaimChecks(workspace.rootPath) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJsonBody<{ workspaceId?: string; documentPath?: string; evidenceMapIds?: string[] }>(request);
    if (!body.documentPath?.trim()) throw new Error('A document path is required.');
    if (body.evidenceMapIds !== undefined && !Array.isArray(body.evidenceMapIds)) throw new Error('evidenceMapIds must be an array.');

    const workspace = await getWorkspace(body.workspaceId);
    const availableMaps = await listEvidenceMaps(workspace.rootPath);
    const selectedIds = body.evidenceMapIds?.length
      ? new Set(body.evidenceMapIds)
      : new Set(availableMaps.map((map) => map.id));
    const evidenceMaps = (await Promise.all([...selectedIds].map((id) => loadEvidenceMap(workspace.rootPath, id))))
      .filter((map): map is NonNullable<typeof map> => Boolean(map));
    const citationCheck = await loadCitationCheck(workspace.rootPath);
    const report = await buildClaimCheckReport(workspace.rootPath, body.documentPath, evidenceMaps, citationCheck);
    await saveClaimCheck(workspace.rootPath, report);
    return Response.json({ report, reports: await listClaimChecks(workspace.rootPath) });
  } catch (error) {
    return jsonError(error);
  }
}
