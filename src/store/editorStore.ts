import { create } from 'zustand';
import { ACTION_DEFAULT_DURATION, ACTION_LABELS, collectActionConflicts, findActionConflicts } from '../domain/actions';
import { persist } from 'zustand/middleware';
import { findPosePreset, createNeutralPose, groundFeet, mirrorPose, solveArmIK, solveLegIK } from '../domain/pose';
import { resolveEntity, resolveEntityWithoutRelationships, resolveSceneAtTime } from '../domain/resolver';
import { sampleProject } from '../domain/sampleProject';
import { applyTransaction, revertTransaction } from '../domain/transactions';
import type {
  ActionBlock,
  AssetLibraryItem,
  ActionParameters,
  ActionType,
  CameraData,
  LightData,
  ReferenceImage,
  Entity,
  EntityType,
  GenerationResult,
  JointName,
  OverridePath,
  PoseState,
  Project,
  Relationship,
  RelationshipParameters,
  RelationshipType,
  Shot,
  ShotOverride,
  Transaction,
  TransformMode,
  Vec3,
} from '../domain/types';
import { validateAndMigrateProject } from '../domain/validation';
import { generateSceneFromPrompt } from '../domain/sceneGenerator';
import { assetWithModel, assetWithoutModel } from '../domain/assets';
import { relayoutSceneEntities, replaceEnvironmentPreset } from '../domain/environmentLayout';

interface EditorState {
  project: Project;
  activeShotId: string;
  selectedEntityId: string | null;
  selectedJoint: JointName | null;
  transformMode: TransformMode;
  playheadTime: number;
  isPlaying: boolean;
  selectedActionId: string | null;
  undoStack: Transaction[];
  redoStack: Transaction[];
  message: string | null;

  setActiveShot(id: string): void;
  selectEntity(id: string | null): void;
  setSelectedJoint(joint: JointName | null): void;
  setTransformMode(mode: TransformMode): void;
  setPlayheadTime(time: number): void;
  togglePlayback(): void;
  advancePlayback(deltaSeconds: number): void;
  selectAction(id: string | null): void;
  clearMessage(): void;

  updateSelectedTransform(path: Extract<OverridePath, `transform.${string}`>, value: Vec3): void;
  moveSelected(position: Vec3): void;
  updateSelectedPose(pose: PoseState, title?: string): void;
  updateSelectedJoint(joint: JointName, rotation: Vec3): void;
  applyPosePreset(presetId: string): void;
  resetSelectedPose(): void;
  mirrorSelectedPose(): void;
  applySelectedArmIK(side: 'left' | 'right', target: Vec3): void;
  applySelectedLegIK(side: 'left' | 'right', target: Vec3): void;
  groundSelectedFeet(): void;

  addSelectedRelationship(type: RelationshipType, targetEntityId: string, parameters?: RelationshipParameters): void;
  removeRelationship(relationshipId: string): void;

  addAction(type: ActionType, actorEntityId: string, targetEntityId?: string, parameters?: ActionParameters): void;
  updateSelectedAction(patch: Partial<ActionBlock>): void;
  updateActionTiming(actionId: string, startTime: number, duration: number): void;
  shiftActions(actionIds: string[], deltaSeconds: number): void;
  removeActions(actionIds: string[]): void;
  updateSelectedCamera(patch: Partial<CameraData>): void;
  updateSelectedLight(patch: Partial<LightData>): void;
  addReferenceImage(image: ReferenceImage): void;
  updateReferenceImage(imageId: string, patch: Partial<ReferenceImage>): void;
  removeReferenceImage(imageId: string): void;
  removeSelectedAction(): void;
  addGenerationResult(result: GenerationResult): void;
  removeGenerationResult(resultId: string): void;

  addEntity(type: EntityType): void;
  duplicateSelected(): void;
  deleteSelected(): void;
  toggleSelectedLock(): void;
  renameSelected(name: string): void;

  addShot(): void;
  duplicateActiveShot(): void;
  deleteActiveShot(): void;
  updateActiveShotName(name: string): void;
  updateActiveShotDuration(duration: number): void;

  replaceActiveSceneFromPrompt(prompt: string): void;
  registerAsset(item: AssetLibraryItem): void;
  updateAssetItem(item: AssetLibraryItem): void;
  assignAssetToSelected(assetId: string): void;
  clearSelectedModelAsset(): void;
  removeAsset(assetId: string): void;
  changeEnvironmentPreset(presetId: string): void;
  relayoutActiveScene(): void;
  importProject(project: unknown): boolean;
  undo(): void;
  redo(): void;
  reset(): void;
  getResolvedEntities(): Entity[];
}

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function currentScene(state: Pick<EditorState, 'project'>) {
  return state.project.scenes.find((scene) => scene.id === state.project.activeSceneId) ?? state.project.scenes[0];
}

function currentShot(state: Pick<EditorState, 'project' | 'activeShotId'>) {
  const scene = currentScene(state);
  return scene.shots.find((shot) => shot.id === state.activeShotId) ?? scene.shots[0];
}

function transaction(title: string, operations: Transaction['operations']): Transaction {
  return {
    id: createId('tx'),
    title,
    createdAt: new Date().toISOString(),
    operations,
  };
}

function createDefaultEntity(type: EntityType, index: number): Entity {
  const labels: Record<EntityType, string> = {
    character: '인물',
    prop: '소품',
    camera: '카메라',
    light: '조명',
  };
  const x = ((index % 5) - 2) * 1.25;
  const baseTransform = {
    position: [x, 0.5, Math.floor(index / 5) * 1.5] as Vec3,
    rotation: [0, 0, 0] as Vec3,
    scale: [1, 1, 1] as Vec3,
  };

  if (type === 'character') baseTransform.position[1] = 0;
  if (type === 'camera') baseTransform.position = [0, 2.5, 8];
  if (type === 'light') baseTransform.position = [3, 5, 3];

  return {
    id: createId(type),
    name: `${labels[type]} ${index + 1}`,
    type,
    transform: baseTransform,
    visible: true,
    locked: false,
    character: type === 'character' ? {
      pose: createNeutralPose(),
      appearance: { role: 'supporting', descriptor: `${labels[type]} ${index + 1}`, ageGroup: 'unspecified', presentation: 'unspecified', outfitSummary: '기본 의상', outfitColors: ['#64748b'], hairColor: '#1c1917', skinTone: '#d6a77a' },
    } : undefined,
    camera: type === 'camera' ? { projection: 'perspective', fov: 48, near: 0.1, far: 100, aspectRatio: '16:9', showSafeFrame: true } : undefined,
    light: type === 'light' ? { kind: 'directional', color: '#fff4d6', intensity: 2, range: 12, angle: Math.PI / 4, castShadow: true } : undefined,
    asset: {
      category: type === 'prop' ? 'generic' : type === 'light' ? 'lighting' : 'generic',
      primitive: type === 'light' ? 'sphere' : 'box',
      color: type === 'character' ? '#64748b' : type === 'camera' ? '#38bdf8' : type === 'light' ? '#fde047' : '#a8a29e',
      material: type === 'light' ? 'emissive' : 'matte',
      source: 'manual',
      tags: [type],
    },
  };
}

