import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Viewport, type CaptureRenderMode, type ViewportHandle } from './components/Viewport';
import { Onboarding, shouldShowOnboarding } from './components/Onboarding';
import { DirectorWorkflowPanel } from './components/DirectorWorkflowPanel';
import { CommandPalette } from './components/CommandPalette';
import { SessionInsightsPanel } from './components/SessionInsightsPanel';
import { AIExportDialog, type AIExportMode } from './components/AIExportDialog';
import type { PreparedComfyInputs } from './components/ComfyPanel';
import { ACTION_LABELS, collectActionConflicts } from './domain/actions';
import { analyzeDirectorWorkflow, type DirectorActionId } from './domain/directorWorkflow';
import { buildShotExportPreflight } from './domain/shotExportPreflight';
import { buildCommandCatalog, type AppCommandId } from './domain/commandPalette';
import { appendCreatorSessionEvent, createCreatorSession, saveCreatorSession, type CreatorSessionEventType } from './domain/sessionInsights';
import { buildCameraPrompt, buildMotionPrompt, buildShotPackageManifest, buildShotPrompt, createStoredZip, DEFAULT_NEGATIVE_PROMPT, downloadBlob, safeFilename } from './domain/export';
import { POSE_PRESETS } from './domain/pose';
import { ENVIRONMENT_PRESETS } from './domain/environmentPresets';
import { describeRelationship, findControllingRelationship } from './domain/relationships';
import { resolveSceneAtTime } from './domain/resolver';

import { JOINT_NAMES, type ActionBlock, type ActionType, type Entity, type EntityType, type HandSide, type JointName, type Project, type ReferenceImage, type RelationshipType, type Vec3 } from './domain/types';
import { saveAssetBlob } from './domain/assetStorage';
import { MAX_REFERENCE_IMAGE_BYTES, MAX_REFERENCE_IMAGE_COUNT, MAX_REFERENCE_ITEM_BYTES, MAX_REFERENCE_SOURCE_BYTES, persistLegacyReferenceImages, referenceImageUrl } from './domain/referenceImages';
import { latestRecoverySnapshot, listRecoverySnapshots, removeRecoverySnapshot, saveRecoverySnapshot } from './domain/recovery';
import { connectProjectWorkspace, currentProjectWorkspace, saveBlobToWorkspace } from './domain/workspace';
import { buildStorageCleanupPlan, cleanupUnusedAssetBlobs, registerProjectStorageReferences } from './domain/storageCleanup';
import { probeBrowserRuntime, resolveRenderQuality, type RenderQualityProfile, type RuntimeDiagnostics } from './domain/runtimeDiagnostics';
import { reportNativeSmokeReady } from './domain/desktopBridge';
import { useEditorStore } from './store/editorStore';
import './styles.css';

const ComfyPanel = lazy(async () => ({ default: (await import('./components/ComfyPanel')).ComfyPanel }));
const SceneGeneratorPanel = lazy(async () => ({ default: (await import('./components/SceneGeneratorPanel')).SceneGeneratorPanel }));
const AssetLibraryPanel = lazy(async () => ({ default: (await import('./components/AssetLibraryPanel')).AssetLibraryPanel }));
const ProjectDoctorPanel = lazy(async () => ({ default: (await import('./components/ProjectDoctorPanel')).ProjectDoctorPanel }));

