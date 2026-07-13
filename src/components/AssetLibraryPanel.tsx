import { useEffect, useMemo, useRef, useState } from 'react';
import { createAssetLibraryItem, formatAssetSize, validateGlbBlob } from '../domain/assets';
import { getAssetBlob, hasAssetBlob, saveAssetBlob } from '../domain/assetStorage';
import { JOINT_NAMES, type AssetLibraryCategory, type AssetLibraryItem, type HumanoidRigProfile, type JointName, type Vec3 } from '../domain/types';
import { analyzeGlbRig, mapHumanoidBones, rebuildHumanoidRigProfile } from '../domain/rigging';
import { useEditorStore } from '../store/editorStore';

const categoryLabels: Record<AssetLibraryCategory, string> = {
  character: '인물',
  prop: '소품',
  environment: '환경·배경',
};

const jointLabels: Record<JointName, string> = {
  pelvis: '골반', spine: '척추', chest: '가슴', neck: '목', head: '머리',
  leftShoulder: '왼쪽 상완', leftElbow: '왼쪽 전완', leftWrist: '왼쪽 손',
  rightShoulder: '오른쪽 상완', rightElbow: '오른쪽 전완', rightWrist: '오른쪽 손',
  leftHip: '왼쪽 허벅지', leftKnee: '왼쪽 종아리', leftAnkle: '왼쪽 발',
  rightHip: '오른쪽 허벅지', rightKnee: '오른쪽 종아리', rightAnkle: '오른쪽 발',
};

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

