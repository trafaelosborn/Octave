import fs from 'node:fs/promises';
import path from 'node:path';
import { resolvePdfArtifactPath } from '@trafaelosborn/octave/core';
import { getWorkspace } from '../../lib/workspaces';
import { jsonError } from '../../lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const workspace = await getWorkspace(url.searchParams.get('workspaceId'));
    const pdf = await resolvePdfArtifactPath(url.searchParams.get('path') ?? '', workspace.rootPath);
    const data = await fs.readFile(pdf.absolute);
    const filename = `${path.basename(pdf.source.relative, pdf.source.extension)}.pdf`;
    return new Response(data, {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Disposition': `inline; filename="${filename.replace(/"/g, '')}"`,
        'Content-Type': 'application/pdf',
      },
    });
  } catch (error) {
    return jsonError(error, 404);
  }
}
