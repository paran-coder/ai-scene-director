import type { Project } from './types.ts';
import { deleteAssetBlob, listAssetStorageKeys } from './assetStorage.ts';

interface RegistryEntry {
  projectId: string;
  knownKeys: string[];
  updatedAt: string;
}

const REGISTRY_KEY = 'ai-scene-director-storage-registry-v1';
let memoryRegistry: RegistryEntry[] = [];

export interface StorageCleanupPlan {
  referencedKeys: string[];
  storedKeys: string[];
  unusedKeys: string[];
}

export interface StorageCleanupResult extends StorageCleanupPlan {
  deletedKeys: string[];
  failedKeys: string[];
}

function readRegistry(): RegistryEntry[] {
  try {
    if (typeof localStorage === 'undefined') return structuredClone(memoryRegistry);
    const raw = localStorage.getItem(REGISTRY_KEY);
    return raw ? JSON.parse(raw) as RegistryEntry[] : [];
  } catch {
    return structuredClone(memoryRegistry);
  }
}

function writeRegistry(entries: RegistryEntry[]): void {
  memoryRegistry = structuredClone(entries);
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(REGISTRY_KEY, JSON.stringify(entries)); } catch { /* quota/private mode */ }
}

export function collectReferencedStorageKeys(project: Project): string[] {
  const keys = new Set<string>();
  for (const item of project.assetLibrary ?? []) {
    if (item.storageKey) keys.add(item.storageKey);
  }
  for (const scene of project.scenes ?? []) {
    for (const image of scene.referenceImages ?? []) {
      if (image.storageKey) keys.add(image.storageKey);
    }
  }
  return [...keys].sort();
}

/**
 * Remembers every key that belonged to this project. Cleanup only considers
 * keys from this project's own history, so assets from another project or an
 * unknown legacy project are never deleted accidentally.
 */
export function registerProjectStorageReferences(project: Project): RegistryEntry {
  const current = collectReferencedStorageKeys(project);
  const entries = readRegistry();
  const previous = entries.find((entry) => entry.projectId === project.id);
  const knownKeys = [...new Set([...(previous?.knownKeys ?? []), ...current])].sort();
  const next: RegistryEntry = { projectId: project.id, knownKeys, updatedAt: new Date().toISOString() };
  writeRegistry([next, ...entries.filter((entry) => entry.projectId !== project.id)]);
  return next;
}

export function clearProjectStorageRegistry(projectId?: string): void {
  if (projectId) writeRegistry(readRegistry().filter((entry) => entry.projectId !== projectId));
  else {
    writeRegistry([]);
    try { if (typeof localStorage !== 'undefined') localStorage.removeItem(REGISTRY_KEY); } catch { /* ignore */ }
  }
}

export async function buildStorageCleanupPlan(project: Project): Promise<StorageCleanupPlan> {
  const referencedKeys = collectReferencedStorageKeys(project);
  const storedKeys = (await listAssetStorageKeys()).sort();
  const referenced = new Set(referencedKeys);
  const stored = new Set(storedKeys);
  const entry = readRegistry().find((item) => item.projectId === project.id);
  const knownKeys = entry?.knownKeys ?? referencedKeys;
  return {
    referencedKeys,
    storedKeys,
    unusedKeys: knownKeys.filter((key) => stored.has(key) && !referenced.has(key)).sort(),
  };
}

export async function cleanupUnusedAssetBlobs(project: Project): Promise<StorageCleanupResult> {
  const plan = await buildStorageCleanupPlan(project);
  const deletedKeys: string[] = [];
  const failedKeys: string[] = [];
  for (const key of plan.unusedKeys) {
    try {
      await deleteAssetBlob(key);
      deletedKeys.push(key);
    } catch {
      failedKeys.push(key);
    }
  }
  const entries = readRegistry();
  const entry = entries.find((item) => item.projectId === project.id);
  if (entry && deletedKeys.length) {
    const deleted = new Set(deletedKeys);
    entry.knownKeys = entry.knownKeys.filter((key) => !deleted.has(key));
    entry.updatedAt = new Date().toISOString();
    writeRegistry(entries);
  }
  return { ...plan, deletedKeys, failedKeys };
}
