import fs from 'node:fs/promises';
import { readDocument, resolveExistingResearchPath, resolvePdfArtifactPath, writeDocument } from '@trafaelosborn/octave/core';
import { getWorkspace, updateLastDocument } from '../../lib/workspaces';
import { jsonError, readJsonBody } from '../../lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_DOCUMENT_CHARS = 2_000_000;

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const workspace = await getWorkspace(url.searchParams.get('workspaceId'));
    const document = await readDocument(url.searchParams.get('path') ?? '', workspace.rootPath, MAX_DOCUMENT_CHARS);
    const resolved = await resolveExistingResearchPath(document.path, workspace.rootPath);
    const stat = await fs.stat(resolved.absolute);
    const pdfAvailable = resolved.extension === '.tex'
      ? await safePdfAvailable(document.path, workspace.rootPath)
      : false;

    await updateLastDocument(workspace.id, document.path);
    return Response.json({
      path: document.path,
      extension: resolved.extension,
      content: document.content,
      readOnly: !document.editable,
      extractionWarnings: document.warnings,
      truncated: document.truncated,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      pdfAvailable,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const body = await readJsonBody<{ workspaceId?: string; path?: string; content?: string }>(request);
    const workspace = await getWorkspace(body.workspaceId);
    const content = body.content ?? '';
    if (content.length > MAX_DOCUMENT_CHARS) throw new Error('Document exceeds the 2,000,000 character editor limit.');

    const document = await writeDocument(body.path ?? '', workspace.rootPath, content);
    const stat = await fs.stat(document.absolute);
    await updateLastDocument(workspace.id, document.relative);
    return Response.json({
      path: document.relative,
      extension: document.extension,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      pdfAvailable: document.extension === '.tex'
        ? await safePdfAvailable(document.relative, workspace.rootPath)
        : false,
    });
  } catch (error) {
    return jsonError(error);
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function safePdfAvailable(documentPath: string, workspaceRoot: string): Promise<boolean> {
  try {
    const pdf = await resolvePdfArtifactPath(documentPath, workspaceRoot);
    return await fileExists(pdf.absolute);
  } catch {
    return false;
  }
}
