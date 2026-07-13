import { getAssetBlob, saveAssetBlob } from './assetStorage.ts';
import { createStoredZip, safeFilename } from './export.ts';
import { dataUrlToBlob } from './referenceImages.ts';
import type { Project, ReferenceImage } from './types.ts';
import { validateAndMigrateProject } from './validation.ts';

export interface ProjectBundleAssetEntry {
  kind: 'glb' | 'reference-image';
  assetId: string;
  path: string;
  originalFilename: string;
  mimeType: string;
  missing: boolean;
}

export interface ProjectBundleManifest {
  format: 'ai-scene-director-project-bundle';
  version: '2';
  createdAt: string;
  projectFile: 'project.json';
  assets: ProjectBundleAssetEntry[];
}

export interface ProjectBundleExportResult {
  blob: Blob;
  missingAssetIds: string[];
  missingReferenceImageIds: string[];
  manifest: ProjectBundleManifest;
}

export interface ProjectBundleImportResult {
  project: Project;
  restoredAssetIds: string[];
  restoredReferenceImageIds: string[];
  missingAssetIds: string[];
  missingReferenceImageIds: string[];
  warnings: string[];
}

function referenceImages(project: Project): ReferenceImage[] {
  return project.scenes.flatMap((scene) => scene.referenceImages ?? []);
}

function extensionForMime(mimeType: string): string {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  return 'bin';
}

export async function createProjectBundle(project: Project): Promise<ProjectBundleExportResult> {
  const files: Array<{ name: string; data: Blob | Uint8Array | string }> = [];
  const entries: ProjectBundleAssetEntry[] = [];
  const missingAssetIds: string[] = [];
  const missingReferenceImageIds: string[] = [];

  for (const asset of project.assetLibrary) {
    const blob = await getAssetBlob(asset.storageKey);
    const path = `assets/glb/${safeFilename(asset.id)}/${safeFilename(asset.originalFilename || `${asset.id}.glb`)}`;
    const missing = !blob;
    entries.push({ kind: 'glb', assetId: asset.id, path, originalFilename: asset.originalFilename, mimeType: asset.mimeType, missing });
    if (blob) files.push({ name: path, data: blob });
    else missingAssetIds.push(asset.id);
  }

  for (const image of referenceImages(project)) {
    let blob = await getAssetBlob(image.storageKey);
    if (!blob && image.dataUrl) blob = dataUrlToBlob(image.dataUrl);
    const filename = `${safeFilename(image.name || image.id)}.${extensionForMime(image.mimeType)}`;
    const path = `assets/reference-images/${safeFilename(image.id)}/${filename}`;
    const missing = !blob;
    entries.push({ kind: 'reference-image', assetId: image.id, path, originalFilename: filename, mimeType: image.mimeType, missing });
    if (blob) files.push({ name: path, data: blob });
    else missingReferenceImageIds.push(image.id);
  }

  const manifest: ProjectBundleManifest = {
    format: 'ai-scene-director-project-bundle',
    version: '2',
    createdAt: new Date().toISOString(),
    projectFile: 'project.json',
    assets: entries,
  };
  files.unshift(
    { name: 'bundle_manifest.json', data: JSON.stringify(manifest, null, 2) },
    { name: 'project.json', data: JSON.stringify(project, null, 2) },
  );
  return { blob: await createStoredZip(files), missingAssetIds, missingReferenceImageIds, manifest };
}

export async function readStoredZip(blob: Blob): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = new Map<string, Uint8Array>();
  let offset = 0;
  while (offset + 4 <= bytes.length) {
    const signature = view.getUint32(offset, true);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    if (signature !== 0x04034b50) throw new Error('지원하지 않는 ZIP 구조입니다. AI Scene Director가 만든 번들을 사용해 주세요.');
    if (offset + 30 > bytes.length) throw new Error('ZIP 로컬 헤더가 손상되었습니다.');
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    if (method !== 0) throw new Error('압축된 ZIP은 아직 지원하지 않습니다. 앱에서 내보낸 프로젝트 번들을 사용해 주세요.');
    if ((flags & 0x0008) !== 0) throw new Error('데이터 디스크립터 ZIP은 지원하지 않습니다.');
    if (compressedSize !== uncompressedSize) throw new Error('Stored ZIP 크기 정보가 올바르지 않습니다.');
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length) throw new Error('ZIP 파일 데이터가 손상되었습니다.');
    const name = new TextDecoder().decode(bytes.slice(nameStart, nameStart + nameLength));
    if (name.includes('..') || name.startsWith('/') || name.startsWith('\\')) throw new Error('안전하지 않은 ZIP 경로가 포함되어 있습니다.');
    files.set(name, bytes.slice(dataStart, dataEnd));
    offset = dataEnd;
  }
  return files;
}

