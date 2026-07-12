import { useEffect, useMemo, useRef, useState } from 'react';
import { Viewport, type CaptureRenderMode, type ViewportHandle } from './components/Viewport';
import { ComfyPanel, type PreparedComfyInputs } from './components/ComfyPanel';
import { SceneGeneratorPanel } from './components/SceneGeneratorPanel';
import { ACTION_LABELS } from './domain/actions';
import { buildCameraPrompt, buildMotionPrompt, buildShotPackageManifest, buildShotPrompt, createStoredZip, DEFAULT_NEGATIVE_PROMPT, downloadBlob, safeFilename } from './domain/export';
import { POSE_PRESETS } from './domain/pose';
import { describeRelationship, findControllingRelationship } from './domain/relationships';
import { resolveSceneAtTime } from './domain/resolver';
import { JOINT_NAMES, type ActionBlock, type ActionType, type Entity, type EntityType, type HandSide, type JointName, type Project, type RelationshipType, type Vec3 } from './domain/types';
import { useEditorStore } from './store/editorStore';
import './styles.css';

function NumberField({ value, onChange, step = 0.1, disabled = false }: { value: number; onChange(value: number): void; step?: number; disabled?: boolean }) {
  return <input disabled={disabled} type="number" step={step} value={Number(value.toFixed(3))} onChange={(event) => onChange(Number(event.target.value))} />;
}

