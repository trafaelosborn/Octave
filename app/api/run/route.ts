import { spawn } from 'node:child_process';
import path from 'node:path';
import { resolveExistingDocumentPath } from '@trafaelosborn/octave/core';
import { getWorkspace } from '../../lib/workspaces';
import { jsonError, readJsonBody } from '../../lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INTERPRETERS: Record<string, string> = { '.py': 'python', '.r': 'Rscript' };
const configuredTimeout = Number(process.env.OCTAVE_RUN_TIMEOUT_MS || 60_000);
const RUN_TIMEOUT_MS = Number.isFinite(configuredTimeout) && configuredTimeout > 0
  ? Math.min(configuredTimeout, 10 * 60_000)
  : 60_000;
const MAX_RUN_OUTPUT_CHARS = 1_000_000;

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJsonBody<{ workspaceId?: string; path?: string }>(request);
    const workspace = await getWorkspace(body.workspaceId);
    const document = await resolveExistingDocumentPath(body.path ?? '', workspace.rootPath);
    const interpreter = INTERPRETERS[document.extension];
    if (!interpreter) throw new Error(`No interpreter is configured for ${document.extension} files.`);
    return Response.json(await runScript(interpreter, document.absolute, workspace.rootPath));
  } catch (error) {
    return jsonError(error);
  }
}

function runScript(
  interpreter: string,
  absolutePath: string,
  workspaceRoot: string,
): Promise<{ ok: boolean; log: string; durationMs: number }> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(interpreter, [absolutePath], {
      cwd: path.dirname(absolutePath),
      env: { ...process.env, OCTAVE_WORKSPACE_ROOT: workspaceRoot },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let log = '';
    let settled = false;

    const finish = (ok: boolean, suffix = ''): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok, log: `${log}${suffix}`.trim(), durationMs: Date.now() - startedAt });
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(false, `\nTimed out after ${Math.round(RUN_TIMEOUT_MS / 1_000)} seconds.`);
    }, RUN_TIMEOUT_MS);

    const appendOutput = (data: Buffer): void => {
      log += data.toString();
      if (log.length <= MAX_RUN_OUTPUT_CHARS) return;
      log = `${log.slice(0, MAX_RUN_OUTPUT_CHARS)}\n[Process output truncated at ${MAX_RUN_OUTPUT_CHARS.toLocaleString()} characters.]`;
      child.kill();
      finish(false);
    };
    child.stdout.on('data', appendOutput);
    child.stderr.on('data', appendOutput);
    child.on('error', (error) => finish(false, `\n${error.message}`));
    child.on('close', (code) => finish(code === 0));
  });
}
