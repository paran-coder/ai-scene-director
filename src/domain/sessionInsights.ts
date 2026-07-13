export type CreatorSessionEventType =
  | 'session_started'
  | 'scene_generator_opened'
  | 'scene_applied'
  | 'first_edit_ready'
  | 'first_edit_completed'
  | 'workflow_navigated'
  | 'shot_added'
  | 'action_added'
  | 'project_checked'
  | 'export_started'
  | 'export_completed'
  | 'command_palette_opened'
  | 'command_executed'
  | 'shortcut_used'
  | 'error';

export type SessionMetadataValue = string | number | boolean;
export interface CreatorSessionEvent {
  id: string;
  type: CreatorSessionEventType;
  at: string;
  elapsedMs: number;
  metadata: Record<string, SessionMetadataValue>;
}

export interface CreatorSessionRecord {
  id: string;
  version: 1;
  startedAt: string;
  updatedAt: string;
  events: CreatorSessionEvent[];
}

export interface CreatorSessionSummary {
  durationMs: number;
  eventCount: number;
  commandExecutions: number;
  shortcutExecutions: number;
  workflowNavigations: number;
  errors: number;
  timeToSceneMs: number | null;
  timeToFirstEditReadyMs: number | null;
  timeToFirstEditMs: number | null;
  timeToFirstExportMs: number | null;
  milestone: 'started' | 'scene-created' | 'first-edit-ready' | 'first-edit-completed' | 'exported';
}

const STORAGE_KEY = 'ai-scene-director-creator-sessions-v1';
const FORBIDDEN_METADATA_KEYS = ['prompt', 'description', 'name', 'url', 'storage', 'filename', 'path', 'text'];

function id(prefix: string): string {
  try { return `${prefix}-${crypto.randomUUID()}`; } catch { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}

export function sanitizeSessionMetadata(input: Record<string, unknown> = {}): Record<string, SessionMetadataValue> {
  const output: Record<string, SessionMetadataValue> = {};
  for (const [rawKey, value] of Object.entries(input)) {
    const key = rawKey.trim().slice(0, 40);
    if (!key || FORBIDDEN_METADATA_KEYS.some((forbidden) => key.toLowerCase().includes(forbidden))) continue;
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) output[key] = value;
    else if (typeof value === 'string') output[key] = value.replace(/[\r\n\t]/g, ' ').slice(0, 80);
  }
  return output;
}

export function createCreatorSession(now = new Date()): CreatorSessionRecord {
  const startedAt = now.toISOString();
  return { id: id('session'), version: 1, startedAt, updatedAt: startedAt, events: [] };
}

export function appendCreatorSessionEvent(
  session: CreatorSessionRecord,
  type: CreatorSessionEventType,
  metadata: Record<string, unknown> = {},
  now = new Date(),
): CreatorSessionRecord {
  const startedMs = Date.parse(session.startedAt);
  const at = now.toISOString();
  const event: CreatorSessionEvent = {
    id: id('event'),
    type,
    at,
    elapsedMs: Math.max(0, now.getTime() - (Number.isFinite(startedMs) ? startedMs : now.getTime())),
    metadata: sanitizeSessionMetadata(metadata),
  };
  return { ...session, updatedAt: at, events: [...session.events, event].slice(-240) };
}

export function summarizeCreatorSession(session: CreatorSessionRecord, now = new Date()): CreatorSessionSummary {
  const findElapsed = (type: CreatorSessionEventType) => session.events.find((event) => event.type === type)?.elapsedMs ?? null;
  const exported = findElapsed('export_completed');
  const firstEditReady = findElapsed('first_edit_ready');
  const firstEdit = findElapsed('first_edit_completed');
  const scene = findElapsed('scene_applied');
  return {
    durationMs: Math.max(0, now.getTime() - Date.parse(session.startedAt)),
    eventCount: session.events.length,
    commandExecutions: session.events.filter((event) => event.type === 'command_executed').length,
    shortcutExecutions: session.events.filter((event) => event.type === 'shortcut_used').length,
    workflowNavigations: session.events.filter((event) => event.type === 'workflow_navigated').length,
    errors: session.events.filter((event) => event.type === 'error').length,
    timeToSceneMs: scene,
    timeToFirstEditReadyMs: firstEditReady,
    timeToFirstEditMs: firstEdit,
    timeToFirstExportMs: exported,
    milestone: exported !== null ? 'exported' : firstEdit !== null ? 'first-edit-completed' : firstEditReady !== null ? 'first-edit-ready' : scene !== null ? 'scene-created' : 'started',
  };
}

export function loadCreatorSessions(): CreatorSessionRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is CreatorSessionRecord => Boolean(item && typeof item === 'object' && (item as CreatorSessionRecord).version === 1 && Array.isArray((item as CreatorSessionRecord).events))).slice(0, 10);
  } catch {
    return [];
  }
}

export function saveCreatorSession(session: CreatorSessionRecord): void {
  try {
    const existing = loadCreatorSessions().filter((item) => item.id !== session.id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([session, ...existing].slice(0, 10)));
  } catch { /* storage may be unavailable */ }
}

export function clearCreatorSessions(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage may be unavailable */ }
}
