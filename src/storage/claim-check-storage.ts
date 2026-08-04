import fs from 'node:fs/promises';
import path from 'node:path';
import {
  CLAIM_CHECKS_DIRECTORY,
  isClaimCheckReport,
  serializeClaimCheckMarkdown,
  toClaimCheckMeta,
  type ClaimCheckMeta,
  type ClaimCheckReport,
} from '../core/claim-check.js';

const CLAIM_CHECK_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export async function ensureClaimCheckDirectory(workspaceRoot: string): Promise<string> {
  const directory = path.join(path.resolve(workspaceRoot), ...CLAIM_CHECKS_DIRECTORY.split('/'));
  await fs.mkdir(directory, { recursive: true });
  return directory;
}

export async function saveClaimCheck(workspaceRoot: string, report: ClaimCheckReport): Promise<void> {
  if (!isClaimCheckReport(report)) throw new Error('Cannot save an invalid claim-check report.');
  const directory = await ensureClaimCheckDirectory(workspaceRoot);
  await Promise.all([
    writeTextAtomic(path.join(directory, `${report.id}.json`), `${JSON.stringify(report, null, 2)}\n`),
    writeTextAtomic(path.join(directory, `${report.id}.md`), serializeClaimCheckMarkdown(report)),
  ]);
}

export async function listClaimChecks(workspaceRoot: string): Promise<ClaimCheckMeta[]> {
  const directory = await ensureClaimCheckDirectory(workspaceRoot);
  const files = await fs.readdir(directory).catch(() => []);
  const reports: ClaimCheckMeta[] = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const reportId = file.slice(0, -'.json'.length);
    if (!CLAIM_CHECK_ID_PATTERN.test(reportId)) continue;
    try {
      const report = await readClaimCheck(path.join(directory, file));
      if (report.id === reportId) reports.push(toClaimCheckMeta(report));
    } catch {
      // Malformed reports should not hide neighboring artifacts.
    }
  }

  return reports.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
}

export async function loadClaimCheck(workspaceRoot: string, reportId: string): Promise<ClaimCheckReport | null> {
  assertValidClaimCheckId(reportId);
  try {
    return await readClaimCheck(path.join(await ensureClaimCheckDirectory(workspaceRoot), `${reportId}.json`));
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

export function assertValidClaimCheckId(reportId: string): void {
  if (!CLAIM_CHECK_ID_PATTERN.test(reportId)) throw new Error('Invalid claim-check report ID.');
}

async function readClaimCheck(filePath: string): Promise<ClaimCheckReport> {
  const parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
  if (!isClaimCheckReport(parsed)) throw new Error(`Invalid claim-check report: ${path.basename(filePath)}`);
  return parsed;
}

async function writeTextAtomic(destination: string, value: string): Promise<void> {
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, value, 'utf8');
  await fs.rename(temporary, destination);
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
