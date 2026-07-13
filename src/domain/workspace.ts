import { chooseDesktopProjectFolder, isDesktopRuntime, writeDesktopFile } from './desktopBridge.ts';

export interface ProjectWorkspace {
  kind: 'desktop' | 'browser';
  label: string;
}

interface WritableFileHandle {
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
}

interface DirectoryHandle {
  name: string;
  getFileHandle(name: string, options: { create: boolean }): Promise<WritableFileHandle>;
}

let desktopPath: string | null = null;
let browserDirectory: DirectoryHandle | null = null;

export async function connectProjectWorkspace(): Promise<ProjectWorkspace | null> {
  if (isDesktopRuntime()) {
    desktopPath = await chooseDesktopProjectFolder();
    return desktopPath ? { kind: 'desktop', label: desktopPath } : null;
  }
  const picker = (window as unknown as { showDirectoryPicker?: () => Promise<DirectoryHandle> }).showDirectoryPicker;
  if (!picker) throw new Error('이 브라우저는 프로젝트 폴더 직접 저장을 지원하지 않습니다. 프로젝트 번들을 사용해 주세요.');
  browserDirectory = await picker();
  return { kind: 'browser', label: browserDirectory.name };
}

export function currentProjectWorkspace(): ProjectWorkspace | null {
  if (desktopPath) return { kind: 'desktop', label: desktopPath };
  if (browserDirectory) return { kind: 'browser', label: browserDirectory.name };
  return null;
}

export async function saveBlobToWorkspace(blob: Blob, filename: string): Promise<string> {
  if (desktopPath) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return writeDesktopFile(desktopPath, filename, bytes);
  }
  if (!browserDirectory) throw new Error('먼저 프로젝트 폴더를 연결해 주세요.');
  const handle = await browserDirectory.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
  return `${browserDirectory.name}/${filename}`;
}

export function disconnectProjectWorkspace(): void {
  desktopPath = null;
  browserDirectory = null;
}
