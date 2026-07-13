import { getAssetObjectUrl, saveAssetBlob } from './assetStorage.ts';
import type { ReferenceImage } from './types.ts';

export const MAX_REFERENCE_IMAGE_COUNT = 30;
export const MAX_REFERENCE_IMAGE_BYTES = 50_000_000;
export const MAX_REFERENCE_SOURCE_BYTES = 20_000_000;
export const MAX_REFERENCE_ITEM_BYTES = 5_000_000;

export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, payload = ''] = dataUrl.split(',', 2);
  const mimeType = /data:([^;]+)/.exec(header)?.[1] ?? 'application/octet-stream';
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
}

export async function persistLegacyReferenceImages(images: ReferenceImage[]): Promise<number> {
  let restored = 0;
  for (const image of images) {
    if (!image.dataUrl) continue;
    try {
      await saveAssetBlob(image.storageKey, dataUrlToBlob(image.dataUrl));
      restored += 1;
    } catch {
      // Keep the inline fallback so old projects remain usable.
    }
  }
  return restored;
}

export async function referenceImageUrl(image: ReferenceImage): Promise<string | null> {
  const stored = await getAssetObjectUrl(image.storageKey);
  return stored ?? image.dataUrl ?? null;
}
