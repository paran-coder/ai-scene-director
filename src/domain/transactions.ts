import { findActionConflicts } from './actions.ts';
import type {
  AddActionOperation,
  AddEntityOperation,
  AddGenerationResultOperation,
  AddAssetLibraryItemOperation,
  AddRelationshipOperation,
  AddShotOperation,
  Operation,
  Project,
  RemoveActionOperation,
  RemoveEntityOperation,
  RemoveGenerationResultOperation,
  RemoveAssetLibraryItemOperation,
  RemoveRelationshipOperation,
  RemoveShotOperation,
  ReplaceSceneOperation,
  ShotOverride,
  Transaction,
  UpdateActionOperation,
  UpdateBaseEntityOperation,
  UpdateEntityOperation,
  UpdateEntityDataOperation,
  AddReferenceImageOperation,
  UpdateReferenceImageOperation,
  RemoveReferenceImageOperation,
  UpdateAssetLibraryItemOperation,
  UpdateEntityAssetOperation,
  UpdateShotOperation,
} from './types.ts';

function findScene(project: Project, sceneId: string) {
  const scene = project.scenes.find((item) => item.id === sceneId);
  if (!scene) throw new Error(`Scene not found: ${sceneId}`);
  return scene;
}

function findShot(project: Project, sceneId: string, shotId: string) {
  const scene = findScene(project, sceneId);
  const shot = scene.shots.find((item) => item.id === shotId);
  if (!shot) throw new Error(`Shot not found: ${shotId}`);
  return { scene, shot };
}

function applyEntityOverride(project: Project, operation: UpdateEntityOperation, inverse: boolean): void {
  const { scene, shot } = findShot(project, operation.sceneId, operation.shotId);
  const entity = scene.entities.find((item) => item.id === operation.entityId);
  if (!entity) throw new Error(`Entity not found: ${operation.entityId}`);
  if (entity.locked) throw new Error(`${entity.name} is locked`);

  const value = inverse ? operation.previousValue : operation.nextValue;
  const overrideId = `${operation.shotId}:${operation.entityId}:${operation.path}`;
  const existing = shot.overrides.find((item) => item.id === overrideId);

  const sameAsBase = (() => {
    switch (operation.path) {
      case 'transform.position':
        return JSON.stringify(entity.transform.position) === JSON.stringify(value);
      case 'transform.rotation':
        return JSON.stringify(entity.transform.rotation) === JSON.stringify(value);
      case 'transform.scale':
        return JSON.stringify(entity.transform.scale) === JSON.stringify(value);
      case 'visible':
        return entity.visible === value;
      case 'character.pose':
        return JSON.stringify(entity.character?.pose) === JSON.stringify(value);
      case 'camera.settings':
        return JSON.stringify(entity.camera) === JSON.stringify(value);
      case 'light.settings':
        return JSON.stringify(entity.light) === JSON.stringify(value);
    }
  })();

  if (sameAsBase) {
    shot.overrides = shot.overrides.filter((item) => item.id !== overrideId);
    return;
  }

  const nextOverride: ShotOverride = {
    id: overrideId,
    entityId: operation.entityId,
    path: operation.path,
    value: structuredClone(value),
  };

  if (existing) Object.assign(existing, nextOverride);
  else shot.overrides.push(nextOverride);
}

function applyAddEntity(project: Project, operation: AddEntityOperation, inverse: boolean): void {
  const scene = findScene(project, operation.sceneId);
  if (inverse) {
    scene.entities = scene.entities.filter((entity) => entity.id !== operation.entity.id);
    scene.shots.forEach((shot) => {
      shot.overrides = shot.overrides.filter((override) => override.entityId !== operation.entity.id);
      shot.relationships = shot.relationships.filter((relationship) => (
        relationship.sourceEntityId !== operation.entity.id && relationship.targetEntityId !== operation.entity.id
      ));
      shot.actions = (shot.actions ?? []).filter((action) => (
        action.actorEntityId !== operation.entity.id
        && action.targetEntityId !== operation.entity.id
        && action.parameters.surfaceEntityId !== operation.entity.id
      ));
    });
    return;
  }
  if (!scene.entities.some((entity) => entity.id === operation.entity.id)) {
    scene.entities.push(structuredClone(operation.entity));
  }
}

