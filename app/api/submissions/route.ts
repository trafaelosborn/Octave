import fs from 'node:fs/promises';
import {
  createSubmissionDraft,
  createSubmissionPackage,
  listSubmissionPackages,
  preflightSubmission,
  resolveSubmissionArtifact,
  saveSubmissionManifest,
  type SubmissionManifest,
} from '@trafaelosborn/octave/core';
import { jsonError, readJsonBody } from '../../lib/http';
import { getWorkspace } from '../../lib/workspaces';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const workspace = await getWorkspace(url.searchParams.get('workspaceId'));
    const packageId = url.searchParams.get('packageId');
    const artifactName = url.searchParams.get('artifact');
    if (packageId || artifactName) {
      if (!packageId || !artifactName) throw new Error('Both packageId and artifact are required.');
      const artifact = await resolveSubmissionArtifact(workspace.rootPath, packageId, artifactName);
      const content = new Uint8Array(await fs.readFile(artifact.absolute));
      return new Response(content, {
        headers: {
          'Content-Disposition': `attachment; filename="${artifact.name.replace(/["\r\n]/g, '')}"`,
          'Content-Type': contentType(artifact.name),
          'Cache-Control': 'no-store',
        },
      });
    }

    const manifest = await createSubmissionDraft(workspace.rootPath, url.searchParams.get('documentPath') ?? '');
    return Response.json({
      manifest,
      preflight: await preflightSubmission(workspace.rootPath, manifest),
      packages: await listSubmissionPackages(workspace.rootPath),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJsonBody<{
      workspaceId?: string;
      action?: 'save' | 'preflight' | 'package';
      manifest?: SubmissionManifest;
    }>(request);
    const workspace = await getWorkspace(body.workspaceId);
    if (!body.manifest) throw new Error('Submission manifest is required.');
    if (!['save', 'preflight', 'package'].includes(body.action ?? '')) throw new Error('Unknown submission action.');

    const created = body.action === 'package'
      ? await createSubmissionPackage(workspace.rootPath, body.manifest)
      : undefined;
    const manifest = created
      ? await createSubmissionDraft(workspace.rootPath)
      : await saveSubmissionManifest(workspace.rootPath, body.manifest);
    const response: Record<string, unknown> = {
      manifest,
      preflight: created?.preflight ?? await preflightSubmission(workspace.rootPath, manifest),
      packages: await listSubmissionPackages(workspace.rootPath),
    };
    if (created) response.created = created;
    return Response.json(response);
  } catch (error) {
    return jsonError(error);
  }
}

function contentType(name: string): string {
  if (name.endsWith('.zip')) return 'application/zip';
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}
