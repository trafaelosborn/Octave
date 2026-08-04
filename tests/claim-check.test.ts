import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildClaimCheckReport,
  buildEvidenceMap,
  buildSourceInventory,
  extractDraftClaims,
  serializeClaimCheckMarkdown,
} from '../src/core/index.js';
import { listClaimChecks, saveClaimCheck } from '../src/storage/index.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('claim checks', () => {
  it('extracts substantive draft paragraphs as claims', () => {
    const claims = extractDraftClaims('paper.md', [
      '# Title',
      '',
      'The walls of Halicarnassus were important to the siege narrative because Alexander had to answer a defended urban perimeter with engines and coordinated assaults.',
      '',
      'Too short.',
    ].join('\n'));

    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ path: 'paper.md', lineStart: 3, lineEnd: 3 });
  });

  it('checks draft claims against saved evidence-map passages', async () => {
    const workspace = await makeWorkspace();
    await write(workspace, 'sources/primary/Arrian.md', 'Alexander pressed the siege while defenders relied on the walls of Halicarnassus and prepared engines along the circuit.');
    await write(workspace, 'paper.md', 'Alexander pressed the siege at Halicarnassus while defenders relied on the walls and prepared engines along the circuit.');

    const inventory = await buildSourceInventory(workspace);
    const evidenceMap = await buildEvidenceMap(workspace, inventory, { question: 'Halicarnassus walls' });
    const report = await buildClaimCheckReport(workspace, 'paper.md', [evidenceMap]);

    expect(report.summary.claims).toBe(1);
    expect(report.findings[0]?.verdict).toBe('likely_supported');
    expect(report.findings[0]?.evidenceMatches[0]?.sourcePath).toBe('sources/primary/Arrian.md');
    expect(serializeClaimCheckMarkdown(report)).toContain('## Findings');
  });

  it('saves paired claim-check artifacts and lists metadata', async () => {
    const workspace = await makeWorkspace();
    await write(workspace, 'paper.md', 'This draft paragraph is substantive enough to become a claim, but no saved source evidence exists for it yet.');

    const report = await buildClaimCheckReport(workspace, 'paper.md', []);
    await saveClaimCheck(workspace, report);

    const reports = await listClaimChecks(workspace);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ id: report.id, findingCount: 1 });
    await expect(fs.stat(path.join(workspace, '.octave', 'claim-checks', `${report.id}.md`))).resolves.toBeTruthy();
  });
});

async function makeWorkspace(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'octave-claim-check-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function write(workspace: string, relativePath: string, content: string): Promise<void> {
  const absolute = path.join(workspace, ...relativePath.split('/'));
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, content, 'utf8');
}