function applyRemoveEntity(project: Project, operation: RemoveEntityOperation, inverse: boolean): void {
  const scene = findScene(project, operation.sceneId);
  if (inverse) {
    if (!scene.entities.some((entity) => entity.id === operation.entity.id)) {
      scene.entities.push(structuredClone(operation.entity));
    }
    scene.shots.forEach((shot) => {
      const restoredOverrides = operation.overridesByShot[shot.id] ?? [];
      const restoredOverrideIds = new Set(restoredOverrides.map((item) => item.id));
      shot.overrides = [
        ...shot.overrides.filter((item) => !restoredOverrideIds.has(item.id)),
        ...structuredClone(restoredOverrides),
      ];

      const restoredRelationships = operation.relationshipsByShot[shot.id] ?? [];
      const restoredRelationshipIds = new Set(restoredRelationships.map((item) => item.id));
      shot.relationships = [
        ...shot.relationships.filter((item) => !restoredRelationshipIds.has(item.id)),
        ...structuredClone(restoredRelationships),
      ];

      const restoredActions = operation.actionsByShot?.[shot.id] ?? [];
      const restoredActionIds = new Set(restoredActions.map((item) => item.id));
      shot.actions = [
        ...(shot.actions ?? []).filter((item) => !restoredActionIds.has(item.id)),
        ...structuredClone(restoredActions),
      ];
    });
    for (const restoredImage of operation.referenceImages ?? []) {
      const index = (scene.referenceImages ?? []).findIndex((item) => item.id === restoredImage.id);
      if (index >= 0) scene.referenceImages[index] = structuredClone(restoredImage);
      else scene.referenceImages.push(structuredClone(restoredImage));
    }
    for (const backup of operation.lightTargetBackups ?? []) {
      const light = scene.entities.find((item) => item.id === backup.lightEntityId);
      if (light && backup.baseLight) light.light = structuredClone(backup.baseLight);
      for (const shot of scene.shots) {
        const restored = backup.overridesByShot[shot.id] ?? [];
        const restoredIds = new Set(restored.map((item) => item.id));
        shot.overrides = [
          ...shot.overrides.filter((item) => !restoredIds.has(item.id)),
          ...structuredClone(restored),
        ];
      }
    }
    return;
  }
  scene.entities = scene.entities.filter((entity) => entity.id !== operation.entity.id);
  scene.referenceImages = (scene.referenceImages ?? []).map((image) => image.cameraEntityId === operation.entity.id ? { ...image, cameraEntityId: undefined } : image);
  for (const light of scene.entities) {
    if (light.type === 'light' && light.light?.targetEntityId === operation.entity.id) delete light.light.targetEntityId;
  }
  scene.shots.forEach((shot) => {
    shot.overrides = shot.overrides.map((override) => {
      if (override.path !== 'light.settings') return override;
      const value = structuredClone(override.value) as import('./types.ts').LightData;
      if (value.targetEntityId !== operation.entity.id) return override;
      delete value.targetEntityId;
      return { ...override, value };
    });
    shot.overrides = shot.overrides.filter((override) => override.entityId !== operation.entity.id);
    shot.relationships = shot.relationships.filter((relationship) => (
      relationship.sourceEntityId !== operation.entity.id && relationship.targetEntityId !== operation.entity.id
    ));
    shot.actions = (shot.actions ?? []).filter((action) => (
      action.actorEntityId !== operation.entity.id
      && action.targetEntityId !== operation.entity.id
      && action.parameters.surfaceEntityId !== operation.entity.id
    ));
  });
}

function applyUpdateBaseEntity(project: Project, operation: UpdateBaseEntityOperation, inverse: boolean): void {
  const scene = findScene(project, operation.sceneId);
  const entity = scene.entities.find((item) => item.id === operation.entityId);
  if (!entity) throw new Error(`Entity not found: ${operation.entityId}`);
  const value = inverse ? operation.previousValue : operation.nextValue;
  if (operation.path === 'name') entity.name = String(value);
  else entity[operation.path] = Boolean(value);
}