function overridesForEntity(shots: Shot[], entityId: string): Record<string, ShotOverride[]> {
  return Object.fromEntries(
    shots.map((shot) => [
      shot.id,
      structuredClone(shot.overrides.filter((override) => override.entityId === entityId)),
    ]),
  );
}

function relationshipsForEntity(shots: Shot[], entityId: string): Record<string, Relationship[]> {
  return Object.fromEntries(
    shots.map((shot) => [
      shot.id,
      structuredClone(shot.relationships.filter((relationship) => (
        relationship.sourceEntityId === entityId || relationship.targetEntityId === entityId
      ))),
    ]),
  );
}

function actionsForEntity(shots: Shot[], entityId: string): Record<string, ActionBlock[]> {
  return Object.fromEntries(
    shots.map((shot) => [
      shot.id,
      structuredClone((shot.actions ?? []).filter((action) => (
        action.actorEntityId === entityId
        || action.targetEntityId === entityId
        || action.parameters.surfaceEntityId === entityId
      ))),
    ]),
  );
}

function conflictingRelationships(
  relationships: Relationship[],
  type: RelationshipType,
  sourceEntityId: string,
  targetEntityId: string,
  parameters: RelationshipParameters,
): Relationship[] {
  return relationships.filter((relationship) => {
    if (type === 'lookAt' || type === 'sitOn' || type === 'placeOn') {
      return relationship.type === type && relationship.sourceEntityId === sourceEntityId;
    }
    if (type === 'hold') {
      const hand = parameters.hand ?? 'right';
      return relationship.type === 'hold' && (
        relationship.targetEntityId === targetEntityId
        || (relationship.sourceEntityId === sourceEntityId && (relationship.parameters.hand ?? 'right') === hand)
      );
    }
    return false;
  });
}
function describeActionConflict(actions: ActionBlock[], candidate: ActionBlock, entities: Entity[]): string | null {
  const conflict = findActionConflicts(actions, candidate)[0];
  if (!conflict) return null;
  const other = actions.find((item) => item.id === conflict.conflictingActionId);
  const resource = entities.find((item) => item.id === conflict.resourceEntityId)?.name ?? '같은 객체';
  return `${resource}의 ${other ? ACTION_LABELS[other.type] : '다른 행동'}과 시간이 겹칩니다.`;
}