function downloadProject(project: Project) {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${project.name.replaceAll(/[\\/:*?"<>|]/g, '-')}.aiscene.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

const entityLabels: Record<EntityType, string> = {
  character: '인물',
  prop: '소품',
  camera: '카메라',
  light: '조명',
};

const relationshipLabels: Record<RelationshipType, string> = {
  lookAt: '바라보기',
  hold: '손에 들기',
  sitOn: '의자에 앉기',
  placeOn: '위에 놓기',
};

function entityMentioned(text: string, entity: Entity): boolean {
  if (text.includes(entity.name)) return true;
  return entity.name.split(/\s+/).some((token) => token.length >= 1 && text.includes(token));
}

const jointLabels: Record<JointName, string> = {
  pelvis: '골반', spine: '척추', chest: '가슴', neck: '목', head: '머리',
  leftShoulder: '왼쪽 어깨', leftElbow: '왼쪽 팔꿈치', leftWrist: '왼쪽 손목',
  rightShoulder: '오른쪽 어깨', rightElbow: '오른쪽 팔꿈치', rightWrist: '오른쪽 손목',
  leftHip: '왼쪽 고관절', leftKnee: '왼쪽 무릎', leftAnkle: '왼쪽 발목',
  rightHip: '오른쪽 고관절', rightKnee: '오른쪽 무릎', rightAnkle: '오른쪽 발목',
};

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

export default function App() {
  const project = useEditorStore((state) => state.project);
  const activeShotId = useEditorStore((state) => state.activeShotId);
  const selectedEntityId = useEditorStore((state) => state.selectedEntityId);
  const selectedJoint = useEditorStore((state) => state.selectedJoint);
  const message = useEditorStore((state) => state.message);
  const setActiveShot = useEditorStore((state) => state.setActiveShot);
  const selectEntity = useEditorStore((state) => state.selectEntity);
  const setSelectedJoint = useEditorStore((state) => state.setSelectedJoint);
  const setTransformMode = useEditorStore((state) => state.setTransformMode);
  const playheadTime = useEditorStore((state) => state.playheadTime);
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const selectedActionId = useEditorStore((state) => state.selectedActionId);
  const setPlayheadTime = useEditorStore((state) => state.setPlayheadTime);
  const togglePlayback = useEditorStore((state) => state.togglePlayback);
  const advancePlayback = useEditorStore((state) => state.advancePlayback);
  const selectAction = useEditorStore((state) => state.selectAction);
  const moveSelected = useEditorStore((state) => state.moveSelected);
  const updateSelectedTransform = useEditorStore((state) => state.updateSelectedTransform);
  const updateSelectedJoint = useEditorStore((state) => state.updateSelectedJoint);
  const applyPosePreset = useEditorStore((state) => state.applyPosePreset);
  const resetSelectedPose = useEditorStore((state) => state.resetSelectedPose);
  const mirrorSelectedPose = useEditorStore((state) => state.mirrorSelectedPose);
  const applySelectedArmIK = useEditorStore((state) => state.applySelectedArmIK);
  const addSelectedRelationship = useEditorStore((state) => state.addSelectedRelationship);
  const removeRelationship = useEditorStore((state) => state.removeRelationship);
  const addAction = useEditorStore((state) => state.addAction);
  const updateSelectedAction = useEditorStore((state) => state.updateSelectedAction);
  const removeSelectedAction = useEditorStore((state) => state.removeSelectedAction);
  const addGenerationResult = useEditorStore((state) => state.addGenerationResult);
  const removeGenerationResult = useEditorStore((state) => state.removeGenerationResult);
  const addEntity = useEditorStore((state) => state.addEntity);
  const duplicateSelected = useEditorStore((state) => state.duplicateSelected);
  const deleteSelected = useEditorStore((state) => state.deleteSelected);
  const toggleSelectedLock = useEditorStore((state) => state.toggleSelectedLock);
  const renameSelected = useEditorStore((state) => state.renameSelected);
  const addShot = useEditorStore((state) => state.addShot);
  const duplicateActiveShot = useEditorStore((state) => state.duplicateActiveShot);
  const deleteActiveShot = useEditorStore((state) => state.deleteActiveShot);
  const updateActiveShotName = useEditorStore((state) => state.updateActiveShotName);
  const updateActiveShotDuration = useEditorStore((state) => state.updateActiveShotDuration);
  const replaceActiveSceneFromPrompt = useEditorStore((state) => state.replaceActiveSceneFromPrompt);
  const importProject = useEditorStore((state) => state.importProject);
  const clearMessage = useEditorStore((state) => state.clearMessage);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const reset = useEditorStore((state) => state.reset);
  const undoCount = useEditorStore((state) => state.undoStack.length);
  const redoCount = useEditorStore((state) => state.redoStack.length);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<ViewportHandle>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [comfyOpen, setComfyOpen] = useState(false);
  const [sceneGeneratorOpen, setSceneGeneratorOpen] = useState(false);
  const scene = project.scenes.find((item) => item.id === project.activeSceneId) ?? project.scenes[0];
  const shot = scene.shots.find((item) => item.id === activeShotId) ?? scene.shots[0];
  const baseSelected = scene.entities.find((item) => item.id === selectedEntityId) ?? null;
  const resolvedEntities = useMemo(() => resolveSceneAtTime(scene, shot, playheadTime), [scene, shot, playheadTime]);
  const selected = resolvedEntities.find((item) => item.id === selectedEntityId) ?? null;
  const controlledRelationship = selected ? findControllingRelationship(shot.relationships, selected.id) : undefined;
  const [command, setCommand] = useState('');
  const [entityType, setEntityType] = useState<EntityType>('character');
  const [relationshipType, setRelationshipType] = useState<RelationshipType>('lookAt');
  const [relationshipTargetId, setRelationshipTargetId] = useState('');
  const [handSide, setHandSide] = useState<HandSide>('right');
  const [actionType, setActionType] = useState<ActionType>('walk');
  const [actionActorId, setActionActorId] = useState('');
  const [actionTargetId, setActionTargetId] = useState('');
  const [actionSurfaceId, setActionSurfaceId] = useState('');
  const [actionHand, setActionHand] = useState<HandSide>('right');

  const allowedRelationshipTypes: RelationshipType[] = selected?.type === 'character'
    ? ['lookAt', 'hold', 'sitOn']
    : selected?.type === 'prop'
      ? ['placeOn']
      : [];
  const relationshipTargets = scene.entities.filter((entity) => {
    if (!selected || entity.id === selected.id) return false;
    if (relationshipType === 'hold' || relationshipType === 'sitOn' || relationshipType === 'placeOn') return entity.type === 'prop';
    return true;
  });

  const actionActorCandidates = scene.entities.filter((entity) => (
    actionType === 'cameraDolly' || actionType === 'cameraOrbit' ? entity.type === 'camera' : entity.type === 'character'
  ));
  const actionTargetCandidates = scene.entities.filter((entity) => {
    if (entity.id === actionActorId) return false;
    if (actionType === 'pickUp' || actionType === 'putDown') return entity.type === 'prop';
    if (actionType === 'cameraOrbit' || actionType === 'cameraDolly') return entity.type !== 'camera';
    return true;
  });
  const surfaceCandidates = scene.entities.filter((entity) => entity.type === 'prop' && entity.id !== actionTargetId);
  const selectedAction = (shot.actions ?? []).find((action) => action.id === selectedActionId) ?? null;
  const previewLocked = playheadTime > 0 || isPlaying;

  useEffect(() => {
    const nextType = allowedRelationshipTypes.includes(relationshipType) ? relationshipType : allowedRelationshipTypes[0];
    if (nextType && nextType !== relationshipType) setRelationshipType(nextType);
  }, [selected?.type, relationshipType]);

  useEffect(() => {
    if (!relationshipTargets.some((entity) => entity.id === relationshipTargetId)) {
      setRelationshipTargetId(relationshipTargets[0]?.id ?? '');
    }
  }, [relationshipType, selectedEntityId, relationshipTargetId, scene.entities.length]);


  useEffect(() => {
    if (!actionActorCandidates.some((entity) => entity.id === actionActorId)) {
      const preferred = selected && actionActorCandidates.some((entity) => entity.id === selected.id) ? selected.id : actionActorCandidates[0]?.id;
      setActionActorId(preferred ?? '');
    }
  }, [actionType, selectedEntityId, scene.entities.length, actionActorId]);

  useEffect(() => {
    if (!actionTargetCandidates.some((entity) => entity.id === actionTargetId)) setActionTargetId(actionTargetCandidates[0]?.id ?? '');
    if (!surfaceCandidates.some((entity) => entity.id === actionSurfaceId)) setActionSurfaceId(surfaceCandidates[0]?.id ?? '');
  }, [actionType, actionActorId, actionTargetId, actionSurfaceId, scene.entities.length]);

  useEffect(() => {
    if (!isPlaying) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      advancePlayback((now - last) / 1000);
      last = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, activeShotId, advancePlayback]);

  const updateAxis = (path: 'transform.position' | 'transform.rotation' | 'transform.scale', axis: 0 | 1 | 2, value: number) => {
    if (!selected || !Number.isFinite(value)) return;
    const source = path === 'transform.position'
      ? selected.transform.position
      : path === 'transform.rotation'
        ? selected.transform.rotation
        : selected.transform.scale;
    const next = [...source] as Vec3;
    next[axis] = value;
    updateSelectedTransform(path, next);
  };

  const updateJointAxis = (axis: 0 | 1 | 2, degrees: number) => {
    if (!selected?.character || !selectedJoint || !Number.isFinite(degrees)) return;
    const next = [...selected.character.pose[selectedJoint]] as Vec3;
    next[axis] = degrees * DEG_TO_RAD;
    updateSelectedJoint(selectedJoint, next);
  };

  const createAction = () => {
    if (!actionActorId) return;
    const targetRequired = actionType === 'pickUp' || actionType === 'putDown' || actionType === 'cameraOrbit';
    if (targetRequired && !actionTargetId) return;
    const parameters: ActionBlock['parameters'] = {};
    if (actionType === 'walk') parameters.direction = [0, 0, -1], parameters.distance = 1.5;
    if (actionType === 'turnAround') parameters.angle = Math.PI;
    if (actionType === 'pickUp') parameters.hand = actionHand;
    if (actionType === 'putDown') parameters.hand = actionHand, parameters.surfaceEntityId = actionSurfaceId;
    if (actionType === 'cameraDolly') parameters.distance = 2;
    if (actionType === 'cameraOrbit') parameters.angle = Math.PI / 2, parameters.clockwise = true;
    addAction(actionType, actionActorId, actionTargetId || undefined, parameters);
  };

  const runSimpleCommand = () => {
    if (!selected) return;
    const normalized = command.trim();
    if (!normalized) return;
    const meterMatch = normalized.match(/(\d+(?:\.\d+)?)\s*m/);
    const amount = normalized.includes('조금') ? 0.3 : meterMatch ? Number(meterMatch[1]) : 1;

    const findTarget = (predicate: (entity: Entity) => boolean, preferredWords: string[] = []) => (
      scene.entities.find((entity) => entity.id !== selected.id && predicate(entity) && entityMentioned(normalized, entity))
      ?? scene.entities.find((entity) => entity.id !== selected.id && predicate(entity) && preferredWords.some((word) => entity.name.includes(word)))
      ?? scene.entities.find((entity) => entity.id !== selected.id && predicate(entity))
    );

    if (selected.type === 'character' && (normalized.includes('걷') || normalized.includes('걸어'))) {
      const direction: Vec3 = normalized.includes('왼쪽') ? [-1, 0, 0]
        : normalized.includes('오른쪽') ? [1, 0, 0]
          : normalized.includes('뒤') ? [0, 0, 1] : [0, 0, -1];
      addAction('walk', selected.id, undefined, { direction, distance: meterMatch ? Number(meterMatch[1]) : 1.5 });
      setCommand(''); return;
    }
    if (selected.type === 'character' && normalized.includes('뒤돌')) {
      addAction('turnAround', selected.id, undefined, { angle: Math.PI });
      setCommand(''); return;
    }
    if (selected.type === 'character' && (normalized.includes('집어') || normalized.includes('집기'))) {
      const target = findTarget((entity) => entity.type === 'prop', ['컵']);
      if (target) addAction('pickUp', selected.id, target.id, { hand: normalized.includes('왼손') ? 'left' : 'right' });
      setCommand(''); return;
    }
    if (selected.type === 'character' && normalized.includes('내려놓')) {
      const held = shot.relationships.find((relationship) => relationship.type === 'hold' && relationship.sourceEntityId === selected.id);
      const prop = held ? scene.entities.find((entity) => entity.id === held.targetEntityId) : findTarget((entity) => entity.type === 'prop', ['컵']);
      const surface = scene.entities.find((entity) => entity.type === 'prop' && entity.id !== prop?.id && entityMentioned(normalized, entity))
        ?? scene.entities.find((entity) => entity.type === 'prop' && entity.id !== prop?.id && (entity.name.includes('테이블') || entity.name.includes('책상')));
      if (prop && surface) addAction('putDown', selected.id, prop.id, { hand: held?.parameters.hand ?? 'right', surfaceEntityId: surface.id });
      setCommand(''); return;
    }
    if (selected.type === 'camera' && (normalized.includes('오빗') || normalized.includes('주위'))) {
      const target = findTarget((entity) => entity.type !== 'camera');
      if (target) addAction('cameraOrbit', selected.id, target.id, { angle: Math.PI / 2, clockwise: !normalized.includes('반시계') });
      setCommand(''); return;
    }
    if (selected.type === 'camera' && (normalized.includes('돌리') || normalized.includes('다가'))) {
      const target = findTarget((entity) => entity.type !== 'camera');
      addAction('cameraDolly', selected.id, target?.id, { distance: meterMatch ? Number(meterMatch[1]) : 2 });
      setCommand(''); return;
    }

    if (selected.type === 'character' && normalized.includes('바라')) {
      const target = findTarget((entity) => entity.type === 'character');
      if (target) addSelectedRelationship('lookAt', target.id, { lookMode: normalized.includes('몸') ? 'body' : 'head' });
      setCommand('');
      return;
    }
    if (selected.type === 'character' && (normalized.includes('들려') || normalized.includes('들게') || normalized.includes('잡게'))) {
      const target = findTarget((entity) => entity.type === 'prop', ['컵']);
      if (target) addSelectedRelationship('hold', target.id, { hand: normalized.includes('왼손') ? 'left' : 'right', alignRotation: true });
      setCommand('');
      return;
    }
    if (selected.type === 'character' && normalized.includes('앉')) {
      const target = findTarget((entity) => entity.type === 'prop', ['의자']);
      if (target) addSelectedRelationship('sitOn', target.id, { alignRotation: true });
      setCommand('');
      return;
    }
    if (selected.type === 'prop' && (normalized.includes('놓') || normalized.includes('올려'))) {
      const target = findTarget((entity) => entity.type === 'prop', ['테이블', '책상']);
      if (target) addSelectedRelationship('placeOn', target.id, { alignRotation: false });
      setCommand('');
      return;
    }

    if (selected.type === 'character') {
      const preset = normalized.includes('손 흔') ? 'wave'
        : normalized.includes('팔짱') ? 'arms-crossed'
          : normalized.includes('앉') ? 'seated'
            : normalized.includes('달리') ? 'running'
              : normalized.includes('가리') ? 'pointing'
                : normalized.toLowerCase().includes('t포즈') || normalized.toLowerCase().includes('t 포즈') ? 't-pose'
                  : normalized.includes('중립') || normalized.includes('초기') ? 'neutral'
                    : normalized.includes('대화') ? 'conversation'
                      : null;
      if (preset) {
        applyPosePreset(preset);
        setCommand('');
        return;
      }
      if (normalized.includes('오른손') && normalized.includes('앞')) {
        applySelectedArmIK('right', [0.45, 1.25, -0.55]);
        setSelectedJoint('rightWrist');
        setCommand('');
        return;
      }
      if (normalized.includes('왼손') && normalized.includes('앞')) {
        applySelectedArmIK('left', [-0.45, 1.25, -0.55]);
        setSelectedJoint('leftWrist');
        setCommand('');
        return;
      }
    }

    const next = [...selected.transform.position] as Vec3;
    if (normalized.includes('왼쪽')) next[0] -= amount;
    else if (normalized.includes('오른쪽')) next[0] += amount;
    else if (normalized.includes('앞')) next[2] -= amount;
    else if (normalized.includes('뒤')) next[2] += amount;
    else if (normalized.includes('위')) next[1] += amount;
    else if (normalized.includes('아래')) next[1] -= amount;
    else return;
    moveSelected(next);
    setCommand('');
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      importProject(parsed);
    } catch {
      importProject(null);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const prepareComfyInputs = async (mode: 'test' | 'full', onStatus: (message: string) => void): Promise<PreparedComfyInputs> => {
    if (!viewportRef.current) throw new Error('3D 뷰포트가 준비되지 않았습니다.');
    const capture = async (time: number, renderMode: CaptureRenderMode, status: string) => {
      onStatus(status);
      const blob = await viewportRef.current!.captureFrame(time, renderMode);
      await new Promise((resolve) => setTimeout(resolve, 40));
      return blob;
    };
    const files: PreparedComfyInputs['files'] = {
      startFrame: await capture(0, 'beauty', '시작 프레임 렌더링'),
    };
    if (mode === 'full') {
      files.endFrame = await capture(shot.duration, 'beauty', '종료 프레임 렌더링');
      files.poseStart = await capture(0, 'pose', '시작 Pose Map 렌더링');
      files.poseEnd = await capture(shot.duration, 'pose', '종료 Pose Map 렌더링');
      files.depthStart = await capture(0, 'depth', '시작 Depth Map 렌더링');
      files.depthEnd = await capture(shot.duration, 'depth', '종료 Depth Map 렌더링');
      files.maskStart = await capture(0, 'mask', '시작 객체 마스크 렌더링');
      files.maskEnd = await capture(shot.duration, 'mask', '종료 객체 마스크 렌더링');
    }
    return {
      files,
      prompts: {
        scene: buildShotPrompt(scene, shot),
        motion: buildMotionPrompt(scene, shot),
        camera: buildCameraPrompt(scene, shot),
        negative: DEFAULT_NEGATIVE_PROMPT,
      },
      shot: { name: shot.name, duration: shot.duration },
    };
  };

  const exportShotPackage = async () => {
    if (!viewportRef.current || isExporting) return;
    setIsExporting(true);
    setExportStatus('시작 프레임 렌더링');
    try {
      const capture = async (time: number, mode: CaptureRenderMode, status: string) => {
        setExportStatus(status);
        const blob = await viewportRef.current!.captureFrame(time, mode);
        await new Promise((resolve) => setTimeout(resolve, 40));
        return blob;
      };
      const startFrame = await capture(0, 'beauty', '시작 프레임 렌더링');
      const endFrame = await capture(shot.duration, 'beauty', '종료 프레임 렌더링');
      const poseStart = await capture(0, 'pose', '시작 Pose Map 렌더링');
      const poseEnd = await capture(shot.duration, 'pose', '종료 Pose Map 렌더링');
      const depthStart = await capture(0, 'depth', '시작 Depth Map 렌더링');
      const depthEnd = await capture(shot.duration, 'depth', '종료 Depth Map 렌더링');
      const maskStart = await capture(0, 'mask', '시작 객체 마스크 렌더링');
      const maskEnd = await capture(shot.duration, 'mask', '종료 객체 마스크 렌더링');

      setExportStatus('Shot Package 압축 중');
      const manifest = buildShotPackageManifest(project, scene, shot);
      const zip = await createStoredZip([
        { name: 'frames/start_frame.png', data: startFrame },
        { name: 'frames/end_frame.png', data: endFrame },
        { name: 'controls/pose_start.png', data: poseStart },
        { name: 'controls/pose_end.png', data: poseEnd },
        { name: 'controls/depth_start.png', data: depthStart },
        { name: 'controls/depth_end.png', data: depthEnd },
        { name: 'controls/entity_mask_start.png', data: maskStart },
        { name: 'controls/entity_mask_end.png', data: maskEnd },
        { name: 'prompts/scene_prompt.txt', data: buildShotPrompt(scene, shot) },
        { name: 'prompts/motion_prompt.txt', data: buildMotionPrompt(scene, shot) },
        { name: 'prompts/camera_prompt.txt', data: buildCameraPrompt(scene, shot) },
        { name: 'prompts/negative_prompt.txt', data: DEFAULT_NEGATIVE_PROMPT },
        { name: 'shot_manifest.json', data: JSON.stringify(manifest, null, 2) },
      ]);
      downloadBlob(zip, `${safeFilename(project.name)}_${safeFilename(shot.name)}_shot-package.zip`);
      setExportStatus('Shot Package 내보내기 완료');
    } catch (error) {
      setExportStatus(error instanceof Error ? error.message : 'Shot Package를 만들지 못했습니다.');
    } finally {
      setIsExporting(false);
      setTimeout(() => setExportStatus(null), 3500);
    }
  };

  const selectedPose = selected?.character?.pose;
  const selectedJointRotation = selectedPose && selectedJoint ? selectedPose[selectedJoint] : null;

  return (
    <main className="app-shell">
      <header>
        <div>
          <strong>{project.name}</strong>
          <span>revision {project.revision}</span>
          <span>schema {project.schemaVersion}</span>
          <span>로컬 자동 저장</span>
        </div>
        <nav>
          <button onClick={undo} disabled={!undoCount}>실행 취소</button>
          <button onClick={redo} disabled={!redoCount}>다시 실행</button>
          <button className="scene-generator-button" onClick={() => setSceneGeneratorOpen(true)}>AI 씬 생성</button>
          <button className="primary-export" disabled={isExporting} onClick={exportShotPackage}>{isExporting ? '패키지 생성 중…' : 'Shot Package'}</button>
          <button className="comfy-button" onClick={() => setComfyOpen(true)}>ComfyUI</button>
          <button onClick={() => downloadProject(project)}>JSON 내보내기</button>
          <button onClick={() => fileInputRef.current?.click()}>JSON 불러오기</button>
          <input ref={fileInputRef} className="file-input" type="file" accept=".json,.aiscene.json" onChange={(event) => importFile(event.target.files?.[0])} />
          <button onClick={reset}>샘플 초기화</button>
        </nav>
      </header>

      <section className="workspace">
        <aside className="panel hierarchy">
          <div className="panel-title-row">
            <h2>씬 계층</h2>
            <span>{scene.entities.length}개</span>
          </div>
          <div className="inline-controls">
            <select value={entityType} onChange={(event) => setEntityType(event.target.value as EntityType)}>
              {Object.entries(entityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <button onClick={() => addEntity(entityType)}>추가</button>
          </div>
          <div className="entity-list">
            {scene.entities.map((entity) => (
              <button
                className={selectedEntityId === entity.id ? 'entity active' : 'entity'}
                key={entity.id}
                onClick={() => selectEntity(entity.id)}
              >
                <span>{entityLabels[entity.type]}</span>
                <strong>{entity.name}</strong>
                <small>{entity.locked ? '잠금' : entity.visible ? '표시' : '숨김'}</small>
              </button>
            ))}
          </div>
          <div className="button-grid">
            <button onClick={duplicateSelected} disabled={!selected}>복제</button>
            <button onClick={toggleSelectedLock} disabled={!selected}>{baseSelected?.locked ? '잠금 해제' : '잠금'}</button>
            <button className="danger" onClick={deleteSelected} disabled={!selected}>삭제</button>
          </div>
        </aside>

        <Viewport ref={viewportRef} />

        <aside className="panel inspector">
          <h2>속성</h2>
          {selected && baseSelected ? (
            <>
              <label className="stacked-label">이름
                <input value={baseSelected.name} onChange={(event) => renameSelected(event.target.value)} />
              </label>

              <h3>위치</h3>
              <div className="axis-fields">
                <label>X <NumberField disabled={Boolean(controlledRelationship) || previewLocked} value={selected.transform.position[0]} onChange={(value) => updateAxis('transform.position', 0, value)} /></label>
                <label>Y <NumberField disabled={Boolean(controlledRelationship) || previewLocked} value={selected.transform.position[1]} onChange={(value) => updateAxis('transform.position', 1, value)} /></label>
                <label>Z <NumberField disabled={Boolean(controlledRelationship) || previewLocked} value={selected.transform.position[2]} onChange={(value) => updateAxis('transform.position', 2, value)} /></label>
              </div>

              <h3>회전</h3>
              <div className="axis-fields">
                <label>X <NumberField disabled={Boolean(controlledRelationship) || previewLocked} value={selected.transform.rotation[0]} onChange={(value) => updateAxis('transform.rotation', 0, value)} step={0.05} /></label>
                <label>Y <NumberField disabled={Boolean(controlledRelationship) || previewLocked} value={selected.transform.rotation[1]} onChange={(value) => updateAxis('transform.rotation', 1, value)} step={0.05} /></label>
                <label>Z <NumberField disabled={Boolean(controlledRelationship) || previewLocked} value={selected.transform.rotation[2]} onChange={(value) => updateAxis('transform.rotation', 2, value)} step={0.05} /></label>
              </div>

              <h3>크기</h3>
              <div className="axis-fields">
                <label>X <NumberField disabled={Boolean(controlledRelationship) || previewLocked} value={selected.transform.scale[0]} onChange={(value) => updateAxis('transform.scale', 0, value)} /></label>
                <label>Y <NumberField disabled={Boolean(controlledRelationship) || previewLocked} value={selected.transform.scale[1]} onChange={(value) => updateAxis('transform.scale', 1, value)} /></label>
                <label>Z <NumberField disabled={Boolean(controlledRelationship) || previewLocked} value={selected.transform.scale[2]} onChange={(value) => updateAxis('transform.scale', 2, value)} /></label>
              </div>

              {selected.type === 'character' && selectedPose && (
                <section className="pose-inspector">
                  <div className="section-title-row">
                    <h3>휴머노이드 포즈</h3>
                    <button onClick={() => setTransformMode('pose')}>뷰포트 편집</button>
                  </div>
                  <div className="pose-presets">
                    {POSE_PRESETS.map((preset) => (
                      <button disabled={previewLocked} key={preset.id} onClick={() => applyPosePreset(preset.id)}>{preset.name}</button>
                    ))}
                  </div>
                  <div className="pose-actions">
                    <button disabled={previewLocked} onClick={mirrorSelectedPose}>좌우 반전</button>
                    <button disabled={previewLocked} onClick={resetSelectedPose}>초기화</button>
                  </div>

                  <label className="stacked-label">관절 선택
                    <select value={selectedJoint ?? ''} onChange={(event) => setSelectedJoint(event.target.value as JointName)}>
                      {JOINT_NAMES.map((joint) => <option key={joint} value={joint}>{jointLabels[joint]}</option>)}
                    </select>
                  </label>

                  {selectedJointRotation && selectedJoint && (
                    <>
                      <div className="joint-name">{jointLabels[selectedJoint]} 회전(°)</div>
                      <div className="axis-fields">
                        <label>X <NumberField disabled={previewLocked} value={selectedJointRotation[0] * RAD_TO_DEG} step={5} onChange={(value) => updateJointAxis(0, value)} /></label>
                        <label>Y <NumberField disabled={previewLocked} value={selectedJointRotation[1] * RAD_TO_DEG} step={5} onChange={(value) => updateJointAxis(1, value)} /></label>
                        <label>Z <NumberField disabled={previewLocked} value={selectedJointRotation[2] * RAD_TO_DEG} step={5} onChange={(value) => updateJointAxis(2, value)} /></label>
                      </div>
                    </>
                  )}

                  <h3>간단한 손 IK</h3>
                  <div className="ik-grid">
                    <button disabled={previewLocked} onClick={() => { setSelectedJoint('leftWrist'); applySelectedArmIK('left', [-0.45, 1.25, -0.55]); }}>왼손 앞으로</button>
                    <button disabled={previewLocked} onClick={() => { setSelectedJoint('rightWrist'); applySelectedArmIK('right', [0.45, 1.25, -0.55]); }}>오른손 앞으로</button>
                    <button disabled={previewLocked} onClick={() => { setSelectedJoint('leftWrist'); applySelectedArmIK('left', [-0.25, 1.85, 0]); }}>왼손 위로</button>
                    <button disabled={previewLocked} onClick={() => { setSelectedJoint('rightWrist'); applySelectedArmIK('right', [0.25, 1.85, 0]); }}>오른손 위로</button>
                  </div>
                  <p className="help-text">포즈·IK 모드에서 손목 관절을 선택하면 분홍색 목표점을 직접 끌 수 있습니다.</p>
                </section>
              )}

              {allowedRelationshipTypes.length > 0 && (
                <section className="relationship-inspector">
                  <div className="section-title-row"><h3>객체 관계</h3><span>{shot.relationships.length}개</span></div>
                  <label className="stacked-label">관계 유형
                    <select value={relationshipType} onChange={(event) => setRelationshipType(event.target.value as RelationshipType)}>
                      {allowedRelationshipTypes.map((type) => <option key={type} value={type}>{relationshipLabels[type]}</option>)}
                    </select>
                  </label>
                  <label className="stacked-label">대상
                    <select value={relationshipTargetId} onChange={(event) => setRelationshipTargetId(event.target.value)}>
                      {relationshipTargets.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
                    </select>
                  </label>
                  {relationshipType === 'hold' && (
                    <label className="stacked-label">손
                      <select value={handSide} onChange={(event) => setHandSide(event.target.value as HandSide)}>
                        <option value="right">오른손</option><option value="left">왼손</option>
                      </select>
                    </label>
                  )}
                  <button
                    className="relationship-add"
                    disabled={!relationshipTargetId || baseSelected.locked || previewLocked}
                    onClick={() => addSelectedRelationship(
                      relationshipType,
                      relationshipTargetId,
                      relationshipType === 'hold' ? { hand: handSide, alignRotation: true }
                        : relationshipType === 'lookAt' ? { lookMode: 'head' }
                          : { alignRotation: relationshipType === 'sitOn' },
                    )}
                  >관계 적용</button>
                  <div className="relationship-list">
                    {shot.relationships
                      .filter((relationship) => relationship.sourceEntityId === selected.id || relationship.targetEntityId === selected.id)
                      .map((relationship) => (
                        <div key={relationship.id} className="relationship-row">
                          <span>{describeRelationship(relationship, scene.entities)}</span>
                          <button onClick={() => removeRelationship(relationship.id)}>삭제</button>
                        </div>
                      ))}
                  </div>
                </section>
              )}

              {controlledRelationship && (
                <div className="notice warning">
                  위치가 “{relationshipLabels[controlledRelationship.type]}” 관계로 제어됩니다. 관계를 삭제하면 직접 이동할 수 있습니다.
                </div>
              )}
              <div className="notice">
                변경은 <strong>{shot.name}</strong>의 Override 또는 관계로 저장됩니다. 기본 씬과 다른 샷은 유지됩니다.
              </div>
            </>
          ) : <p>객체를 선택해 주세요.</p>}
        </aside>
      </section>

      <section className="shot-strip">
        <div className="shot-actions">
          <button onClick={addShot}>+ 새 샷</button>
          <button onClick={duplicateActiveShot}>현재 샷 복제</button>
          <button className="danger" onClick={deleteActiveShot}>현재 샷 삭제</button>
        </div>
        {scene.shots.map((item) => (
          <button key={item.id} className={item.id === activeShotId ? 'shot active' : 'shot'} onClick={() => setActiveShot(item.id)}>
            <strong>{item.name}</strong>
            <span>{item.duration}초 · Override {item.overrides.length}개 · 관계 {item.relationships.length}개 · 행동 {(item.actions ?? []).length}개 · 결과 {(item.generationResults ?? []).length}개</span>
          </button>
        ))}
        <div className="shot-editor">
          <label>샷 이름<input value={shot.name} onChange={(event) => updateActiveShotName(event.target.value)} /></label>
          <label>길이(초)<NumberField value={shot.duration} step={0.5} onChange={updateActiveShotDuration} /></label>
        </div>
      </section>

      <section className="timeline-panel">
        <div className="timeline-controls">
          <button onClick={() => setPlayheadTime(0)}>처음</button>
          <button className={isPlaying ? 'active' : ''} onClick={togglePlayback}>{isPlaying ? '정지' : '재생'}</button>
          <strong>{playheadTime.toFixed(2)} / {shot.duration.toFixed(2)}초</strong>
          <input type="range" min={0} max={shot.duration} step={0.01} value={playheadTime} onChange={(event) => setPlayheadTime(Number(event.target.value))} />
        </div>
        <div className="action-create">
          <select value={actionType} onChange={(event) => setActionType(event.target.value as ActionType)}>
            {(Object.keys(ACTION_LABELS) as ActionType[]).map((type) => <option key={type} value={type}>{ACTION_LABELS[type]}</option>)}
          </select>
          <select value={actionActorId} onChange={(event) => setActionActorId(event.target.value)}>
            {actionActorCandidates.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
          </select>
          {(actionType === 'pickUp' || actionType === 'putDown' || actionType === 'cameraDolly' || actionType === 'cameraOrbit') && (
            <select value={actionTargetId} onChange={(event) => setActionTargetId(event.target.value)}>
              {actionTargetCandidates.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
            </select>
          )}
          {actionType === 'putDown' && (
            <select value={actionSurfaceId} onChange={(event) => setActionSurfaceId(event.target.value)}>
              {surfaceCandidates.map((entity) => <option key={entity.id} value={entity.id}>{entity.name} 위</option>)}
            </select>
          )}
          {(actionType === 'pickUp' || actionType === 'putDown') && (
            <select value={actionHand} onChange={(event) => setActionHand(event.target.value as HandSide)}><option value="right">오른손</option><option value="left">왼손</option></select>
          )}
          <button onClick={createAction}>현재 시간에 추가</button>
        </div>
        <div className="timeline-body">
          <div className="timeline-ruler"><span>0초</span><span>{(shot.duration / 2).toFixed(1)}초</span><span>{shot.duration.toFixed(1)}초</span></div>
          <div className="playhead" style={{ left: `${(playheadTime / shot.duration) * 100}%` }} />
          {(shot.actions ?? []).length === 0 && <div className="timeline-empty">행동을 추가하면 이곳에 시간 블록이 표시됩니다.</div>}
          {(shot.actions ?? []).map((action) => (
            <button key={action.id} className={selectedActionId === action.id ? 'action-track selected' : 'action-track'} onClick={() => selectAction(action.id)}>
              <span>{ACTION_LABELS[action.type]}</span>
              <i style={{ left: `${(action.startTime / shot.duration) * 100}%`, width: `${(action.duration / shot.duration) * 100}%` }}>{scene.entities.find((entity) => entity.id === action.actorEntityId)?.name}</i>
            </button>
          ))}
        </div>
        {selectedAction && (
          <div className="action-editor">
            <strong>{ACTION_LABELS[selectedAction.type]}</strong>
            <label>시작 <NumberField value={selectedAction.startTime} step={0.1} onChange={(value) => updateSelectedAction({ startTime: value })} /></label>
            <label>길이 <NumberField value={selectedAction.duration} step={0.1} onChange={(value) => updateSelectedAction({ duration: value })} /></label>
            {(selectedAction.type === 'walk' || selectedAction.type === 'cameraDolly') && <label>거리 <NumberField value={selectedAction.parameters.distance ?? 1.5} step={0.1} onChange={(value) => updateSelectedAction({ parameters: { ...selectedAction.parameters, distance: value } })} /></label>}
            {(selectedAction.type === 'turnAround' || selectedAction.type === 'cameraOrbit') && <label>각도(°) <NumberField value={(selectedAction.parameters.angle ?? Math.PI) * RAD_TO_DEG} step={5} onChange={(value) => updateSelectedAction({ parameters: { ...selectedAction.parameters, angle: value * DEG_TO_RAD } })} /></label>}
            <button className="danger" onClick={removeSelectedAction}>행동 삭제</button>
          </div>
        )}
      </section>

      <section className="command-bar">
        <select value={activeShotId} onChange={(event) => setActiveShot(event.target.value)}>
          {scene.shots.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <input
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && runSimpleCommand()}
          placeholder="예: 2m 앞으로 걸어줘 / 뒤돌아보게 해줘 / 컵을 집어줘 / 카메라 오빗"
        />
        <button onClick={runSimpleCommand}>적용</button>
      </section>

      <SceneGeneratorPanel
        open={sceneGeneratorOpen}
        onClose={() => setSceneGeneratorOpen(false)}
        onApply={replaceActiveSceneFromPrompt}
      />

      <ComfyPanel
        open={comfyOpen}
        onClose={() => setComfyOpen(false)}
        onPrepareInputs={prepareComfyInputs}
        onRegisterResult={addGenerationResult}
        results={shot.generationResults ?? []}
        onRemoveResult={removeGenerationResult}
      />

      {exportStatus && <div className="export-status">{exportStatus}</div>}

      {message && (
        <button className="toast" onClick={clearMessage} aria-label="알림 닫기">
          {message}<span>×</span>
        </button>
      )}
    </main>
  );
}
