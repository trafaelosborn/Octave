import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface Workspace {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
  lastDocumentPath?: string;
}

interface WorkspaceStore {
  workspaces: Workspace[];
}

const configDirectory = path.resolve(
  /* turbopackIgnore: true */
  process.env.OCTAVE_CONFIG_DIR || path.join(os.homedir(), '.octave'),
);
const workspaceStorePath = path.join(/* turbopackIgnore: true */ configDirectory, 'workspaces.json');

export async function listWorkspaces(): Promise<Workspace[]> {
  const store = await readStore();
  if (store.workspaces.length > 0) return store.workspaces;

  const environmentRoot = process.env.OCTAVE_ROOT?.trim();
  if (!environmentRoot) return [];

  try {
    const workspace = await upsertWorkspace({ rootPath: environmentRoot });
    return [workspace];
  } catch {
    return [];
  }
}

export async function getWorkspace(workspaceId?: string | null): Promise<Workspace> {
  const workspaces = await listWorkspaces();
  const workspace = workspaceId
    ? workspaces.find((candidate) => candidate.id === workspaceId)
    : workspaces[0];

  if (!workspace) {
    throw new Error('No workspace is configured. Add a research folder first.');
  }
  return workspace;
}

export async function upsertWorkspace(input: {
  rootPath: string;
  name?: string;
}): Promise<Workspace> {
  const rootPath = await validateWorkspaceRoot(input.rootPath);
  const id = workspaceId(rootPath);
  const store = await readStore();
  const now = new Date().toISOString();
  const existing = store.workspaces.find((workspace) => workspace.id === id);

  if (existing) {
    existing.rootPath = rootPath;
    existing.name = input.name?.trim() || existing.name;
    existing.updatedAt = now;
  } else {
    store.workspaces.unshift({
      id,
      name: input.name?.trim() || path.basename(rootPath) || 'Research workspace',
      rootPath,
      createdAt: now,
      updatedAt: now,
    });
  }

  await writeStore(store);
  const workspace = store.workspaces.find((candidate) => candidate.id === id);
  if (!workspace) throw new Error('Could not save the workspace.');
  return workspace;
}

export async function updateLastDocument(workspaceId: string, documentPath: string): Promise<void> {
  const store = await readStore();
  const workspace = store.workspaces.find((candidate) => candidate.id === workspaceId);
  if (!workspace) return;

  workspace.lastDocumentPath = documentPath;
  workspace.updatedAt = new Date().toISOString();
  await writeStore(store);
}

export async function deleteWorkspace(workspaceId: string): Promise<Workspace[]> {
  const store = await readStore();
  store.workspaces = store.workspaces.filter((workspace) => workspace.id !== workspaceId);
  await writeStore(store);
  return store.workspaces;
}

async function validateWorkspaceRoot(input: string): Promise<string> {
  const raw = input.trim();
  if (!raw) throw new Error('A workspace path is required.');

  const rootPath = await fs.realpath(path.resolve(/* turbopackIgnore: true */ raw));
  const stat = await fs.stat(rootPath);
  if (!stat.isDirectory()) throw new Error(`Workspace path is not a directory: ${rootPath}`);
  return rootPath;
}

function workspaceId(rootPath: string): string {
  const normalized = process.platform === 'win32' ? rootPath.toLowerCase() : rootPath;
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

async function readStore(): Promise<WorkspaceStore> {
  await fs.mkdir(configDirectory, { recursive: true });

  try {
    const parsed = JSON.parse(await fs.readFile(workspaceStorePath, 'utf8')) as Partial<WorkspaceStore>;
    if (!Array.isArray(parsed.workspaces)) return { workspaces: [] };
    return {
      workspaces: parsed.workspaces.filter(isWorkspace).map((workspace) => ({
        ...workspace,
        rootPath: path.resolve(/* turbopackIgnore: true */ workspace.rootPath),
      })),
    };
  } catch (error) {
    if (isMissingFileError(error)) return { workspaces: [] };
    throw new Error('Could not read the Octave workspace registry.');
  }
}

async function writeStore(store: WorkspaceStore): Promise<void> {
  await fs.mkdir(configDirectory, { recursive: true });
  const temporaryPath = `${workspaceStorePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryPath, workspaceStorePath);
}

function isWorkspace(value: unknown): value is Workspace {
  if (!value || typeof value !== 'object') return false;
  const workspace = value as Partial<Workspace>;
  return (
    typeof workspace.id === 'string' &&
    typeof workspace.name === 'string' &&
    typeof workspace.rootPath === 'string' &&
    typeof workspace.createdAt === 'string' &&
    typeof workspace.updatedAt === 'string' &&
    (workspace.lastDocumentPath === undefined || typeof workspace.lastDocumentPath === 'string')
  );
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
