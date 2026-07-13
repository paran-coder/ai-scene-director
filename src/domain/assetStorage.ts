const DB_NAME = 'ai-scene-director-assets';
const STORE_NAME = 'files';
const DB_VERSION = 1;
const memoryStorage = new Map<string, Blob>();

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('이 환경에서는 로컬 에셋 저장소를 사용할 수 없습니다.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('에셋 저장소를 열지 못했습니다.'));
  });
}

export async function saveAssetBlob(storageKey: string, blob: Blob): Promise<void> {
  if (typeof indexedDB === 'undefined') { memoryStorage.set(storageKey, blob); return; }
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(blob, storageKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('GLB 파일을 저장하지 못했습니다.'));
      tx.onabort = () => reject(tx.error ?? new Error('GLB 파일 저장이 중단되었습니다.'));
    });
  } finally {
    db.close();
  }
}

export async function getAssetBlob(storageKey: string): Promise<Blob | null> {
  if (typeof indexedDB === 'undefined') return memoryStorage.get(storageKey) ?? null;
  const db = await openDatabase();
  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(storageKey);
      request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
      request.onerror = () => reject(request.error ?? new Error('GLB 파일을 불러오지 못했습니다.'));
    });
  } finally {
    db.close();
  }
}

export async function hasAssetBlob(storageKey: string): Promise<boolean> {
  return Boolean(await getAssetBlob(storageKey));
}


export async function listAssetStorageKeys(): Promise<string[]> {
  if (typeof indexedDB === 'undefined') return [...memoryStorage.keys()];
  const db = await openDatabase();
  try {
    return await new Promise<string[]>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAllKeys();
      request.onsuccess = () => resolve(request.result.map((key) => String(key)));
      request.onerror = () => reject(request.error ?? new Error('에셋 저장소 목록을 읽지 못했습니다.'));
    });
  } finally {
    db.close();
  }
}

export async function deleteAssetBlob(storageKey: string): Promise<void> {
  if (typeof indexedDB === 'undefined') { memoryStorage.delete(storageKey); return; }
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(storageKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('GLB 파일을 삭제하지 못했습니다.'));
    });
  } finally {
    db.close();
  }
}

const objectUrlCache = new Map<string, string>();

export async function getAssetObjectUrl(storageKey: string): Promise<string | null> {
  const cached = objectUrlCache.get(storageKey);
  if (cached) return cached;
  const blob = await getAssetBlob(storageKey);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  objectUrlCache.set(storageKey, url);
  return url;
}


export function clearAssetObjectUrl(storageKey: string): void {
  const url = objectUrlCache.get(storageKey);
  if (url) URL.revokeObjectURL(url);
  objectUrlCache.delete(storageKey);
}

export function clearAllAssetObjectUrls(): void {
  for (const url of objectUrlCache.values()) URL.revokeObjectURL(url);
  objectUrlCache.clear();
}