function parseJsonFile<T>(files: Map<string, Uint8Array>, path: string): T {
  const bytes = files.get(path);
  if (!bytes) throw new Error(`${path} 파일이 번들에 없습니다.`);
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    throw new Error(`${path} JSON을 읽지 못했습니다.`);
  }
}

function legacyEntries(manifest: { assets?: Array<Record<string, unknown>> }): ProjectBundleAssetEntry[] {
  return (manifest.assets ?? []).map((entry) => ({
    kind: entry.kind === 'reference-image' ? 'reference-image' : 'glb',
    assetId: String(entry.assetId ?? ''),
    path: String(entry.path ?? ''),
    originalFilename: String(entry.originalFilename ?? ''),
    mimeType: String(entry.mimeType ?? (entry.kind === 'reference-image' ? 'image/webp' : 'model/gltf-binary')),
    missing: Boolean(entry.missing),
  }));
}

export async function importProjectBundle(blob: Blob): Promise<ProjectBundleImportResult> {
  const files = await readStoredZip(blob);
  const rawManifest = parseJsonFile<Record<string, unknown>>(files, 'bundle_manifest.json');
  if (rawManifest.format !== 'ai-scene-director-project-bundle' || !['1', '2'].includes(String(rawManifest.version))) {
    throw new Error('지원하지 않는 프로젝트 번들 형식입니다.');
  }
  const manifest: ProjectBundleManifest = {
    format: 'ai-scene-director-project-bundle',
    version: '2',
    createdAt: String(rawManifest.createdAt ?? ''),
    projectFile: 'project.json',
    assets: legacyEntries(rawManifest as { assets?: Array<Record<string, unknown>> }),
  };
  const rawProject = parseJsonFile<unknown>(files, String(rawManifest.projectFile ?? 'project.json'));
  const validation = validateAndMigrateProject(rawProject);
  if (!validation.success || !validation.project) throw new Error(validation.errors[0] ?? '프로젝트 데이터가 올바르지 않습니다.');
  const project = validation.project;
  const restoredAssetIds: string[] = [];
  const restoredReferenceImageIds: string[] = [];
  const missingAssetIds: string[] = [];
  const missingReferenceImageIds: string[] = [];
  const warnings = [...validation.warnings];

  for (const entry of manifest.assets) {
    const bytes = files.get(entry.path);
    if (entry.kind === 'glb') {
      const asset = project.assetLibrary.find((item) => item.id === entry.assetId);
      if (!asset) {
        warnings.push(`번들 에셋 ${entry.assetId}는 프로젝트 메타데이터에 없어 건너뛰었습니다.`);
        continue;
      }
      if (!bytes || entry.missing) {
        missingAssetIds.push(entry.assetId);
        warnings.push(`${asset.name}: GLB 원본이 번들에 포함되지 않았습니다.`);
        continue;
      }
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      await saveAssetBlob(asset.storageKey, new Blob([buffer], { type: asset.mimeType || entry.mimeType || 'model/gltf-binary' }));
      restoredAssetIds.push(entry.assetId);
      continue;
    }

    const image = referenceImages(project).find((item) => item.id === entry.assetId);
    if (!image) {
      warnings.push(`번들 참조 이미지 ${entry.assetId}는 프로젝트 메타데이터에 없어 건너뛰었습니다.`);
      continue;
    }
    if (!bytes || entry.missing) {
      missingReferenceImageIds.push(entry.assetId);
      warnings.push(`${image.name}: 참조 이미지 원본이 번들에 포함되지 않았습니다.`);
      continue;
    }
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    await saveAssetBlob(image.storageKey, new Blob([buffer], { type: image.mimeType || entry.mimeType || 'image/webp' }));
    delete image.dataUrl;
    restoredReferenceImageIds.push(entry.assetId);
  }

  return { project, restoredAssetIds, restoredReferenceImageIds, missingAssetIds, missingReferenceImageIds, warnings };
}
