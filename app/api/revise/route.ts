import { readDocument } from '@trafaelosborn/octave/core';
import type { Message } from '@trafaelosborn/octave/providers';
import { jsonError, readJsonBody } from '../../lib/http';
import { createProvider } from '../../lib/providers';
import { getWorkspace } from '../../lib/workspaces';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_REVISION_CHARS = 2_000_000;

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJsonBody<{
      workspaceId?: string;
      path?: string;
      instruction?: string;
      provider?: string;
      model?: string;
    }>(request);
    const instruction = body.instruction?.trim() ?? '';
    if (!instruction) throw new Error('A revision instruction is required.');

    const workspace = await getWorkspace(body.workspaceId);
    const document = await readDocument(body.path ?? '', workspace.rootPath, MAX_REVISION_CHARS);
    if (!document.editable) throw new Error('Extracted document previews are read-only and cannot be revised in place.');
    if (document.truncated) throw new Error('Document is too large for the revision workflow.');

    const providerId = body.provider ?? process.env.OCTAVE_DEFAULT_PROVIDER ?? 'ollama';
    let after: string;
    if (providerId === 'demo') {
      after = demoRevision(document.content, instruction, document.path);
    } else {
      const provider = createProvider(providerId, body.model);
      if (provider.isAvailable && !(await provider.isAvailable())) {
        return jsonError(new Error(`${provider.name} is not available. Check its local service or credentials.`), 503);
      }

      const messages: Message[] = [
        {
          role: 'system',
          content: [
            'You are Octave\'s document revision engine.',
            'Apply the requested change conservatively while preserving the author\'s voice, notation, and file format.',
            'Return only the complete revised document between <octave-document> and </octave-document> tags.',
            'Do not use Markdown fences and do not omit unchanged sections.',
            `<document path="${document.path}">\n${document.content}\n</document>`,
          ].join('\n\n'),
        },
        { role: 'user', content: instruction },
      ];

      let response = '';
      for await (const delta of provider.streamChat(messages, body.model ? { model: body.model } : {})) {
        response += delta;
        if (response.length > MAX_REVISION_CHARS * 1.5) {
          throw new Error('Revision response exceeded the safety limit.');
        }
      }
      after = extractRevision(response);
    }

    if (after === document.content) throw new Error('The provider returned no document changes.');
    return Response.json({
      path: document.path,
      instruction,
      before: document.content,
      after,
    });
  } catch (error) {
    return jsonError(error);
  }
}

function extractRevision(response: string): string {
  const match = response.match(/<octave-document>\s*([\s\S]*?)\s*<\/octave-document>/i);
  if (!match?.[1]) {
    throw new Error('The provider did not return a complete reviewable document.');
  }
  return match[1].replace(/^```[^\n]*\n/, '').replace(/\n```$/, '');
}

function demoRevision(source: string, instruction: string, documentPath: string): string {
  const cleanInstruction = instruction.replace(/[\r\n]+/g, ' ').slice(0, 120);
  if (documentPath.endsWith('.tex')) {
    const note = `% Octave demo revision: ${cleanInstruction}\n`;
    return source.includes('\\end{document}')
      ? source.replace('\\end{document}', `${note}\\end{document}`)
      : `${source.trimEnd()}\n${note}`;
  }
  return `${source.trimEnd()}\n\n<!-- Octave demo revision: ${cleanInstruction} -->\n`;
}
