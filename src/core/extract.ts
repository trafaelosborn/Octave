import fs from 'node:fs/promises';
import path from 'node:path';
import { parseOffice, type SupportedFileType } from 'officeparser';

export type ExtractedDocumentKind = 'text' | 'pdf' | 'office' | 'image';

export interface ExtractionResult {
  content: string;
  kind: ExtractedDocumentKind;
  warnings: string[];
  sourceBytes: number;
  truncated: boolean;
}

export interface ExtractionOptions {
  maxChars?: number;
  maxSourceBytes?: number;
  timeoutMs?: number;
}

export const TEXT_DOCUMENT_EXTENSIONS = new Set([
  '.tex', '.bib', '.md', '.txt', '.sty', '.cls', '.py', '.r',
  '.csv', '.tsv', '.json', '.jsonl', '.yaml', '.yml', '.xml',
  '.html', '.htm', '.js', '.jsx', '.ts', '.tsx',
]);

export const OFFICE_DOCUMENT_EXTENSIONS = new Set([
  '.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp', '.rtf',
]);

export const IMAGE_DOCUMENT_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif',
]);

const DEFAULT_MAX_CHARS = 80_000;
const DEFAULT_MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const OFFICE_FILE_TYPES: Record<string, SupportedFileType> = {
  '.docx': 'docx', '.xlsx': 'xlsx', '.pptx': 'pptx',
  '.odt': 'odt', '.ods': 'ods', '.odp': 'odp', '.rtf': 'rtf', '.pdf': 'pdf',
};

export async function extractDocument(
  absolutePath: string,
  options: ExtractionOptions = {},
): Promise<ExtractionResult> {
  const maxChars = positiveInteger(options.maxChars, DEFAULT_MAX_CHARS, 'maxChars');
  const maxSourceBytes = positiveInteger(options.maxSourceBytes, DEFAULT_MAX_SOURCE_BYTES, 'maxSourceBytes');
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 'timeoutMs');
  const extension = path.extname(absolutePath).toLowerCase();
  const stat = await fs.stat(absolutePath);
  if (!stat.isFile()) throw new Error('Research document is not a file.');
  if (stat.size > maxSourceBytes) {
    throw new Error(`Research document exceeds the ${(maxSourceBytes / 1024 / 1024).toFixed(0)} MB extraction limit.`);
  }

  if (TEXT_DOCUMENT_EXTENSIONS.has(extension)) {
    const content = await fs.readFile(absolutePath, 'utf8');
    return truncate({ content, kind: 'text', warnings: [], sourceBytes: stat.size, truncated: false }, maxChars);
  }

  if (IMAGE_DOCUMENT_EXTENSIONS.has(extension)) {
    const mime = extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : `image/${extension.slice(1)}`;
    return {
      content: `[Image file: ${path.basename(absolutePath)}; MIME type: ${mime}; size: ${stat.size} bytes]`,
      kind: 'image',
      warnings: ['Image content requires a vision-capable provider; only file metadata is available to text models.'],
      sourceBytes: stat.size,
      truncated: false,
    };
  }

  const fileType = OFFICE_FILE_TYPES[extension];
  if (!fileType) throw new Error(`Unsupported extraction format: ${extension || '(none)'}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const ast = await parseOffice(absolutePath, {
      fileType,
      abortSignal: controller.signal,
      extractAttachments: false,
      includeRawContent: false,
      ocr: false,
      decompressionLimits: {
        maxUncompressedBytes: 64 * 1024 * 1024,
        maxZipEntries: 5_000,
      },
    });
    const warnings = ast.warnings.map((warning) => warning.message).filter(Boolean);
    const content = ast.toText().trim();
    if (!content) {
      warnings.push(extension === '.pdf'
        ? 'No selectable text was found. The PDF may contain scanned pages and require OCR.'
        : 'No extractable text was found in this document.');
    }
    return truncate({
      content,
      kind: extension === '.pdf' ? 'pdf' : 'office',
      warnings,
      sourceBytes: stat.size,
      truncated: false,
    }, maxChars);
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`Document extraction timed out after ${timeoutMs} ms.`);
    throw new Error(`Could not extract ${extension || 'document'} content: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timeout);
  }
}

function truncate(result: ExtractionResult, maxChars: number): ExtractionResult {
  if (result.content.length <= maxChars) return result;
  return {
    ...result,
    content: result.content.slice(0, maxChars),
    truncated: true,
    warnings: [...result.warnings, `Extracted text was truncated to ${maxChars.toLocaleString()} characters.`],
  };
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1) throw new Error(`${name} must be a positive integer.`);
  return resolved;
}