export const useEditorStore = create<EditorState>()(
  persist(
    (set, get) => {
      const commit = (nextTransaction: Transaction, nextSelection?: string | null, nextShotId?: string) => {
        const state = get();
        try {
          set({
            project: applyTransaction(state.project, nextTransaction),
            undoStack: [...state.undoStack, nextTransaction],
            redoStack: [],
            selectedEntityId: nextSelection === undefined ? state.selectedEntityId : nextSelection,
            selectedJoint: nextSelection !== undefined && nextSelection !== state.selectedEntityId ? null : state.selectedJoint,
            activeShotId: nextShotId ?? state.activeShotId,
            message: nextTransaction.title,
          });
        } catch (error) {
          set({ message: error instanceof Error ? error.message : '편집 작업을 적용하지 못했습니다.' });
        }
      };

      return {
        project: structuredClone(sampleProject),
        activeShotId: 'shot-001',
        selectedEntityId: 'character-a',
        selectedJoint: 'rightShoulder',
        transformMode: 'translate',
        playheadTime: 0,
        isPlaying: false,
        selectedActionId: null,
        undoStack: [],
        redoStack: [],
        message: null,

        setActiveShot: (activeShotId) => set({ activeShotId, playheadTime: 0, isPlaying: false, selectedActionId: null }),
        selectEntity: (selectedEntityId) => {
          if (!selectedEntityId) {
            set({ selectedEntityId: null, selectedJoint: null });
            return;
          }
          const scene = currentScene(get());
          const entity = scene.entities.find((item) => item.id === selectedEntityId);
          set({
            selectedEntityId,
            selectedJoint: entity?.type === 'character' ? get().selectedJoint ?? 'rightShoulder' : null,
          });
        },
        setSelectedJoint: (selectedJoint) => set({ selectedJoint, transformMode: selectedJoint ? 'pose' : get().transformMode }),
        setTransformMode: (transformMode) => set({ transformMode }),
        setPlayheadTime: (time) => {
          const shot = currentShot(get());
          set({ playheadTime: Math.max(0, Math.min(shot.duration, Number.isFinite(time) ? time : 0)) });
        },
        togglePlayback: () => {
          const state = get();
          const shot = currentShot(state);
          set({
            isPlaying: !state.isPlaying,
            playheadTime: !state.isPlaying && state.playheadTime >= shot.duration ? 0 : state.playheadTime,
          });
        },
        advancePlayback: (deltaSeconds) => {
          const state = get();
          if (!state.isPlaying) return;
          const shot = currentShot(state);
          const next = state.playheadTime + Math.max(0, deltaSeconds);
          if (next >= shot.duration) set({ playheadTime: shot.duration, isPlaying: false });
          else set({ playheadTime: next });
        },
        selectAction: (selectedActionId) => set({ selectedActionId }),
        clearMessage: () => set({ message: null }),

        updateSelectedTransform: (path, value) => {
          const state = get();
          if (!state.selectedEntityId) return;
          if (state.playheadTime > 0 || state.isPlaying) {
            set({ message: '0초로 이동한 뒤 기본 Transform을 편집해 주세요.' });
            return;
          }
          const scene = currentScene(state);
          const shot = currentShot(state);
          const selected = scene.entities.find((entity) => entity.id === state.selectedEntityId);
          if (!selected) return;
          if (selected.locked) {
            set({ message: `${selected.name}은(는) 잠겨 있습니다.` });
            return;
          }
          const resolved = resolveEntityWithoutRelationships(scene, shot, selected.id);
          const previousValue = path === 'transform.position'
            ? resolved.transform.position
            : path === 'transform.rotation'
              ? resolved.transform.rotation
              : resolved.transform.scale;
          if (JSON.stringify(previousValue) === JSON.stringify(value)) return;
          commit(transaction(`${resolved.name} ${path.split('.')[1]} 변경`, [{
            type: 'updateEntity',
            sceneId: scene.id,
            shotId: shot.id,
            entityId: resolved.id,
            path,
            previousValue,
            nextValue: value,
          }]));
        },

        moveSelected: (position) => get().updateSelectedTransform('transform.position', position),

        updateSelectedPose: (pose, title = '포즈 변경') => {
          const state = get();
          if (!state.selectedEntityId) return;
          if (state.playheadTime > 0 || state.isPlaying) {
            set({ message: '0초로 이동한 뒤 기본 포즈를 편집해 주세요.' });
            return;
          }
          const scene = currentScene(state);
          const shot = currentShot(state);
          const base = scene.entities.find((entity) => entity.id === state.selectedEntityId);
          if (!base || base.type !== 'character' || !base.character) return;
          if (base.locked) {
            set({ message: `${base.name}은(는) 잠겨 있습니다.` });
            return;
          }
          const resolved = resolveEntityWithoutRelationships(scene, shot, base.id);
          const previousValue = resolved.character?.pose;
          if (!previousValue || JSON.stringify(previousValue) === JSON.stringify(pose)) return;
          commit(transaction(`${base.name} ${title}`, [{
            type: 'updateEntity',
            sceneId: scene.id,
            shotId: shot.id,
            entityId: base.id,
            path: 'character.pose',
            previousValue,
            nextValue: structuredClone(pose),
          }]));
        },

        updateSelectedJoint: (joint, rotation) => {
          const state = get();
          if (!state.selectedEntityId) return;
          const scene = currentScene(state);
          const shot = currentShot(state);
          const resolved = resolveEntityWithoutRelationships(scene, shot, state.selectedEntityId);
          if (!resolved.character) return;
          const pose = structuredClone(resolved.character.pose);
          pose[joint] = rotation;
          get().updateSelectedPose(pose, `${joint} 관절 변경`);
        },

        applyPosePreset: (presetId) => {
          const preset = findPosePreset(presetId);
          if (!preset) {
            set({ message: '포즈 프리셋을 찾지 못했습니다.' });
            return;
          }
          get().updateSelectedPose(structuredClone(preset.pose), `포즈 “${preset.name}” 적용`);
        },

        resetSelectedPose: () => get().updateSelectedPose(createNeutralPose(), '포즈 초기화'),

        mirrorSelectedPose: () => {
          const state = get();
          if (!state.selectedEntityId) return;
          const scene = currentScene(state);
          const shot = currentShot(state);
          const resolved = resolveEntityWithoutRelationships(scene, shot, state.selectedEntityId);
          if (!resolved.character) return;
          get().updateSelectedPose(mirrorPose(resolved.character.pose), '포즈 좌우 반전');
        },

        applySelectedArmIK: (side, target) => {
          const state = get();
          if (!state.selectedEntityId) return;
          const scene = currentScene(state);
          const shot = currentShot(state);
          const resolved = resolveEntityWithoutRelationships(scene, shot, state.selectedEntityId);
          if (!resolved.character) return;
          const assetId = resolved.asset?.modelAssetId;
          const proportions = assetId ? state.project.assetLibrary.find((item) => item.id === assetId)?.rig?.proportions : undefined;
          get().updateSelectedPose(solveArmIK(resolved.character.pose, side, target, proportions), `${side === 'left' ? '왼손' : '오른손'} 비율 보정 IK 적용`);
        },

        applySelectedLegIK: (side, target) => {
          const state = get();
          if (!state.selectedEntityId) return;
          const scene = currentScene(state);
          const shot = currentShot(state);
          const resolved = resolveEntityWithoutRelationships(scene, shot, state.selectedEntityId);
          if (!resolved.character) return;
          const assetId = resolved.asset?.modelAssetId;
          const proportions = assetId ? state.project.assetLibrary.find((item) => item.id === assetId)?.rig?.proportions : undefined;
          get().updateSelectedPose(solveLegIK(resolved.character.pose, side, target, proportions), `${side === 'left' ? '왼발' : '오른발'} 비율 보정 IK 적용`);
        },

        groundSelectedFeet: () => {
          const state = get();
          if (!state.selectedEntityId) return;
          const scene = currentScene(state);
          const shot = currentShot(state);
          const resolved = resolveEntityWithoutRelationships(scene, shot, state.selectedEntityId);
          if (!resolved.character) return;
          const assetId = resolved.asset?.modelAssetId;
          const proportions = assetId ? state.project.assetLibrary.find((item) => item.id === assetId)?.rig?.proportions : undefined;
          const localGround = -resolved.transform.position[1] / Math.max(0.001, Math.abs(resolved.transform.scale[1]));
          get().updateSelectedPose(groundFeet(resolved.character.pose, proportions, localGround), '양발 지면 고정');
        },

        addSelectedRelationship: (type, targetEntityId, parameters = {}) => {
          const state = get();
          if (!state.selectedEntityId || state.selectedEntityId === targetEntityId) return;
          const scene = currentScene(state);
          const shot = currentShot(state);
          const source = scene.entities.find((entity) => entity.id === state.selectedEntityId);
          const target = scene.entities.find((entity) => entity.id === targetEntityId);
          if (!source || !target) return;
          if (source.locked || target.locked) {
            set({ message: '잠긴 객체에는 관계를 추가할 수 없습니다.' });
            return;
          }
          if ((type === 'lookAt' || type === 'hold' || type === 'sitOn') && source.type !== 'character') {
            set({ message: '이 관계의 시작 객체는 인물이어야 합니다.' });
            return;
          }
          if ((type === 'hold' || type === 'sitOn') && target.type !== 'prop') {
            set({ message: '들기와 앉기의 대상은 소품이어야 합니다.' });
            return;
          }
          if (type === 'placeOn' && (source.type !== 'prop' || target.type !== 'prop')) {
            set({ message: '위에 놓기는 소품 사이에서만 사용할 수 있습니다.' });
            return;
          }

          const relationship: Relationship = {
            id: createId('relationship'),
            type,
            sourceEntityId: source.id,
            targetEntityId: target.id,
            parameters: structuredClone(parameters),
            active: true,
          };
          const conflicts = conflictingRelationships(shot.relationships, type, source.id, target.id, parameters);
          const operations: Transaction['operations'] = [
            ...conflicts.map((item) => ({
              type: 'removeRelationship' as const,
              sceneId: scene.id,
              shotId: shot.id,
              relationship: structuredClone(item),
            })),
            { type: 'addRelationship', sceneId: scene.id, shotId: shot.id, relationship },
          ];
          const labels: Record<RelationshipType, string> = {
            lookAt: '바라보기', hold: '손에 들기', sitOn: '앉기', placeOn: '위에 놓기',
          };
          commit(transaction(`${source.name} · ${target.name} ${labels[type]} 관계`, operations));
        },

        removeRelationship: (relationshipId) => {
          const state = get();
          const scene = currentScene(state);
          const shot = currentShot(state);
          const relationship = shot.relationships.find((item) => item.id === relationshipId);
          if (!relationship) return;
          commit(transaction('관계 삭제', [{
            type: 'removeRelationship',
            sceneId: scene.id,
            shotId: shot.id,
            relationship: structuredClone(relationship),
          }]));
        },

        addAction: (type, actorEntityId, targetEntityId, parameters = {}) => {
          const state = get();
          const scene = currentScene(state);
          const shot = currentShot(state);
          const actor = scene.entities.find((entity) => entity.id === actorEntityId);
          const target = targetEntityId ? scene.entities.find((entity) => entity.id === targetEntityId) : undefined;
          const surface = parameters.surfaceEntityId
            ? scene.entities.find((entity) => entity.id === parameters.surfaceEntityId)
            : undefined;
          if (!actor) return;
          if (actor.locked || target?.locked || surface?.locked) {
            set({ message: '잠긴 객체가 포함된 행동은 추가할 수 없습니다.' });
            return;
          }
          if ((type === 'walk' || type === 'turnAround' || type === 'pickUp' || type === 'putDown') && actor.type !== 'character') {
            set({ message: '이 행동의 실행 객체는 인물이어야 합니다.' });
            return;
          }
          if ((type === 'cameraDolly' || type === 'cameraOrbit') && actor.type !== 'camera') {
            set({ message: '카메라 행동은 카메라 객체에만 적용할 수 있습니다.' });
            return;
          }
          if ((type === 'pickUp' || type === 'putDown') && target?.type !== 'prop') {
            set({ message: '집기와 내려놓기의 대상은 소품이어야 합니다.' });
            return;
          }
          if (type === 'putDown' && surface?.type !== 'prop') {
            set({ message: '내려놓을 표면 소품을 선택해 주세요.' });
            return;
          }
          if (type === 'cameraOrbit' && !target) {
            set({ message: '오빗할 대상 객체를 선택해 주세요.' });
            return;
          }
          const maxDuration = Math.max(0.25, shot.duration - state.playheadTime);
          const duration = Math.min(ACTION_DEFAULT_DURATION[type], maxDuration);
          const action: ActionBlock = {
            id: createId('action'),
            type,
            actorEntityId,
            targetEntityId,
            startTime: Math.min(state.playheadTime, Math.max(0, shot.duration - duration)),
            duration,
            parameters: structuredClone(parameters),
            enabled: true,
          };
          const conflictMessage = describeActionConflict(shot.actions ?? [], action, scene.entities);
          if (conflictMessage) { set({ message: conflictMessage }); return; }
          commit(transaction(`${ACTION_LABELS[type]} 행동 추가`, [{ type: 'addAction', sceneId: scene.id, shotId: shot.id, action } ]));
          set({ selectedActionId: action.id });
        },

        updateSelectedAction: (patch) => {
          const state = get();
          if (!state.selectedActionId) return;
          const scene = currentScene(state);
          const shot = currentShot(state);
          const action = (shot.actions ?? []).find((item) => item.id === state.selectedActionId);
          if (!action) return;
          const nextAction: ActionBlock = { ...structuredClone(action), ...structuredClone(patch) };
          nextAction.startTime = Math.max(0, Math.min(shot.duration - 0.1, nextAction.startTime));
          nextAction.duration = Math.max(0.1, Math.min(shot.duration - nextAction.startTime, nextAction.duration));
          if (JSON.stringify(action) === JSON.stringify(nextAction)) return;
          const conflictMessage = describeActionConflict(shot.actions ?? [], nextAction, scene.entities);
          if (conflictMessage) { set({ message: conflictMessage }); return; }
          commit(transaction(`${ACTION_LABELS[action.type]} 행동 수정`, [{
            type: 'updateAction', sceneId: scene.id, shotId: shot.id,
            previousAction: structuredClone(action), nextAction,
          }]));
        },

        updateActionTiming: (actionId, startTime, duration) => {
          const state = get();
          const scene = currentScene(state);
          const shot = currentShot(state);
          const action = (shot.actions ?? []).find((item) => item.id === actionId);
          if (!action) return;
          const nextAction = structuredClone(action);
          nextAction.startTime = Math.max(0, Math.min(shot.duration - 0.1, Number.isFinite(startTime) ? startTime : action.startTime));
          nextAction.duration = Math.max(0.1, Math.min(shot.duration - nextAction.startTime, Number.isFinite(duration) ? duration : action.duration));
          const conflictMessage = describeActionConflict(shot.actions ?? [], nextAction, scene.entities);
          if (conflictMessage) { set({ message: conflictMessage }); return; }
          if (Math.abs(nextAction.startTime - action.startTime) < 1e-6 && Math.abs(nextAction.duration - action.duration) < 1e-6) return;
          commit(transaction(`${ACTION_LABELS[action.type]} 시간 변경`, [{ type: 'updateAction', sceneId: scene.id, shotId: shot.id, previousAction: structuredClone(action), nextAction }]));
          set({ selectedActionId: action.id, playheadTime: nextAction.startTime });
        },

        shiftActions: (actionIds, deltaSeconds) => {
          const state = get();
          const scene = currentScene(state);
          const shot = currentShot(state);
          const ids = new Set(actionIds);
          const selectedActions = (shot.actions ?? []).filter((action) => ids.has(action.id));
          if (!selectedActions.length || !Number.isFinite(deltaSeconds)) return;
          const minStart = Math.min(...selectedActions.map((action) => action.startTime));
          const maxEnd = Math.max(...selectedActions.map((action) => action.startTime + action.duration));
          const clampedDelta = Math.max(-minStart, Math.min(shot.duration - maxEnd, deltaSeconds));
          if (Math.abs(clampedDelta) < 1e-6) return;
          const replacements = new Map(selectedActions.map((action) => [action.id, { ...structuredClone(action), startTime: Math.round((action.startTime + clampedDelta) * 20) / 20 }]));
          const candidateActions = (shot.actions ?? []).map((action) => replacements.get(action.id) ?? action);
          if (collectActionConflicts(candidateActions).length > 0) {
            set({ message: '선택한 행동을 이동하면 다른 행동과 시간이 겹칩니다.' });
            return;
          }
          const operations = selectedActions.map((action) => ({
            type: 'updateAction' as const, sceneId: scene.id, shotId: shot.id,
            previousAction: structuredClone(action), nextAction: replacements.get(action.id)!,
          }));
          commit(transaction(`${selectedActions.length}개 행동 시간 이동`, operations));
          set({ playheadTime: Math.max(0, minStart + clampedDelta) });
        },

        removeActions: (actionIds) => {
          const state = get();
          const scene = currentScene(state);
          const shot = currentShot(state);
          const ids = new Set(actionIds);
          const actions = (shot.actions ?? []).filter((action) => ids.has(action.id));
          if (!actions.length) return;
          commit(transaction(`${actions.length}개 행동 삭제`, actions.map((action) => ({
            type: 'removeAction' as const, sceneId: scene.id, shotId: shot.id, action: structuredClone(action),
          }))));
          set({ selectedActionId: null });
        },

        updateSelectedCamera: (patch) => {
          const state = get();
          if (!state.selectedEntityId) return;
          const scene = currentScene(state);
          const shot = currentShot(state);
          const base = scene.entities.find((item) => item.id === state.selectedEntityId);
          if (!base || base.type !== 'camera') return;
          if (base.locked) { set({ message: `${base.name}은(는) 잠겨 있습니다.` }); return; }
          const resolved = resolveEntityWithoutRelationships(scene, shot, base.id);
          const previousValue: CameraData = structuredClone(resolved.camera ?? { projection: 'perspective', fov: 48, near: 0.1, far: 100, aspectRatio: '16:9', showSafeFrame: true });
          const nextValue: CameraData = { ...previousValue, ...structuredClone(patch) };
          nextValue.fov = Math.max(10, Math.min(140, nextValue.fov));
          nextValue.near = Math.max(0.01, nextValue.near);
          nextValue.far = Math.max(nextValue.near + 0.1, nextValue.far);
          if (JSON.stringify(previousValue) === JSON.stringify(nextValue)) return;
          commit(transaction(`${base.name} Shot 렌즈 설정 변경`, [{ type: 'updateEntity', sceneId: scene.id, shotId: shot.id, entityId: base.id, path: 'camera.settings', previousValue, nextValue }]));
        },

        updateSelectedLight: (patch) => {
          const state = get();
          if (!state.selectedEntityId) return;
          const scene = currentScene(state);
          const shot = currentShot(state);
          const base = scene.entities.find((item) => item.id === state.selectedEntityId);
          if (!base || base.type !== 'light') return;
          if (base.locked) { set({ message: `${base.name}은(는) 잠겨 있습니다.` }); return; }
          const resolved = resolveEntityWithoutRelationships(scene, shot, base.id);
          const previousValue: LightData = structuredClone(resolved.light ?? { kind: 'directional', color: '#fff4d6', intensity: 2, range: 12, angle: Math.PI / 4, castShadow: true });
          const nextValue: LightData = { ...previousValue, ...structuredClone(patch) };
          if (nextValue.targetEntityId === base.id || (nextValue.targetEntityId && !scene.entities.some((entity) => entity.id === nextValue.targetEntityId))) delete nextValue.targetEntityId;
          nextValue.intensity = Math.max(0, Math.min(50, nextValue.intensity));
          nextValue.range = Math.max(0, Math.min(200, nextValue.range));
          nextValue.angle = Math.max(0.05, Math.min(Math.PI, nextValue.angle));
          if (JSON.stringify(previousValue) === JSON.stringify(nextValue)) return;
          commit(transaction(`${base.name} Shot 조명 설정 변경`, [{ type: 'updateEntity', sceneId: scene.id, shotId: shot.id, entityId: base.id, path: 'light.settings', previousValue, nextValue }]));
        },

        addReferenceImage: (image) => {
          const state = get();
          const scene = currentScene(state);
          if ((scene.referenceImages ?? []).some((item) => item.id === image.id)) return;
          const existing = scene.referenceImages ?? [];
          if (existing.length >= 30) { set({ message: '프로젝트당 참조 이미지는 최대 30개까지 지원합니다.' }); return; }
          const totalBytes = existing.reduce((sum, item) => sum + item.sizeBytes, 0) + image.sizeBytes;
          if (totalBytes > 50_000_000) { set({ message: '참조 이미지 로컬 에셋 총량은 50MB까지 지원합니다.' }); return; }
          commit(transaction(`${image.name} 참조 이미지 추가`, [{ type: 'addReferenceImage', sceneId: scene.id, image: structuredClone(image) }]));
        },

        updateReferenceImage: (imageId, patch) => {
          const state = get();
          const scene = currentScene(state);
          const image = (scene.referenceImages ?? []).find((item) => item.id === imageId);
          if (!image) return;
          const nextImage: ReferenceImage = { ...structuredClone(image), ...structuredClone(patch) };
          nextImage.opacity = Math.max(0, Math.min(1, nextImage.opacity));
          if (JSON.stringify(image) === JSON.stringify(nextImage)) return;
          commit(transaction(`${image.name} 참조 이미지 수정`, [{ type: 'updateReferenceImage', sceneId: scene.id, previousImage: structuredClone(image), nextImage }]));
        },

        removeReferenceImage: (imageId) => {
          const state = get();
          const scene = currentScene(state);
          const image = (scene.referenceImages ?? []).find((item) => item.id === imageId);
          if (!image) return;
          commit(transaction(`${image.name} 참조 이미지 삭제`, [{ type: 'removeReferenceImage', sceneId: scene.id, image: structuredClone(image) }]));
        },

        removeSelectedAction: () => {
          const state = get();
          if (!state.selectedActionId) return;
          const scene = currentScene(state);
          const shot = currentShot(state);
          const action = (shot.actions ?? []).find((item) => item.id === state.selectedActionId);
          if (!action) return;
          commit(transaction(`${ACTION_LABELS[action.type]} 행동 삭제`, [{
            type: 'removeAction', sceneId: scene.id, shotId: shot.id, action: structuredClone(action),
          }]));
          set({ selectedActionId: null });
        },

        addEntity: (type) => {
          const state = get();
          const scene = currentScene(state);
          const entity = createDefaultEntity(type, scene.entities.length);
          commit(transaction(`${entity.name} 추가`, [{ type: 'addEntity', sceneId: scene.id, entity }]), entity.id);
        },

        duplicateSelected: () => {
          const state = get();
          if (!state.selectedEntityId) return;
          const scene = currentScene(state);
          const shot = currentShot(state);
          const base = scene.entities.find((entity) => entity.id === state.selectedEntityId);
          if (!base) return;
          const resolved = resolveEntity(scene, shot, base.id, state.playheadTime);
          const duplicate: Entity = {
            ...structuredClone(base),
            id: createId(base.type),
            name: `${base.name} 복사본`,
            transform: {
              ...structuredClone(resolved.transform),
              position: [resolved.transform.position[0] + 0.6, resolved.transform.position[1], resolved.transform.position[2]],
            },
            character: resolved.character ? structuredClone(resolved.character) : undefined,
            locked: false,
          };
          commit(transaction(`${base.name} 복제`, [{ type: 'addEntity', sceneId: scene.id, entity: duplicate }]), duplicate.id);
        },

        deleteSelected: () => {
          const state = get();
          if (!state.selectedEntityId) return;
          const scene = currentScene(state);
          const entity = scene.entities.find((item) => item.id === state.selectedEntityId);
          if (!entity) return;
          if (entity.locked) {
            set({ message: `${entity.name}은(는) 잠겨 있어 삭제할 수 없습니다.` });
            return;
          }
          const usedByShot = scene.shots.some((shot) => shot.cameraEntityId === entity.id);
          if (usedByShot) {
            set({ message: '현재 샷에서 사용하는 카메라는 삭제할 수 없습니다.' });
            return;
          }
          commit(transaction(`${entity.name} 삭제`, [{
            type: 'removeEntity',
            sceneId: scene.id,
            entity: structuredClone(entity),
            overridesByShot: overridesForEntity(scene.shots, entity.id),
            relationshipsByShot: relationshipsForEntity(scene.shots, entity.id),
            actionsByShot: actionsForEntity(scene.shots, entity.id),
            referenceImages: structuredClone((scene.referenceImages ?? []).filter((image) => image.cameraEntityId === entity.id)),
            lightTargetBackups: scene.entities
              .filter((light) => light.type === 'light' && (
                light.light?.targetEntityId === entity.id
                || scene.shots.some((shot) => shot.overrides.some((override) => override.entityId === light.id && override.path === 'light.settings' && (override.value as LightData).targetEntityId === entity.id))
              ))
              .map((light) => ({
                lightEntityId: light.id,
                baseLight: light.light ? structuredClone(light.light) : undefined,
                overridesByShot: Object.fromEntries(scene.shots.map((shot) => [shot.id, structuredClone(shot.overrides.filter((override) => override.entityId === light.id && override.path === 'light.settings'))])),
              })),
          }]), null);
        },

        toggleSelectedLock: () => {
          const state = get();
          if (!state.selectedEntityId) return;
          const scene = currentScene(state);
          const entity = scene.entities.find((item) => item.id === state.selectedEntityId);
          if (!entity) return;
          commit(transaction(`${entity.name} ${entity.locked ? '잠금 해제' : '잠금'}`, [{
            type: 'updateBaseEntity',
            sceneId: scene.id,
            entityId: entity.id,
            path: 'locked',
            previousValue: entity.locked,
            nextValue: !entity.locked,
          }]));
        },

        renameSelected: (name) => {
          const state = get();
          const trimmed = name.trim();
          if (!state.selectedEntityId || !trimmed) return;
          const scene = currentScene(state);
          const entity = scene.entities.find((item) => item.id === state.selectedEntityId);
          if (!entity || entity.name === trimmed) return;
          commit(transaction(`${entity.name} 이름 변경`, [{
            type: 'updateBaseEntity',
            sceneId: scene.id,
            entityId: entity.id,
            path: 'name',
            previousValue: entity.name,
            nextValue: trimmed,
          }]));
        },

        addGenerationResult: (result) => {
          const state = get();
          const scene = currentScene(state);
          const shot = currentShot(state);
          commit(transaction(`ComfyUI 결과 ${result.outputs.length}개 등록`, [{
            type: 'addGenerationResult', sceneId: scene.id, shotId: shot.id, result: structuredClone(result),
          }]));
        },

        removeGenerationResult: (resultId) => {
          const state = get();
          const scene = currentScene(state);
          const shot = currentShot(state);
          const result = (shot.generationResults ?? []).find((item) => item.id === resultId);
          if (!result) return;
          commit(transaction('생성 결과 기록 삭제', [{
            type: 'removeGenerationResult', sceneId: scene.id, shotId: shot.id, result: structuredClone(result),
          }]));
        },

        addShot: () => {
          const state = get();
          const scene = currentScene(state);
          const source = currentShot(state);
          const shot: Shot = {
            id: createId('shot'),
            name: `Shot ${scene.shots.length + 1}`,
            order: scene.shots.length + 1,
            duration: 4,
            cameraEntityId: source.cameraEntityId,
            overrides: [],
            relationships: [],
            actions: [],
            generationResults: [],
          };
          commit(transaction(`${shot.name} 추가`, [{ type: 'addShot', sceneId: scene.id, shot }]), undefined, shot.id);
        },

        duplicateActiveShot: () => {
          const state = get();
          const scene = currentScene(state);
          const source = currentShot(state);
          const shot: Shot = {
            ...structuredClone(source),
            id: createId('shot'),
            name: `${source.name} 복사본`,
            order: scene.shots.length + 1,
            overrides: source.overrides.map((override) => ({ ...structuredClone(override), id: '' })),
          };
          shot.overrides = shot.overrides.map((override) => ({
            ...override,
            id: `${shot.id}:${override.entityId}:${override.path}`,
          }));
          shot.relationships = source.relationships.map((relationship) => ({
            ...structuredClone(relationship),
            id: createId('relationship'),
          }));
          shot.actions = (source.actions ?? []).map((action) => ({
            ...structuredClone(action),
            id: createId('action'),
          }));
          shot.generationResults = [];
          commit(transaction(`${source.name} 복제`, [{ type: 'addShot', sceneId: scene.id, shot }]), undefined, shot.id);
        },

        deleteActiveShot: () => {
          const state = get();
          const scene = currentScene(state);
          if (scene.shots.length <= 1) {
            set({ message: '씬에는 최소 한 개의 샷이 필요합니다.' });
            return;
          }
          const shot = currentShot(state);
          const remaining = scene.shots.filter((item) => item.id !== shot.id).sort((a, b) => a.order - b.order);
          const nextShot = remaining[Math.min(Math.max(shot.order - 1, 0), remaining.length - 1)];
          commit(transaction(`${shot.name} 삭제`, [{ type: 'removeShot', sceneId: scene.id, shot: structuredClone(shot) }]), undefined, nextShot.id);
        },

        updateActiveShotName: (name) => {
          const state = get();
          const trimmed = name.trim();
          if (!trimmed) return;
          const scene = currentScene(state);
          const shot = currentShot(state);
          if (shot.name === trimmed) return;
          commit(transaction(`${shot.name} 이름 변경`, [{
            type: 'updateShot', sceneId: scene.id, shotId: shot.id, path: 'name', previousValue: shot.name, nextValue: trimmed,
          }]));
        },

        updateActiveShotDuration: (duration) => {
          const state = get();
          const scene = currentScene(state);
          const shot = currentShot(state);
          const nextDuration = Math.max(0.5, Math.min(60, Number.isFinite(duration) ? duration : shot.duration));
          const latestActionEnd = Math.max(0, ...(shot.actions ?? []).map((action) => action.startTime + action.duration));
          if (nextDuration + 1e-6 < latestActionEnd) {
            set({ message: `행동이 ${latestActionEnd.toFixed(1)}초까지 있어 샷을 더 짧게 만들 수 없습니다.` });
            return;
          }
          if (shot.duration === nextDuration) return;
          commit(transaction(`${shot.name} 길이 변경`, [{
            type: 'updateShot', sceneId: scene.id, shotId: shot.id, path: 'duration', previousValue: shot.duration, nextValue: nextDuration,
          }]));
        },

        registerAsset: (item) => {
          const state = get();
          if (state.project.assetLibrary.some((asset) => asset.id === item.id)) {
            set({ message: '이미 등록된 에셋입니다.' });
            return;
          }
          commit(transaction(`${item.name} GLB 에셋 등록`, [{ type: 'addAssetLibraryItem', item: structuredClone(item) }]));
        },

        updateAssetItem: (item) => {
          const state = get();
          const previousItem = state.project.assetLibrary.find((asset) => asset.id === item.id);
          if (!previousItem) { set({ message: '수정할 에셋을 찾지 못했습니다.' }); return; }
          if (JSON.stringify(previousItem) === JSON.stringify(item)) return;
          commit(transaction(`${item.name} GLB 분석 정보 갱신`, [{ type: 'updateAssetLibraryItem', previousItem: structuredClone(previousItem), nextItem: structuredClone(item) }]));
        },

        assignAssetToSelected: (assetId) => {
          const state = get();
          if (!state.selectedEntityId) return;
          const scene = currentScene(state);
          const entity = scene.entities.find((item) => item.id === state.selectedEntityId);
          const item = state.project.assetLibrary.find((asset) => asset.id === assetId);
          if (!entity || !item) return;
          if (entity.locked) {
            set({ message: `${entity.name}이 잠겨 있습니다.` });
            return;
          }
          if (item.category === 'character' && entity.type !== 'character') {
            set({ message: '인물용 GLB는 인물 Entity에만 적용할 수 있습니다.' });
            return;
          }
          if (item.category !== 'character' && entity.type === 'character') {
            set({ message: '인물 Entity에는 인물용 GLB를 선택해 주세요.' });
            return;
          }
          const previousAsset = entity.asset ? structuredClone(entity.asset) : undefined;
          const nextAsset = assetWithModel(entity.asset, assetId);
          commit(transaction(`${entity.name} 모델을 ${item.name}(으)로 교체`, [{ type: 'updateEntityAsset', sceneId: scene.id, entityId: entity.id, previousAsset, nextAsset }]));
        },

        clearSelectedModelAsset: () => {
          const state = get();
          if (!state.selectedEntityId) return;
          const scene = currentScene(state);
          const entity = scene.entities.find((item) => item.id === state.selectedEntityId);
          if (!entity?.asset?.modelAssetId) return;
          const previousAsset = structuredClone(entity.asset);
          const nextAsset = assetWithoutModel(entity.asset);
          commit(transaction(`${entity.name} 프록시 모델로 복원`, [{ type: 'updateEntityAsset', sceneId: scene.id, entityId: entity.id, previousAsset, nextAsset }]));
        },

        removeAsset: (assetId) => {
          const state = get();
          const item = state.project.assetLibrary.find((asset) => asset.id === assetId);
          if (!item) return;
          const previousEntityAssets = state.project.scenes.flatMap((scene) => scene.entities
            .filter((entity) => entity.asset?.modelAssetId === assetId)
            .map((entity) => ({ sceneId: scene.id, entityId: entity.id, asset: entity.asset ? structuredClone(entity.asset) : undefined })));
          commit(transaction(`${item.name} 라이브러리에서 제거`, [{ type: 'removeAssetLibraryItem', item: structuredClone(item), previousEntityAssets }]));
        },

        changeEnvironmentPreset: (presetId) => {
          const state = get();
          const previousScene = currentScene(state);
          try {
            const nextScene = replaceEnvironmentPreset(previousScene, presetId, true);
            commit(transaction(`${nextScene.environment.name} 환경으로 교체`, [{ type: 'replaceScene', sceneId: previousScene.id, previousScene: structuredClone(previousScene), nextScene }]));
          } catch (error) {
            set({ message: error instanceof Error ? error.message : '환경을 교체하지 못했습니다.' });
          }
        },

        relayoutActiveScene: () => {
          const state = get();
          const previousScene = currentScene(state);
          const nextScene = relayoutSceneEntities(previousScene);
          commit(transaction('인원수와 공간에 맞춰 장면 재배치', [{ type: 'replaceScene', sceneId: previousScene.id, previousScene: structuredClone(previousScene), nextScene }]));
        },

        replaceActiveSceneFromPrompt: (prompt) => {
          const state = get();
          const trimmed = prompt.trim();
          if (!trimmed) {
            set({ message: '장면 설명을 입력해 주세요.' });
            return;
          }
          const previousScene = currentScene(state);
          const { scene: nextScene, plan } = generateSceneFromPrompt(trimmed, previousScene.id);
          const nextSelection = nextScene.entities.find((entity) => entity.type === 'character')?.id ?? nextScene.entities[0]?.id ?? null;
          const nextShotId = nextScene.shots[0]?.id;
          if (!nextShotId) {
            set({ message: '샷을 생성하지 못했습니다.' });
            return;
          }
          commit(transaction(`자연어 씬 생성 · ${plan.characters.length}명 · ${plan.shots.length}샷`, [{
            type: 'replaceScene',
            sceneId: previousScene.id,
            previousScene: structuredClone(previousScene),
            nextScene: structuredClone(nextScene),
          }]), nextSelection, nextShotId);
          set({ playheadTime: 0, isPlaying: false, transformMode: 'translate', selectedActionId: null, selectedJoint: nextScene.entities.find((entity) => entity.id === nextSelection)?.type === 'character' ? 'rightShoulder' : null });
        },

        importProject: (project) => {
          const result = validateAndMigrateProject(project);
          if (!result.success || !result.project) {
            set({ message: result.errors[0] ?? '올바른 AI Scene Director 프로젝트 파일이 아닙니다.' });
            return false;
          }
          const cloned = structuredClone(result.project);
          const scene = cloned.scenes.find((item) => item.id === cloned.activeSceneId) ?? cloned.scenes[0];
          set({
            project: cloned,
            activeShotId: scene.shots[0].id,
            selectedEntityId: scene.entities[0]?.id ?? null,
            selectedJoint: scene.entities[0]?.type === 'character' ? 'rightShoulder' : null,
            playheadTime: 0,
            isPlaying: false,
            selectedActionId: null,
            undoStack: [],
            redoStack: [],
            message: result.warnings.length
              ? `${cloned.name} 불러옴 · ${result.warnings.length}개 항목 자동 변환`
              : `${cloned.name} 프로젝트를 불러왔습니다.`,
          });
          return true;
        },

        undo: () => {
          const state = get();
          const item = state.undoStack.at(-1);
          if (!item) return;
          try {
            const nextProject = revertTransaction(state.project, item);
            const scene = nextProject.scenes.find((candidate) => candidate.id === nextProject.activeSceneId) ?? nextProject.scenes[0];
            const selectedExists = state.selectedEntityId && scene.entities.some((entity) => entity.id === state.selectedEntityId);
            const shotExists = scene.shots.some((shot) => shot.id === state.activeShotId);
            set({
              project: nextProject,
              undoStack: state.undoStack.slice(0, -1),
              redoStack: [...state.redoStack, item],
              selectedEntityId: selectedExists ? state.selectedEntityId : scene.entities[0]?.id ?? null,
              activeShotId: shotExists ? state.activeShotId : scene.shots[0].id,
              message: `${item.title} 실행 취소`,
            });
          } catch (error) {
            set({ message: error instanceof Error ? error.message : '실행 취소에 실패했습니다.' });
          }
        },

        redo: () => {
          const state = get();
          const item = state.redoStack.at(-1);
          if (!item) return;
          try {
            const nextProject = applyTransaction(state.project, item);
            const scene = nextProject.scenes.find((candidate) => candidate.id === nextProject.activeSceneId) ?? nextProject.scenes[0];
            const selectedExists = state.selectedEntityId && scene.entities.some((entity) => entity.id === state.selectedEntityId);
            const shotExists = scene.shots.some((shot) => shot.id === state.activeShotId);
            set({
              project: nextProject,
              undoStack: [...state.undoStack, item],
              redoStack: state.redoStack.slice(0, -1),
              selectedEntityId: selectedExists ? state.selectedEntityId : scene.entities[0]?.id ?? null,
              activeShotId: shotExists ? state.activeShotId : scene.shots[0].id,
              message: `${item.title} 다시 실행`,
            });
          } catch (error) {
            set({ message: error instanceof Error ? error.message : '다시 실행에 실패했습니다.' });
          }
        },

        reset: () => set({
          project: structuredClone(sampleProject),
          activeShotId: 'shot-001',
          selectedEntityId: 'character-a',
          selectedJoint: 'rightShoulder',
          transformMode: 'translate',
          playheadTime: 0,
          isPlaying: false,
          selectedActionId: null,
          undoStack: [],
          redoStack: [],
          message: '샘플 프로젝트를 초기화했습니다.',
        }),

        getResolvedEntities: () => {
          const state = get();
          const scene = currentScene(state);
          const shot = currentShot(state);
          return resolveSceneAtTime(scene, shot, state.playheadTime);
        },
      };
    },
    {
      name: 'ai-scene-director-project',
      partialize: (state) => ({
        project: state.project,
        activeShotId: state.activeShotId,
        selectedEntityId: state.selectedEntityId,
        selectedJoint: state.selectedJoint,
        transformMode: state.transformMode,
        playheadTime: 0,
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<EditorState> | undefined;
        const result = validateAndMigrateProject(persisted?.project);
        const project = result.success && result.project ? result.project : currentState.project;
        const scene = project.scenes.find((item) => item.id === project.activeSceneId) ?? project.scenes[0];
        const activeShotId = persisted?.activeShotId && scene.shots.some((shot) => shot.id === persisted.activeShotId)
          ? persisted.activeShotId
          : scene.shots[0].id;
        const selectedEntityId = persisted?.selectedEntityId && scene.entities.some((entity) => entity.id === persisted.selectedEntityId)
          ? persisted.selectedEntityId
          : scene.entities[0]?.id ?? null;
        return {
          ...currentState,
          ...persisted,
          project,
          activeShotId,
          selectedEntityId,
          selectedJoint: persisted?.selectedJoint ?? (scene.entities.find((entity) => entity.id === selectedEntityId)?.type === 'character' ? 'rightShoulder' : null),
          playheadTime: 0,
          isPlaying: false,
          selectedActionId: null,
          undoStack: [],
          redoStack: [],
          message: result.warnings.length ? `저장된 프로젝트를 0.13.0으로 변환했습니다.` : null,
        };
      },
    },
  ),
);
