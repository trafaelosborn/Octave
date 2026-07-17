import { listProjectFiles, readDocument } from '@trafaelosborn/octave/core';
import { getWorkspace } from '../../lib/workspaces';
import { jsonError } from '../../lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_RESULTS = 80;

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const query = (url.searchParams.get('q') ?? '').trim();
    if (query.length < 2) return Response.json({ results: [] });

    const workspace = await getWorkspace(url.searchParams.get('workspaceId'));
    const needles = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
    const files = await listProjectFiles(workspace.rootPath);
    const results: Array<{ path: string; line: number; column: number; preview: string }> = [];

    for (const file of files) {
      if (results.length >= MAX_RESULTS) break;
      if (file.size > 1_000_000) continue;

      const document = await readDocument(file.path, workspace.rootPath, 1_000_000);
      const lines = document.content.split(/\r?\n/);
      for (let index = 0; index < lines.length && results.length < MAX_RESULTS; index += 1) {
        const line = lines[index] ?? '';
        const lower = line.toLowerCase();
        if (!needles.every((needle) => lower.includes(needle))) continue;
        const column = Math.max(0, lower.indexOf(needles[0] ?? ''));
        results.push({
          path: file.path,
          line: index + 1,
          column: column + 1,
          preview: line.trim().slice(Math.max(0, column - 60), column + 180),
        });
      }
    }

    return Response.json({ results });
  } catch (error) {
    return jsonError(error);
  }
}