function applyUpdateEntityData(project: Project, operation: UpdateEntityDataOperation, inverse: boolean): void {
  const scene = findScene(project, operation.sceneId);
  const entity = scene.entities.find((item) => item.id === operation.entityId);
  if (!entity) throw new Error(`Entity not found: ${operation.entityId}`);
  if (entity.locked) throw new Error(`${entity.name} is locked`);
  const value = structuredClone(inverse ? operation.previousValue : operation.nextValue);
  if (operation.field === 'camera') {
    if (entity.type !== 'camera') throw new Error('카메라 설정은 카메라 객체에만 적용할 수 있습니다.');
    entity.camera = value as typeof entity.camera;
  } else {
    if (entity.type !== 'light') throw new Error('조명 설정은 조명 객체에만 적용할 수 있습니다.');
    entity.light = value as typeof entity.light;
  }
}

function applyAddReferenceImage(project: Project, operation: AddReferenceImageOperation, inverse: boolean): void {
  const scene = findScene(project, operation.sceneId);
  scene.referenceImages = scene.referenceImages ?? [];
  if (inverse) scene.referenceImages = scene.referenceImages.filter((item) => item.id !== operation.image.id);
  else if (!scene.referenceImages.some((item) => item.id === operation.image.id)) scene.referenceImages.push(structuredClone(operation.image));
}

function applyUpdateReferenceImage(project: Project, operation: UpdateReferenceImageOperation, inverse: boolean): void {
  const scene = findScene(project, operation.sceneId);
  scene.referenceImages = scene.referenceImages ?? [];
  const image = structuredClone(inverse ? operation.previousImage : operation.nextImage);
  const index = scene.referenceImages.findIndex((item) => item.id === image.id);
  if (index < 0) throw new Error(`Reference image not found: ${image.id}`);
  scene.referenceImages[index] = image;
}

function applyRemoveReferenceImage(project: Project, operation: RemoveReferenceImageOperation, inverse: boolean): void {
  const scene = findScene(project, operation.sceneId);
  scene.referenceImages = scene.referenceImages ?? [];
  if (inverse) {
    if (!scene.referenceImages.some((item) => item.id === operation.image.id)) scene.referenceImages.push(structuredClone(operation.image));
  } else scene.referenceImages = scene.referenceImages.filter((item) => item.id !== operation.image.id);
}

function assertRelationshipEntities(project: Project, operation: AddRelationshipOperation | RemoveRelationshipOperation): void {
  const { scene } = findShot(project, operation.sceneId, operation.shotId);
  const source = scene.entities.find((entity) => entity.id === operation.relationship.sourceEntityId);
  const target = scene.entities.find((entity) => entity.id === operation.relationship.targetEntityId);
  if (!source || !target) throw new Error('관계가 존재하지 않는 객체를 참조합니다.');
  if (source.locked || target.locked) throw new Error('잠긴 객체의 관계는 변경할 수 없습니다.');
}

function applyAddRelationship(project: Project, operation: AddRelationshipOperation, inverse: boolean): void {
  const { shot } = findShot(project, operation.sceneId, operation.shotId);
  if (inverse) {
    shot.relationships = shot.relationships.filter((item) => item.id !== operation.relationship.id);
    return;
  }
  assertRelationshipEntities(project, operation);
  if (!shot.relationships.some((item) => item.id === operation.relationship.id)) {
    shot.relationships.push(structuredClone(operation.relationship));
  }
}

function applyRemoveRelationship(project: Project, operation: RemoveRelationshipOperation, inverse: boolean): void {
  const { shot } = findShot(project, operation.sceneId, operation.shotId);
  if (inverse) {
    assertRelationshipEntities(project, operation);
    if (!shot.relationships.some((item) => item.id === operation.relationship.id)) {
      shot.relationships.push(structuredClone(operation.relationship));
    }
    return;
  }
  assertRelationshipEntities(project, operation);
  shot.relationships = shot.relationships.filter((item) => item.id !== operation.relationship.id);
}

