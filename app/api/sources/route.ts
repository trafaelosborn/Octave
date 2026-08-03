import {
  buildSourceInventory,
  isSourceRole,
  updateSourceInventoryRole,
  type SourceInventory,
} from '@trafaelosborn/octave/core';
import { loadSourceInventory, saveSourceInventory } from '@trafaelosborn/octave/storage';
import { getWorkspace } from '../../lib/workspaces';
import { jsonError, readJsonBody } from '../../lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    const workspace = await getWorkspace(new URL(request.url).searchParams.get('workspaceId'));
    return Response.json(await scanSources(workspace.rootPath));
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJsonBody<{ workspaceId?: string; action?: 'refresh' }>(request);
    if (body.action !== undefined && body.action !== 'refresh') throw new Error('Unsupported source inventory action.');
    const workspace = await getWorkspace(body.workspaceId);
    const inventory = await scanSources(workspace.rootPath);
    await saveSourceInventory(workspace.rootPath, inventory);
    return Response.json(inventory);
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const body = await readJsonBody<{ workspaceId?: string; path?: string; role?: string }>(request);
    if (!body.path?.trim()) throw new Error('A source path is required.');
    if (!isSourceRole(body.role)) throw new Error('A valid source role is required.');
    const workspace = await getWorkspace(body.workspaceId);
    const inventory = await scanSources(workspace.rootPath);
    const updated = updateSourceInventoryRole(inventory, body.path, body.role);
    await saveSourceInventory(workspace.rootPath, updated);
    return Response.json(updated);
  } catch (error) {
    return jsonError(error);
  }
}

async function scanSources(workspaceRoot: string): Promise<SourceInventory> {
  const existing = await loadSourceInventory(workspaceRoot);
  return buildSourceInventory(workspaceRoot, existing);
}