function RigMappingEditor({ item, onSave, onClose }: { item: AssetLibraryItem; onSave(rig: HumanoidRigProfile): void; onClose(): void }) {
  const rig = item.rig;
  const [boneMap, setBoneMap] = useState<Partial<Record<JointName, string>>>(() => structuredClone(rig?.boneMap ?? {}));
  const [axisCorrections, setAxisCorrections] = useState<Partial<Record<JointName, Vec3>>>(() => structuredClone(rig?.axisCorrections ?? {}));
  if (!rig) return null;

  const setAxis = (joint: JointName, axis: number, degrees: number) => {
    const next = structuredClone(axisCorrections);
    const value = [...(next[joint] ?? [0, 0, 0])] as Vec3;
    value[axis] = Number.isFinite(degrees) ? degrees * DEG : 0;
    next[joint] = value;
    setAxisCorrections(next);
  };

  const autoMap = () => {
    setBoneMap(mapHumanoidBones(rig.nodeNames));
    setAxisCorrections({});
  };

  const preview = rebuildHumanoidRigProfile(rig, boneMap, axisCorrections);
  return (
    <div className="rig-mapping-editor">
      <div className="rig-editor-heading">
        <div>
          <strong>{item.name} 본 매핑</strong>
          <span>{preview.mappedJointCount}/17 매핑 · 축 보정은 포즈 회전 좌표계를 변환합니다.</span>
        </div>
        <button onClick={onClose}>닫기</button>
      </div>
      {rig.proportions && (
        <div className="rig-proportion-summary">
          <span>체형 기준 높이 {rig.proportions.referenceHeight.toFixed(2)}</span>
          <span>왼팔 {rig.proportions.leftArm.upperLength.toFixed(2)} + {rig.proportions.leftArm.lowerLength.toFixed(2)}m</span>
          <span>오른팔 {rig.proportions.rightArm.upperLength.toFixed(2)} + {rig.proportions.rightArm.lowerLength.toFixed(2)}m</span>
        </div>
      )}
      <div className="rig-editor-actions">
        <button onClick={autoMap}>자동 매핑 복원</button>
        <button onClick={() => { setBoneMap({}); setAxisCorrections({}); }}>전체 해제</button>
      </div>
      <div className="rig-mapping-table">
        <div className="rig-mapping-header"><b>표준 관절</b><b>GLB 본</b><b>축 보정 X°</b><b>Y°</b><b>Z°</b></div>
        {JOINT_NAMES.map((joint) => {
          const correction = axisCorrections[joint] ?? [0, 0, 0];
          return (
            <div key={joint} className="rig-mapping-row">
              <label>{jointLabels[joint]}</label>
              <select value={boneMap[joint] ?? ''} onChange={(event) => setBoneMap((previous) => ({ ...previous, [joint]: event.target.value || undefined }))}>
                <option value="">미매핑</option>
                {rig.nodeNames.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
              {[0, 1, 2].map((axis) => (
                <input key={axis} disabled={!boneMap[joint]} type="number" step={5} value={Number((correction[axis] * RAD).toFixed(1))} onChange={(event) => setAxis(joint, axis, Number(event.target.value))} />
              ))}
            </div>
          );
        })}
      </div>
      <div className="rig-editor-footer">
        {preview.missingJoints.length > 0 && <span>미매핑: {preview.missingJoints.map((joint) => jointLabels[joint]).join(', ')}</span>}
        <button className="primary" onClick={() => onSave(preview)}>매핑 저장</button>
      </div>
    </div>
  );
}

export function AssetLibraryPanel() {
  const project = useEditorStore((state) => state.project);
  const selectedEntityId = useEditorStore((state) => state.selectedEntityId);
  const registerAsset = useEditorStore((state) => state.registerAsset);
  const updateAssetItem = useEditorStore((state) => state.updateAssetItem);
  const assignAssetToSelected = useEditorStore((state) => state.assignAssetToSelected);
  const clearSelectedModelAsset = useEditorStore((state) => state.clearSelectedModelAsset);
  const removeAsset = useEditorStore((state) => state.removeAsset);
  const inputRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<AssetLibraryCategory>('prop');
  const [status, setStatus] = useState<string | null>(null);
  const [relinkAssetId, setRelinkAssetId] = useState<string | null>(null);
  const [availability, setAvailability] = useState<Record<string, boolean>>({});
  const [editingRigAssetId, setEditingRigAssetId] = useState<string | null>(null);
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
        setStatus(`${existing.name} 파일과 Skeleton을 다시 분석하는 중…`);
        const rig = await analyzeGlbRig(file);
        await saveAssetBlob(existing.storageKey, file);
        const nextItem: AssetLibraryItem = { ...structuredClone(existing), sizeBytes: file.size, mimeType: file.type || existing.mimeType, originalFilename: file.name, rig };
        updateAssetItem(nextItem);
        setAvailability((previous) => ({ ...previous, [existing.id]: true }));
        setStatus(`${existing.name} 재연결 완료 · 본 ${rig.mappedJointCount}/${17}`);
        return;
      }

      setStatus('GLB Skeleton과 애니메이션을 분석하는 중…');
      const rig = await analyzeGlbRig(file);
      const item = createAssetLibraryItem({
        name: file.name.replace(/\.glb$/i, ''),
        originalFilename: file.name,
        mimeType: file.type || 'model/gltf-binary',
        sizeBytes: file.size,
        category: compatibleCategory,
        rig,
      });
      await saveAssetBlob(item.storageKey, file);
      registerAsset(item);
      setAvailability((previous) => ({ ...previous, [item.id]: true }));
      setStatus(`${item.name} 등록 완료 · 리그 ${rig.status} · 본 ${rig.mappedJointCount}/${17}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'GLB를 가져오지 못했습니다.');
    } finally {
      setRelinkAssetId(null);
      if (inputRef.current) inputRef.current.value = '';
      setTimeout(() => setStatus(null), 3500);
    }
  };

  const reanalyzeRig = async (item: AssetLibraryItem) => {
    try {
      setStatus(`${item.name} Skeleton 재분석 중…`);
      const blob = await getAssetBlob(item.storageKey);
      if (!blob) throw new Error('로컬 GLB 파일을 찾지 못했습니다. 재연결해 주세요.');
      const rig = await analyzeGlbRig(blob);
      updateAssetItem({ ...structuredClone(item), rig });
      setStatus(`${item.name} 분석 완료 · ${rig.mappedJointCount}/${17} 관절 매핑`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Skeleton을 분석하지 못했습니다.');
    } finally {
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
      <div className={editingRigAssetId ? 'asset-library-list editing-rig' : 'asset-library-list'}>
        {project.assetLibrary.length === 0 && <p className="help-text">로컬 GLB를 등록한 뒤 선택한 인물이나 소품에 적용할 수 있습니다.</p>}
        {project.assetLibrary.map((item) => {
          const compatible = Boolean(selected) && (selected?.type === 'character' ? item.category === 'character' : item.category !== 'character');
          const available = availability[item.id] !== false;
          return (
            <div key={item.id} className={selectedAssetId === item.id ? 'asset-library-item active' : 'asset-library-item'}>
              <div>
                <strong>{item.name}</strong>
                <span>{categoryLabels[item.category]} · {formatAssetSize(item.sizeBytes)} · {available ? '로컬 파일 있음' : '재연결 필요'}</span>
                {item.rig && <span className={`rig-status ${item.rig.status}`}>리그 {item.rig.status} · 본 {item.rig.mappedJointCount}/17 · Skeleton {item.rig.skeletonCount}개</span>}
                {item.rig && item.rig.nodeNames.length > 0 && (
                  <details className="rig-details">
                    <summary>본 매핑과 애니메이션</summary>
                    <div className="rig-map-grid">
                      {Object.entries(item.rig.boneMap).map(([joint, bone]) => <span key={joint}><b>{joint}</b><i>{bone}</i></span>)}
                    </div>
                    {item.rig.missingJoints.length > 0 && <small>미매핑: {item.rig.missingJoints.join(', ')}</small>}
                    {item.rig.animationClips.length > 0 && <small>클립: {item.rig.animationClips.join(', ')}</small>}
                  </details>
                )}
              </div>
              <div className="asset-library-actions">
                <button disabled={!compatible || !available || selectedAssetId === item.id} onClick={() => assignAssetToSelected(item.id)}>적용</button>
                {available && <button onClick={() => reanalyzeRig(item)}>리그 분석</button>}
                {item.rig && <button onClick={() => setEditingRigAssetId(editingRigAssetId === item.id ? null : item.id)}>매핑 편집</button>}
                {!available ? <button onClick={() => openImport(item.id)}>재연결</button> : <button className="danger" onClick={() => removeAsset(item.id)}>제거</button>}
              </div>
              {editingRigAssetId === item.id && item.rig && (
                <RigMappingEditor
                  item={item}
                  onClose={() => setEditingRigAssetId(null)}
                  onSave={(rig) => { updateAssetItem({ ...structuredClone(item), rig }); setEditingRigAssetId(null); setStatus(`${item.name} 수동 본 매핑을 저장했습니다.`); }}
                />
              )}
            </div>
          );
        })}
      </div>
      {selectedAssetId && <button className="proxy-restore" onClick={clearSelectedModelAsset}>선택 객체를 프록시로 복원</button>}
    </section>
  );
}
