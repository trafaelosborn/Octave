import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildEvidenceMap, buildSourceInventory, serializeEvidenceMapMarkdown } from '../src/core/index.js';
import { listEvidenceMaps, loadEvidenceMap, saveEvidenceMap } from '../src/storage/index.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('evidence maps', () => {
  it('builds a bounded passage map from the source inventory', async () => {
    const workspace = await makeWorkspace();
    await write(workspace, 'sources/primary/Arrian.md', [
      '# Arrian',
      '',
      'Alexander pressed the siege while the defenders relied on the city walls and prepared engines along the circuit.',
      '',
      'The account gives tactical sequence but does not provide a numerical wall height.',
    ].join('\n'));
    await write(workspace, 'sources/secondary/walls.md', 'Modern scholarship warns that surviving narrative sources rarely preserve exact dimensions for city walls.');

    const inventory = await buildSourceInventory(workspace);
    const map = await buildEvidenceMap(workspace, inventory, {
      question: 'How high were the walls of Halicarnassus?',
      sourceLimit: 2,
      passagesPerSource: 2,
    });

    expect(map.question).toBe('How high were the walls of Halicarnassus?');
    expect(map.sources).toHaveLength(2);
    expect(map.passages.length).toBeGreaterThan(0);
    expect(map.passages[0]?.sourcePath).toBe('sources/primary/Arrian.md');
    expect(map.artifactPaths.json).toMatch(/^\.octave\/evidence-maps\/.+\.json$/);
    expect(serializeEvidenceMapMarkdown(map)).toContain('## Candidate passages');
  });

  it('saves, lists, and loads evidence maps as paired artifacts', async () => {
    const workspace = await makeWorkspace();
    await write(workspace, 'sources/primary/Diodorus.md', 'Diodorus supplies narrative evidence but this fixture does not include a measured wall height.');

    const inventory = await buildSourceInventory(workspace);
    const map = await buildEvidenceMap(workspace, inventory, { question: 'Wall evidence' });
    await saveEvidenceMap(workspace, map);

    const maps = await listEvidenceMaps(workspace);
    expect(maps).toHaveLength(1);
    expect(maps[0]).toMatchObject({ id: map.id, passageCount: map.passages.length });
    expect(await loadEvidenceMap(workspace, map.id)).toMatchObject({ id: map.id, question: 'Wall evidence' });
    await expect(fs.stat(path.join(workspace, '.octave', 'evidence-maps', `${map.id}.md`))).resolves.toBeTruthy();
  });
});

async function makeWorkspace(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'octave-evidence-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function write(workspace: string, relativePath: string, content: string): Promise<void> {
  const absolute = path.join(workspace, ...relativePath.split('/'));
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, content, 'utf8');
}
