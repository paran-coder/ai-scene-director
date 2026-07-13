import type { Project } from './types.ts';
import { validateAndMigrateProject } from './validation.ts';

export type RecoveryReason = 'auto' | 'manual' | 'beforeunload' | 'error';

export interface RecoverySnapshotV1 {
  format: 'ai-scene-director-recovery';
  version: 1;
  id: string;
  createdAt: string;
  reason: RecoveryReason;
  activeShotId: string;
  project: Project;
}

export interface RecoverySnapshot {
  format: 'ai-scene-director-recovery';
  version: 2;
  id: string;
  createdAt: string;
  reason: RecoveryReason;
  activeShotId: string;
  sequence: number;
  checksum: string;
  project: Project;
}

type AnyRecoverySnapshot = RecoverySnapshot | RecoverySnapshotV1;

const STORAGE_KEY = 'ai-scene-director-recovery-v2';
const PENDING_STORAGE_KEY = `${STORAGE_KEY}:pending`;
const LEGACY_STORAGE_KEY = 'ai-scene-director-recovery-v1';
const MAX_SNAPSHOTS = 5;
let memorySnapshots: AnyRecoverySnapshot[] = [];

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function checksumPayload(snapshot: Pick<RecoverySnapshot, 'activeShotId' | 'createdAt' | 'reason' | 'sequence' | 'project'>): string {
  return hashString(JSON.stringify({
    activeShotId: snapshot.activeShotId,
    createdAt: snapshot.createdAt,
    reason: snapshot.reason,
    sequence: snapshot.sequence,
    project: snapshot.project,
  }));
}

function parseSnapshots(raw: string | null): AnyRecoverySnapshot[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as AnyRecoverySnapshot[] : [];
  } catch {
    return [];
  }
}

function readRaw(): AnyRecoverySnapshot[] {
  try {
    if (typeof localStorage === 'undefined') return structuredClone(memorySnapshots);
    const committed = parseSnapshots(localStorage.getItem(STORAGE_KEY));
    if (committed.length) return committed;
    const pending = parseSnapshots(localStorage.getItem(PENDING_STORAGE_KEY));
    if (pending.length) return pending;
    return parseSnapshots(localStorage.getItem(LEGACY_STORAGE_KEY));
  } catch {
    return structuredClone(memorySnapshots);
  }
}

function writeRaw(snapshots: AnyRecoverySnapshot[]): void {
  const trimmed = snapshots.slice(0, MAX_SNAPSHOTS);
  memorySnapshots = structuredClone(trimmed);
  try {
    if (typeof localStorage !== 'undefined') {
      const serialized = JSON.stringify(trimmed);
      localStorage.setItem(PENDING_STORAGE_KEY, serialized);
      localStorage.setItem(STORAGE_KEY, serialized);
      localStorage.removeItem(PENDING_STORAGE_KEY);
    }
  } catch {
    // Browser quota failures must not interrupt editing. The in-memory journal
    // remains usable for the current session.
  }
}

export function createRecoverySnapshot(project: Project, activeShotId: string, reason: RecoveryReason = 'auto', now = new Date()): RecoverySnapshot {
  const sequence = Math.max(0, ...readRaw().map((snapshot) => snapshot.version === 2 ? snapshot.sequence : 0)) + 1;
  const base = {
    format: 'ai-scene-director-recovery' as const,
    version: 2 as const,
    id: `recovery-${now.getTime()}-${project.revision}-${sequence}`,
    createdAt: now.toISOString(),
    reason,
    activeShotId,
    sequence,
    project: structuredClone(project),
  };
  return { ...base, checksum: checksumPayload(base) };
}

export function verifyRecoverySnapshot(snapshot: unknown): snapshot is AnyRecoverySnapshot {
  if (!snapshot || typeof snapshot !== 'object') return false;
  const candidate = snapshot as Partial<AnyRecoverySnapshot>;
  if (candidate.format !== 'ai-scene-director-recovery') return false;
  if (candidate.version !== 1 && candidate.version !== 2) return false;
  if (typeof candidate.id !== 'string' || typeof candidate.createdAt !== 'string' || typeof candidate.activeShotId !== 'string') return false;
  if (!['auto', 'manual', 'beforeunload', 'error'].includes(String(candidate.reason))) return false;
  if (!candidate.project || !validateAndMigrateProject(candidate.project).success) return false;
  if (candidate.version === 2) {
    if (typeof candidate.sequence !== 'number' || !Number.isInteger(candidate.sequence) || candidate.sequence < 1) return false;
    if (typeof candidate.checksum !== 'string') return false;
    if (candidate.checksum !== checksumPayload(candidate as RecoverySnapshot)) return false;
  }
  return true;
}

function migrateSnapshot(snapshot: AnyRecoverySnapshot): RecoverySnapshot {
  if (snapshot.version === 2) return structuredClone(snapshot);
  const base = {
    format: 'ai-scene-director-recovery' as const,
    version: 2 as const,
    id: snapshot.id,
    createdAt: snapshot.createdAt,
    reason: snapshot.reason,
    activeShotId: snapshot.activeShotId,
    sequence: 1,
    project: structuredClone(snapshot.project),
  };
  return { ...base, checksum: checksumPayload(base) };
}

export function saveRecoverySnapshot(project: Project, activeShotId: string, reason: RecoveryReason = 'auto'): RecoverySnapshot {
  const snapshot = createRecoverySnapshot(project, activeShotId, reason);
  const snapshots = readRaw().filter((item) => item.id !== snapshot.id && item.project.revision !== project.revision);
  writeRaw([snapshot, ...snapshots]);
  return snapshot;
}

export function listRecoverySnapshots(): RecoverySnapshot[] {
  const snapshots = readRaw().filter(verifyRecoverySnapshot).map(migrateSnapshot);
  return snapshots.sort((a, b) => b.sequence - a.sequence || b.createdAt.localeCompare(a.createdAt)).slice(0, MAX_SNAPSHOTS);
}

export function latestRecoverySnapshot(): RecoverySnapshot | null {
  return listRecoverySnapshots()[0] ?? null;
}

export function removeRecoverySnapshot(id: string): void {
  writeRaw(readRaw().filter((snapshot) => snapshot.id !== id));
}

export function clearRecoverySnapshots(): void {
  writeRaw([]);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(PENDING_STORAGE_KEY);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
  } catch {
    // ignore unavailable storage
  }
}
