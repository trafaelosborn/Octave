import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildSourceInventory,
  SOURCE_INVENTORY_PATH,
  updateSourceInventoryRole,
} from '../src/core/source-inventory.js';
import { loadSourceInventory, saveSourceInventory } from '../src/storage/source-inventory-storage.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('source inventory', () => {
  it('inventories source-like folders and infers source roles', async () => {
    const workspace = await makeWorkspace();
    await write(workspace, 'sources/primary/Arrian.md', '# Arrian');
    await write(workspace, 'sources/secondary/wall-review.md', '# Review');
    await write(workspace, 'data/heights.csv', 'site,height\nHalicarnassus,unknown\n');
    await write(workspace, 'draft.md', '# Draft');

    const inventory = await buildSourceInventory(workspace);

    expect(inventory.inventoryPath).toBe(SOURCE_INVENTORY_PATH);
    expect(inventory.items.map((item) => item.path)).toEqual([
      'sources/primary/Arrian.md',
      'sources/secondary/wall-review.md',
      'data/heights.csv',
    ]);
    expect(inventory.summary).toMatchObject({
      total: 3,
      primary: 1,
      secondary: 1,
      dataset_archive: 1,
      unknown: 0,
    });
  });

  it('preserves manual roles when the inventory is rebuilt', async () => {
    const workspace = await makeWorkspace();
    await write(workspace, 'sources/notes.md', '# Ambiguous notes');

    const first = await buildSourceInventory(workspace);
    const updated = updateSourceInventoryRole(first, 'sources/notes.md', 'primary');
    await saveSourceInventory(workspace, updated);

    const loaded = await loadSourceInventory(workspace);
    const rebuilt = await buildSourceInventory(workspace, loaded);

    expect(rebuilt.items[0]).toMatchObject({
      path: 'sources/notes.md',
      role: 'primary',
      roleSource: 'manual',
    });
    expect(rebuilt.summary.manual).toBe(1);
  });
});

async function makeWorkspace(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'octave-sources-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function write(workspace: string, relativePath: string, content: string): Promise<void> {
  const absolute = path.join(workspace, ...relativePath.split('/'));
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, content, 'utf8');
}
