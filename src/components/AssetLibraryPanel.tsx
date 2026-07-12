import { useEffect, useMemo, useRef, useState } from 'react';
import { createAssetLibraryItem, formatAssetSize, validateGlbBlob } from '../domain/assets';
import { hasAssetBlob, saveAssetBlob } from '../domain/assetStorage';
import type { AssetLibraryCategory } from '../domain/types';
import { useEditorStore } from '../store/editorStore';

const categoryLabels: Record<AssetLibraryCategory, string> = {
  character: '인물',
  prop: '소품',
  environment: '환경·배경',
};

export function AssetLibraryPanel() {
  const project = useEditorStore((state) => state.project);
  const selectedEntityId = useEditorStore((state) => state.selectedEntityId);
  const registerAsset = useEditorStore((state) => state.registerAsset);
  const assignAssetToSelected = useEditorStore((state) => state.assignAssetToSelected);
  const clearSelectedModelAsset = useEditorStore((state) => state.clearSelectedModelAsset);
  const removeAsset = useEditorStore((state) => state.removeAsset);
  const inputRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<AssetLibraryCategory>('prop');
  const [status, setStatus] = useState<string | null>(null);
  const [relinkAssetId, setRelinkAssetId] = useState<string | null>(null);
  const [availability, setAvailability] = useState<Record<string, boolean>>({});
  const scene = project.scenes.find((item) => item.id === project.activeSceneId) ?? project.scenes[0];
  const selected = scene.entities.find((item) => item.id === selectedEntityId);
  const selectedAssetId = selected?.asset?.modelAssetId;

  const compatibleCategory = useMemo<AssetLibraryCategory>(() => {
    if (selected?.type === 'character') return 'character';
    return category;
  }, [category, selected?.type]);

  useEffect(() => {
    let active = true;
    Promise.all(project.assetLibrary.map(async (item) => [item.id, await hasAssetBlob(item.storageKey)] as const))
      .then((entries) => active && setAvailability(Object.fromEntries(entries)))
      .catch(() => undefined);
    return () => { active = false; };
  }, [project.assetLibrary]);

  const importGlb = async (file: File | undefined) => {
    if (!file) return;
    try {
      if (!file.name.toLowerCase().endsWith('.glb')) throw new Error('현재는 .glb 파일만 지원합니다.');
      if (file.size > 150 * 1024 * 1024) throw new Error('MVP에서는 150MB 이하 GLB를 권장합니다.');
      const validation = await validateGlbBlob(file);
      if (!validation.valid) throw new Error(validation.error ?? '올바른 GLB 파일이 아닙니다.');

      if (relinkAssetId) {
        const existing = project.assetLibrary.find((item) => item.id === relinkAssetId);
        if (!existing) throw new Error('재연결할 에셋 정보를 찾지 못했습니다.');
        setStatus(`${existing.name} 파일을 다시 연결하는 중…`);
        await saveAssetBlob(existing.storageKey, file);
        setAvailability((previous) => ({ ...previous, [existing.id]: true }));
        setStatus(`${existing.name} 재연결 완료`);
        return;
      }

      setStatus('GLB를 로컬 에셋 저장소에 복사하는 중…');
      const item = createAssetLibraryItem({
        name: file.name.replace(/\.glb$/i, ''),
        originalFilename: file.name,
        mimeType: file.type || 'model/gltf-binary',
        sizeBytes: file.size,
        category: compatibleCategory,
      });
      await saveAssetBlob(item.storageKey, file);
      registerAsset(item);
      setAvailability((previous) => ({ ...previous, [item.id]: true }));
      setStatus(`${item.name} 등록 완료`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'GLB를 가져오지 못했습니다.');
    } finally {
      setRelinkAssetId(null);
      if (inputRef.current) inputRef.current.value = '';
      setTimeout(() => setStatus(null), 3500);
    }
  };

  const openImport = (assetId?: string) => {
    setRelinkAssetId(assetId ?? null);
    inputRef.current?.click();
  };

  return (
    <section className="asset-library-panel">
      <div className="section-title-row">
        <h3>GLB 에셋 라이브러리</h3>
        <span>{project.assetLibrary.length}개</span>
      </div>
      <div className="asset-import-row">
        <select value={compatibleCategory} disabled={selected?.type === 'character'} onChange={(event) => setCategory(event.target.value as AssetLibraryCategory)}>
          {Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <button onClick={() => openImport()}>GLB 가져오기</button>
        <input ref={inputRef} className="file-input" type="file" accept=".glb,model/gltf-binary" onChange={(event) => importGlb(event.target.files?.[0])} />
      </div>
      {status && <p className="asset-status">{status}</p>}
      <div className="asset-library-list">
        {project.assetLibrary.length === 0 && <p className="help-text">로컬 GLB를 등록한 뒤 선택한 인물이나 소품에 적용할 수 있습니다.</p>}
        {project.assetLibrary.map((item) => {
          const compatible = Boolean(selected) && (selected?.type === 'character' ? item.category === 'character' : item.category !== 'character');
          const available = availability[item.id] !== false;
          return (
            <div key={item.id} className={selectedAssetId === item.id ? 'asset-library-item active' : 'asset-library-item'}>
              <div>
                <strong>{item.name}</strong>
                <span>{categoryLabels[item.category]} · {formatAssetSize(item.sizeBytes)} · {available ? '로컬 파일 있음' : '재연결 필요'}</span>
              </div>
              <div className="asset-library-actions">
                <button disabled={!compatible || !available || selectedAssetId === item.id} onClick={() => assignAssetToSelected(item.id)}>적용</button>
                {!available ? <button onClick={() => openImport(item.id)}>재연결</button> : <button className="danger" onClick={() => removeAsset(item.id)}>제거</button>}
              </div>
            </div>
          );
        })}
      </div>
      {selectedAssetId && <button className="proxy-restore" onClick={clearSelectedModelAsset}>선택 객체를 프록시로 복원</button>}
    </section>
  );
}