function assertActionEntities(project: Project, operation: AddActionOperation | RemoveActionOperation | UpdateActionOperation): void {
  const action = operation.type === 'updateAction' ? operation.nextAction : operation.action;
  const { scene, shot } = findShot(project, operation.sceneId, operation.shotId);
  const actor = scene.entities.find((entity) => entity.id === action.actorEntityId);
  const target = action.targetEntityId ? scene.entities.find((entity) => entity.id === action.targetEntityId) : undefined;
  const surface = action.parameters.surfaceEntityId
    ? scene.entities.find((entity) => entity.id === action.parameters.surfaceEntityId)
    : undefined;
  if (!actor) throw new Error('행동의 실행 객체가 존재하지 않습니다.');
  if (action.targetEntityId && !target) throw new Error('행동의 대상 객체가 존재하지 않습니다.');
  if (action.parameters.surfaceEntityId && !surface) throw new Error('행동의 표면 객체가 존재하지 않습니다.');
  if (actor.locked || target?.locked || surface?.locked) throw new Error('잠긴 객체가 포함된 행동은 변경할 수 없습니다.');
  if (action.startTime < 0 || action.duration <= 0 || action.startTime + action.duration > shot.duration + 1e-6) {
    throw new Error('행동 시간이 현재 샷 범위를 벗어납니다.');
  }
  const conflicts = findActionConflicts(shot.actions ?? [], action);
  if (conflicts.length > 0) throw new Error('같은 객체를 사용하는 행동 시간이 겹칩니다.');
}

function applyAddAction(project: Project, operation: AddActionOperation, inverse: boolean): void {
  const { shot } = findShot(project, operation.sceneId, operation.shotId);
  if (inverse) {
    shot.actions = (shot.actions ?? []).filter((item) => item.id !== operation.action.id);
    return;
  }
  assertActionEntities(project, operation);
  if (!(shot.actions ?? []).some((item) => item.id === operation.action.id)) {
    shot.actions = [...(shot.actions ?? []), structuredClone(operation.action)];
  }
}

function applyRemoveAction(project: Project, operation: RemoveActionOperation, inverse: boolean): void {
  const { shot } = findShot(project, operation.sceneId, operation.shotId);
  if (inverse) {
    assertActionEntities(project, operation);
    if (!(shot.actions ?? []).some((item) => item.id === operation.action.id)) {
      shot.actions = [...(shot.actions ?? []), structuredClone(operation.action)];
    }
    return;
  }
  assertActionEntities(project, operation);
  shot.actions = (shot.actions ?? []).filter((item) => item.id !== operation.action.id);
}

function applyUpdateAction(project: Project, operation: UpdateActionOperation, inverse: boolean): void {
  const { shot } = findShot(project, operation.sceneId, operation.shotId);
  const nextAction = structuredClone(inverse ? operation.previousAction : operation.nextAction);
  assertActionEntities(project, { ...operation, nextAction });
  const index = (shot.actions ?? []).findIndex((item) => item.id === nextAction.id);
  if (index < 0) throw new Error(`Action not found: ${nextAction.id}`);
  shot.actions[index] = nextAction;
}



function applyAddAssetLibraryItem(project: Project, operation: AddAssetLibraryItemOperation, inverse: boolean): void {
  project.assetLibrary = project.assetLibrary ?? [];
  if (inverse) {
    project.assetLibrary = project.assetLibrary.filter((item) => item.id !== operation.item.id);
    return;
  }
  if (!project.assetLibrary.some((item) => item.id === operation.item.id)) {
    project.assetLibrary.push(structuredClone(operation.item));
  }
}

