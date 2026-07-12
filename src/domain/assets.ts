import type { AssetLibraryCategory, AssetLibraryItem, EntityAssetData, Project } from './types.ts';

export function createAssetLibraryItem(input: {
  name: string;
  originalFilename: string;
  mimeType?: string;
  sizeBytes: number;
  category: AssetLibraryCategory;
  id?: string;
  createdAt?: string;
}): AssetLibraryItem {
  const id = input.id ?? `asset-${crypto.randomUUID()}`;
  return {
    id,
    name: input.name.trim() || input.originalFilename.replace(/\.glb$/i, '') || 'GLB 에셋',
    kind: 'glb',
    category: input.category,
    mimeType: input.mimeType || 'model/gltf-binary',
    sizeBytes: Math.max(0, Math.floor(input.sizeBytes)),
    storageKey: `glb:${id}`,
    createdAt: input.createdAt ?? new Date().toISOString(),
    originalFilename: input.originalFilename,
  };
}

export function assetWithModel(previous: EntityAssetData | undefined, modelAssetId: string): EntityAssetData {
  return {
    presetId: previous?.presetId,
    modelAssetId,
    category: previous?.category ?? 'generic',
    primitive: previous?.primitive ?? 'box',
    color: previous?.color ?? '#a8a29e',
    material: previous?.material ?? 'matte',
    source: 'manual',
    tags: [...new Set([...(previous?.tags ?? []), 'imported-glb'])],
  };
}

export function assetWithoutModel(previous: EntityAssetData | undefined): EntityAssetData | undefined {
  if (!previous) return undefined;
  const next = structuredClone(previous);
  delete next.modelAssetId;
  next.tags = next.tags.filter((tag) => tag !== 'imported-glb');
  return next;
}

export function findAsset(project: Project, assetId: string | undefined): AssetLibraryItem | undefined {
  if (!assetId) return undefined;
  return project.assetLibrary.find((item) => item.id === assetId);
}

export function formatAssetSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}


export async function validateGlbBlob(blob: Blob): Promise<{ valid: boolean; error?: string }> {
  if (blob.size < 12) return { valid: false, error: 'GLB 파일이 너무 작습니다.' };
  const header = new DataView(await blob.slice(0, 12).arrayBuffer());
  const magic = header.getUint32(0, true);
  const version = header.getUint32(4, true);
  const declaredLength = header.getUint32(8, true);
  if (magic !== 0x46546c67) return { valid: false, error: 'GLB 헤더(glTF)가 올바르지 않습니다.' };
  if (version !== 2) return { valid: false, error: `지원하지 않는 GLB 버전 ${version}입니다. glTF 2.0 GLB가 필요합니다.` };
  if (declaredLength > blob.size || declaredLength < 12) return { valid: false, error: 'GLB 파일 길이 정보가 올바르지 않습니다.' };
  return { valid: true };
}
