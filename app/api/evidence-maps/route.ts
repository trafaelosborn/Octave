import { buildEvidenceMap, buildSourceInventory, type BuildEvidenceMapInput } from '@trafaelosborn/octave/core';
import {
  listEvidenceMaps,
  loadEvidenceMap,
  loadSourceInventory,
  saveEvidenceMap,
} from '@trafaelosborn/octave/storage';
import { getWorkspace } from '../../lib/workspaces';
import { jsonError, readJsonBody } from '../../lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const workspace = await getWorkspace(url.searchParams.get('workspaceId'));
    const mapId = url.searchParams.get('mapId');
    if (mapId) return Response.json({ map: await loadEvidenceMap(workspace.rootPath, mapId) });
    return Response.json({ maps: await listEvidenceMaps(workspace.rootPath) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJsonBody<{
      workspaceId?: string;
      question?: string;
      title?: string;
      sourceLimit?: number;
    }>(request);
    if (body.question !== undefined && typeof body.question !== 'string') throw new Error('Evidence question must be a string.');
    if (body.title !== undefined && typeof body.title !== 'string') throw new Error('Evidence map title must be a string.');
    if (body.sourceLimit !== undefined && (!Number.isInteger(body.sourceLimit) || body.sourceLimit < 1)) {
      throw new Error('sourceLimit must be a positive integer.');
    }

    const workspace = await getWorkspace(body.workspaceId);
    const existing = await loadSourceInventory(workspace.rootPath);
    const inventory = await buildSourceInventory(workspace.rootPath, existing);
    if (inventory.items.length === 0) throw new Error('Add files to a sources/ folder before creating an evidence map.');
    const options: BuildEvidenceMapInput = {};
    if (body.question !== undefined) options.question = body.question;
    if (body.title !== undefined) options.title = body.title;
    if (body.sourceLimit !== undefined) options.sourceLimit = body.sourceLimit;
    const map = await buildEvidenceMap(workspace.rootPath, inventory, options);
    await saveEvidenceMap(workspace.rootPath, map);
    return Response.json({ map, maps: await listEvidenceMaps(workspace.rootPath) });
  } catch (error) {
    return jsonError(error);
  }
}