function applyRemoveAssetLibraryItem(project: Project, operation: RemoveAssetLibraryItemOperation, inverse: boolean): void {
  project.assetLibrary = project.assetLibrary ?? [];
  if (inverse) {
    if (!project.assetLibrary.some((item) => item.id === operation.item.id)) {
      project.assetLibrary.push(structuredClone(operation.item));
    }
    operation.previousEntityAssets.forEach((assignment) => {
      const scene = findScene(project, assignment.sceneId);
      const entity = scene.entities.find((item) => item.id === assignment.entityId);
      if (entity) entity.asset = assignment.asset ? structuredClone(assignment.asset) : undefined;
    });
    return;
  }
  project.assetLibrary = project.assetLibrary.filter((item) => item.id !== operation.item.id);
  project.scenes.forEach((scene) => scene.entities.forEach((entity) => {
    if (entity.asset?.modelAssetId === operation.item.id) {
      const next = structuredClone(entity.asset);
      delete next.modelAssetId;
      next.tags = next.tags.filter((tag) => tag !== 'imported-glb');
      entity.asset = next;
    }
  }));
}


function applyUpdateAssetLibraryItem(project: Project, operation: UpdateAssetLibraryItemOperation, inverse: boolean): void {
  project.assetLibrary = project.assetLibrary ?? [];
  const nextItem = structuredClone(inverse ? operation.previousItem : operation.nextItem);
  const index = project.assetLibrary.findIndex((item) => item.id === nextItem.id);
  if (index < 0) throw new Error(`Asset not found: ${nextItem.id}`);
  project.assetLibrary[index] = nextItem;
}

function applyUpdateEntityAsset(project: Project, operation: UpdateEntityAssetOperation, inverse: boolean): void {
  const scene = findScene(project, operation.sceneId);
  const entity = scene.entities.find((item) => item.id === operation.entityId);
  if (!entity) throw new Error(`Entity not found: ${operation.entityId}`);
  if (entity.locked) throw new Error(`${entity.name} is locked`);
  const asset = inverse ? operation.previousAsset : operation.nextAsset;
  if (asset?.modelAssetId && !project.assetLibrary.some((item) => item.id === asset.modelAssetId)) {
    throw new Error('선택한 GLB 에셋이 라이브러리에 없습니다.');
  }
  entity.asset = asset ? structuredClone(asset) : undefined;
}

function applyAddGenerationResult(project: Project, operation: AddGenerationResultOperation, inverse: boolean): void {
  const { shot } = findShot(project, operation.sceneId, operation.shotId);
  if (inverse) {
    shot.generationResults = (shot.generationResults ?? []).filter((item) => item.id !== operation.result.id);
    return;
  }
  if (!(shot.generationResults ?? []).some((item) => item.id === operation.result.id)) {
    shot.generationResults = [...(shot.generationResults ?? []), structuredClone(operation.result)];
  }
}

function applyRemoveGenerationResult(project: Project, operation: RemoveGenerationResultOperation, inverse: boolean): void {
  const { shot } = findShot(project, operation.sceneId, operation.shotId);
  if (inverse) {
    if (!(shot.generationResults ?? []).some((item) => item.id === operation.result.id)) {
      shot.generationResults = [...(shot.generationResults ?? []), structuredClone(operation.result)];
    }
    return;
  }
  shot.generationResults = (shot.generationResults ?? []).filter((item) => item.id !== operation.result.id);
}

function normalizeShotOrder(project: Project, sceneId: string): void {
  const scene = findScene(project, sceneId);
  scene.shots.sort((a, b) => a.order - b.order);
  scene.shots.forEach((shot, index) => {
    shot.order = index + 1;
  });
}

function applyAddShot(project: Project, operation: AddShotOperation, inverse: boolean): void {
  const scene = findScene(project, operation.sceneId);
  if (inverse) {
    scene.shots = scene.shots.filter((shot) => shot.id !== operation.shot.id);
  } else if (!scene.shots.some((shot) => shot.id === operation.shot.id)) {
    scene.shots.push(structuredClone(operation.shot));
  }
  normalizeShotOrder(project, operation.sceneId);
}

