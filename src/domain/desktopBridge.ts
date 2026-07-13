interface TauriCore {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
}

declare global {
  interface Window {
    __TAURI__?: { core?: TauriCore };
  }
}

export function isDesktopRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean(window.__TAURI__?.core?.invoke);
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const core = typeof window !== 'undefined' ? window.__TAURI__?.core : undefined;
  if (!core) throw new Error('데스크톱 런타임에서만 사용할 수 있는 기능입니다.');
  return core.invoke<T>(command, args);
}

export async function chooseDesktopProjectFolder(): Promise<string | null> {
  return invoke<string | null>('choose_project_folder');
}

export async function writeDesktopFile(path: string, filename: string, bytes: Uint8Array): Promise<string> {
  return invoke<string>('write_project_file', { path, filename, bytes: Array.from(bytes) });
}

export async function readDesktopFile(): Promise<{ filename: string; bytes: number[] } | null> {
  return invoke<{ filename: string; bytes: number[] } | null>('read_project_file');
}


export async function reportNativeSmokeReady(): Promise<boolean> {
  if (!isDesktopRuntime()) return false;
  return invoke<boolean>('native_smoke_ready');
}
