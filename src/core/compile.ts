import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveExistingDocumentPath, resolvePdfArtifactPath } from './path.js';

export type CompileEngine = 'pdflatex' | 'lualatex' | 'tectonic';

export interface CompilePass {
  pass: number;
  ok: boolean;
  code: number | null;
  durationMs: number;
  rerunRequested: boolean;
}

export interface CompileResult {
  ok: boolean;
  code: number | null;
  log: string;
  passes: CompilePass[];
  rerunRequested: boolean;
  pdfAvailable: boolean;
  pdfPath: string;
}

export interface CompileOptions {
  engine?: CompileEngine;
  maxPasses?: number;
  timeoutMs?: number;
  texPath?: string;
}

const ENGINES = new Set<CompileEngine>(['pdflatex', 'lualatex', 'tectonic']);
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_PASSES = 3;
const MAX_COMPILER_OUTPUT_CHARS = 1_000_000;

export async function compileDocument(
  documentPath: string,
  workspaceRoot: string,
  options: CompileOptions = {},
): Promise<CompileResult> {
  const engine = options.engine ?? 'pdflatex';
  if (!ENGINES.has(engine)) {
    throw new Error('Engine must be pdflatex, lualatex, or tectonic.');
  }

  const maxPasses = options.maxPasses ?? DEFAULT_MAX_PASSES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(maxPasses) || maxPasses < 1 || maxPasses > 10) {
    throw new Error('maxPasses must be an integer between 1 and 10.');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
    throw new Error('timeoutMs must be positive.');
  }

  const source = await resolveExistingDocumentPath(documentPath, workspaceRoot);
  if (source.extension !== '.tex') {
    throw new Error('Only .tex documents can be compiled.');
  }
  const pdf = await resolvePdfArtifactPath(source.relative, workspaceRoot);

  const result = await runCompilation(engine, source.absolute, {
    ...options,
    maxPasses,
    timeoutMs,
  });
  let pdfAvailable = false;
  try {
    await fs.access(pdf.absolute);
    pdfAvailable = true;
  } catch {
    // Compilation failures normally do not produce a PDF.
  }

  return {
    ...result,
    pdfAvailable,
    pdfPath: pdf.relative,
  };
}

async function runCompilation(
  engine: CompileEngine,
  absolutePath: string,
  options: Required<Pick<CompileOptions, 'maxPasses' | 'timeoutMs'>> & CompileOptions,
): Promise<Omit<CompileResult, 'pdfAvailable' | 'pdfPath'>> {
  const maxPasses = engine === 'tectonic' ? 1 : options.maxPasses;
  const passes: CompilePass[] = [];
  const logs: string[] = [];
  let lastCode: number | null = null;
  let ok = false;

  for (let pass = 1; pass <= maxPasses; pass += 1) {
    const result = await runSinglePass(engine, absolutePath, options);
    const rerunRequested = engine !== 'tectonic' && shouldRerun(result.log);

    passes.push({
      pass,
      ok: result.ok,
      code: result.code,
      durationMs: result.durationMs,
      rerunRequested,
    });
    logs.push(formatPassLog(pass, result));
    lastCode = result.code;
    ok = result.ok;

    if (!result.ok || !rerunRequested) break;
  }

  const finalPass = passes.at(-1);
  const capped = Boolean(finalPass?.ok && finalPass.rerunRequested && passes.length >= maxPasses);
  const capMessage = capped
    ? `\n\nLaTeX still requested another rerun after ${maxPasses} passes.`
    : '';

  return {
    ok,
    code: lastCode,
    log: `${logs.join('\n\n')}${capMessage}`.trim(),
    passes,
    rerunRequested: capped,
  };
}

function runSinglePass(
  engine: CompileEngine,
  absolutePath: string,
  options: Required<Pick<CompileOptions, 'timeoutMs'>> & CompileOptions,
): Promise<{ ok: boolean; code: number | null; log: string; durationMs: number }> {
  return new Promise((resolve) => {
    const args = engine === 'tectonic'
      ? ['--keep-logs', '--keep-intermediates', path.basename(absolutePath)]
      : ['-interaction=nonstopmode', '-halt-on-error', '-file-line-error', path.basename(absolutePath)];

    const env = { ...process.env };
    if (options.texPath) {
      const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
      env[pathKey] = [options.texPath, env[pathKey] ?? ''].filter(Boolean).join(path.delimiter);
    }

    const startedAt = Date.now();
    const processHandle = spawn(engine, args, {
      cwd: path.dirname(absolutePath),
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let log = '';
    let settled = false;

    const finish = (passOk: boolean, code: number | null, extra = ''): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: passOk,
        code,
        log: `${log}${extra}`.trim(),
        durationMs: Date.now() - startedAt,
      });
    };

    const timer = setTimeout(() => {
      processHandle.kill();
      finish(false, null, `\nTimed out after ${Math.round(options.timeoutMs / 1000)} seconds.`);
    }, options.timeoutMs);

    const appendOutput = (data: Buffer): void => {
      log += data.toString();
      if (log.length <= MAX_COMPILER_OUTPUT_CHARS) return;
      log = `${log.slice(0, MAX_COMPILER_OUTPUT_CHARS)}\n[Compiler output truncated at ${MAX_COMPILER_OUTPUT_CHARS.toLocaleString()} characters.]`;
      processHandle.kill();
      finish(false, null);
    };
    processHandle.stdout.on('data', appendOutput);
    processHandle.stderr.on('data', appendOutput);
    processHandle.on('error', (error) => finish(false, null, `\n${error.message}`));
    processHandle.on('close', (code) => finish(code === 0, code));
  });
}

function shouldRerun(log: string): boolean {
  return [
    /Rerun to get (cross-references|outlines) right/i,
    /LaTeX Warning: Label\(s\) may have changed/i,
    /LaTeX Warning: Citation\(s\) may have changed/i,
    /Package rerunfilecheck Warning: File .* has changed/i,
    /Package biblatex Warning: Please \(re\)run/i,
    /There were undefined references/i,
  ].some((pattern) => pattern.test(log));
}

function formatPassLog(
  pass: number,
  result: { ok: boolean; code: number | null; log: string; durationMs: number },
): string {
  const seconds = (result.durationMs / 1000).toFixed(1);
  return [
    `===== LaTeX pass ${pass} (${result.ok ? 'ok' : `failed, code ${result.code ?? 'none'}`}, ${seconds}s) =====`,
    result.log || '(no compiler output)',
  ].join('\n');
}