function applyRemoveShot(project: Project, operation: RemoveShotOperation, inverse: boolean): void {
  const scene = findScene(project, operation.sceneId);
  if (inverse) {
    if (!scene.shots.some((shot) => shot.id === operation.shot.id)) {
      scene.shots.push(structuredClone(operation.shot));
    }
  } else {
    scene.shots = scene.shots.filter((shot) => shot.id !== operation.shot.id);
  }
  normalizeShotOrder(project, operation.sceneId);
}


function applyReplaceScene(project: Project, operation: ReplaceSceneOperation, inverse: boolean): void {
  const index = project.scenes.findIndex((scene) => scene.id === operation.sceneId);
  if (index < 0) throw new Error(`Scene not found: ${operation.sceneId}`);
  const replacement = structuredClone(inverse ? operation.previousScene : operation.nextScene);
  if (replacement.id !== operation.sceneId) replacement.id = operation.sceneId;
  project.scenes[index] = replacement;
}

function applyUpdateShot(project: Project, operation: UpdateShotOperation, inverse: boolean): void {
  const scene = findScene(project, operation.sceneId);
  const shot = scene.shots.find((item) => item.id === operation.shotId);
  if (!shot) throw new Error(`Shot not found: ${operation.shotId}`);
  const value = inverse ? operation.previousValue : operation.nextValue;
  if (operation.path === 'name') shot.name = String(value);
  else shot[operation.path] = Number(value);
  if (operation.path === 'order') normalizeShotOrder(project, operation.sceneId);
}

function applyOperation(project: Project, operation: Operation, inverse = false): void {
  switch (operation.type) {
    case 'updateEntity':
      applyEntityOverride(project, operation, inverse);
      return;
    case 'addEntity':
      applyAddEntity(project, operation, inverse);
      return;
    case 'removeEntity':
      applyRemoveEntity(project, operation, inverse);
      return;
    case 'updateBaseEntity':
      applyUpdateBaseEntity(project, operation, inverse);
      return;
    case 'updateEntityData':
      applyUpdateEntityData(project, operation, inverse);
      return;
    case 'addReferenceImage':
      applyAddReferenceImage(project, operation, inverse);
      return;
    case 'updateReferenceImage':
      applyUpdateReferenceImage(project, operation, inverse);
      return;
    case 'removeReferenceImage':
      applyRemoveReferenceImage(project, operation, inverse);
      return;
    case 'addRelationship':
      applyAddRelationship(project, operation, inverse);
      return;
    case 'removeRelationship':
      applyRemoveRelationship(project, operation, inverse);
      return;
    case 'addAction':
      applyAddAction(project, operation, inverse);
      return;
    case 'removeAction':
      applyRemoveAction(project, operation, inverse);
      return;
    case 'updateAction':
      applyUpdateAction(project, operation, inverse);
      return;
    case 'addAssetLibraryItem':
      applyAddAssetLibraryItem(project, operation, inverse);
      return;
    case 'removeAssetLibraryItem':
      applyRemoveAssetLibraryItem(project, operation, inverse);
      return;
    case 'updateAssetLibraryItem':
      applyUpdateAssetLibraryItem(project, operation, inverse);
      return;
    case 'updateEntityAsset':
      applyUpdateEntityAsset(project, operation, inverse);
      return;
    case 'addGenerationResult':
      applyAddGenerationResult(project, operation, inverse);
      return;
    case 'removeGenerationResult':
      applyRemoveGenerationResult(project, operation, inverse);
      return;
    case 'addShot':
      applyAddShot(project, operation, inverse);
      return;
    case 'removeShot':
      applyRemoveShot(project, operation, inverse);
      return;
    case 'replaceScene':
      applyReplaceScene(project, operation, inverse);
      return;
    case 'updateShot':
      applyUpdateShot(project, operation, inverse);
  }
}

export function applyTransaction(project: Project, transaction: Transaction): Project {
  const next = structuredClone(project);
  transaction.operations.forEach((operation) => applyOperation(next, operation));
  next.revision += 1;
  return next;
}

export function revertTransaction(project: Project, transaction: Transaction): Project {
  const next = structuredClone(project);
  [...transaction.operations].reverse().forEach((operation) => applyOperation(next, operation, true));
  next.revision += 1;
  return next;
}
