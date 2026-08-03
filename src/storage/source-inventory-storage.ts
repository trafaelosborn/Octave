import fs from 'node:fs/promises';
import path from 'node:path';
import {
  isSourceInventory,
  SOURCE_INVENTORY_PATH,
  type SourceInventory,
} from '../core/source-inventory.js';

export async function loadSourceInventory(workspaceRoot: string): Promise<SourceInventory | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(sourceInventoryAbsolutePath(workspaceRoot), 'utf8')) as unknown;
    return isSourceInventory(parsed) ? parsed : null;
  } catch (error) {
    if (isMissingFileError(error) || error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function saveSourceInventory(workspaceRoot: string, inventory: SourceInventory): Promise<void> {
  if (!isSourceInventory(inventory)) throw new Error('Cannot save an invalid source inventory.');
  const destination = sourceInventoryAbsolutePath(workspaceRoot);
  assertInsideWorkspace(destination, workspaceRoot);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, destination);
}

function sourceInventoryAbsolutePath(workspaceRoot: string): string {
  return path.join(path.resolve(workspaceRoot), ...SOURCE_INVENTORY_PATH.split('/'));
}

function assertInsideWorkspace(target: string, workspaceRoot: string): void {
  const root = path.resolve(workspaceRoot);
  const relative = path.relative(root, path.resolve(target));
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Source inventory path escapes the workspace directory.');
  }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
