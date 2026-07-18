import { readDocument } from './path.js';

export interface ContextOptions {
  workspaceRoot: string;
  currentDocumentPath?: string;
  pinnedFiles?: string[];
  maxContextChars?: number;
}

const DEFAULT_MAX_CONTEXT_CHARS = 80_000;

export async function buildWorkspaceContext(options: ContextOptions): Promise<string> {
  const maxContextChars = options.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS;
  if (!Number.isInteger(maxContextChars) || maxContextChars < 1) {
    throw new Error('maxContextChars must be a positive integer.');
  }

  const candidates = [options.currentDocumentPath, ...(options.pinnedFiles ?? [])]
    .filter((value): value is string => Boolean(value));
  const paths = [...new Set(candidates)];
  const parts = [
    'You are Octave, a local-first research assistant.',
    'Work precisely from the supplied research documents. Distinguish what the documents establish from your own inference.',
  ];

  if (paths.length === 0) {
    parts.push('No document content is attached to this message.');
    return parts.join('\n\n');
  }

  let remaining = maxContextChars;
  for (const documentPath of paths) {
    if (remaining <= 0) break;

    try {
      const document = await readDocument(documentPath, options.workspaceRoot, remaining);
      const label = documentPath === options.currentDocumentPath ? 'current document' : 'pinned file';
      parts.push([
        `<document path="${escapeAttribute(document.path)}" role="${label}" format="${escapeAttribute(document.kind)}">`,
        document.content,
        ...document.warnings.map((warning) => `\n[extraction warning: ${warning}]`),
        '</document>',
      ].join('\n'));
      remaining -= document.content.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      parts.push(`<document-error path="${escapeAttribute(documentPath)}">${message}</document-error>`);
    }
  }

  if (remaining <= 0 && paths.length > 1) {
    parts.push('[Additional context files omitted because the context limit was reached.]');
  }

  return parts.join('\n\n');
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