function ReferenceImagePreview({ image, alt, className }: { image: ReferenceImage; alt: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(image.dataUrl ?? null);
  useEffect(() => {
    let active = true;
    void referenceImageUrl(image).then((url) => { if (active) setSrc(url); });
    return () => { active = false; };
  }, [image.storageKey, image.dataUrl]);
  return src ? <img src={src} alt={alt} className={className} /> : <div className={`reference-placeholder ${className ?? ''}`}>이미지 로드 중</div>;
}


function TimelineActionRow({
  action,
  duration,
  actorName,
  selected,
  conflicted,
  onSelect,
  onCommit,
}: {
  action: ActionBlock;
  duration: number;
  actorName: string;
  selected: boolean;
  conflicted: boolean;
  onSelect(event?: React.MouseEvent<HTMLDivElement>): void;
  onCommit(startTime: number, actionDuration: number): void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState({ startTime: action.startTime, duration: action.duration });
  const draftRef = useRef(draft);
  useEffect(() => {
    const next = { startTime: action.startTime, duration: action.duration };
    draftRef.current = next;
    setDraft(next);
  }, [action.startTime, action.duration]);

  const startDrag = (event: React.PointerEvent<HTMLDivElement>, mode: 'move' | 'start' | 'end') => {
    event.preventDefault();
    event.stopPropagation();
    const row = rowRef.current;
    if (!row) return;
    const rect = row.getBoundingClientRect();
    const timelineWidth = Math.max(1, rect.width - 120);
    const originX = event.clientX;
    const original = { ...draft };
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const onMove = (moveEvent: PointerEvent) => {
      const delta = ((moveEvent.clientX - originX) / timelineWidth) * duration;
      let startTime = original.startTime;
      let actionDuration = original.duration;
      if (mode === 'move') startTime = Math.max(0, Math.min(duration - actionDuration, original.startTime + delta));
      if (mode === 'start') {
        const end = original.startTime + original.duration;
        startTime = Math.max(0, Math.min(end - 0.1, original.startTime + delta));
        actionDuration = end - startTime;
      }
      if (mode === 'end') actionDuration = Math.max(0.1, Math.min(duration - original.startTime, original.duration + delta));
      startTime = Math.round(startTime * 20) / 20;
      actionDuration = Math.round(actionDuration * 20) / 20;
      const next = { startTime, duration: actionDuration };
      draftRef.current = next;
      setDraft(next);
    };
    const onUp = (upEvent: PointerEvent) => {
      try { target.releasePointerCapture(upEvent.pointerId); } catch { /* capture may already be released */ }
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      onCommit(draftRef.current.startTime, draftRef.current.duration);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  return (
    <div ref={rowRef} className={`action-track ${selected ? 'selected' : ''} ${conflicted ? 'conflicted' : ''}`} onClick={(event) => onSelect(event)}>
      <span>{ACTION_LABELS[action.type]}{conflicted ? ' ⚠' : ''}</span>
      <div className="action-lane">
        <div
          className="action-block"
          style={{ left: `${(draft.startTime / duration) * 100}%`, width: `${(draft.duration / duration) * 100}%` }}
          onPointerDown={(event) => startDrag(event, 'move')}
        >
          <button aria-label="시작 시간 조절" className="resize-handle start" onPointerDown={(event) => startDrag(event as unknown as React.PointerEvent<HTMLDivElement>, 'start')} />
          <b>{actorName}</b>
          <small>{draft.startTime.toFixed(2)}–{(draft.startTime + draft.duration).toFixed(2)}초</small>
          <button aria-label="종료 시간 조절" className="resize-handle end" onPointerDown={(event) => startDrag(event as unknown as React.PointerEvent<HTMLDivElement>, 'end')} />
        </div>
      </div>
    </div>
  );
}

function NumberField({ value, onChange, step = 0.1, disabled = false }: { value: number; onChange(value: number): void; step?: number; disabled?: boolean }) {
  return <input disabled={disabled} type="number" step={step} value={Number(value.toFixed(3))} onChange={(event) => onChange(Number(event.target.value))} />;
}


async function prepareReferenceImage(file: File): Promise<{ blob: Blob; mimeType: string; sizeBytes: number }> {
  const rawUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('참조 이미지 형식을 읽지 못했습니다.'));
      element.src = rawUrl;
    });
    const maxDimension = 1800;
    const ratio = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('이미지 압축용 Canvas를 만들지 못했습니다.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (result) => result ? resolve(result) : reject(new Error('참조 이미지를 WebP로 변환하지 못했습니다.')),
      'image/webp',
      0.84,
    ));
    return { blob, mimeType: blob.type || 'image/webp', sizeBytes: blob.size };
  } finally {
    URL.revokeObjectURL(rawUrl);
  }
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
  useEffect(() => {
    const frame = requestAnimationFrame(() => { void reportNativeSmokeReady(); });
    return () => cancelAnimationFrame(frame);
  }, []);
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
  const applySelectedLegIK = useEditorStore((state) => state.applySelectedLegIK);
  const groundSelectedFeet = useEditorStore((state) => state.groundSelectedFeet);
  const addSelectedRelationship = useEditorStore((state) => state.addSelectedRelationship);
  const removeRelationship = useEditorStore((state) => state.removeRelationship);
  const addAction = useEditorStore((state) => state.addAction);
  const updateSelectedAction = useEditorStore((state) => state.updateSelectedAction);
  const updateActionTiming = useEditorStore((state) => state.updateActionTiming);
  const shiftActions = useEditorStore((state) => state.shiftActions);
  const removeActions = useEditorStore((state) => state.removeActions);
  const updateSelectedCamera = useEditorStore((state) => state.updateSelectedCamera);
  const updateSelectedLight = useEditorStore((state) => state.updateSelectedLight);
  const addReferenceImage = useEditorStore((state) => state.addReferenceImage);
  const updateReferenceImage = useEditorStore((state) => state.updateReferenceImage);
  const removeReferenceImage = useEditorStore((state) => state.removeReferenceImage);
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
  const changeEnvironmentPreset = useEditorStore((state) => state.changeEnvironmentPreset);
  const relayoutActiveScene = useEditorStore((state) => state.relayoutActiveScene);
  const importProject = useEditorStore((state) => state.importProject);
  const clearMessage = useEditorStore((state) => state.clearMessage);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const reset = useEditorStore((state) => state.reset);
  const undoCount = useEditorStore((state) => state.undoStack.length);
  const redoCount = useEditorStore((state) => state.redoStack.length);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const bundleInputRef = useRef<HTMLInputElement>(null);
  const referenceImageInputRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<ViewportHandle>(null);
  const hierarchyRef = useRef<HTMLElement>(null);
  const inspectorRef = useRef<HTMLElement>(null);
  const shotStripRef = useRef<HTMLElement>(null);
  const timelineRef = useRef<HTMLElement>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [aiExportOpen, setAIExportOpen] = useState(false);
  const [comfyOpen, setComfyOpen] = useState(false);
  const [sceneGeneratorOpen, setSceneGeneratorOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [sessionInsightsOpen, setSessionInsightsOpen] = useState(false);
  const [creatorSession, setCreatorSession] = useState(() => appendCreatorSessionEvent(createCreatorSession(), 'session_started', { appVersion: project.schemaVersion }));
  const firstEditRecordedRef = useRef(false);
  const firstEditCompletedRef = useRef(false);
  const generatedSceneRevisionRef = useRef<number | null>(null);
  const executeCommandRef = useRef<(id: AppCommandId, source?: 'palette' | 'shortcut') => void>(() => undefined);
  const [workflowCollapsed, setWorkflowCollapsed] = useState(() => {
    try { return localStorage.getItem('ai-scene-director-workflow-collapsed') === 'true'; } catch { return false; }
  });
  const [focusMode, setFocusMode] = useState(() => {
    try { return localStorage.getItem('ai-scene-director-focus-mode') === 'true'; } catch { return false; }
  });
  const [firstEditGuideOpen, setFirstEditGuideOpen] = useState(false);
  const [focusedArea, setFocusedArea] = useState<'hierarchy' | 'inspector' | 'shots' | 'timeline' | null>(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState('복구 저장 준비');
  const [workspaceLabel, setWorkspaceLabel] = useState(currentProjectWorkspace()?.label ?? '');
  const [recoveryCount, setRecoveryCount] = useState(() => listRecoverySnapshots().length);
  const smokeMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('smoke');
  const [onboardingOpen, setOnboardingOpen] = useState(() => smokeMode ? false : shouldShowOnboarding());
  const [selectedActionIds, setSelectedActionIds] = useState<Set<string>>(new Set());
  const [cleanupStatus, setCleanupStatus] = useState<string | null>(null);
  const [doctorOpen, setDoctorOpen] = useState(false);
  const [runtimeDiagnostics, setRuntimeDiagnostics] = useState<RuntimeDiagnostics | null>(() => {
    try { return probeBrowserRuntime(); } catch { return null; }
  });
  const [renderQuality, setRenderQuality] = useState<RenderQualityProfile>(() => {
    try {
      const stored = localStorage.getItem('ai-scene-director-render-quality');
      return stored === 'performance' || stored === 'balanced' || stored === 'quality' ? stored : 'auto';
    } catch {
      return 'auto';
    }
  });

  const recordCreatorEvent = (type: CreatorSessionEventType, metadata: Record<string, unknown> = {}) => {
    setCreatorSession((current) => {
      const next = appendCreatorSessionEvent(current, type, metadata);
      saveCreatorSession(next);
      return next;
    });
  };

  const openCommandPalette = () => {
    setCommandPaletteOpen(true);
    recordCreatorEvent('command_palette_opened');
  };
  useEffect(() => {
    try { localStorage.setItem('ai-scene-director-workflow-collapsed', String(workflowCollapsed)); } catch { /* private mode */ }
  }, [workflowCollapsed]);

  useEffect(() => {
    try { localStorage.setItem('ai-scene-director-focus-mode', String(focusMode)); } catch { /* private mode */ }
  }, [focusMode]);

  const scene = project.scenes.find((item) => item.id === project.activeSceneId) ?? project.scenes[0];
  const shot = scene.shots.find((item) => item.id === activeShotId) ?? scene.shots[0];
  const baseSelected = scene.entities.find((item) => item.id === selectedEntityId) ?? null;
  const resolvedEntities = useMemo(() => resolveSceneAtTime(scene, shot, playheadTime), [scene, shot, playheadTime]);
  const selected = resolvedEntities.find((item) => item.id === selectedEntityId) ?? null;
  const exportPreflight = useMemo(() => buildShotExportPreflight(scene, shot, { renderAvailable: runtimeDiagnostics?.status !== 'unsupported' }), [scene, shot, runtimeDiagnostics?.status]);
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
  const actionConflicts = useMemo(() => collectActionConflicts(shot.actions ?? []), [shot.actions]);
  const conflictedActionIds = useMemo(() => new Set(actionConflicts.flatMap((item) => [item.actionId, item.conflictingActionId])), [actionConflicts]);
  const previewLocked = playheadTime > 0 || isPlaying;
  const effectiveRenderQuality = resolveRenderQuality(renderQuality, runtimeDiagnostics);
  const directorReport = useMemo(() => analyzeDirectorWorkflow(project, scene.id, shot.id), [project, scene.id, shot.id]);
  const shotReadinessById = useMemo(() => new Map(directorReport.shotReadiness.map((item) => [item.shotId, item])), [directorReport]);

  useEffect(() => {
    try {
      const next = probeBrowserRuntime();
      setRuntimeDiagnostics(next);
      document.documentElement.dataset.aisdReady = 'true';
      document.documentElement.dataset.aisdRuntime = next.status;
    } catch {
      setRuntimeDiagnostics(null);
      document.documentElement.dataset.aisdReady = 'true';
      document.documentElement.dataset.aisdRuntime = 'unknown';
    }
    return () => {
      delete document.documentElement.dataset.aisdReady;
      delete document.documentElement.dataset.aisdRuntime;
    };
  }, []);

  const changeRenderQuality = (profile: RenderQualityProfile) => {
    setRenderQuality(profile);
    try { localStorage.setItem('ai-scene-director-render-quality', profile); } catch { /* private mode */ }
  };

  useEffect(() => {
    setSelectedActionIds(new Set());
  }, [activeShotId]);

  useEffect(() => {
    const existing = new Set((shot.actions ?? []).map((action) => action.id));
    setSelectedActionIds((current) => new Set([...current].filter((id) => existing.has(id))));
  }, [shot.actions]);

  const selectTimelineAction = (actionId: string, event?: React.MouseEvent<HTMLDivElement>) => {
    const additive = Boolean(event?.ctrlKey || event?.metaKey || event?.shiftKey);
    setSelectedActionIds((current) => {
      if (!additive) return new Set([actionId]);
      const next = new Set(current);
      if ((event?.ctrlKey || event?.metaKey) && next.has(actionId)) next.delete(actionId);
      else next.add(actionId);
      return next;
    });
    selectAction(actionId);
  };

  const cleanupLocalAssets = async () => {
    setCleanupStatus('미사용 로컬 에셋 확인 중…');
    try {
      const plan = await buildStorageCleanupPlan(project);
      if (!plan.unusedKeys.length) {
        setCleanupStatus('정리할 미사용 로컬 에셋이 없습니다.');
        return;
      }
      const confirmed = window.confirm(`현재 프로젝트에서 제거된 로컬 에셋 ${plan.unusedKeys.length}개를 영구 삭제합니다. 다른 프로젝트의 에셋은 삭제하지 않습니다.`);
      if (!confirmed) {
        setCleanupStatus('저장소 정리를 취소했습니다.');
        return;
      }
      const result = await cleanupUnusedAssetBlobs(project);
      setCleanupStatus(result.failedKeys.length
        ? `${result.deletedKeys.length}개 정리 · ${result.failedKeys.length}개 실패`
        : `미사용 로컬 에셋 ${result.deletedKeys.length}개 정리 완료`);
    } catch (error) {
      setCleanupStatus(error instanceof Error ? error.message : '로컬 에셋 정리에 실패했습니다.');
    }
  };

  useEffect(() => {
    registerProjectStorageReferences(project);
  }, [project.id, project.revision]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const snapshot = saveRecoverySnapshot(project, activeShotId, 'auto');
      setRecoveryCount(listRecoverySnapshots().length);
      setAutoSaveStatus(`복구 저장 ${new Date(snapshot.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [project.revision, activeShotId]);

  useEffect(() => {
    const handler = () => saveRecoverySnapshot(project, activeShotId, 'beforeunload');
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [project, activeShotId]);

  useEffect(() => {
    const images = project.scenes.flatMap((item) => item.referenceImages ?? []).filter((image) => Boolean(image.dataUrl));
    if (!images.length) return;
    void persistLegacyReferenceImages(images).then(() => {
      images.forEach((image) => updateReferenceImage(image.id, { dataUrl: undefined }));
    });
  }, [project.id, project.schemaVersion]);

  useEffect(() => {
    if (!workspaceLabel) return undefined;
    const timer = window.setTimeout(() => {
      const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
      void saveBlobToWorkspace(blob, '.aiscene-autosave.json')
        .then(() => setAutoSaveStatus('프로젝트 폴더 자동 저장 완료'))
        .catch((error) => setAutoSaveStatus(error instanceof Error ? error.message : '프로젝트 폴더 자동 저장 실패'));
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [project.revision, workspaceLabel]);

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

  const importReferenceImage = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    if (file.size > MAX_REFERENCE_SOURCE_BYTES) {
      alert('원본 참조 이미지는 20MB 이하만 불러올 수 있습니다.');
      return;
    }
    const existingReferences = scene.referenceImages ?? [];
    if (existingReferences.length >= MAX_REFERENCE_IMAGE_COUNT) {
      alert('프로젝트당 참조 이미지는 최대 30개까지 지원합니다.');
      return;
    }
    const prepared = await prepareReferenceImage(file);
    if (prepared.sizeBytes > MAX_REFERENCE_ITEM_BYTES) {
      alert('압축 후 이미지가 5MB를 넘습니다. 더 작은 이미지를 사용해 주세요.');
      return;
    }
    const totalBytes = existingReferences.reduce((sum, item) => sum + item.sizeBytes, 0) + prepared.sizeBytes;
    if (totalBytes > MAX_REFERENCE_IMAGE_BYTES) {
      alert('참조 이미지 로컬 에셋 총량은 50MB까지 지원합니다.');
      return;
    }
    const id = `reference-${crypto.randomUUID()}`;
    const storageKey = `reference-image:${id}`;
    await saveAssetBlob(storageKey, prepared.blob);
    const image: ReferenceImage = {
      id,
      name: file.name.replace(/\.[^.]+$/, ''),
      storageKey,
      mimeType: prepared.mimeType,
      sizeBytes: prepared.sizeBytes,
      opacity: 0.45,
      visible: true,
      cameraEntityId: selected?.type === 'camera' ? selected.id : shot.cameraEntityId,
      fit: 'contain',
    };
    addReferenceImage(image);
    if (referenceImageInputRef.current) referenceImageInputRef.current.value = '';
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
    recordCreatorEvent('action_added', { actionType });
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

  const connectWorkspace = async () => {
    try {
      const workspace = await connectProjectWorkspace();
      if (!workspace) return;
      setWorkspaceLabel(workspace.label);
      setAutoSaveStatus(`프로젝트 폴더 연결 · ${workspace.label}`);
    } catch (error) {
      setAutoSaveStatus(error instanceof Error ? error.message : '프로젝트 폴더를 연결하지 못했습니다.');
    }
  };

  const saveWorkspaceBundle = async () => {
    if (!workspaceLabel || isExporting) return;
    setIsExporting(true);
    setExportStatus('프로젝트 폴더에 전체 번들을 저장하는 중…');
    try {
      const { createProjectBundle } = await import('./domain/projectBundle');
      const result = await createProjectBundle(project);
      const path = await saveBlobToWorkspace(result.blob, `${safeFilename(project.name)}.aiscene.zip`);
      setExportStatus(`프로젝트 폴더 저장 완료 · ${path}`);
      saveRecoverySnapshot(project, activeShotId, 'manual');
      setRecoveryCount(listRecoverySnapshots().length);
    } catch (error) {
      setExportStatus(error instanceof Error ? error.message : '프로젝트 폴더에 저장하지 못했습니다.');
    } finally {
      setIsExporting(false);
      setTimeout(() => setExportStatus(null), 4200);
    }
  };

  const restoreLatestRecovery = () => {
    const snapshot = latestRecoverySnapshot();
    if (!snapshot) { setAutoSaveStatus('복구 가능한 스냅샷이 없습니다.'); return; }
    if (!importProject(snapshot.project)) { setAutoSaveStatus('복구 스냅샷을 열지 못했습니다.'); return; }
    const recoveredScene = snapshot.project.scenes.find((item) => item.id === snapshot.project.activeSceneId) ?? snapshot.project.scenes[0];
    if (recoveredScene?.shots.some((item) => item.id === snapshot.activeShotId)) setActiveShot(snapshot.activeShotId);
    removeRecoverySnapshot(snapshot.id);
    setRecoveryCount(listRecoverySnapshots().length);
    setAutoSaveStatus(`복구 완료 · ${new Date(snapshot.createdAt).toLocaleString('ko-KR')}`);
  };

  const exportProjectBundle = async () => {
    if (isExporting) return;
    setIsExporting(true);
    setExportStatus('프로젝트와 로컬 GLB를 번들로 묶는 중…');
    try {
      const { createProjectBundle } = await import('./domain/projectBundle');
      const result = await createProjectBundle(project);
      downloadBlob(result.blob, `${safeFilename(project.name)}.aiscene.zip`);
      setExportStatus(result.missingAssetIds.length
        ? `번들 완료 · 누락 GLB ${result.missingAssetIds.length}개`
        : `프로젝트 번들 완료 · GLB ${project.assetLibrary.length}개 · 참조 이미지 ${project.scenes.reduce((sum, item) => sum + (item.referenceImages?.length ?? 0), 0)}개 포함`);
    } catch (error) {
      setExportStatus(error instanceof Error ? error.message : '프로젝트 번들을 만들지 못했습니다.');
    } finally {
      setIsExporting(false);
      setTimeout(() => setExportStatus(null), 4200);
    }
  };

  const importBundleFile = async (file: File | undefined) => {
    if (!file) return;
    setExportStatus('프로젝트 번들과 GLB를 복원하는 중…');
    try {
      const { importProjectBundle } = await import('./domain/projectBundle');
      const result = await importProjectBundle(file);
      importProject(result.project);
      setExportStatus(`번들 불러오기 완료 · GLB ${result.restoredAssetIds.length}개 · 참조 이미지 ${result.restoredReferenceImageIds.length}개 복원${result.missingAssetIds.length + result.missingReferenceImageIds.length ? ` · 누락 ${result.missingAssetIds.length + result.missingReferenceImageIds.length}개` : ''}`);
    } catch (error) {
      setExportStatus(error instanceof Error ? error.message : '프로젝트 번들을 불러오지 못했습니다.');
    } finally {
      if (bundleInputRef.current) bundleInputRef.current.value = '';
      setTimeout(() => setExportStatus(null), 4500);
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

  const composeAIExportPrompt = (mode: 'image' | 'video') => {
    const sections = [
      `[장면]\n${buildShotPrompt(scene, shot)}`,
      mode === 'video' ? `[동작]\n${buildMotionPrompt(scene, shot)}` : null,
      `[카메라]\n${buildCameraPrompt(scene, shot)}`,
      `[피해야 할 요소]\n${DEFAULT_NEGATIVE_PROMPT}`,
    ].filter(Boolean);
    return sections.join('\n\n');
  };

  const copyAIExportPrompt = async (mode: 'image' | 'video') => {
    const text = composeAIExportPrompt(mode);
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
      setExportStatus(`${mode === 'image' ? '이미지' : '영상'} AI용 프롬프트를 복사했습니다.`);
    } catch {
      setExportStatus('프롬프트를 복사하지 못했습니다. 내보내기 창의 텍스트를 직접 복사해 주세요.');
    } finally {
      setTimeout(() => setExportStatus(null), 3000);
    }
  };

  const downloadAIReferenceFrame = async () => {
    if (!viewportRef.current || isExporting) return;
    setIsExporting(true);
    setExportStatus('기준 이미지 렌더링');
    try {
      const blob = await viewportRef.current.captureFrame(0, 'beauty');
      downloadBlob(blob, `${safeFilename(project.name)}_${safeFilename(shot.name)}_reference.png`);
      setExportStatus('기준 이미지 다운로드 완료');
    } catch (error) {
      setExportStatus(error instanceof Error ? error.message : '기준 이미지를 만들지 못했습니다.');
    } finally {
      setIsExporting(false);
      setTimeout(() => setExportStatus(null), 3000);
    }
  };

  const downloadAIStartEndFrames = async () => {
    if (!viewportRef.current || isExporting) return;
    setIsExporting(true);
    setExportStatus('시작·종료 이미지 렌더링');
    try {
      const startFrame = await viewportRef.current.captureFrame(0, 'beauty');
      const endFrame = await viewportRef.current.captureFrame(shot.duration, 'beauty');
      const zip = await createStoredZip([
        { name: 'start_frame.png', data: startFrame },
        { name: 'end_frame.png', data: endFrame },
        { name: 'video_prompt.txt', data: composeAIExportPrompt('video') },
      ]);
      downloadBlob(zip, `${safeFilename(project.name)}_${safeFilename(shot.name)}_start-end.zip`);
      setExportStatus('시작·종료 이미지 다운로드 완료');
    } catch (error) {
      setExportStatus(error instanceof Error ? error.message : '시작·종료 이미지를 만들지 못했습니다.');
    } finally {
      setIsExporting(false);
      setTimeout(() => setExportStatus(null), 3000);
    }
  };

  const performAIExport = async (mode: Exclude<AIExportMode, 'simple'>) => {
    if (!viewportRef.current || isExporting) return;
    setAIExportOpen(false);
    setIsExporting(true);
    recordCreatorEvent('export_started', { kind: `ai-${mode}`, shotCount: scene.shots.length });
    setExportStatus('AI용 기준 프레임 렌더링');
    try {
      const capture = async (time: number, renderMode: CaptureRenderMode, status: string) => {
        setExportStatus(status);
        const blob = await viewportRef.current!.captureFrame(time, renderMode);
        await new Promise((resolve) => setTimeout(resolve, 40));
        return blob;
      };
      const startFrame = await capture(0, 'beauty', '기준 프레임 렌더링');
      const poseStart = await capture(0, 'pose', 'Pose 가이드 렌더링');
      const depthStart = await capture(0, 'depth', 'Depth 가이드 렌더링');
      const maskStart = await capture(0, 'mask', '객체 마스크 렌더링');
      const files: Array<{ name: string; data: Blob | string }> = mode === 'image' ? [
        { name: 'frames/reference.png', data: startFrame },
        { name: 'controls/pose.png', data: poseStart },
        { name: 'controls/depth.png', data: depthStart },
        { name: 'controls/entity_mask.png', data: maskStart },
      ] : [
        { name: 'frames/start_frame.png', data: startFrame },
        { name: 'frames/end_frame.png', data: await capture(shot.duration, 'beauty', '종료 프레임 렌더링') },
        { name: 'controls/pose_start.png', data: poseStart },
        { name: 'controls/pose_end.png', data: await capture(shot.duration, 'pose', '종료 Pose 렌더링') },
        { name: 'controls/depth_start.png', data: depthStart },
        { name: 'controls/depth_end.png', data: await capture(shot.duration, 'depth', '종료 Depth 렌더링') },
        { name: 'controls/entity_mask_start.png', data: maskStart },
        { name: 'controls/entity_mask_end.png', data: await capture(shot.duration, 'mask', '종료 마스크 렌더링') },
      ];
      files.push(
        { name: 'prompts/final_prompt.txt', data: composeAIExportPrompt(mode) },
        { name: 'prompts/scene_prompt.txt', data: buildShotPrompt(scene, shot) },
        { name: 'prompts/camera_prompt.txt', data: buildCameraPrompt(scene, shot) },
        { name: 'prompts/negative_prompt.txt', data: DEFAULT_NEGATIVE_PROMPT },
      );
      if (mode === 'video') files.push({ name: 'prompts/motion_prompt.txt', data: buildMotionPrompt(scene, shot) });

      const manifest = buildShotPackageManifest(project, scene, shot);
      files.push(
        { name: 'shot_manifest.json', data: JSON.stringify({ ...manifest, aiExportMode: mode }, null, 2) },
        { name: '사용법.txt', data: mode === 'image'
          ? 'reference.png을 기준 이미지로 사용하고 final_prompt.txt를 프롬프트에 붙여넣으세요. 필요하면 Pose, Depth, entity_mask를 생성 도구의 제어 이미지로 연결하세요.'
          : 'start_frame.png과 end_frame.png을 영상 생성 도구의 시작·종료 프레임으로 사용하고 final_prompt.txt를 붙여넣으세요. motion_prompt와 camera_prompt는 동작 및 카메라 지시입니다.' },
      );

      setExportStatus(`${mode === 'image' ? '이미지' : '영상'} AI 자료 압축 중`);
      const zip = await createStoredZip(files);
      const suffix = mode === 'image' ? 'image-ai' : 'video-ai';
      downloadBlob(zip, `${safeFilename(project.name)}_${safeFilename(shot.name)}_${suffix}.zip`);
      setExportStatus(`${mode === 'image' ? '이미지' : '영상'} AI용 내보내기 완료`);
      recordCreatorEvent('export_completed', { kind: `ai-${mode}`, actionCount: shot.actions.length });
    } catch (error) {
      recordCreatorEvent('error', { area: 'ai-export' });
      setExportStatus(error instanceof Error ? error.message : 'AI용 자료를 만들지 못했습니다.');
    } finally {
      setIsExporting(false);
      setTimeout(() => setExportStatus(null), 3500);
    }
  };

  const requestAIExport = () => {
    setAIExportOpen(true);
    recordCreatorEvent('workflow_navigated', { action: 'export-review', readiness: exportPreflight.status });
  };

  const focusArea = (area: 'hierarchy' | 'inspector' | 'shots' | 'timeline', element: HTMLElement | null) => {
    if (focusMode && (area === 'hierarchy' || area === 'inspector')) setFocusMode(false);
    setFocusedArea(area);
    window.setTimeout(() => {
      element?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      window.setTimeout(() => setFocusedArea(null), 1400);
    }, 40);
  };

  const selectPrimarySubject = () => {
    const lead = scene.entities.find((entity) => entity.type === 'character' && entity.character?.appearance.role === 'lead')
      ?? scene.entities.find((entity) => entity.type === 'character');
    const promptProp = scene.entities.find((entity) => entity.type === 'prop' && entity.asset?.source === 'prompt')
      ?? scene.entities.find((entity) => entity.type === 'prop' && !entity.locked)
      ?? scene.entities.find((entity) => entity.type === 'prop');
    const subject = lead ?? promptProp ?? scene.entities.find((entity) => entity.type === 'camera');
    if (subject) {
      selectEntity(subject.id);
      setTransformMode(subject.type === 'character' ? 'translate' : 'translate');
      focusArea('inspector', inspectorRef.current);
    }
  };

  const handleDirectorAction = (action: DirectorActionId) => {
    recordCreatorEvent('workflow_navigated', { action });
    if (action === 'openSceneGenerator') { setSceneGeneratorOpen(true); return; }
    if (action === 'selectPrimarySubject') { selectPrimarySubject(); return; }
    if (action === 'selectLeadCharacter') {
      const lead = scene.entities.find((entity) => entity.type === 'character' && entity.character?.appearance.role === 'lead')
        ?? scene.entities.find((entity) => entity.type === 'character');
      if (lead) { selectEntity(lead.id); setTransformMode('translate'); focusArea('inspector', inspectorRef.current); }
      return;
    }
    if (action === 'focusSceneHierarchy') {
      const subject = scene.entities.find((entity) => entity.type === 'character' && entity.character?.appearance.role === 'lead')
        ?? scene.entities.find((entity) => entity.type === 'character')
        ?? scene.entities.find((entity) => entity.type === 'prop');
      if (subject) selectEntity(subject.id);
      focusArea('hierarchy', hierarchyRef.current);
      return;
    }
    if (action === 'selectShotCamera') {
      const camera = scene.entities.find((entity) => entity.id === shot.cameraEntityId && entity.type === 'camera')
        ?? scene.entities.find((entity) => entity.type === 'camera');
      if (camera) { selectEntity(camera.id); focusArea('inspector', inspectorRef.current); }
      else addEntity('camera');
      return;
    }
    if (action === 'focusShotStrip') { focusArea('shots', shotStripRef.current); return; }
    if (action === 'addShot') { addShot(); focusArea('shots', shotStripRef.current); return; }
    if (action === 'focusTimeline') {
      setPlayheadTime(0);
      const lead = scene.entities.find((entity) => entity.type === 'character' && entity.character?.appearance.role === 'lead')
        ?? scene.entities.find((entity) => entity.type === 'character');
      if (lead) { selectEntity(lead.id); setActionActorId(lead.id); setActionType('walk'); }
      focusArea('timeline', timelineRef.current);
      return;
    }
    if (action === 'openProjectDoctor') { setDoctorOpen(true); return; }
    if (action === 'exportShotPackage') { requestAIExport(); }
  };

  const handleExportQuickFix = () => {
    setAIExportOpen(false);
    if (exportPreflight.quickAction === 'selectCamera') handleDirectorAction('selectShotCamera');
    else if (exportPreflight.quickAction === 'focusTimeline') handleDirectorAction('focusTimeline');
    else handleDirectorAction('openProjectDoctor');
  };

  const applyGeneratedScene = (prompt: string) => {
    replaceActiveSceneFromPrompt(prompt);
    firstEditRecordedRef.current = false;
    firstEditCompletedRef.current = false;
    generatedSceneRevisionRef.current = project.revision + 1;
    recordCreatorEvent('scene_applied', { source: 'natural-language' });
    setFirstEditGuideOpen(true);
    setWorkflowCollapsed(true);
    setFocusMode(false);
    window.setTimeout(() => viewportRef.current && document.querySelector('.viewport')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
  };



  useEffect(() => {
    if (!firstEditGuideOpen || !directorReport.journey.firstEdit.ready || firstEditRecordedRef.current) return;
    firstEditRecordedRef.current = true;
    recordCreatorEvent('first_edit_ready', { targetKind: directorReport.journey.firstEdit.targetKind });
  }, [firstEditGuideOpen, directorReport.journey.firstEdit.ready, directorReport.journey.firstEdit.targetKind]);

  useEffect(() => {
    const baseline = generatedSceneRevisionRef.current;
    if (baseline === null || firstEditCompletedRef.current || project.revision <= baseline) return;
    firstEditCompletedRef.current = true;
    recordCreatorEvent('first_edit_completed', { revisionDelta: project.revision - baseline });
  }, [project.revision]);

  const commandCatalog = useMemo(() => buildCommandCatalog({
    canUndo: undoCount > 0,
    canRedo: redoCount > 0,
    canSaveWorkspace: Boolean(workspaceLabel),
    hasSelection: Boolean(selected),
    isPlaying,
    focusMode,
    workflowCollapsed,
  }), [undoCount, redoCount, workspaceLabel, selected, isPlaying, focusMode, workflowCollapsed]);

  const executeCommand = (id: AppCommandId, source: 'palette' | 'shortcut' = 'palette') => {
    recordCreatorEvent(source === 'shortcut' ? 'shortcut_used' : 'command_executed', { commandId: id });
    if (id === 'openSceneGenerator') { setSceneGeneratorOpen(true); recordCreatorEvent('scene_generator_opened', { source }); return; }
    if (id === 'focusSceneHierarchy') { handleDirectorAction('focusSceneHierarchy'); return; }
    if (id === 'focusShotStrip') { handleDirectorAction('focusShotStrip'); return; }
    if (id === 'focusTimeline') { handleDirectorAction('focusTimeline'); return; }
    if (id === 'openProjectDoctor') { setDoctorOpen(true); recordCreatorEvent('project_checked', { source }); return; }
    if (id === 'exportShotPackage') { requestAIExport(); return; }
    if (id === 'toggleFocusMode') { setFocusMode((value) => !value); return; }
    if (id === 'toggleWorkflow') { setWorkflowCollapsed((value) => !value); return; }
    if (id === 'undo') { if (undoCount) undo(); return; }
    if (id === 'redo') { if (redoCount) redo(); return; }
    if (id === 'transformTranslate') { setTransformMode('translate'); return; }
    if (id === 'transformRotate') { setTransformMode('rotate'); return; }
    if (id === 'transformScale') { setTransformMode('scale'); return; }
    if (id === 'transformPose') { if (selected?.type === 'character') setTransformMode('pose'); return; }
    if (id === 'togglePlayback') { togglePlayback(); return; }
    if (id === 'resetPlayhead') { setPlayheadTime(0); return; }
    if (id === 'addShot') { addShot(); recordCreatorEvent('shot_added', { source }); focusArea('shots', shotStripRef.current); return; }
    if (id === 'duplicateShot') { duplicateActiveShot(); recordCreatorEvent('shot_added', { source: 'duplicate' }); return; }
    if (id === 'selectShotCamera') { handleDirectorAction('selectShotCamera'); return; }
    if (id === 'saveProject') { if (workspaceLabel) void saveWorkspaceBundle(); else void exportProjectBundle(); return; }
    if (id === 'exportProjectBundle') { void exportProjectBundle(); return; }
    if (id === 'openOnboarding') { setOnboardingOpen(true); return; }
    if (id === 'openSessionInsights') { setSessionInsightsOpen(true); return; }
  };
  executeCommandRef.current = executeCommand;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editable = Boolean(target && (target.matches('input, textarea, select') || target.isContentEditable));
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (modifier && key === 'k') { event.preventDefault(); openCommandPalette(); return; }
      if (event.key === 'Escape') {
        if (commandPaletteOpen) setCommandPaletteOpen(false);
        else if (sessionInsightsOpen) setSessionInsightsOpen(false);
        else if (sceneGeneratorOpen) setSceneGeneratorOpen(false);
        else if (doctorOpen) setDoctorOpen(false);
        return;
      }
      if (editable || commandPaletteOpen || sessionInsightsOpen) return;
      let commandId: AppCommandId | null = null;
      if (modifier && key === 'z' && event.shiftKey) commandId = 'redo';
      else if (modifier && key === 'z') commandId = 'undo';
      else if (event.ctrlKey && key === 'y') commandId = 'redo';
      else if (modifier && key === 's') commandId = 'saveProject';
      else if (modifier && event.shiftKey && key === 'n') commandId = 'addShot';
      else if (modifier && key === 'd') commandId = 'duplicateShot';
      else if (event.altKey && key === '1') commandId = 'openSceneGenerator';
      else if (event.altKey && key === '2') commandId = 'focusSceneHierarchy';
      else if (event.altKey && key === '3') commandId = 'focusShotStrip';
      else if (event.altKey && key === '4') commandId = 'focusTimeline';
      else if (event.altKey && key === '5') commandId = 'openProjectDoctor';
      else if (event.altKey && key === '6') commandId = 'exportShotPackage';
      else if (!event.altKey && !modifier && !event.shiftKey && key === 'g') commandId = 'openSceneGenerator';
      else if (!event.altKey && !modifier && !event.shiftKey && key === 'w') commandId = 'transformTranslate';
      else if (!event.altKey && !modifier && !event.shiftKey && key === 'e') commandId = 'transformRotate';
      else if (!event.altKey && !modifier && !event.shiftKey && key === 'r') commandId = 'transformScale';
      else if (!event.altKey && !modifier && !event.shiftKey && key === 'p') commandId = 'transformPose';
      else if (!event.altKey && !modifier && !event.shiftKey && key === 'c') commandId = 'selectShotCamera';
      else if (!event.altKey && !modifier && event.shiftKey && key === 'f') commandId = 'toggleWorkflow';
      else if (!event.altKey && !modifier && !event.shiftKey && key === 'f') commandId = 'toggleFocusMode';
      else if (event.code === 'Space') commandId = 'togglePlayback';
      else if (event.key === 'Home') commandId = 'resetPlayhead';
      else if (event.key === '?') commandId = 'openOnboarding';
      if (!commandId) return;
      event.preventDefault();
      executeCommandRef.current(commandId, 'shortcut');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [commandPaletteOpen, sessionInsightsOpen, sceneGeneratorOpen, doctorOpen]);

  const selectedPose = selected?.character?.pose;
  const selectedJointRotation = selectedPose && selectedJoint ? selectedPose[selectedJoint] : null;

  return (
    <main className={`app-shell ${focusMode ? 'focus-mode' : ''}`} data-aisd-ready="true" data-runtime-status={runtimeDiagnostics?.status ?? 'checking'}>
      <header className="app-header">
        <div className="brand-cluster">
          <div className="brand-mark" aria-hidden="true">AS</div>
          <div className="project-identity">
            <strong>{project.name}</strong>
            <span>AI Scene Director</span>
          </div>
          <div className="header-statuses" aria-label="프로젝트 상태">
            <span className="status-chip">r{project.revision}</span>
            <span className="status-chip">schema {project.schemaVersion}</span>
            <span className="status-chip autosave">{autoSaveStatus}</span>
            <span className={`status-chip runtime-status ${runtimeDiagnostics?.status ?? 'checking'}`}>환경 {runtimeDiagnostics?.score ?? '…'} · {effectiveRenderQuality}</span>
            {workspaceLabel && <span className="status-chip" title={workspaceLabel}>폴더 {workspaceLabel.split(/[\\/]/).pop()}</span>}
          </div>
        </div>
        <nav className="header-actions" aria-label="주요 작업">
          <div className="history-actions" aria-label="실행 기록">
            <button className="compact-action focus-essential" title="실행 취소 (Ctrl/Cmd+Z)" onClick={undo} disabled={!undoCount}><span aria-hidden="true">↶</span><b>취소</b></button>
            <button className="compact-action focus-essential" title="다시 실행 (Ctrl/Cmd+Shift+Z)" onClick={redo} disabled={!redoCount}><span aria-hidden="true">↷</span><b>다시</b></button>
          </div>
          <div className="product-flow-actions" aria-label="핵심 제작 흐름">
            <button className="flow-action focus-essential" onClick={() => executeCommand('openSceneGenerator')}><i>1</i><span>장면 만들기</span></button>
            <button className="flow-action focus-essential" onClick={selectPrimarySubject}><i>2</i><span>장면 수정하기</span></button>
            <button className="flow-action export primary-export focus-essential" disabled={isExporting} onClick={requestAIExport}><i>3</i><span>{isExporting ? '생성 중…' : 'AI용 내보내기'}</span></button>
          </div>
          <button className="command-search-button focus-essential" onClick={openCommandPalette}><span>명령 검색</span><kbd>⌘K</kbd></button>
          <button className="usage-button focus-essential" title="장면 만들기부터 AI용 내보내기까지" onClick={() => setOnboardingOpen(true)}>사용법</button>
          <details className="header-menu advanced-menu tools-menu">
            <summary>고급 도구</summary>
            <div className="header-popover wide">
              <span className="menu-label">고급 연결·진단</span>
              <button className="comfy-button" onClick={() => setComfyOpen(true)}>ComfyUI 연결</button>
              <button onClick={() => setDoctorOpen(true)}>프로젝트 점검</button>
              <button onClick={() => setSessionInsightsOpen(true)}>세션 기록</button>
              <button onClick={() => downloadProject(project)}>JSON 내보내기</button>
              <button onClick={() => fileInputRef.current?.click()}>JSON 불러오기</button>
              <input ref={fileInputRef} className="file-input" type="file" accept=".json,.aiscene.json" onChange={(event) => importFile(event.target.files?.[0])} />
              <div className="menu-divider" />
              <span className="menu-label">환경·저장소</span>
              <button className="focus-toggle" onClick={() => setFocusMode((value) => !value)}>{focusMode ? '집중 모드 종료' : '집중 모드'}</button>
              <button onClick={() => void cleanupLocalAssets()}>저장소 정리</button>
              <button className="danger" onClick={reset}>샘플 초기화</button>
            </div>
          </details>
          <details className="header-menu project-menu">
            <summary>프로젝트</summary>
            <div className="header-popover wide">
              <span className="menu-label">작업 저장·복원</span>
              <button onClick={connectWorkspace}>{workspaceLabel ? '프로젝트 폴더 변경' : '프로젝트 폴더 연결'}</button>
              <button disabled={!workspaceLabel || isExporting} onClick={saveWorkspaceBundle}>연결 폴더에 저장</button>
              <button disabled={!recoveryCount} onClick={restoreLatestRecovery}>최근 복구본 ({recoveryCount})</button>
              <button className="bundle-button" disabled={isExporting} onClick={exportProjectBundle}>프로젝트 백업 ZIP</button>
              <button onClick={() => bundleInputRef.current?.click()}>프로젝트 백업 불러오기</button>
              <input ref={bundleInputRef} className="file-input" type="file" accept=".zip,.aiscene.zip,application/zip" onChange={(event) => importBundleFile(event.target.files?.[0])} />
            </div>
          </details>
        </nav>
      </header>

      <section className="workspace">
        <DirectorWorkflowPanel report={directorReport} activeShotName={shot.name} collapsed={workflowCollapsed || focusMode} focusMode={focusMode} onAction={handleDirectorAction} onToggleCollapsed={() => setWorkflowCollapsed((value) => !value)} onToggleFocus={() => setFocusMode((value) => !value)} />
        {firstEditGuideOpen && (
          <section className="first-edit-guide" role="status" aria-label="첫 수정 안내" data-first-edit-ready={directorReport.journey.firstEdit.ready}>
            <div>
              <span>장면 생성 완료 · 첫 수정 준비</span>
              <strong>{directorReport.journey.firstEdit.label}</strong>
              <small>{directorReport.journey.firstEdit.instruction}</small>
            </div>
            <div className="first-edit-actions">
              {directorReport.journey.firstEdit.quickActions.map((item) => (
                <button key={item.id} onClick={() => handleDirectorAction(item.id)}>{item.label}</button>
              ))}
              <button className="guide-close" onClick={() => setFirstEditGuideOpen(false)}>닫기</button>
            </div>
          </section>
        )}
        <aside ref={hierarchyRef} className={`panel hierarchy ${focusedArea === 'hierarchy' ? 'workflow-focus-target' : ''}`}>
          <div className="panel-title-row">
            <h2>씬 계층</h2>
            <span>{scene.entities.length}개</span>
          </div>
          <div className="environment-summary">
            <strong>{scene.environment?.name ?? '환경 미지정'}</strong>
            <span>{scene.environment?.location}</span>
            <div className="environment-palette">{scene.environment?.palette.map((color) => <i key={color} style={{ background: color }} title={color} />)}</div>
            <label className="stacked-label environment-select">환경 프리셋
              <select value={scene.environment?.presetId ?? 'studio'} onChange={(event) => changeEnvironmentPreset(event.target.value)}>
                {ENVIRONMENT_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
              </select>
            </label>
            <button className="relayout-button" onClick={relayoutActiveScene}>인원수·공간 기준 재배치</button>
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
          <Suspense fallback={<div className="panel-loading">에셋 라이브러리 로드 중…</div>}><AssetLibraryPanel /></Suspense>
        </aside>

        {runtimeDiagnostics?.status === 'unsupported' ? (
          <section className="viewport viewport-unavailable" data-testid="viewport-safe-mode">
            <div>
              <strong>3D 안전 모드</strong>
              <p>이 환경에서는 WebGL 또는 로컬 저장소를 사용할 수 없어 3D 뷰포트를 열지 않았습니다.</p>
              <p>프로젝트 데이터 편집·진단·복구·내보내기는 계속 사용할 수 있습니다.</p>
              <button onClick={() => setDoctorOpen(true)}>환경 진단 열기</button>
            </div>
          </section>
        ) : (
          <Viewport ref={viewportRef} qualityProfile={effectiveRenderQuality} />
        )}

        <aside ref={inspectorRef} className={`panel inspector ${focusedArea === 'inspector' ? 'workflow-focus-target' : ''}`}>
          <h2>속성</h2>
          {selected && baseSelected ? (
            <>
              <label className="stacked-label">이름
                <input value={baseSelected.name} onChange={(event) => renameSelected(event.target.value)} />
              </label>

              {selected.type === 'character' && selected.character?.appearance && (
                <section className="appearance-card">
                  <div className="section-title-row"><h3>역할·외형</h3><span>{selected.character.appearance.role === 'lead' ? '주인공' : selected.character.appearance.role === 'supporting' ? '조연' : '배경 인물'}</span></div>
                  <p>{selected.character.appearance.descriptor}</p>
                  <dl>
                    <div><dt>연령</dt><dd>{selected.character.appearance.ageGroup}</dd></div>
                    <div><dt>직업</dt><dd>{selected.character.appearance.occupation ?? '미지정'}</dd></div>
                    <div><dt>의상</dt><dd>{selected.character.appearance.outfitSummary}</dd></div>
                  </dl>
                  <div className="color-swatches large">{selected.character.appearance.outfitColors.map((color) => <i key={color} style={{ background: color }} title={color} />)}</div>
                </section>
              )}

              {selected.asset && selected.type !== 'character' && (
                <section className="asset-card">
                  <div className="section-title-row"><h3>에셋 정보</h3><span>{selected.asset.source === 'preset' ? '프리셋' : selected.asset.source === 'prompt' ? '문장 감지' : '직접 추가'}</span></div>
                  <dl>
                    <div><dt>분류</dt><dd>{selected.asset.category}</dd></div>
                    <div><dt>형태</dt><dd>{selected.asset.primitive}</dd></div>
                    <div><dt>재질</dt><dd>{selected.asset.material}</dd></div>
                  </dl>
                  <div className="color-swatches large"><i style={{ background: selected.asset.color }} title={selected.asset.color} /></div>
                </section>
              )}

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

              {selected.type === 'camera' && selected.camera && (
                <section className="camera-light-inspector">
                  <div className="section-title-row"><h3>카메라 렌즈 · Shot Override</h3><span>{selected.camera.aspectRatio}</span></div>
                  <div className="axis-fields two">
                    <label>FOV <NumberField disabled={previewLocked} value={selected.camera.fov} step={1} onChange={(value) => updateSelectedCamera({ fov: value })} /></label>
                    <label>Near <NumberField disabled={previewLocked} value={selected.camera.near} step={0.01} onChange={(value) => updateSelectedCamera({ near: value })} /></label>
                    <label>Far <NumberField disabled={previewLocked} value={selected.camera.far} step={1} onChange={(value) => updateSelectedCamera({ far: value })} /></label>
                    <label>화면비
                      <select disabled={previewLocked} value={selected.camera.aspectRatio} onChange={(event) => updateSelectedCamera({ aspectRatio: event.target.value as typeof selected.camera.aspectRatio })}>
                        <option value="16:9">16:9 가로</option><option value="9:16">9:16 세로</option><option value="1:1">1:1 정사각</option><option value="4:3">4:3</option>
                      </select>
                    </label>
                  </div>
                  <label className="toggle-row"><input type="checkbox" checked={selected.camera.showSafeFrame} onChange={(event) => updateSelectedCamera({ showSafeFrame: event.target.checked })} /> 샷 카메라 안전 프레임</label>
                </section>
              )}

              {selected.type === 'light' && selected.light && (
                <section className="camera-light-inspector">
                  <div className="section-title-row"><h3>조명 · Shot Override</h3><span>{selected.light.kind}</span></div>
                  <label className="stacked-label">유형
                    <select disabled={previewLocked} value={selected.light.kind} onChange={(event) => updateSelectedLight({ kind: event.target.value as typeof selected.light.kind })}>
                      <option value="directional">방향광</option><option value="point">포인트</option><option value="spot">스포트</option><option value="ambient">환경광</option>
                    </select>
                  </label>
                  <div className="axis-fields two">
                    <label>세기 <NumberField disabled={previewLocked} value={selected.light.intensity} step={0.1} onChange={(value) => updateSelectedLight({ intensity: value })} /></label>
                    <label>범위 <NumberField disabled={previewLocked} value={selected.light.range} step={0.5} onChange={(value) => updateSelectedLight({ range: value })} /></label>
                    <label>각도 <NumberField disabled={previewLocked} value={selected.light.angle * RAD_TO_DEG} step={5} onChange={(value) => updateSelectedLight({ angle: value * DEG_TO_RAD })} /></label>
                    <label>색상 <input disabled={previewLocked} type="color" value={selected.light.color} onChange={(event) => updateSelectedLight({ color: event.target.value })} /></label>
                  </div>
                  {selected.light.kind === 'spot' && (
                    <label className="stacked-label">조명 대상
                      <select disabled={previewLocked} value={selected.light.targetEntityId ?? ''} onChange={(event) => updateSelectedLight({ targetEntityId: event.target.value || undefined })}>
                        <option value="">회전 방향 사용</option>
                        {scene.entities.filter((entity) => entity.id !== selected.id && entity.type !== 'light').map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
                      </select>
                    </label>
                  )}
                  <label className="toggle-row"><input type="checkbox" checked={selected.light.castShadow} onChange={(event) => updateSelectedLight({ castShadow: event.target.checked })} /> 그림자 생성</label>
                </section>
              )}

              {selected.type === 'camera' && (
                <section className="reference-inspector">
                  <div className="section-title-row"><h3>참조 이미지</h3><span>{(scene.referenceImages ?? []).filter((image) => !image.cameraEntityId || image.cameraEntityId === selected.id).length}개</span></div>
                  <input ref={referenceImageInputRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void importReferenceImage(event.target.files?.[0])} />
                  <button onClick={() => referenceImageInputRef.current?.click()}>+ 카메라 참조 이미지</button>
                  <p className="help-text">샷 카메라 보기 위에 반투명으로 겹쳐 구도와 캐릭터 위치를 맞춥니다. IndexedDB 로컬 에셋으로 저장하며 프로젝트 번들에 원본 WebP를 포함합니다. 최대 30개·총 50MB를 지원합니다.</p>
                  <div className="reference-list">
                    {(scene.referenceImages ?? []).filter((image) => !image.cameraEntityId || image.cameraEntityId === selected.id).map((image) => (
                      <div key={image.id} className="reference-row">
                        <ReferenceImagePreview image={image} alt={image.name} />
                        <div>
                          <strong>{image.name}</strong>
                          <label>투명도 <input type="range" min={0} max={1} step={0.05} value={image.opacity} onChange={(event) => updateReferenceImage(image.id, { opacity: Number(event.target.value) })} /></label>
                          <select value={image.fit} onChange={(event) => updateReferenceImage(image.id, { fit: event.target.value as ReferenceImage['fit'] })}><option value="contain">전체 맞춤</option><option value="cover">화면 채움</option></select>
                        </div>
                        <label className="reference-visible"><input type="checkbox" checked={image.visible} onChange={(event) => updateReferenceImage(image.id, { visible: event.target.checked })} />표시</label>
                        <button className="danger" onClick={() => removeReferenceImage(image.id)}>삭제</button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

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

                  <h3>손 IK</h3>
                  <div className="ik-grid">
                    <button disabled={previewLocked} onClick={() => { setSelectedJoint('leftWrist'); applySelectedArmIK('left', [-0.45, 1.25, -0.55]); }}>왼손 앞으로</button>
                    <button disabled={previewLocked} onClick={() => { setSelectedJoint('rightWrist'); applySelectedArmIK('right', [0.45, 1.25, -0.55]); }}>오른손 앞으로</button>
                    <button disabled={previewLocked} onClick={() => { setSelectedJoint('leftWrist'); applySelectedArmIK('left', [-0.25, 1.85, 0]); }}>왼손 위로</button>
                    <button disabled={previewLocked} onClick={() => { setSelectedJoint('rightWrist'); applySelectedArmIK('right', [0.25, 1.85, 0]); }}>오른손 위로</button>
                  </div>
                  <h3>다리 IK·지면</h3>
                  <div className="ik-grid">
                    <button disabled={previewLocked} onClick={() => { setSelectedJoint('leftAnkle'); applySelectedLegIK('left', [-0.2, 0.08, -0.35]); }}>왼발 앞으로</button>
                    <button disabled={previewLocked} onClick={() => { setSelectedJoint('rightAnkle'); applySelectedLegIK('right', [0.2, 0.08, -0.35]); }}>오른발 앞으로</button>
                    <button disabled={previewLocked} onClick={() => { setSelectedJoint('leftAnkle'); applySelectedLegIK('left', [-0.2, 0.28, -0.15]); }}>왼발 들기</button>
                    <button disabled={previewLocked} onClick={() => { setSelectedJoint('rightAnkle'); applySelectedLegIK('right', [0.2, 0.28, -0.15]); }}>오른발 들기</button>
                    <button className="wide-button" disabled={previewLocked} onClick={groundSelectedFeet}>양발 지면 고정</button>
                  </div>
                  <p className="help-text">포즈 모드에서 모든 관절은 회전 링으로 직접 조절할 수 있습니다. 손목은 분홍색, 발목은 초록색 목표점을 끌어 IK를 적용합니다.</p>
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

      <section ref={shotStripRef} className={`shot-strip ${focusedArea === 'shots' ? 'workflow-focus-target' : ''}`}>
        <div className="shot-actions">
          <button onClick={addShot}>+ 새 샷</button>
          <button onClick={duplicateActiveShot}>현재 샷 복제</button>
          <button className="danger" onClick={deleteActiveShot}>현재 샷 삭제</button>
        </div>
        {scene.shots.map((item) => (
          <button key={item.id} className={item.id === activeShotId ? 'shot active' : 'shot'} onClick={() => setActiveShot(item.id)}>
            <strong>{item.name}</strong>
            <span>{item.duration}초 · Override {item.overrides.length}개 · 관계 {item.relationships.length}개 · 행동 {(item.actions ?? []).length}개 · 결과 {(item.generationResults ?? []).length}개</span>
            {(() => { const readiness = shotReadinessById.get(item.id); return readiness ? <small className={`shot-readiness ${readiness.status}`} title={readiness.issues.join('\n') || '출력 준비 완료'}>{readiness.status === 'ready' ? '출력 준비' : readiness.status === 'blocked' ? '수정 필요' : `점검 ${readiness.score}`}</small> : null; })()}
          </button>
        ))}
        <div className="shot-editor">
          <label>샷 이름<input value={shot.name} onChange={(event) => updateActiveShotName(event.target.value)} /></label>
          <label>길이(초)<NumberField value={shot.duration} step={0.5} onChange={updateActiveShotDuration} /></label>
        </div>
      </section>

      <section ref={timelineRef} className={`timeline-panel ${focusedArea === 'timeline' ? 'workflow-focus-target' : ''}`}>
        <div className="timeline-controls">
          <button onClick={() => setPlayheadTime(0)}>처음</button>
          <button className={isPlaying ? 'active' : ''} onClick={togglePlayback}>{isPlaying ? '미리보기 정지' : '동작 미리보기'}</button><span className="timeline-purpose">생성 전 움직임 검수</span>
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
            <TimelineActionRow
              key={action.id}
              action={action}
              duration={shot.duration}
              actorName={scene.entities.find((entity) => entity.id === action.actorEntityId)?.name ?? '알 수 없는 객체'}
              selected={selectedActionIds.has(action.id) || selectedActionId === action.id}
              conflicted={conflictedActionIds.has(action.id)}
              onSelect={(event) => selectTimelineAction(action.id, event)}
              onCommit={(startTime, actionDuration) => updateActionTiming(action.id, startTime, actionDuration)}
            />
          ))}
        </div>
        {selectedActionIds.size > 1 && (
          <div className="bulk-action-editor">
            <strong>{selectedActionIds.size}개 행동 선택</strong>
            <button onClick={() => shiftActions([...selectedActionIds], -0.25)}>−0.25초</button>
            <button onClick={() => shiftActions([...selectedActionIds], 0.25)}>+0.25초</button>
            <button onClick={() => setSelectedActionIds(new Set())}>선택 해제</button>
            <button className="danger" onClick={() => { removeActions([...selectedActionIds]); setSelectedActionIds(new Set()); }}>선택 삭제</button>
          </div>
        )}
        {actionConflicts.length > 0 && (
          <div className="timeline-conflict-notice">⚠ 같은 객체를 동시에 사용하는 행동 {actionConflicts.length}쌍이 있습니다. 블록을 이동하거나 길이를 줄여 주세요.</div>
        )}
        {selectedAction && (
          <div className="action-editor">
            <strong>{ACTION_LABELS[selectedAction.type]}</strong>
            <label>시작 <NumberField value={selectedAction.startTime} step={0.1} onChange={(value) => updateSelectedAction({ startTime: value })} /></label>
            <label>길이 <NumberField value={selectedAction.duration} step={0.1} onChange={(value) => updateSelectedAction({ duration: value })} /></label>
            {(selectedAction.type === 'walk' || selectedAction.type === 'cameraDolly') && <label>거리 <NumberField value={selectedAction.parameters.distance ?? 1.5} step={0.1} onChange={(value) => updateSelectedAction({ parameters: { ...selectedAction.parameters, distance: value } })} /></label>}
            {selectedAction.type === 'walk' && <>
              <label>보폭 <NumberField value={selectedAction.parameters.strideLength ?? 0.72} step={0.05} onChange={(value) => updateSelectedAction({ parameters: { ...selectedAction.parameters, strideLength: value } })} /></label>
              <label>발 높이 <NumberField value={selectedAction.parameters.stepHeight ?? 0.11} step={0.01} onChange={(value) => updateSelectedAction({ parameters: { ...selectedAction.parameters, stepHeight: value } })} /></label>
              <label>걸음 속도 <NumberField value={selectedAction.parameters.cadence ?? 1.8} step={0.1} onChange={(value) => updateSelectedAction({ parameters: { ...selectedAction.parameters, cadence: value } })} /></label>
              <label>상체 기울기 <NumberField value={selectedAction.parameters.bodyLean ?? 0.08} step={0.02} onChange={(value) => updateSelectedAction({ parameters: { ...selectedAction.parameters, bodyLean: value } })} /></label>
            </>}
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

      <Suspense fallback={null}><SceneGeneratorPanel
        open={sceneGeneratorOpen}
        onClose={() => setSceneGeneratorOpen(false)}
        onApply={applyGeneratedScene}
      /></Suspense>

      <Suspense fallback={null}><ComfyPanel
        open={comfyOpen}
        onClose={() => setComfyOpen(false)}
        onPrepareInputs={prepareComfyInputs}
        onRegisterResult={addGenerationResult}
        results={shot.generationResults ?? []}
        onRemoveResult={removeGenerationResult}
      /></Suspense>

      <CommandPalette open={commandPaletteOpen} commands={commandCatalog} onClose={() => setCommandPaletteOpen(false)} onExecute={(id) => executeCommand(id, 'palette')} />
      <SessionInsightsPanel open={sessionInsightsOpen} session={creatorSession} onClose={() => setSessionInsightsOpen(false)} onClear={() => { const next = appendCreatorSessionEvent(createCreatorSession(), 'session_started', { appVersion: project.schemaVersion }); setCreatorSession(next); saveCreatorSession(next); }} />
      <AIExportDialog
        open={aiExportOpen}
        shotName={shot.name}
        preflight={exportPreflight}
        isExporting={isExporting}
        scenePrompt={buildShotPrompt(scene, shot)}
        motionPrompt={buildMotionPrompt(scene, shot)}
        cameraPrompt={buildCameraPrompt(scene, shot)}
        onClose={() => setAIExportOpen(false)}
        onExport={(mode) => void performAIExport(mode)}
        onQuickFix={handleExportQuickFix}
        onCopyPrompt={(mode) => void copyAIExportPrompt(mode)}
        onDownloadReference={() => void downloadAIReferenceFrame()}
        onDownloadStartEnd={() => void downloadAIStartEndFrames()}
      />

      {exportStatus && <div className="export-status">{exportStatus}</div>}
      {cleanupStatus && <button className="export-status cleanup-status" onClick={() => setCleanupStatus(null)}>{cleanupStatus}</button>}
      <Suspense fallback={null}><ProjectDoctorPanel
        open={doctorOpen}
        project={project}
        runtime={runtimeDiagnostics}
        renderQuality={renderQuality}
        onRenderQualityChange={changeRenderQuality}
        onApplyProject={importProject}
        onClose={() => setDoctorOpen(false)}
      /></Suspense>
      <Onboarding open={onboardingOpen} onClose={() => setOnboardingOpen(false)} onOpenSceneGenerator={() => setSceneGeneratorOpen(true)} />

      {message && (
        <button className="toast" onClick={clearMessage} aria-label="알림 닫기">
          {message}<span>×</span>
        </button>
      )}
    </main>
  );
}
