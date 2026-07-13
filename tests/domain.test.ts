import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { calculateAnkleLocalPosition, calculateHandLocalPosition, calculateHumanoidJointLocalPositions, findPosePreset, groundFeet, solveArmIK, solveLegIK } from '../src/domain/pose.ts';
import { buildMotionPrompt, buildShotPackageManifest, buildShotPrompt, createStoredZip } from '../src/domain/export.ts';
import { resolveEntity, resolveEntityWithoutRelationships, resolveScene, resolveSceneAtTime } from '../src/domain/resolver.ts';
import { sampleProject } from '../src/domain/sampleProject.ts';
import { applyTransaction, revertTransaction } from '../src/domain/transactions.ts';
import type { ActionBlock, Relationship, Transaction } from '../src/domain/types.ts';
import { validateAndMigrateProject } from '../src/domain/validation.ts';
import { buildComfyViewUrl, createConnectionTestWorkflow, detectPotentialPaidNodes, extractComfyOutputs, normalizeComfyServerUrl, replaceWorkflowPlaceholders, validateWorkflow } from '../src/domain/comfyui.ts';
import { analyzeScenePrompt, buildSceneFromPlan, generateSceneFromPrompt } from '../src/domain/sceneGenerator.ts';
import { assetWithModel, createAssetLibraryItem, validateGlbBlob } from '../src/domain/assets.ts';
import { deleteAssetBlob, getAssetBlob, listAssetStorageKeys, saveAssetBlob } from '../src/domain/assetStorage.ts';
import { relayoutSceneEntities, replaceEnvironmentPreset } from '../src/domain/environmentLayout.ts';
import { analyzeGlbRig, applyHumanoidPoseToObject, collectHumanoidJointPositions, mapHumanoidBones, rebuildHumanoidRigProfile } from '../src/domain/rigging.ts';
import { createProjectBundle, importProjectBundle, readStoredZip } from '../src/domain/projectBundle.ts';
import { Euler, Group, Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import { collectActionConflicts, findActionConflicts } from '../src/domain/actions.ts';
import { createAsyncResourceCache } from '../src/domain/resourceCache.ts';
import { clearRecoverySnapshots, createRecoverySnapshot, latestRecoverySnapshot, listRecoverySnapshots, saveRecoverySnapshot, verifyRecoverySnapshot } from '../src/domain/recovery.ts';
import { dataUrlToBlob } from '../src/domain/referenceImages.ts';
import { buildStorageCleanupPlan, cleanupUnusedAssetBlobs, clearProjectStorageRegistry, collectReferencedStorageKeys, registerProjectStorageReferences } from '../src/domain/storageCleanup.ts';
import { evaluateRuntimeCapabilities, resolveRenderQuality, viewportQualitySettings } from '../src/domain/runtimeDiagnostics.ts';
import { analyzeProjectHealth, repairProjectSafely } from '../src/domain/projectDoctor.ts';
import { buildVisualSnapshot } from '../src/domain/visualSnapshot.ts';
import { createSupportBundle } from '../src/domain/supportBundle.ts';
import { evaluateReleaseQualification } from '../src/domain/releaseQualification.ts';
import { validatePlatformReleaseEvidence, validateReleaseEvidenceMatrix } from '../src/domain/releaseEvidence.ts';
import { analyzeDirectorWorkflow, analyzeShotReadiness, buildFirstEditPlan } from '../src/domain/directorWorkflow.ts';
import { buildCommandCatalog, searchCommands } from '../src/domain/commandPalette.ts';
import { appendCreatorSessionEvent, createCreatorSession, sanitizeSessionMetadata, summarizeCreatorSession } from '../src/domain/sessionInsights.ts';
import { computeFrontViewFrame } from '../src/domain/viewFraming.ts';
import { buildShotExportPreflight } from '../src/domain/shotExportPreflight.ts';


function createRiggedGlbBlob(nodeNames: string[], animationNames: string[] = []): Blob {
  const json = {
    asset: { version: '2.0', generator: 'AI Scene Director Test' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: nodeNames.map((name, index) => ({ name, children: index + 1 < nodeNames.length ? [index + 1] : undefined })),
    skins: [{ joints: nodeNames.map((_, index) => index), skeleton: 0 }],
    animations: animationNames.map((name) => ({ name, channels: [], samplers: [] })),
  };
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const paddedLength = Math.ceil(encoded.length / 4) * 4;
  const totalLength = 12 + 8 + paddedLength;
  const bytes = new Uint8Array(totalLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, paddedLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, totalLength);
  bytes.set(encoded, 20);
  return new Blob([bytes], { type: 'model/gltf-binary' });
}

const MIXAMO_BONES = [
  'mixamorig:Hips', 'mixamorig:Spine', 'mixamorig:Spine2', 'mixamorig:Neck', 'mixamorig:Head',
  'mixamorig:LeftShoulder', 'mixamorig:LeftArm', 'mixamorig:LeftForeArm', 'mixamorig:LeftHand',
  'mixamorig:RightShoulder', 'mixamorig:RightArm', 'mixamorig:RightForeArm', 'mixamorig:RightHand',
  'mixamorig:LeftUpLeg', 'mixamorig:LeftLeg', 'mixamorig:LeftFoot',
  'mixamorig:RightUpLeg', 'mixamorig:RightLeg', 'mixamorig:RightFoot',
];

function cloneSample() {
  return structuredClone(sampleProject);
}

function relationship(type: Relationship['type'], sourceEntityId: string, targetEntityId: string, parameters: Relationship['parameters'] = {}): Relationship {
  return { id: `rel-${type}`, type, sourceEntityId, targetEntityId, parameters, active: true };
}

test('Shot Override는 다른 Shot의 Entity 상태를 변경하지 않는다', () => {
  const project = cloneSample();
  const transaction: Transaction = {
    id: 'tx-test', title: '지윤 이동', createdAt: new Date().toISOString(),
    operations: [{
      type: 'updateEntity', sceneId: 'scene-001', shotId: 'shot-001', entityId: 'character-a',
      path: 'transform.position', previousValue: [-1, 0, 0], nextValue: [2, 0, 0],
    }],
  };
  const changed = applyTransaction(project, transaction);
  assert.deepEqual(resolveEntity(changed.scenes[0], changed.scenes[0].shots[0], 'character-a').transform.position, [2, 0, 0]);
  assert.deepEqual(resolveEntity(changed.scenes[0], changed.scenes[0].shots[1], 'character-a').transform.position, [-1, 0, 0]);
  const reverted = revertTransaction(changed, transaction);
  assert.equal(reverted.scenes[0].shots[0].overrides.length, 0);
});

test('잠긴 Entity에는 Shot Override를 적용할 수 없다', () => {
  const project = cloneSample();
  project.scenes[0].entities[0].locked = true;
  const transaction: Transaction = {
    id: 'tx-lock', title: '잠긴 지윤 이동', createdAt: new Date().toISOString(),
    operations: [{
      type: 'updateEntity', sceneId: 'scene-001', shotId: 'shot-001', entityId: 'character-a',
      path: 'transform.position', previousValue: [-1, 0, 0], nextValue: [0, 0, 0],
    }],
  };
  assert.throws(() => applyTransaction(project, transaction), /locked/);
});

test('0.5 프로젝트를 최신 스키마로 변환한다', () => {
  const legacy = cloneSample() as unknown as Record<string, unknown>;
  legacy.schemaVersion = '0.5.0';
  const scenes = legacy.scenes as Array<Record<string, unknown>>;
  const shots = scenes[0].shots as Array<Record<string, unknown>>;
  shots.forEach((shot) => delete shot.actions);
  const result = validateAndMigrateProject(legacy);
  assert.equal(result.success, true);
  assert.equal(result.project?.schemaVersion, '1.0.0-rc.13');
  assert.deepEqual(result.project?.scenes[0].shots[0].actions, []);
  assert.equal(result.migrated, true);
});

test('잘못된 Transform과 카메라 참조를 거부한다', () => {
  const invalid = cloneSample();
  invalid.scenes[0].entities[0].transform.position = [Number.NaN, 0, 0];
  invalid.scenes[0].shots[0].cameraEntityId = 'missing-camera';
  const result = validateAndMigrateProject(invalid);
  assert.equal(result.success, false);
  assert.ok(result.errors.some((error) => error.includes('Entity 데이터')));
  assert.ok(result.errors.some((error) => error.includes('카메라')));
});

test('2-bone 손 IK가 목표점 근처로 손목을 이동시킨다', () => {
  const pose = cloneSample().scenes[0].entities[0].character!.pose;
  const target: [number, number, number] = [0.45, 1.25, -0.45];
  const solved = solveArmIK(pose, 'right', target);
  const hand = calculateHandLocalPosition(solved, 'right');
  const distance = Math.hypot(hand[0] - target[0], hand[1] - target[1], hand[2] - target[2]);
  assert.ok(distance < 0.03, `IK distance was ${distance}`);
});

test('hold 관계는 인물이 이동해도 소품을 손에 유지한다', () => {
  const project = cloneSample();
  const shot = project.scenes[0].shots[0];
  shot.relationships.push(relationship('hold', 'character-a', 'coffee-cup', { hand: 'right' }));
  const before = resolveScene(project.scenes[0], shot).find((entity) => entity.id === 'coffee-cup')!;
  shot.overrides.push({ id: 'move', entityId: 'character-a', path: 'transform.position', value: [1, 0, 0] });
  const after = resolveScene(project.scenes[0], shot).find((entity) => entity.id === 'coffee-cup')!;
  assert.ok(Math.abs((after.transform.position[0] - before.transform.position[0]) - 2) < 1e-6);
});

test('lookAt 관계는 대상 방향으로 머리를 회전한다', () => {
  const project = cloneSample();
  const shot = project.scenes[0].shots[0];
  shot.relationships.push(relationship('lookAt', 'character-a', 'character-b', { lookMode: 'head' }));
  const character = resolveEntity(project.scenes[0], shot, 'character-a');
  assert.ok(Math.abs(character.character!.pose.head[1]) > 0.2);
});

test('sitOn 관계는 인물을 의자 위에 배치하고 앉기 포즈를 적용한다', () => {
  const project = cloneSample();
  const shot = project.scenes[0].shots[0];
  shot.relationships.push(relationship('sitOn', 'character-a', 'chair-01', { alignRotation: true }));
  const character = resolveEntity(project.scenes[0], shot, 'character-a');
  const seated = findPosePreset('seated')!;
  assert.deepEqual(character.character!.pose, seated.pose);
  assert.ok(character.transform.position[1] > 0);
});

test('placeOn 관계는 소품을 대상 표면 위에 배치한다', () => {
  const project = cloneSample();
  const shot = project.scenes[0].shots[0];
  shot.relationships.push(relationship('placeOn', 'coffee-cup', 'table'));
  const cup = resolveEntity(project.scenes[0], shot, 'coffee-cup');
  const table = resolveEntity(project.scenes[0], shot, 'table');
  assert.ok(cup.transform.position[1] > table.transform.position[1] + table.transform.scale[1] / 2);
});

test('관계 Transaction은 현재 Shot에만 적용되고 Undo할 수 있다', () => {
  const project = cloneSample();
  const rel = relationship('lookAt', 'character-a', 'character-b');
  const transaction: Transaction = {
    id: 'tx-rel', title: '바라보기', createdAt: new Date().toISOString(),
    operations: [{ type: 'addRelationship', sceneId: 'scene-001', shotId: 'shot-001', relationship: rel }],
  };
  const changed = applyTransaction(project, transaction);
  assert.equal(changed.scenes[0].shots[0].relationships.length, 1);
  assert.equal(changed.scenes[0].shots[1].relationships.length, 0);
  const reverted = revertTransaction(changed, transaction);
  assert.equal(reverted.scenes[0].shots[0].relationships.length, 0);
});

test('Entity 삭제는 관련 관계를 제거하고 Undo 시 복원한다', () => {
  const project = cloneSample();
  const rel = relationship('hold', 'character-a', 'coffee-cup', { hand: 'right' });
  project.scenes[0].shots[0].relationships.push(rel);
  const cup = structuredClone(project.scenes[0].entities.find((entity) => entity.id === 'coffee-cup')!);
  const transaction: Transaction = {
    id: 'tx-delete', title: '컵 삭제', createdAt: new Date().toISOString(),
    operations: [{
      type: 'removeEntity', sceneId: 'scene-001', entity: cup,
      overridesByShot: { 'shot-001': [], 'shot-002': [] },
      relationshipsByShot: { 'shot-001': [rel], 'shot-002': [] },
      actionsByShot: { 'shot-001': [], 'shot-002': [] },
    }],
  };
  const changed = applyTransaction(project, transaction);
  assert.equal(changed.scenes[0].shots[0].relationships.length, 0);
  const reverted = revertTransaction(changed, transaction);
  assert.equal(reverted.scenes[0].shots[0].relationships.length, 1);
});


function action(input: Partial<ActionBlock> & Pick<ActionBlock, 'type' | 'actorEntityId'>): ActionBlock {
  return {
    id: `action-${input.type}`,
    type: input.type,
    actorEntityId: input.actorEntityId,
    targetEntityId: input.targetEntityId,
    startTime: input.startTime ?? 0,
    duration: input.duration ?? 2,
    parameters: input.parameters ?? {},
    enabled: input.enabled ?? true,
  };
}

test('walk 행동은 시간에 따라 인물을 이동시키고 다른 Shot에는 영향을 주지 않는다', () => {
  const project = cloneSample();
  const shot = project.scenes[0].shots[0];
  shot.actions.push(action({ type: 'walk', actorEntityId: 'character-a', duration: 2, parameters: { direction: [0, 0, -1], distance: 2 } }));
  const half = resolveEntity(project.scenes[0], shot, 'character-a', 1);
  const end = resolveEntity(project.scenes[0], shot, 'character-a', 2);
  assert.ok(half.transform.position[2] < -0.8 && half.transform.position[2] > -1.2);
  assert.ok(Math.abs(end.transform.position[2] + 2) < 1e-6);
  const otherShot = resolveEntity(project.scenes[0], project.scenes[0].shots[1], 'character-a', 2);
  assert.deepEqual(otherShot.transform.position, [-1, 0, 0]);
});

test('turnAround 행동은 종료 시 인물을 180도 회전한다', () => {
  const project = cloneSample();
  const shot = project.scenes[0].shots[0];
  shot.actions.push(action({ type: 'turnAround', actorEntityId: 'character-a', duration: 1, parameters: { angle: Math.PI } }));
  const end = resolveEntity(project.scenes[0], shot, 'character-a', 1);
  assert.ok(Math.abs(end.transform.rotation[1] - Math.PI) < 1e-6);
});

test('cameraDolly와 cameraOrbit 행동이 카메라 위치를 변경한다', () => {
  const project = cloneSample();
  const shot = project.scenes[0].shots[0];
  shot.actions.push(action({ type: 'cameraDolly', actorEntityId: 'camera-wide', targetEntityId: 'character-a', duration: 2, parameters: { distance: 2 } }));
  const dolly = resolveEntity(project.scenes[0], shot, 'camera-wide', 2);
  assert.ok(dolly.transform.position[2] < 8);
  shot.actions = [action({ type: 'cameraOrbit', actorEntityId: 'camera-wide', targetEntityId: 'character-a', duration: 2, parameters: { angle: Math.PI / 2 } })];
  const orbit = resolveEntity(project.scenes[0], shot, 'camera-wide', 2);
  assert.ok(Math.abs(orbit.transform.position[0]) > 3);
});

test('pickUp 행동 종료 후 소품이 손 관계로 전환된다', () => {
  const project = cloneSample();
  const shot = project.scenes[0].shots[0];
  shot.actions.push(action({ type: 'pickUp', actorEntityId: 'character-a', targetEntityId: 'coffee-cup', duration: 1, parameters: { hand: 'right' } }));
  const start = resolveEntity(project.scenes[0], shot, 'coffee-cup', 0);
  const middle = resolveEntity(project.scenes[0], shot, 'coffee-cup', 0.5);
  const endScene = resolveSceneAtTime(project.scenes[0], shot, 1);
  const end = endScene.find((entity) => entity.id === 'coffee-cup')!;
  assert.notDeepEqual(middle.transform.position, start.transform.position);
  assert.notDeepEqual(end.transform.position, start.transform.position);
});

test('pickUp 뒤 putDown 행동은 소품을 표면 위에 배치한다', () => {
  const project = cloneSample();
  const shot = project.scenes[0].shots[0];
  shot.duration = 4;
  shot.actions.push(
    action({ type: 'pickUp', actorEntityId: 'character-a', targetEntityId: 'coffee-cup', duration: 1, parameters: { hand: 'right' } }),
    action({ type: 'putDown', actorEntityId: 'character-a', targetEntityId: 'coffee-cup', startTime: 2, duration: 1, parameters: { hand: 'right', surfaceEntityId: 'table' } }),
  );
  const cup = resolveEntity(project.scenes[0], shot, 'coffee-cup', 3);
  const table = resolveEntity(project.scenes[0], shot, 'table', 3);
  assert.ok(cup.transform.position[1] > table.transform.position[1] + table.transform.scale[1] / 2);
  assert.ok(Math.abs(cup.transform.position[0] - table.transform.position[0]) < 1e-6);
});

test('행동 Transaction은 현재 Shot에만 적용되고 Undo할 수 있다', () => {
  const project = cloneSample();
  const block = action({ type: 'walk', actorEntityId: 'character-a', duration: 2, parameters: { distance: 1 } });
  const tx: Transaction = {
    id: 'tx-action', title: '걷기 추가', createdAt: new Date().toISOString(),
    operations: [{ type: 'addAction', sceneId: 'scene-001', shotId: 'shot-001', action: block }],
  };
  const changed = applyTransaction(project, tx);
  assert.equal(changed.scenes[0].shots[0].actions.length, 1);
  assert.equal(changed.scenes[0].shots[1].actions.length, 0);
  const reverted = revertTransaction(changed, tx);
  assert.equal(reverted.scenes[0].shots[0].actions.length, 0);
});

test('Entity 삭제는 관련 행동을 제거하고 Undo 시 복원한다', () => {
  const project = cloneSample();
  const block = action({ type: 'pickUp', actorEntityId: 'character-a', targetEntityId: 'coffee-cup', duration: 1 });
  project.scenes[0].shots[0].actions.push(block);
  const cup = structuredClone(project.scenes[0].entities.find((entity) => entity.id === 'coffee-cup')!);
  const tx: Transaction = {
    id: 'tx-delete-action', title: '컵 삭제', createdAt: new Date().toISOString(),
    operations: [{
      type: 'removeEntity', sceneId: 'scene-001', entity: cup,
      overridesByShot: { 'shot-001': [], 'shot-002': [] },
      relationshipsByShot: { 'shot-001': [], 'shot-002': [] },
      actionsByShot: { 'shot-001': [block], 'shot-002': [] },
    }],
  };
  const changed = applyTransaction(project, tx);
  assert.equal(changed.scenes[0].shots[0].actions.length, 0);
  const reverted = revertTransaction(changed, tx);
  assert.equal(reverted.scenes[0].shots[0].actions.length, 1);
});


test('Shot Package Manifest는 시작·종료 상태와 카메라를 포함한다', () => {
  const project = cloneSample();
  const scene = project.scenes[0];
  const shot = scene.shots[0];
  shot.actions.push(action({ type: 'walk', actorEntityId: 'character-a', duration: 2, parameters: { direction: [0, 0, -1], distance: 2 } }));
  const manifest = buildShotPackageManifest(project, scene, shot);
  assert.equal(manifest.schemaVersion, '1.0.0-rc.13');
  assert.equal(manifest.camera?.id, shot.cameraEntityId);
  const character = manifest.entities.find((entity) => entity.id === 'character-a')!;
  assert.notDeepEqual(character.start.transform.position, character.end.transform.position);
  assert.match(character.maskColor, /^hsl\(/);
});

test('Shot 프롬프트는 등장 객체와 행동을 설명한다', () => {
  const project = cloneSample();
  const scene = project.scenes[0];
  const shot = scene.shots[0];
  shot.actions.push(action({ type: 'turnAround', actorEntityId: 'character-a', duration: 1 }));
  assert.match(buildShotPrompt(scene, shot), /지윤/);
  assert.match(buildMotionPrompt(scene, shot), /뒤돌아보기/);
});

test('무압축 ZIP 생성기는 PK 헤더와 파일명을 포함한다', async () => {
  const zip = await createStoredZip([
    { name: 'shot_manifest.json', data: '{"ok":true}' },
    { name: 'prompts/scene_prompt.txt', data: 'scene' },
  ]);
  const bytes = new Uint8Array(await zip.arrayBuffer());
  assert.deepEqual(Array.from(bytes.slice(0, 4)), [0x50, 0x4b, 0x03, 0x04]);
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /shot_manifest\.json/);
  assert.match(text, /scene_prompt\.txt/);
});


test('0.6 프로젝트는 generationResults를 추가해 0.7로 마이그레이션한다', () => {
  const legacy = cloneSample() as unknown as Record<string, unknown>;
  legacy.schemaVersion = '0.6.0';
  const scenes = legacy.scenes as Array<Record<string, unknown>>;
  const shots = scenes[0].shots as Array<Record<string, unknown>>;
  delete shots[0].generationResults;
  const result = validateAndMigrateProject(legacy);
  assert.equal(result.success, true);
  assert.equal(result.project?.schemaVersion, '1.0.0-rc.13');
  assert.deepEqual(result.project?.scenes[0].shots[0].generationResults, []);
});

test('ComfyUI URL과 view URL을 안전하게 구성한다', () => {
  assert.equal(normalizeComfyServerUrl('127.0.0.1:8188/'), 'http://127.0.0.1:8188');
  const url = buildComfyViewUrl('http://127.0.0.1:8188', { filename: 'a b.png', subfolder: 'aisd', type: 'output' });
  assert.match(url, /filename=a(?:\+|%20)b\.png/);
  assert.match(url, /subfolder=aisd/);
});

test('워크플로 자리표시자는 문자열과 숫자를 치환한다', () => {
  const workflow = {
    '1': { class_type: 'LoadImage', inputs: { image: '__AISD_START_FRAME__' } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: '장면: __AISD_SCENE_PROMPT__' } },
    '3': { class_type: 'PrimitiveNode', inputs: { value: '__AISD_SEED__' } },
  };
  const compiled = replaceWorkflowPlaceholders(workflow, {
    __AISD_START_FRAME__: 'ai_scene/start.png',
    __AISD_SCENE_PROMPT__: '카페 대화',
    __AISD_SEED__: 1234,
  });
  assert.equal(compiled['1'].inputs.image, 'ai_scene/start.png');
  assert.equal(compiled['2'].inputs.text, '장면: 카페 대화');
  assert.equal(compiled['3'].inputs.value, 1234);
  assert.equal(validateWorkflow(compiled).valid, true);
});

test('연결 테스트 워크플로는 LoadImage와 PreviewImage를 포함한다', () => {
  const workflow = createConnectionTestWorkflow('aisd/start.png');
  assert.equal(workflow['1'].class_type, 'LoadImage');
  assert.equal(workflow['1'].inputs.image, 'aisd/start.png');
  assert.deepEqual(workflow['2'].inputs.images, ['1', 0]);
});

test('잠재적 유료 API 노드를 감지한다', () => {
  const findings = detectPotentialPaidNodes({
    '1': { class_type: 'LoadImage', inputs: {} },
    '2': { class_type: 'KlingVideoAPINode', inputs: {} },
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].nodeId, '2');
});

test('ComfyUI history에서 이미지와 영상 출력 메타데이터를 추출한다', () => {
  const outputs = extractComfyOutputs({
    prompt123: {
      outputs: {
        '9': { images: [{ filename: 'result.png', subfolder: '', type: 'output' }] },
        '10': { videos: [{ filename: 'result.mp4', subfolder: 'video', type: 'output' }] },
      },
    },
  }, 'prompt123', 'http://127.0.0.1:8188');
  assert.equal(outputs.length, 2);
  assert.equal(outputs[0].kind, 'image');
  assert.equal(outputs[1].kind, 'video');
  assert.match(outputs[1].url, /result\.mp4/);
});

test('ComfyUI 생성 결과 Transaction은 Shot에 등록되고 Undo된다', () => {
  const project = cloneSample();
  const result = {
    id: 'result-1', provider: 'comfyui' as const, serverUrl: 'http://127.0.0.1:8188', promptId: 'prompt-1',
    workflowName: 'test', createdAt: new Date().toISOString(),
    outputs: [{ nodeId: '9', filename: 'result.png', subfolder: '', type: 'output', kind: 'image' as const }],
  };
  const tx: Transaction = { id: 'tx-result', title: '결과 등록', createdAt: new Date().toISOString(), operations: [
    { type: 'addGenerationResult', sceneId: 'scene-001', shotId: 'shot-001', result },
  ] };
  const changed = applyTransaction(project, tx);
  assert.equal(changed.scenes[0].shots[0].generationResults.length, 1);
  assert.equal(changed.scenes[0].shots[1].generationResults.length, 0);
  const reverted = revertTransaction(changed, tx);
  assert.equal(reverted.scenes[0].shots[0].generationResults.length, 0);
});


const GENERATOR_EXAMPLE = '비 오는 밤의 편의점 앞이다. 검은 코트를 입은 여성과 교복을 입은 남학생이 마주 보고 있다. 여성은 우산을 들고 있고 남학생은 자전거 옆에 서 있다. 처음에는 두 사람이 함께 보이는 와이드 샷, 다음은 여성의 얼굴 클로즈업, 마지막에는 남학생이 자전거를 타고 떠나는 트래킹 샷으로 만들어줘.';

test('자연어 씬 분석은 인물·소품·샷 순서를 추출한다', () => {
  const plan = analyzeScenePrompt(GENERATOR_EXAMPLE);
  assert.equal(plan.location, '편의점 앞');
  assert.deepEqual(plan.characters.map((character) => character.name), ['검은 코트를 입은 여성', '교복을 입은 남학생']);
  assert.deepEqual(plan.props.map((prop) => prop.name), ['우산', '자전거']);
  assert.deepEqual(plan.shots.map((shot) => shot.kind), ['wide', 'closeUp', 'tracking']);
  assert.equal(plan.shots[1].subjectCharacterIndex, 0);
  assert.equal(plan.shots[2].subjectCharacterIndex, 1);
});

test('샷 설명이 없으면 와이드·미디엄·클로즈업 기본 구성을 만든다', () => {
  const plan = analyzeScenePrompt('카페에서 여성과 남성이 커피를 마시며 대화한다.');
  assert.deepEqual(plan.shots.map((shot) => shot.kind), ['wide', 'medium', 'closeUp']);
  assert.ok(plan.warnings.some((warning) => warning.includes('기본 구성')));
});

test('자연어 생성 Scene은 인물·소품·카메라·조명을 편집 가능한 Entity로 만든다', () => {
  const { plan, scene } = generateSceneFromPrompt(GENERATOR_EXAMPLE, 'scene-001');
  assert.equal(scene.id, 'scene-001');
  assert.equal(scene.description, GENERATOR_EXAMPLE);
  assert.equal(scene.entities.filter((entity) => entity.type === 'character').length, plan.characters.length);
  assert.equal(scene.entities.filter((entity) => entity.type === 'camera').length, plan.shots.length);
  assert.equal(scene.entities.filter((entity) => entity.type === 'light').length, 2);
  assert.equal(scene.shots.length, 3);
});

test('마주 보기·소품 들기·떠나기 연출을 관계와 Action으로 변환한다', () => {
  const { scene } = generateSceneFromPrompt(GENERATOR_EXAMPLE, 'scene-001');
  const firstShot = scene.shots[0];
  const lastShot = scene.shots.at(-1)!;
  assert.equal(firstShot.relationships.filter((relationship) => relationship.type === 'lookAt').length, 2);
  assert.equal(firstShot.relationships.filter((relationship) => relationship.type === 'hold').length, 1);
  assert.ok(lastShot.actions.some((action) => action.type === 'walk'));
  assert.ok(lastShot.actions.some((action) => action.type === 'cameraDolly'));
});

test('문장 앞의 고유 이름 두 명을 캐릭터 이름으로 사용한다', () => {
  const plan = analyzeScenePrompt('지윤과 민수가 카페에서 테이블을 사이에 두고 대화한다.');
  assert.deepEqual(plan.characters.map((character) => character.name), ['지윤', '민수']);
  assert.ok(plan.props.some((prop) => prop.name === '테이블'));
});

test('replaceScene Transaction은 전체 자동 생성 Scene을 적용하고 Undo한다', () => {
  const project = cloneSample();
  const previousScene = structuredClone(project.scenes[0]);
  const plan = analyzeScenePrompt(GENERATOR_EXAMPLE);
  const nextScene = buildSceneFromPlan(plan, previousScene.id);
  const tx: Transaction = {
    id: 'tx-replace-scene',
    title: '자연어 씬 생성',
    createdAt: new Date().toISOString(),
    operations: [{ type: 'replaceScene', sceneId: previousScene.id, previousScene, nextScene }],
  };
  const changed = applyTransaction(project, tx);
  assert.equal(changed.scenes[0].shots.length, 3);
  assert.equal(changed.scenes[0].description, GENERATOR_EXAMPLE);
  const reverted = revertTransaction(changed, tx);
  assert.deepEqual(reverted.scenes[0], previousScene);
});

test('0.7 프로젝트는 0.10으로 마이그레이션되고 Scene 설명을 보존한다', () => {
  const legacy = cloneSample() as unknown as Record<string, unknown>;
  legacy.schemaVersion = '0.7.0';
  const scenes = legacy.scenes as Array<Record<string, unknown>>;
  scenes[0].description = '테스트 장면 설명';
  const result = validateAndMigrateProject(legacy);
  assert.equal(result.success, true);
  assert.equal(result.project?.schemaVersion, '1.0.0-rc.13');
  assert.equal(result.project?.scenes[0].description, '테스트 장면 설명');
});


test('편의점 문장은 편의점 외부 프리셋과 자동 배경 에셋을 선택한다', () => {
  const plan = analyzeScenePrompt(GENERATOR_EXAMPLE);
  assert.equal(plan.environmentPreset.id, 'convenience-exterior');
  assert.ok(plan.autoProps.some((prop) => prop.name === '편의점 외벽'));
  assert.ok(plan.autoProps.some((prop) => prop.name === '젖은 보도'));
});

test('인물 설명에서 역할·연령·의상 메타데이터를 구조화한다', () => {
  const plan = analyzeScenePrompt(GENERATOR_EXAMPLE);
  assert.equal(plan.characters[0].role, 'lead');
  assert.equal(plan.characters[0].outfitSummary, '검은 코트');
  assert.equal(plan.characters[1].role, 'supporting');
  assert.equal(plan.characters[1].ageGroup, 'teen');
  assert.equal(plan.characters[1].outfitSummary, '교복');
});

test('생성 Scene은 환경 프리셋·에셋 출처·인물 외형을 보존한다', () => {
  const { scene } = generateSceneFromPrompt(GENERATOR_EXAMPLE, 'scene-001');
  assert.equal(scene.environment.presetId, 'convenience-exterior');
  const wall = scene.entities.find((entity) => entity.name === '편의점 외벽');
  assert.equal(wall?.asset?.source, 'preset');
  assert.equal(wall?.asset?.category, 'architecture');
  const lead = scene.entities.find((entity) => entity.type === 'character');
  assert.equal(lead?.character?.appearance.outfitSummary, '검은 코트');
});

test('0.8 프로젝트는 환경·외형·에셋 메타데이터를 추가해 0.10으로 변환한다', () => {
  const legacy = cloneSample() as unknown as Record<string, unknown>;
  legacy.schemaVersion = '0.8.0';
  const scenes = legacy.scenes as Array<Record<string, unknown>>;
  delete scenes[0].environment;
  const entities = scenes[0].entities as Array<Record<string, unknown>>;
  delete entities[0].asset;
  const character = entities[0].character as Record<string, unknown>;
  delete character.appearance;
  const result = validateAndMigrateProject(legacy);
  assert.equal(result.success, true);
  assert.equal(result.project?.schemaVersion, '1.0.0-rc.13');
  assert.ok(result.project?.scenes[0].environment);
  assert.ok(result.project?.scenes[0].entities[0].asset);
  assert.ok(result.project?.scenes[0].entities[0].character?.appearance);
});


test('0.9 프로젝트는 빈 GLB 에셋 라이브러리를 추가해 0.10으로 변환한다', () => {
  const legacy = cloneSample() as unknown as Record<string, unknown>;
  legacy.schemaVersion = '0.9.0';
  delete legacy.assetLibrary;
  const result = validateAndMigrateProject(legacy);
  assert.equal(result.success, true);
  assert.equal(result.project?.schemaVersion, '1.0.0-rc.13');
  assert.deepEqual(result.project?.assetLibrary, []);
});

test('GLB 에셋 적용은 Transform·Shot Override·관계를 유지한다', () => {
  const project = cloneSample();
  const item = createAssetLibraryItem({
    id: 'asset-chair', name: '고급 의자', originalFilename: 'chair.glb', sizeBytes: 2048,
    category: 'prop', createdAt: '2026-07-12T00:00:00.000Z',
  });
  project.scenes[0].shots[0].overrides.push({
    id: 'shot-001:chair-01:transform.position', entityId: 'chair-01', path: 'transform.position', value: [-2, 0.45, 1.2],
  });
  project.scenes[0].shots[0].relationships.push(relationship('sitOn', 'character-a', 'chair-01'));
  const chair = project.scenes[0].entities.find((entity) => entity.id === 'chair-01')!;
  const originalTransform = structuredClone(chair.transform);
  const tx: Transaction = {
    id: 'tx-asset-apply', title: 'GLB 적용', createdAt: new Date().toISOString(), operations: [
      { type: 'addAssetLibraryItem', item },
      { type: 'updateEntityAsset', sceneId: 'scene-001', entityId: 'chair-01', previousAsset: structuredClone(chair.asset), nextAsset: assetWithModel(chair.asset, item.id) },
    ],
  };
  const changed = applyTransaction(project, tx);
  const changedChair = changed.scenes[0].entities.find((entity) => entity.id === 'chair-01')!;
  assert.equal(changedChair.asset?.modelAssetId, item.id);
  assert.deepEqual(changedChair.transform, originalTransform);
  assert.equal(changed.scenes[0].shots[0].overrides.length, 1);
  assert.equal(changed.scenes[0].shots[0].relationships.length, 1);
  const reverted = revertTransaction(changed, tx);
  assert.equal(reverted.assetLibrary.length, 0);
  assert.equal(reverted.scenes[0].entities.find((entity) => entity.id === 'chair-01')?.asset?.modelAssetId, undefined);
});

test('GLB 에셋 제거는 연결을 해제하고 Undo 시 복원한다', () => {
  const project = cloneSample();
  const item = createAssetLibraryItem({ id: 'asset-cup', name: '컵 GLB', originalFilename: 'cup.glb', sizeBytes: 1024, category: 'prop', createdAt: '2026-07-12T00:00:00.000Z' });
  project.assetLibrary.push(item);
  const cup = project.scenes[0].entities.find((entity) => entity.id === 'coffee-cup')!;
  cup.asset = assetWithModel(cup.asset, item.id);
  const tx: Transaction = {
    id: 'tx-remove-asset', title: '에셋 제거', createdAt: new Date().toISOString(), operations: [{
      type: 'removeAssetLibraryItem', item,
      previousEntityAssets: [{ sceneId: 'scene-001', entityId: cup.id, asset: structuredClone(cup.asset) }],
    }],
  };
  const changed = applyTransaction(project, tx);
  assert.equal(changed.assetLibrary.length, 0);
  assert.equal(changed.scenes[0].entities.find((entity) => entity.id === cup.id)?.asset?.modelAssetId, undefined);
  const reverted = revertTransaction(changed, tx);
  assert.equal(reverted.assetLibrary.length, 1);
  assert.equal(reverted.scenes[0].entities.find((entity) => entity.id === cup.id)?.asset?.modelAssetId, item.id);
});

test('환경 프리셋 교체는 인물·Shot Override를 유지하고 호환 표면 관계를 재연결한다', () => {
  const scene = structuredClone(sampleProject.scenes[0]);
  scene.shots[0].overrides.push({ id: 'shot-001:character-a:transform.position', entityId: 'character-a', path: 'transform.position', value: [-2, 0, 0] });
  scene.shots[0].relationships.push(relationship('placeOn', 'coffee-cup', 'table'));
  const changed = replaceEnvironmentPreset(scene, 'kitchen', false);
  assert.equal(changed.environment.presetId, 'kitchen');
  assert.ok(changed.entities.some((entity) => entity.id === 'character-a'));
  assert.ok(changed.shots[0].overrides.some((override) => override.entityId === 'character-a'));
  const place = changed.shots[0].relationships.find((item) => item.type === 'placeOn');
  assert.ok(place);
  assert.notEqual(place?.targetEntityId, 'table');
  assert.ok(changed.entities.some((entity) => entity.id === place?.targetEntityId));
});

test('장면 재배치는 인원수에 따라 캐릭터를 분산하고 카메라를 중심으로 향하게 한다', () => {
  const scene = structuredClone(sampleProject.scenes[0]);
  scene.entities.push(structuredClone({ ...scene.entities[0], id: 'character-c', name: '서준', transform: { ...scene.entities[0].transform, position: [9, 0, 9] } }));
  const changed = relayoutSceneEntities(scene);
  const characters = changed.entities.filter((entity) => entity.type === 'character');
  assert.equal(new Set(characters.map((entity) => entity.transform.position.join(','))).size, 3);
  const camera = changed.entities.find((entity) => entity.type === 'camera')!;
  assert.ok(camera.transform.position[2] > 5);
  assert.notDeepEqual(camera.transform.rotation, [0, 0, 0]);
});


test('GLB 헤더 검증은 glTF 2.0 바이너리만 허용한다', async () => {
  const validHeader = new ArrayBuffer(12);
  const view = new DataView(validHeader);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, 12, true);
  assert.equal((await validateGlbBlob(new Blob([validHeader]))).valid, true);
  assert.equal((await validateGlbBlob(new Blob(['not glb']))).valid, false);
});

test('로컬 에셋 저장소는 GLB Blob을 저장·복원·삭제한다', async () => {
  const key = 'test:asset-storage';
  const blob = new Blob(['glb-data'], { type: 'model/gltf-binary' });
  await saveAssetBlob(key, blob);
  const restored = await getAssetBlob(key);
  assert.ok(restored);
  assert.equal(await restored?.text(), 'glb-data');
  await deleteAssetBlob(key);
  assert.equal(await getAssetBlob(key), null);
});


test('GLB Skeleton 분석은 Mixamo 본을 17개 휴머노이드 관절에 매핑한다', async () => {
  const rig = await analyzeGlbRig(createRiggedGlbBlob(MIXAMO_BONES, ['Idle', 'Walk']));
  assert.equal(rig.status, 'humanoid');
  assert.equal(rig.detectedPreset, 'mixamo');
  assert.equal(rig.skeletonCount, 1);
  assert.equal(rig.mappedJointCount, 17);
  assert.equal(rig.boneMap.pelvis, 'mixamorig:Hips');
  assert.equal(rig.boneMap.leftShoulder, 'mixamorig:LeftArm');
  assert.equal(rig.boneMap.rightWrist, 'mixamorig:RightHand');
  assert.deepEqual(rig.animationClips, ['Idle', 'Walk']);
});

test('본 이름 자동 매핑은 접두사와 좌우 표기를 정규화한다', () => {
  const map = mapHumanoidBones(['Armature_LeftShoulder', 'Armature_LeftForeArm', 'Armature_LeftHand', 'Head']);
  assert.equal(map.leftShoulder, 'Armature_LeftShoulder');
  assert.equal(map.leftElbow, 'Armature_LeftForeArm');
  assert.equal(map.leftWrist, 'Armature_LeftHand');
  assert.equal(map.head, 'Head');
});

test('기본 포즈 리타기팅은 매핑된 GLB 본의 Rest Quaternion에 회전을 더한다', async () => {
  const rig = await analyzeGlbRig(createRiggedGlbBlob(MIXAMO_BONES));
  const root = new Group();
  for (const name of MIXAMO_BONES) {
    const bone = new Object3D();
    bone.name = name;
    root.add(bone);
  }
  const pose = structuredClone(sampleProject.scenes[0].entities[0].character!.pose);
  pose.rightShoulder = [0.5, 0.2, -0.1];
  const applied = applyHumanoidPoseToObject(root, rig, pose);
  assert.equal(applied, 17);
  const shoulder = root.getObjectByName('mixamorig:RightArm')!;
  assert.ok(Math.abs(shoulder.quaternion.x) > 0.1);
  pose.rightShoulder = [0, 0, 0];
  applyHumanoidPoseToObject(root, rig, pose);
  assert.ok(Math.abs(shoulder.quaternion.x) < 1e-6);
});

test('에셋 리그 정보 갱신 Transaction은 Undo로 이전 분석을 복원한다', async () => {
  const project = cloneSample();
  const item = createAssetLibraryItem({ id: 'asset-rig', name: '인물', originalFilename: 'person.glb', sizeBytes: 1000, category: 'character', createdAt: '2026-07-12T00:00:00.000Z' });
  project.assetLibrary.push(item);
  const rig = await analyzeGlbRig(createRiggedGlbBlob(MIXAMO_BONES));
  const nextItem = { ...structuredClone(item), rig };
  const tx: Transaction = { id: 'tx-rig', title: '리그 갱신', createdAt: new Date().toISOString(), operations: [{ type: 'updateAssetLibraryItem', previousItem: item, nextItem }] };
  const changed = applyTransaction(project, tx);
  assert.equal(changed.assetLibrary[0].rig?.mappedJointCount, 17);
  const reverted = revertTransaction(changed, tx);
  assert.equal(reverted.assetLibrary[0].rig, undefined);
});

test('프로젝트 번들은 project.json과 로컬 GLB를 함께 저장하고 복원한다', async () => {
  const project = cloneSample();
  const glb = createRiggedGlbBlob(MIXAMO_BONES);
  const rig = await analyzeGlbRig(glb);
  const item = createAssetLibraryItem({ id: 'asset-bundle-character', name: '번들 인물', originalFilename: 'character.glb', sizeBytes: glb.size, category: 'character', createdAt: '2026-07-12T00:00:00.000Z', rig });
  project.assetLibrary.push(item);
  await saveAssetBlob(item.storageKey, glb);
  const exported = await createProjectBundle(project);
  assert.deepEqual(exported.missingAssetIds, []);
  const files = await readStoredZip(exported.blob);
  assert.ok(files.has('project.json'));
  assert.ok([...files.keys()].some((name) => name.endsWith('/character.glb')));
  await deleteAssetBlob(item.storageKey);
  const imported = await importProjectBundle(exported.blob);
  assert.deepEqual(imported.restoredAssetIds, [item.id]);
  assert.equal(imported.project.schemaVersion, '1.0.0-rc.13');
  const restored = await getAssetBlob(item.storageKey);
  assert.equal(restored?.size, glb.size);
});

test('프로젝트 번들은 누락된 로컬 GLB를 명시하고 프로젝트는 유지한다', async () => {
  const project = cloneSample();
  const item = createAssetLibraryItem({ id: 'asset-missing-bundle', name: '누락', originalFilename: 'missing.glb', sizeBytes: 100, category: 'prop', createdAt: '2026-07-12T00:00:00.000Z' });
  project.assetLibrary.push(item);
  await deleteAssetBlob(item.storageKey);
  const exported = await createProjectBundle(project);
  assert.deepEqual(exported.missingAssetIds, [item.id]);
  const imported = await importProjectBundle(exported.blob);
  assert.deepEqual(imported.missingAssetIds, [item.id]);
  assert.ok(imported.project.assetLibrary.some((asset) => asset.id === item.id));
});

test('0.10 프로젝트는 에셋 라이브러리를 보존하며 0.11로 변환한다', () => {
  const legacy = cloneSample();
  legacy.schemaVersion = '0.10.0';
  const result = validateAndMigrateProject(legacy);
  assert.equal(result.success, true);
  assert.equal(result.project?.schemaVersion, '1.0.0-rc.13');
});

test('수동 본 매핑은 중복 본을 제거하고 상태·누락 관절을 다시 계산한다', async () => {
  const rig = await analyzeGlbRig(createRiggedGlbBlob(MIXAMO_BONES));
  const remapped = rebuildHumanoidRigProfile(rig, {
    pelvis: 'mixamorig:Hips',
    head: 'mixamorig:Hips',
    leftShoulder: 'mixamorig:LeftArm',
    leftElbow: 'mixamorig:LeftForeArm',
    leftWrist: 'mixamorig:LeftHand',
    rightShoulder: 'mixamorig:RightArm',
    rightElbow: 'mixamorig:RightForeArm',
    rightWrist: 'mixamorig:RightHand',
  }, { rightShoulder: [0, 0, Math.PI / 2] });
  assert.equal(remapped.boneMap.pelvis, 'mixamorig:Hips');
  assert.equal(remapped.boneMap.head, undefined);
  assert.equal(remapped.mappedJointCount, 7);
  assert.equal(remapped.status, 'partial');
  assert.deepEqual(remapped.axisCorrections.rightShoulder, [0, 0, Math.PI / 2]);
});

test('본 축 보정은 에디터 회전 축을 GLB 본 로컬 축으로 변환한다', async () => {
  const rig = await analyzeGlbRig(createRiggedGlbBlob(MIXAMO_BONES));
  rig.axisCorrections.rightShoulder = [0, 0, Math.PI / 2];
  const root = new Group();
  for (const name of MIXAMO_BONES) {
    const bone = new Object3D();
    bone.name = name;
    root.add(bone);
  }
  const pose = structuredClone(sampleProject.scenes[0].entities[0].character!.pose);
  pose.rightShoulder = [0.6, 0, 0];
  applyHumanoidPoseToObject(root, rig, pose);
  const shoulder = root.getObjectByName('mixamorig:RightArm')!;
  assert.ok(Math.abs(shoulder.quaternion.y) > 0.15);
  assert.ok(Math.abs(shoulder.quaternion.x) < 0.05);
});

test('GLB 관절 위치 수집은 매핑된 본의 로컬 위치를 반환한다', async () => {
  const rig = await analyzeGlbRig(createRiggedGlbBlob(MIXAMO_BONES));
  const root = new Group();
  const chest = new Object3D();
  chest.name = 'mixamorig:Spine2';
  chest.position.set(0, 1.2, 0);
  const arm = new Object3D();
  arm.name = 'mixamorig:RightArm';
  arm.position.set(0.3, 0.15, 0);
  chest.add(arm);
  root.add(chest);
  const positions = collectHumanoidJointPositions(root, rig);
  assert.ok(positions.chest);
  assert.ok(positions.rightShoulder);
  assert.ok(Math.abs(positions.rightShoulder![0] - 0.3) < 1e-6);
  assert.ok(Math.abs(positions.rightShoulder![1] - 1.35) < 1e-6);
});

test('신체 비율 기반 팔 IK는 긴 팔 모델에서도 목표점에 도달한다', () => {
  const pose = structuredClone(sampleProject.scenes[0].entities[0].character!.pose);
  const proportions = {
    referenceHeight: 2,
    leftArm: { shoulderOffset: [-0.42, 0.2, 0] as [number, number, number], upperLength: 0.48, lowerLength: 0.46 },
    rightArm: { shoulderOffset: [0.42, 0.2, 0] as [number, number, number], upperLength: 0.48, lowerLength: 0.46 },
  };
  const target: [number, number, number] = [0.7, 1.25, -0.45];
  const solved = solveArmIK(pose, 'right', target, proportions);
  const hand = calculateHandLocalPosition(solved, 'right', proportions);
  const distance = Math.hypot(hand[0] - target[0], hand[1] - target[1], hand[2] - target[2]);
  assert.ok(distance < 0.04, `proportion IK distance was ${distance}`);
});

test('0.11 리그 데이터는 축 보정 기본값을 추가해 0.12로 변환한다', async () => {
  const legacy = cloneSample();
  legacy.schemaVersion = '0.11.0';
  const rig = await analyzeGlbRig(createRiggedGlbBlob(MIXAMO_BONES));
  const legacyRig = structuredClone(rig) as unknown as Record<string, unknown>;
  delete legacyRig.axisCorrections;
  legacy.assetLibrary.push({
    id: 'asset-legacy-rig', name: '구 리그', kind: 'glb', category: 'character', mimeType: 'model/gltf-binary',
    sizeBytes: 10, storageKey: 'legacy', createdAt: '2026-07-12T00:00:00.000Z', originalFilename: 'legacy.glb',
    rig: legacyRig as never,
  });
  const result = validateAndMigrateProject(legacy);
  assert.equal(result.success, true);
  assert.equal(result.project?.schemaVersion, '1.0.0-rc.13');
  assert.deepEqual(result.project?.assetLibrary[0].rig?.axisCorrections, {});
});


test('2-bone 다리 IK는 체형 비율을 사용해 발목을 목표점으로 이동시킨다', () => {
  const pose = structuredClone(sampleProject.scenes[0].entities[0].character!.pose);
  const proportions = {
    referenceHeight: 2,
    pelvisHeight: 1.02,
    leftArm: { shoulderOffset: [-0.4, 0.2, 0] as [number, number, number], upperLength: 0.45, lowerLength: 0.43 },
    rightArm: { shoulderOffset: [0.4, 0.2, 0] as [number, number, number], upperLength: 0.45, lowerLength: 0.43 },
    leftLeg: { hipOffset: [-0.19, -0.08, 0] as [number, number, number], upperLength: 0.5, lowerLength: 0.48, footLength: 0.31 },
    rightLeg: { hipOffset: [0.19, -0.08, 0] as [number, number, number], upperLength: 0.5, lowerLength: 0.48, footLength: 0.31 },
  };
  const target: [number, number, number] = [-0.22, 0.12, -0.36];
  const solved = solveLegIK(pose, 'left', target, proportions);
  const ankle = calculateAnkleLocalPosition(solved, 'left', proportions);
  const distance = Math.hypot(ankle[0] - target[0], ankle[1] - target[1], ankle[2] - target[2]);
  assert.ok(distance < 0.04, `leg IK distance was ${distance}`);
});

test('양발 지면 고정은 발목을 발 길이 기반 높이에 맞춘다', () => {
  const pose = structuredClone(findPosePreset('running')!.pose);
  const grounded = groundFeet(pose);
  const left = calculateAnkleLocalPosition(grounded, 'left');
  const right = calculateAnkleLocalPosition(grounded, 'right');
  assert.ok(Math.abs(left[1] - 0.0812) < 0.02);
  assert.ok(Math.abs(right[1] - 0.0812) < 0.02);
});

test('걷기 행동은 이동 방향으로 캐릭터의 몸을 자동 회전한다', () => {
  const scene = structuredClone(sampleProject.scenes[0]);
  const shot = structuredClone(scene.shots[0]);
  shot.actions = [{
    id: 'walk-east', type: 'walk', actorEntityId: 'character-a', startTime: 0, duration: 2,
    parameters: { direction: [1, 0, 0], distance: 2 }, enabled: true,
  }];
  const actor = resolveSceneAtTime(scene, shot, 1.5).find((entity) => entity.id === 'character-a')!;
  assert.ok(Math.abs(actor.transform.rotation[1] + Math.PI / 2) < 0.05);
});

test('걷기 중 지지 발은 연속 구간에서 월드 위치가 거의 고정된다', () => {
  const scene = structuredClone(sampleProject.scenes[0]);
  const shot = structuredClone(scene.shots[0]);
  shot.actions = [{
    id: 'walk-lock', type: 'walk', actorEntityId: 'character-a', startTime: 0, duration: 2,
    parameters: { direction: [1, 0, 0], distance: 2 }, enabled: true,
  }];
  const worldFoot = (time: number) => {
    const actor = resolveSceneAtTime(scene, shot, time).find((entity) => entity.id === 'character-a')!;
    const local = calculateAnkleLocalPosition(actor.character!.pose, 'left');
    const matrix = new Matrix4().compose(
      new Vector3(...actor.transform.position),
      new Quaternion().setFromEuler(new Euler(...actor.transform.rotation, 'XYZ')),
      new Vector3(...actor.transform.scale),
    );
    return new Vector3(...local).applyMatrix4(matrix);
  };
  const before = worldFoot(0.8);
  const after = worldFoot(1.0);
  assert.ok(before.distanceTo(after) < 0.04, `planted foot slipped ${before.distanceTo(after)}`);
});

test('관절 위치 계산은 상위 관절 회전을 자식 핸들 위치에 반영한다', () => {
  const pose = structuredClone(sampleProject.scenes[0].entities[0].character!.pose);
  const neutral = calculateHumanoidJointLocalPositions(pose);
  pose.rightShoulder = [0.7, 0, 0];
  const rotated = calculateHumanoidJointLocalPositions(pose);
  assert.ok(neutral.rightWrist && rotated.rightWrist);
  assert.ok(new Vector3(...neutral.rightWrist!).distanceTo(new Vector3(...rotated.rightWrist!)) > 0.15);
});

test('0.12 리그 신체 비율은 다리와 골반 기본값을 추가해 0.13으로 변환한다', async () => {
  const legacy = cloneSample();
  legacy.schemaVersion = '0.12.0';
  const rig = await analyzeGlbRig(createRiggedGlbBlob(MIXAMO_BONES));
  const oldProportions = {
    referenceHeight: rig.proportions!.referenceHeight,
    leftArm: rig.proportions!.leftArm,
    rightArm: rig.proportions!.rightArm,
  };
  legacy.assetLibrary.push({
    id: 'asset-old-proportions', name: '이전 체형', kind: 'glb', category: 'character', mimeType: 'model/gltf-binary',
    sizeBytes: 10, storageKey: 'old-proportions', createdAt: '2026-07-12T00:00:00.000Z', originalFilename: 'old.glb',
    rig: { ...rig, proportions: oldProportions as never },
  });
  const result = validateAndMigrateProject(legacy);
  assert.equal(result.success, true);
  assert.equal(result.project?.schemaVersion, '1.0.0-rc.13');
  assert.ok(result.project?.assetLibrary[0].rig?.proportions?.leftLeg);
  assert.equal(result.project?.assetLibrary[0].rig?.proportions?.pelvisHeight, 0.9);
});


test('행동 중첩 검사는 같은 실행 객체만 충돌로 판단한다', () => {
  const first: ActionBlock = { id: 'a1', type: 'walk', actorEntityId: 'character-a', startTime: 0, duration: 2, parameters: { direction: [0, 0, -1] }, enabled: true };
  const sameActor: ActionBlock = { id: 'a2', type: 'turnAround', actorEntityId: 'character-a', startTime: 1, duration: 1, parameters: {}, enabled: true };
  const otherActor: ActionBlock = { id: 'a3', type: 'walk', actorEntityId: 'character-b', startTime: 1, duration: 1, parameters: {}, enabled: true };
  assert.equal(findActionConflicts([first, otherActor], sameActor).length, 1);
  assert.equal(findActionConflicts([first], otherActor).length, 0);
  assert.equal(collectActionConflicts([first, sameActor, otherActor]).length, 1);
});

test('동일 소품의 집기와 내려놓기는 실행 인물이 달라도 겹칠 수 없다', () => {
  const pick: ActionBlock = { id: 'pick', type: 'pickUp', actorEntityId: 'character-a', targetEntityId: 'coffee-cup', startTime: 0, duration: 1.5, parameters: { hand: 'right' }, enabled: true };
  const put: ActionBlock = { id: 'put', type: 'putDown', actorEntityId: 'character-b', targetEntityId: 'coffee-cup', startTime: 1, duration: 1, parameters: { hand: 'left', surfaceEntityId: 'table' }, enabled: true };
  const conflicts = findActionConflicts([pick], put);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].resourceType, 'target');
});

test('행동 Transaction은 같은 객체의 시간 중첩을 거부한다', () => {
  const project = cloneSample();
  project.scenes[0].shots[0].actions = [{ id: 'walk-existing', type: 'walk', actorEntityId: 'character-a', startTime: 0, duration: 2, parameters: { direction: [0, 0, -1] }, enabled: true }];
  const action: ActionBlock = { id: 'turn-overlap', type: 'turnAround', actorEntityId: 'character-a', startTime: 1, duration: 1, parameters: { angle: Math.PI }, enabled: true };
  const tx: Transaction = { id: 'tx-overlap', title: '겹침', createdAt: new Date().toISOString(), operations: [{ type: 'addAction', sceneId: 'scene-001', shotId: 'shot-001', action }] };
  assert.throws(() => applyTransaction(project, tx), /시간이 겹칩니다/);
});

test('0.13 프로젝트는 카메라·조명 설정과 참조 이미지 배열을 추가해 0.14로 변환한다', () => {
  const legacy = cloneSample() as any;
  legacy.schemaVersion = '0.13.0';
  delete legacy.scenes[0].referenceImages;
  const camera = legacy.scenes[0].entities.find((entity: any) => entity.type === 'camera');
  delete camera.camera;
  legacy.scenes[0].entities.push({ id: 'legacy-light', name: '이전 조명', type: 'light', transform: { position: [0, 3, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, visible: true, locked: false });
  const result = validateAndMigrateProject(legacy);
  assert.equal(result.success, true);
  assert.equal(result.project?.schemaVersion, '1.0.0-rc.13');
  assert.deepEqual(result.project?.scenes[0].referenceImages, []);
  assert.equal(result.project?.scenes[0].entities.find((entity) => entity.id === 'camera-wide')?.camera?.fov, 48);
  assert.equal(result.project?.scenes[0].entities.find((entity) => entity.id === 'legacy-light')?.light?.kind, 'directional');
});

test('카메라·조명 설정과 참조 이미지는 Transaction으로 수정하고 Undo할 수 있다', () => {
  const project = cloneSample();
  const camera = project.scenes[0].entities.find((entity) => entity.id === 'camera-wide')!;
  const previousCamera = structuredClone(camera.camera!);
  const nextCamera = { ...previousCamera, fov: 35, aspectRatio: '9:16' as const };
  const image = { id: 'ref-1', name: '구도 참조', storageKey: 'reference-image:ref-1', dataUrl: 'data:image/png;base64,AA==', mimeType: 'image/png', sizeBytes: 1, opacity: 0.5, visible: true, cameraEntityId: 'camera-wide', fit: 'contain' as const };
  const tx: Transaction = { id: 'tx-camera-ref', title: '카메라 참조', createdAt: new Date().toISOString(), operations: [
    { type: 'updateEntityData', sceneId: 'scene-001', entityId: 'camera-wide', field: 'camera', previousValue: previousCamera, nextValue: nextCamera },
    { type: 'addReferenceImage', sceneId: 'scene-001', image },
  ] };
  const changed = applyTransaction(project, tx);
  assert.equal(changed.scenes[0].entities.find((entity) => entity.id === 'camera-wide')?.camera?.fov, 35);
  assert.equal(changed.scenes[0].referenceImages.length, 1);
  const reverted = revertTransaction(changed, tx);
  assert.equal(reverted.scenes[0].entities.find((entity) => entity.id === 'camera-wide')?.camera?.fov, 48);
  assert.equal(reverted.scenes[0].referenceImages.length, 0);
});

test('자연어 생성 Scene은 렌즈 설정과 실제 조명 데이터를 포함한다', () => {
  const scene = generateSceneFromPrompt('카페에서 지윤과 민수가 대화한다. 와이드 샷과 클로즈업으로 만들어줘.').scene;
  const cameras = scene.entities.filter((entity) => entity.type === 'camera');
  const lights = scene.entities.filter((entity) => entity.type === 'light');
  assert.ok(cameras.every((entity) => entity.camera && entity.camera.fov >= 10));
  assert.ok(lights.every((entity) => entity.light && entity.light.intensity > 0));
  assert.deepEqual(scene.referenceImages, []);
});


test('저장소의 실제 GLB 시각 Fixture는 glTF 2.0과 휴머노이드 리그를 포함한다', async () => {
  const bytes = readFileSync(new URL('../public/fixtures/humanoid-smoke.glb', import.meta.url));
  const blob = new Blob([bytes], { type: 'model/gltf-binary' });
  const validation = await validateGlbBlob(blob);
  assert.equal(validation.valid, true);
  const rig = await analyzeGlbRig(blob);
  assert.ok(rig.skeletonCount >= 1);
  assert.ok(rig.mappedJointCount >= 15);
  assert.equal(rig.detectedPreset, 'mixamo');
});

test('카메라 삭제는 참조 이미지 연결을 해제하고 Undo 시 복원한다', () => {
  const project = cloneSample();
  const camera = structuredClone(project.scenes[0].entities.find((entity) => entity.id === 'camera-wide')!);
  const image = { id: 'ref-camera-delete', name: '삭제 복원 참조', storageKey: 'reference-image:ref-camera-delete', dataUrl: 'data:image/png;base64,AA==', mimeType: 'image/png', sizeBytes: 1, opacity: 0.5, visible: true, cameraEntityId: camera.id, fit: 'contain' as const };
  project.scenes[0].referenceImages.push(image);
  const tx: Transaction = { id: 'tx-remove-camera-ref', title: '카메라 삭제', createdAt: new Date().toISOString(), operations: [{
    type: 'removeEntity', sceneId: 'scene-001', entity: camera,
    overridesByShot: {}, relationshipsByShot: {}, actionsByShot: {}, referenceImages: [structuredClone(image)],
  }] };
  const changed = applyTransaction(project, tx);
  assert.equal(changed.scenes[0].referenceImages[0].cameraEntityId, undefined);
  const reverted = revertTransaction(changed, tx);
  assert.equal(reverted.scenes[0].referenceImages[0].cameraEntityId, 'camera-wide');
});


test('카메라 설정 Shot Override는 다른 Shot과 기본 카메라를 변경하지 않는다', () => {
  const project = cloneSample();
  const baseCamera = project.scenes[0].entities.find((entity) => entity.id === 'camera-wide')!.camera!;
  const nextCamera = { ...structuredClone(baseCamera), fov: 28, aspectRatio: '9:16' as const };
  const tx: Transaction = { id: 'tx-camera-shot', title: 'Shot 렌즈', createdAt: new Date().toISOString(), operations: [{
    type: 'updateEntity', sceneId: 'scene-001', shotId: 'shot-001', entityId: 'camera-wide', path: 'camera.settings', previousValue: structuredClone(baseCamera), nextValue: nextCamera,
  }] };
  const changed = applyTransaction(project, tx);
  const scene = changed.scenes[0];
  assert.equal(resolveEntityWithoutRelationships(scene, scene.shots[0], 'camera-wide').camera?.fov, 28);
  assert.equal(resolveEntityWithoutRelationships(scene, scene.shots[1], 'camera-wide').camera?.fov, 48);
  assert.equal(scene.entities.find((entity) => entity.id === 'camera-wide')?.camera?.fov, 48);
  const reverted = revertTransaction(changed, tx);
  assert.equal(reverted.scenes[0].shots[0].overrides.some((override) => override.path === 'camera.settings'), false);
});

test('조명 설정 Shot Override는 샷별 광량을 독립적으로 유지한다', () => {
  const project = cloneSample();
  project.scenes[0].entities.push({
    id: 'light-test', name: '키 라이트', type: 'light', transform: { position: [2, 4, 2], rotation: [0, 0, 0], scale: [1, 1, 1] }, visible: true, locked: false,
    light: { kind: 'directional', color: '#ffffff', intensity: 2, range: 10, angle: Math.PI / 4, castShadow: true },
  });
  const previousValue = structuredClone(project.scenes[0].entities.at(-1)!.light!);
  const nextValue = { ...previousValue, intensity: 7, color: '#ff0000' };
  const tx: Transaction = { id: 'tx-light-shot', title: 'Shot 조명', createdAt: new Date().toISOString(), operations: [{
    type: 'updateEntity', sceneId: 'scene-001', shotId: 'shot-002', entityId: 'light-test', path: 'light.settings', previousValue, nextValue,
  }] };
  const changed = applyTransaction(project, tx);
  const scene = changed.scenes[0];
  assert.equal(resolveEntityWithoutRelationships(scene, scene.shots[0], 'light-test').light?.intensity, 2);
  assert.equal(resolveEntityWithoutRelationships(scene, scene.shots[1], 'light-test').light?.intensity, 7);
});

test('0.14 인라인 참조 이미지는 로컬 에셋 storageKey를 추가해 0.15로 변환한다', () => {
  const legacy = cloneSample() as any;
  legacy.schemaVersion = '0.14.0';
  legacy.scenes[0].referenceImages.push({ id: 'legacy-reference', name: '이전 참조', dataUrl: 'data:image/png;base64,AA==', mimeType: 'image/png', sizeBytes: 1, opacity: 0.5, visible: true, fit: 'contain' });
  const result = validateAndMigrateProject(legacy);
  assert.equal(result.success, true);
  assert.equal(result.project?.schemaVersion, '1.0.0-rc.13');
  assert.equal(result.project?.scenes[0].referenceImages[0].storageKey, 'reference-image:legacy-reference');
  assert.ok(result.project?.scenes[0].referenceImages[0].dataUrl?.startsWith('data:image/'));
});

test('프로젝트 번들은 참조 이미지 로컬 Blob을 포함하고 복원한다', async () => {
  const project = cloneSample();
  const image = { id: 'ref-bundle', name: '프레이밍', storageKey: 'reference-image:ref-bundle', mimeType: 'image/webp', sizeBytes: 4, opacity: 0.4, visible: true, cameraEntityId: 'camera-wide', fit: 'cover' as const };
  project.scenes[0].referenceImages.push(image);
  await saveAssetBlob(image.storageKey, new Blob([new Uint8Array([1, 2, 3, 4])], { type: image.mimeType }));
  const exported = await createProjectBundle(project);
  assert.equal(exported.missingReferenceImageIds.length, 0);
  const files = await readStoredZip(exported.blob);
  assert.ok([...files.keys()].some((name) => name.includes('assets/reference-images/ref-bundle/')));
  await deleteAssetBlob(image.storageKey);
  const imported = await importProjectBundle(exported.blob);
  assert.deepEqual(imported.restoredReferenceImageIds, ['ref-bundle']);
  assert.equal((await getAssetBlob(image.storageKey))?.size, 4);
});

test('복구 스냅샷은 최신 5개를 유지하고 유효한 프로젝트를 복원한다', () => {
  clearRecoverySnapshots();
  const project = cloneSample();
  for (let revision = 1; revision <= 7; revision += 1) {
    project.revision = revision;
    saveRecoverySnapshot(project, 'shot-001', 'auto');
  }
  const snapshots = listRecoverySnapshots();
  assert.equal(snapshots.length, 5);
  assert.equal(snapshots[0].project.revision, 7);
  assert.equal(latestRecoverySnapshot()?.activeShotId, 'shot-001');
  const manual = createRecoverySnapshot(project, 'shot-002', 'manual', new Date('2026-07-12T10:00:00.000Z'));
  assert.equal(manual.reason, 'manual');
  assert.equal(manual.createdAt, '2026-07-12T10:00:00.000Z');
  clearRecoverySnapshots();
});

test('비동기 리소스 캐시는 동일 키 로더를 한 번만 실행하고 실패 항목은 재시도한다', async () => {
  const cache = createAsyncResourceCache<number>();
  let calls = 0;
  const first = cache.get('model', async () => { calls += 1; return 42; });
  const second = cache.get('model', async () => { calls += 1; return 99; });
  assert.equal(await first, 42);
  assert.equal(await second, 42);
  assert.equal(calls, 1);
  await assert.rejects(cache.get('broken', async () => { throw new Error('load failed'); }), /load failed/);
  assert.equal(cache.has('broken'), false);
  assert.equal(await cache.get('broken', async () => 7), 7);
});

test('data URL 참조 이미지는 동일 MIME Blob으로 변환된다', async () => {
  const blob = dataUrlToBlob('data:image/png;base64,AQIDBA==');
  assert.equal(blob.type, 'image/png');
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 3, 4]);
});

test('Tauri 데스크톱 구성은 Vite dist와 전역 브리지를 사용한다', () => {
  const config = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  assert.equal(config.version, '1.0.0-rc.13');
  assert.equal(config.build.frontendDist, '../dist');
  assert.equal(config.app.withGlobalTauri, true);
  assert.equal(config.app.windows[0].label, 'main');
});

test('0.15 프로젝트는 스포트라이트 대상 데이터를 검증해 0.16으로 변환한다', () => {
  const legacy = cloneSample() as any;
  legacy.schemaVersion = '0.15.0';
  legacy.scenes[0].entities.push({
    id: 'spot-migrate', name: '이전 스포트', type: 'light', transform: { position: [0, 4, 2], rotation: [0, 0, 0], scale: [1, 1, 1] }, visible: true, locked: false,
    light: { kind: 'spot', color: '#ffffff', intensity: 3, range: 10, angle: 0.7, castShadow: true, targetEntityId: 'missing-target' },
  });
  const result = validateAndMigrateProject(legacy);
  assert.equal(result.success, true);
  assert.equal(result.project?.schemaVersion, '1.0.0-rc.13');
  assert.equal(result.project?.scenes[0].entities.find((entity) => entity.id === 'spot-migrate')?.light?.targetEntityId, undefined);
  assert.ok(result.warnings.some((warning) => warning.includes('스포트라이트 대상')));
});

test('유효한 스포트라이트 대상은 Base와 Shot Override에서 유지된다', () => {
  const project = cloneSample();
  project.scenes[0].entities.push({
    id: 'spot-valid', name: '인물 스포트', type: 'light', transform: { position: [0, 4, 2], rotation: [0, 0, 0], scale: [1, 1, 1] }, visible: true, locked: false,
    light: { kind: 'spot', color: '#ffffff', intensity: 3, range: 10, angle: 0.7, castShadow: true, targetEntityId: 'character-a' },
  });
  project.scenes[0].shots[0].overrides.push({
    id: 'shot-001:spot-valid:light.settings', entityId: 'spot-valid', path: 'light.settings',
    value: { kind: 'spot', color: '#ffddee', intensity: 4, range: 12, angle: 0.5, castShadow: true, targetEntityId: 'character-b' },
  });
  const result = validateAndMigrateProject(project);
  assert.equal(result.success, true);
  assert.equal(result.project?.scenes[0].entities.find((entity) => entity.id === 'spot-valid')?.light?.targetEntityId, 'character-a');
  assert.equal((result.project?.scenes[0].shots[0].overrides.at(-1)?.value as any).targetEntityId, 'character-b');
});

test('스포트라이트 대상 Entity 삭제는 연결을 해제하고 Undo 시 복원한다', () => {
  const project = cloneSample();
  const target = structuredClone(project.scenes[0].entities.find((entity) => entity.id === 'character-b')!);
  const light = {
    id: 'spot-delete', name: '삭제 대상 스포트', type: 'light' as const, transform: { position: [0, 4, 2] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] }, visible: true, locked: false,
    light: { kind: 'spot' as const, color: '#ffffff', intensity: 3, range: 10, angle: 0.7, castShadow: true, targetEntityId: target.id },
  };
  project.scenes[0].entities.push(light);
  const override = { id: 'shot-001:spot-delete:light.settings', entityId: light.id, path: 'light.settings' as const, value: { ...structuredClone(light.light), intensity: 5 } };
  project.scenes[0].shots[0].overrides.push(override);
  const tx: Transaction = { id: 'tx-remove-light-target', title: '대상 삭제', createdAt: new Date().toISOString(), operations: [{
    type: 'removeEntity', sceneId: 'scene-001', entity: target, overridesByShot: {}, relationshipsByShot: {}, actionsByShot: {}, referenceImages: [],
    lightTargetBackups: [{ lightEntityId: light.id, baseLight: structuredClone(light.light), overridesByShot: { 'shot-001': [structuredClone(override)] } }],
  }] };
  const changed = applyTransaction(project, tx);
  assert.equal(changed.scenes[0].entities.find((entity) => entity.id === light.id)?.light?.targetEntityId, undefined);
  assert.equal((changed.scenes[0].shots[0].overrides.find((item) => item.entityId === light.id)?.value as any).targetEntityId, undefined);
  const reverted = revertTransaction(changed, tx);
  assert.equal(reverted.scenes[0].entities.find((entity) => entity.id === light.id)?.light?.targetEntityId, target.id);
  assert.equal((reverted.scenes[0].shots[0].overrides.find((item) => item.entityId === light.id)?.value as any).targetEntityId, target.id);
});

test('걷기 보폭·발 높이·상체 기울기 파라미터가 절차형 포즈에 반영된다', () => {
  const scene = structuredClone(sampleProject.scenes[0]);
  const shot = structuredClone(scene.shots[0]);
  const actorId = 'character-a';
  const baseAction: ActionBlock = { id: 'walk-gait', type: 'walk', actorEntityId: actorId, startTime: 0, duration: 2, parameters: { direction: [0, 0, -1], distance: 2, strideLength: 0.45, stepHeight: 0.24, cadence: 2.4, bodyLean: 0.24 }, enabled: true };
  shot.actions = [baseAction];
  const tuned = resolveSceneAtTime(scene, shot, 0.7).find((entity) => entity.id === actorId)!;
  shot.actions = [{ ...baseAction, parameters: { ...baseAction.parameters, bodyLean: 0, stepHeight: 0.02 } }];
  const flat = resolveSceneAtTime(scene, shot, 0.7).find((entity) => entity.id === actorId)!;
  assert.ok((tuned.character?.pose.spine[0] ?? 0) > (flat.character?.pose.spine[0] ?? 0) + 0.1);
  assert.notDeepEqual(tuned.character?.pose.leftHip, flat.character?.pose.leftHip);
});

test('저장소 정리 계획은 프로젝트가 참조하는 GLB와 이미지를 보존한다', async () => {
  const project = cloneSample();
  const usedGlb = 'cleanup-used-glb';
  const usedRef = 'cleanup-used-ref';
  const unused = 'cleanup-unused';
  project.assetLibrary.push({ id: 'asset-cleanup', name: '보존 GLB', kind: 'glb', category: 'prop', mimeType: 'model/gltf-binary', sizeBytes: 1, storageKey: usedGlb, createdAt: new Date().toISOString(), originalFilename: 'used.glb' });
  project.assetLibrary.push({ id: 'asset-cleanup-unused', name: '삭제 이력 GLB', kind: 'glb', category: 'prop', mimeType: 'model/gltf-binary', sizeBytes: 1, storageKey: unused, createdAt: new Date().toISOString(), originalFilename: 'unused.glb' });
  project.scenes[0].referenceImages.push({ id: 'ref-cleanup', name: '보존 이미지', storageKey: usedRef, mimeType: 'image/webp', sizeBytes: 1, opacity: 0.5, visible: true, fit: 'contain' });
  clearProjectStorageRegistry(project.id);
  registerProjectStorageReferences(project);
  project.assetLibrary = project.assetLibrary.filter((item) => item.storageKey !== unused);
  await Promise.all([usedGlb, usedRef, unused].map((key) => saveAssetBlob(key, new Blob([key]))));
  const referenced = collectReferencedStorageKeys(project);
  assert.ok(referenced.includes(usedGlb));
  assert.ok(referenced.includes(usedRef));
  const plan = await buildStorageCleanupPlan(project);
  assert.ok(plan.unusedKeys.includes(unused));
  assert.ok(!plan.unusedKeys.includes(usedGlb));
  await Promise.all([usedGlb, usedRef, unused].map(deleteAssetBlob));
  clearProjectStorageRegistry(project.id);
});

test('미사용 로컬 에셋 정리는 참조되지 않은 Blob만 삭제한다', async () => {
  const project = cloneSample();
  const used = 'cleanup-delete-used';
  const unused = 'cleanup-delete-unused';
  project.assetLibrary.push({ id: 'asset-cleanup-delete', name: '사용 에셋', kind: 'glb', category: 'prop', mimeType: 'model/gltf-binary', sizeBytes: 1, storageKey: used, createdAt: new Date().toISOString(), originalFilename: 'used.glb' });
  project.assetLibrary.push({ id: 'asset-cleanup-delete-old', name: '삭제 이력', kind: 'glb', category: 'prop', mimeType: 'model/gltf-binary', sizeBytes: 1, storageKey: unused, createdAt: new Date().toISOString(), originalFilename: 'unused.glb' });
  clearProjectStorageRegistry(project.id);
  registerProjectStorageReferences(project);
  project.assetLibrary = project.assetLibrary.filter((item) => item.storageKey !== unused);
  await saveAssetBlob(used, new Blob([new Uint8Array([1])]));
  await saveAssetBlob(unused, new Blob([new Uint8Array([2])]));
  const result = await cleanupUnusedAssetBlobs(project);
  assert.ok(result.deletedKeys.includes(unused));
  assert.equal(await getAssetBlob(unused), null);
  assert.ok(await getAssetBlob(used));
  await deleteAssetBlob(used);
  clearProjectStorageRegistry(project.id);
});

test('다중 Action Transaction은 여러 블록을 함께 이동하고 한 번에 Undo한다', () => {
  const project = cloneSample();
  const first: ActionBlock = { id: 'multi-a', type: 'walk', actorEntityId: 'character-a', startTime: 0, duration: 1, parameters: { direction: [0, 0, -1] }, enabled: true };
  const second: ActionBlock = { id: 'multi-b', type: 'walk', actorEntityId: 'character-b', startTime: 0.5, duration: 1, parameters: { direction: [0, 0, -1] }, enabled: true };
  project.scenes[0].shots[0].actions = [first, second];
  const nextFirst = { ...structuredClone(first), startTime: 0.25 };
  const nextSecond = { ...structuredClone(second), startTime: 0.75 };
  const tx: Transaction = { id: 'tx-multi-actions', title: '다중 이동', createdAt: new Date().toISOString(), operations: [
    { type: 'updateAction', sceneId: 'scene-001', shotId: 'shot-001', previousAction: first, nextAction: nextFirst },
    { type: 'updateAction', sceneId: 'scene-001', shotId: 'shot-001', previousAction: second, nextAction: nextSecond },
  ] };
  const changed = applyTransaction(project, tx);
  assert.deepEqual(changed.scenes[0].shots[0].actions.map((action) => action.startTime), [0.25, 0.75]);
  const reverted = revertTransaction(changed, tx);
  assert.deepEqual(reverted.scenes[0].shots[0].actions.map((action) => action.startTime), [0, 0.5]);
});

test('대표 베타 시나리오는 자연어 Scene부터 Action·Manifest·프로젝트 번들 복원까지 통과한다', async () => {
  const generated = generateSceneFromPrompt('비 오는 밤 편의점 앞에서 지윤과 민수가 마주 본다. 지윤은 우산을 들고 있고 와이드 샷 다음 민수 트래킹 샷으로 만들어줘.');
  const project = cloneSample();
  project.scenes = [generated.scene];
  project.activeSceneId = generated.scene.id;
  project.schemaVersion = '1.0.0-rc.13';
  const validation = validateAndMigrateProject(project);
  assert.equal(validation.success, true);
  const scene = validation.project!.scenes[0];
  const shot = scene.shots[0];
  assert.ok(scene.entities.some((entity) => entity.type === 'character'));
  assert.ok(scene.entities.some((entity) => entity.type === 'camera'));
  const manifest = buildShotPackageManifest(validation.project!, scene, shot);
  assert.equal(manifest.schemaVersion, '1.0.0-rc.13');
  assert.ok(manifest.entities.length > 0);
  const bundle = await createProjectBundle(validation.project!);
  const imported = await importProjectBundle(bundle.blob);
  assert.equal(imported.project.schemaVersion, '1.0.0-rc.13');
  assert.equal(imported.project.scenes[0].shots.length, scene.shots.length);
});

test('데스크톱 빌드 워크플로는 Windows·macOS·Linux 패키징을 모두 검증한다', () => {
  const workflow = readFileSync(new URL('../.github/workflows/desktop-build.yml', import.meta.url), 'utf8');
  assert.ok(workflow.includes('ubuntu-22.04'));
  assert.ok(workflow.includes('windows-latest'));
  assert.ok(workflow.includes('macos-latest'));
  assert.ok(workflow.includes('tauri-apps/tauri-action'));
  assert.ok(workflow.includes('npm run verify:rc'));
});


test('실행 환경 진단은 WebGL·메모리·코어에 따라 안전한 렌더 품질을 권장한다', () => {
  const unsupported = evaluateRuntimeCapabilities({
    webgl: false, webgl2: false, indexedDb: true, fileSystemAccess: false, tauri: false,
  });
  assert.equal(unsupported.status, 'unsupported');
  assert.equal(unsupported.recommendedQuality, 'performance');
  const limited = evaluateRuntimeCapabilities({
    webgl: true, webgl2: false, indexedDb: true, fileSystemAccess: false, tauri: false,
    deviceMemoryGb: 2, hardwareConcurrency: 2, maxTextureSize: 2048,
  });
  assert.equal(limited.status, 'limited');
  assert.equal(resolveRenderQuality('auto', limited), 'performance');
  assert.equal(viewportQualitySettings('performance').shadows, false);
  assert.deepEqual(viewportQualitySettings('quality').dpr, [1, 2]);
});

test('결정적 시각 스냅샷은 같은 Scene 상태에서 같은 서명을 만들고 위치 변경을 감지한다', () => {
  const scene = structuredClone(sampleProject.scenes[0]);
  const shot = scene.shots[0];
  const first = buildVisualSnapshot(scene, shot, 0);
  const second = buildVisualSnapshot(scene, shot, 0);
  assert.equal(first.signature, second.signature);
  assert.ok(first.svg.includes(first.signature));
  scene.entities[0].transform.position[0] += 0.25;
  const changed = buildVisualSnapshot(scene, shot, 0);
  assert.notEqual(changed.signature, first.signature);
});

test('프로젝트 점검은 Action 충돌과 누락된 로컬 에셋을 보고한다', async () => {
  const project = cloneSample();
  project.assetLibrary.push({
    id: 'doctor-missing-asset', name: '누락 GLB', kind: 'glb', category: 'prop',
    mimeType: 'model/gltf-binary', sizeBytes: 2048, storageKey: 'doctor-missing-storage',
    createdAt: new Date().toISOString(), originalFilename: 'missing.glb',
  });
  project.scenes[0].shots[0].actions = [
    { id: 'doctor-walk-a', type: 'walk', actorEntityId: 'character-a', startTime: 0, duration: 1.5, parameters: { direction: [0, 0, -1] }, enabled: true },
    { id: 'doctor-walk-b', type: 'turnAround', actorEntityId: 'character-a', startTime: 0.5, duration: 1, parameters: {}, enabled: true },
  ];
  const report = await analyzeProjectHealth(project);
  assert.equal(report.status, 'blocked');
  assert.ok(report.issues.some((item) => item.code === 'action-conflicts'));
  assert.ok(report.issues.some((item) => item.code === 'missing-local-asset'));
  assert.ok(report.missingStorageKeys.includes('doctor-missing-storage'));
});

test('안전 복구는 Shot 카메라·Action 범위·충돌·끊어진 관계를 교정한다', () => {
  const project = cloneSample();
  const shot = project.scenes[0].shots[0];
  shot.cameraEntityId = 'missing-camera';
  shot.relationships.push({ id: 'doctor-dangling-rel', type: 'lookAt', sourceEntityId: 'character-a', targetEntityId: 'missing-entity', parameters: {}, active: true });
  shot.actions = [
    { id: 'doctor-out-of-range', type: 'walk', actorEntityId: 'character-a', startTime: -2, duration: 99, parameters: { direction: [0, 0, -1] }, enabled: true },
    { id: 'doctor-conflict', type: 'turnAround', actorEntityId: 'character-a', startTime: 0.25, duration: 1, parameters: {}, enabled: true },
  ];
  const result = repairProjectSafely(project);
  assert.deepEqual(result.validationErrors, []);
  const repairedShot = result.project.scenes[0].shots[0];
  assert.ok(result.project.scenes[0].entities.some((entity) => entity.id === repairedShot.cameraEntityId && entity.type === 'camera'));
  assert.equal(repairedShot.relationships.some((item) => item.id === 'doctor-dangling-rel'), false);
  assert.ok(repairedShot.actions.every((action) => action.startTime >= 0 && action.startTime + action.duration <= repairedShot.duration + 1e-6));
  assert.equal(repairedShot.actions.filter((action) => action.enabled).length, 1);
  assert.ok(result.changes.length >= 3);
});

test('복구 저널 v2는 체크섬과 순번으로 손상된 스냅샷을 거부한다', () => {
  clearRecoverySnapshots();
  const snapshot = createRecoverySnapshot(cloneSample(), 'shot-001', 'manual', new Date('2026-07-12T20:00:00.000Z'));
  assert.equal(snapshot.version, 2);
  assert.ok(snapshot.sequence >= 1);
  assert.equal(verifyRecoverySnapshot(snapshot), true);
  const corrupted = structuredClone(snapshot);
  corrupted.project.name = '손상된 프로젝트';
  assert.equal(verifyRecoverySnapshot(corrupted), false);
  clearRecoverySnapshots();
});

test('1.0 RC 프로젝트 스키마와 데스크톱 패키지 버전이 일치한다', () => {
  const result = validateAndMigrateProject(cloneSample());
  assert.equal(result.success, true);
  assert.equal(result.project?.schemaVersion, '1.0.0-rc.13');
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const tauri = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  assert.equal(packageJson.version, '1.0.0-rc.13');
  assert.equal(tauri.version, packageJson.version);
});


test('실제 VRM 스타일 GLB Fixture는 휴머노이드 17개 관절을 자동 매핑한다', async () => {
  const bytes = readFileSync(new URL('../public/fixtures/humanoid-vrm-smoke.glb', import.meta.url));
  const profile = await analyzeGlbRig(new Blob([bytes], { type: 'model/gltf-binary' }));
  assert.equal(profile.detectedPreset, 'vrm');
  assert.equal(profile.status, 'humanoid');
  assert.equal(profile.mappedJointCount, 17);
  assert.equal(profile.boneMap.leftShoulder, 'J_Bip_L_UpperArm');
  assert.equal(profile.boneMap.rightKnee, 'J_Bip_R_LowerLeg');
});

test('실제 Generic Blender 스타일 GLB Fixture는 좌우 접미사 본을 자동 매핑한다', async () => {
  const bytes = readFileSync(new URL('../public/fixtures/humanoid-generic-smoke.glb', import.meta.url));
  const profile = await analyzeGlbRig(new Blob([bytes], { type: 'model/gltf-binary' }));
  assert.equal(profile.detectedPreset, 'generic');
  assert.equal(profile.status, 'humanoid');
  assert.equal(profile.mappedJointCount, 17);
  assert.equal(profile.boneMap.leftElbow, 'forearm.L');
  assert.equal(profile.boneMap.rightAnkle, 'foot.R');
});

test('지원 번들은 진단·복구 요약·시각 스냅샷을 하나의 ZIP으로 만든다', async () => {
  clearRecoverySnapshots();
  const project = cloneSample();
  saveRecoverySnapshot(project, 'shot-001', 'manual');
  const report = await analyzeProjectHealth(project);
  const snapshot = buildVisualSnapshot(project.scenes[0], project.scenes[0].shots[0], 0);
  const bundle = await createSupportBundle({
    project,
    report,
    runtime: evaluateRuntimeCapabilities({ webgl: true, webgl2: true, indexedDb: true, fileSystemAccess: false, tauri: false }),
    snapshot,
    recoverySnapshots: listRecoverySnapshots(),
    appVersion: '1.0.0-rc.13',
    generatedAt: new Date('2026-07-12T23:30:00.000Z'),
  });
  const files = await readStoredZip(bundle);
  for (const name of ['support_manifest.json', 'diagnostics.json', 'project_structure.json', 'recovery_summary.json', 'visual_snapshot.svg', 'README.txt']) {
    assert.ok(files.has(name), `${name} missing`);
  }
  const manifest = JSON.parse(new TextDecoder().decode(files.get('support_manifest.json')));
  assert.equal(manifest.appVersion, '1.0.0-rc.13');
  assert.equal(manifest.privacy.localAssetBinaryIncluded, false);
  clearRecoverySnapshots();
});

test('지원 번들의 구조 프로젝트는 프롬프트·로컬 키·서버 주소를 제거한다', async () => {
  const project = cloneSample();
  project.name = '비밀 프로젝트';
  project.scenes[0].description = '비밀 프롬프트 문장';
  project.scenes[0].referenceImages.push({
    id: 'private-ref', name: '비밀 이미지', storageKey: 'private-storage-key', mimeType: 'image/webp', sizeBytes: 10,
    opacity: 0.5, visible: true, fit: 'contain', cameraEntityId: 'camera-main',
  });
  project.scenes[0].shots[0].generationResults.push({
    id: 'private-result', provider: 'comfyui', serverUrl: 'http://private-server:8188', promptId: 'prompt',
    workflowName: 'private-workflow', createdAt: new Date().toISOString(),
    outputs: [{ nodeId: '1', filename: 'secret.png', subfolder: 'private', type: 'output', kind: 'image' }],
  });
  const report = await analyzeProjectHealth(project);
  const bundle = await createSupportBundle({ project, report, appVersion: '1.0.0-rc.13' });
  const files = await readStoredZip(bundle);
  const text = new TextDecoder().decode(files.get('project_structure.json'));
  for (const secret of ['비밀 프로젝트', '비밀 프롬프트 문장', 'private-storage-key', 'http://private-server:8188', 'private-workflow', 'secret.png']) {
    assert.equal(text.includes(secret), false, `${secret} leaked`);
  }
});

test('장시간 편집 스트레스는 250회 변경 후에도 프로젝트와 최근 5개 복구본을 유지한다', () => {
  clearRecoverySnapshots();
  let project = cloneSample();
  for (let index = 0; index < 250; index += 1) {
    const current = resolveEntityWithoutRelationships(project.scenes[0], project.scenes[0].shots[0], 'character-a').transform.position;
    const next: [number, number, number] = [current[0] + 0.001, current[1], current[2]];
    project = applyTransaction(project, {
      id: `stress-${index}`,
      title: `stress ${index}`,
      createdAt: new Date(1_700_000_000_000 + index).toISOString(),
      operations: [{
        type: 'updateEntity', sceneId: 'scene-001', shotId: 'shot-001', entityId: 'character-a',
        path: 'transform.position', previousValue: current, nextValue: next,
      }],
    });
    if (index % 20 === 0) saveRecoverySnapshot(project, 'shot-001', 'auto');
  }
  const validation = validateAndMigrateProject(project);
  assert.equal(validation.success, true);
  const snapshots = listRecoverySnapshots();
  assert.equal(snapshots.length, 5);
  assert.ok(snapshots.every(verifyRecoverySnapshot));
  assert.ok(snapshots[0].project.revision > snapshots[4].project.revision);
  clearRecoverySnapshots();
});


test('릴리스 게이트는 필수 외부 검증이 남으면 conditional로 판정한다', () => {
  const result = evaluateReleaseQualification([
    { id: 'tests', label: 'tests', required: true, status: 'pass' },
    { id: 'browser', label: 'browser', required: true, status: 'blocked' },
    { id: 'installers', label: 'installers', required: true, status: 'not-run' },
  ]);
  assert.equal(result.status, 'conditional');
  assert.deepEqual(result.pendingExternal, ['browser', 'installers']);
  assert.deepEqual(result.blockers, []);
});

test('릴리스 게이트는 필수 검사 실패를 blocked로 판정한다', () => {
  const result = evaluateReleaseQualification([
    { id: 'tests', label: 'tests', required: true, status: 'fail' },
    { id: 'browser', label: 'browser', required: true, status: 'pass' },
  ]);
  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.blockers, ['tests']);
});

test('릴리스 게이트는 모든 필수 검사가 통과하면 ready로 판정한다', () => {
  const result = evaluateReleaseQualification([
    { id: 'tests', label: 'tests', required: true, status: 'pass' },
    { id: 'browser', label: 'browser', required: true, status: 'pass' },
    { id: 'installers', label: 'installers', required: true, status: 'pass' },
    { id: 'optional', label: 'optional', required: false, status: 'not-run' },
  ]);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.optionalFailures, ['optional']);
});

test('앱은 WebGL 미지원 환경에서 Canvas 대신 3D 안전 모드를 제공한다', () => {
  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.ok(appSource.includes('data-testid="viewport-safe-mode"'));
  assert.ok(appSource.includes("runtimeDiagnostics?.status === 'unsupported'"));
  assert.ok(appSource.includes('data-aisd-ready="true"'));
});

test('데스크톱 CI는 실브라우저와 네이티브 설치 산출물을 엄격 검사한다', () => {
  const workflow = readFileSync(new URL('../.github/workflows/desktop-build.yml', import.meta.url), 'utf8');
  assert.ok(workflow.includes('node scripts/browser-smoke.mjs --strict'));
  assert.ok(workflow.includes('npm run native:artifacts'));
  assert.ok(workflow.includes('NATIVE_ARTIFACTS_${{ matrix.artifact_platform }}.json'));
  assert.ok(workflow.includes('actions/upload-artifact@v4'));
});

test('연출 흐름은 설명이 없는 프로젝트에서 자연어 장면 생성을 다음 작업으로 제안한다', () => {
  const project = cloneSample();
  const report = analyzeDirectorWorkflow(project, 'scene-001', 'shot-001');
  assert.equal(report.intent, 'sequence');
  assert.equal(report.nextAction.id, 'openSceneGenerator');
  assert.equal(report.stages[0].status, 'blocked');
  assert.equal(report.shotReadiness.every((shot) => shot.status === 'ready'), true);
});

test('자연어로 생성한 모션 장면은 인물·카메라·샷·행동을 연출 흐름에 반영한다', () => {
  const { scene } = generateSceneFromPrompt('낮의 도심 거리에서 빨간 재킷을 입은 여성이 가방을 집어 들고 앞으로 걸어간다. 처음은 와이드 샷, 다음은 손 인서트, 마지막은 여성을 따라가는 트래킹 샷으로 만들어줘.', 'scene-flow');
  const project = cloneSample();
  project.activeSceneId = scene.id;
  project.scenes = [scene];
  const report = analyzeDirectorWorkflow(project, scene.id, scene.shots[0].id);
  assert.equal(report.intent, 'motion');
  assert.ok(report.stages.find((stage) => stage.id === 'scene')!.score >= 75);
  assert.ok(scene.shots.length >= 2);
  assert.ok(scene.shots.flatMap((shot) => shot.actions).length > 0);
});

test('샷 준비도는 카메라 참조가 끊기면 출력 차단 상태가 된다', () => {
  const project = cloneSample();
  const scene = project.scenes[0];
  const shot = structuredClone(scene.shots[0]);
  shot.cameraEntityId = 'missing-camera';
  const readiness = analyzeShotReadiness(scene, shot);
  assert.equal(readiness.status, 'blocked');
  assert.ok(readiness.issues.some((issue) => issue.includes('카메라')));
});

test('연출 흐름은 같은 객체의 행동 충돌을 점검 단계 차단으로 표시한다', () => {
  const project = cloneSample();
  const scene = project.scenes[0];
  scene.description = '카페에서 지윤이 앞으로 걸어간 뒤 민수와 대화하는 영상 장면이다.';
  scene.entities.push({
    id: 'light-flow', name: '키 라이트', type: 'light', transform: { position: [0, 3, 2], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true, locked: false,
    light: { kind: 'directional', color: '#ffffff', intensity: 1, range: 10, angle: Math.PI / 4, castShadow: true },
  });
  scene.shots[0].actions = [
    { id: 'flow-a', type: 'walk', actorEntityId: 'character-a', startTime: 0, duration: 2, parameters: { direction: [0, 0, -1], distance: 1 }, enabled: true },
    { id: 'flow-b', type: 'turnAround', actorEntityId: 'character-a', startTime: 1, duration: 2, parameters: { angle: Math.PI }, enabled: true },
  ];
  const report = analyzeDirectorWorkflow(project, scene.id, scene.shots[0].id);
  assert.equal(report.nextAction.id, 'openProjectDoctor');
  assert.equal(report.stages.find((stage) => stage.id === 'direction')!.status, 'blocked');
});

test('단일 스틸 장면은 한 개의 유효한 샷으로 출력 준비가 가능하다', () => {
  const project = cloneSample();
  const scene = project.scenes[0];
  scene.description = '스튜디오 테이블 위 제품을 한 장의 정면 이미지로 연출한다.';
  scene.shots = [scene.shots[0]];
  scene.entities = scene.entities.filter((entity) => entity.type !== 'character' || entity.id === 'character-a');
  scene.entities.push({
    id: 'light-still', name: '제품 조명', type: 'light', transform: { position: [0, 3, 2], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true, locked: false,
    light: { kind: 'directional', color: '#ffffff', intensity: 1, range: 10, angle: Math.PI / 4, castShadow: true },
  });
  const report = analyzeDirectorWorkflow(project, scene.id, scene.shots[0].id);
  assert.equal(report.intent, 'still');
  assert.equal(report.shotReadiness[0].status, 'ready');
  assert.equal(report.nextAction.id, 'exportShotPackage');
});

test('앱은 연출 흐름 안내판과 대표 장면 템플릿을 제공한다', () => {
  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const generatorSource = readFileSync(new URL('../src/components/SceneGeneratorPanel.tsx', import.meta.url), 'utf8');
  assert.ok(appSource.includes('<DirectorWorkflowPanel'));
  assert.ok(appSource.includes('shot-readiness'));
  assert.ok(generatorSource.includes("id: 'dialogue'"));
  assert.ok(generatorSource.includes("id: 'product'"));
  assert.ok(generatorSource.includes("id: 'action'"));
});


test('연출 단계 카드는 모두 실제 편집 위치로 이동하는 액션을 가진다', () => {
  const project = cloneSample();
  const report = analyzeDirectorWorkflow(project, 'scene-001', 'shot-001');
  assert.deepEqual(report.stages.map((stage) => stage.actionId), [
    'openSceneGenerator', 'focusSceneHierarchy', 'focusShotStrip', 'focusTimeline', 'openProjectDoctor', 'exportShotPackage',
  ]);
  assert.ok(report.stages.every((stage) => stage.actionLabel.length > 0));
});

test('자연어 인물 장면은 적용 직후 주인공을 첫 수정 대상으로 준비한다', () => {
  const { scene } = generateSceneFromPrompt('낮의 거리에서 빨간 재킷을 입은 여성이 앞으로 걸어간다. 와이드 샷과 트래킹 샷으로 만들어줘.', 'scene-first-edit');
  const plan = buildFirstEditPlan(scene);
  assert.equal(plan.ready, true);
  assert.equal(plan.targetKind, 'character');
  assert.equal(plan.primaryAction, 'selectLeadCharacter');
  assert.ok(scene.entities.some((entity) => entity.id === plan.targetEntityId && entity.type === 'character'));
});

test('제품 장면은 인물이 없어도 핵심 소품을 첫 수정 대상으로 준비한다', () => {
  const { scene } = generateSceneFromPrompt('어두운 스튜디오의 검은 테이블 위에 은색 헤드폰이 놓여 있다. 제품 미디엄 샷과 재질 인서트로 만들어줘.', 'scene-product-edit');
  const plan = buildFirstEditPlan(scene);
  assert.equal(plan.ready, true);
  assert.equal(plan.targetKind, 'prop');
  assert.equal(plan.primaryAction, 'selectPrimarySubject');
  const project = cloneSample();
  project.activeSceneId = scene.id;
  project.scenes = [scene];
  const report = analyzeDirectorWorkflow(project, scene.id, scene.shots[0].id);
  assert.notEqual(report.stages.find((stage) => stage.id === 'scene')?.status, 'blocked');
});

test('대표 대화·제품·동작 장면은 모두 첫 수정 준비 상태를 계산한다', () => {
  const prompts = [
    '작은 카페에서 지윤과 민수가 테이블을 사이에 두고 마주 앉아 대화한다. 와이드와 오버숄더, 클로즈업으로 만들어줘.',
    '스튜디오 테이블 위 은색 헤드폰을 미디엄과 인서트 샷으로 연출해줘.',
    '도심 거리에서 여성이 가방을 집고 걸어간다. 와이드와 손 인서트, 트래킹 샷으로 만들어줘.',
  ];
  for (const [index, prompt] of prompts.entries()) {
    const { scene } = generateSceneFromPrompt(prompt, `scene-usability-${index}`);
    const project = cloneSample();
    project.activeSceneId = scene.id;
    project.scenes = [scene];
    const report = analyzeDirectorWorkflow(project, scene.id, scene.shots[0].id);
    assert.equal(report.journey.firstEdit.ready, true);
    assert.ok(report.journey.estimatedStepsToExport >= 0 && report.journey.estimatedStepsToExport <= 6);
  }
});

test('앱은 연출 흐름 접기·집중 모드와 생성 직후 첫 수정 안내를 제공한다', () => {
  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const panelSource = readFileSync(new URL('../src/components/DirectorWorkflowPanel.tsx', import.meta.url), 'utf8');
  const storeSource = readFileSync(new URL('../src/store/editorStore.ts', import.meta.url), 'utf8');
  assert.ok(appSource.includes("'focus-mode'"));
  assert.ok(appSource.includes('data-first-edit-ready'));
  assert.ok(appSource.includes('workflow-focus-target'));
  assert.ok(panelSource.includes('director-workflow collapsed'));
  assert.ok(panelSource.includes('onAction(stage.actionId)'));
  assert.ok(storeSource.includes("transformMode: 'translate'"));
});


test('명령 검색은 한국어 키워드와 기능 설명을 기준으로 관련 작업을 우선 반환한다', () => {
  const commands = buildCommandCatalog({ canUndo: true, canRedo: false, canSaveWorkspace: false, hasSelection: true, isPlaying: false, focusMode: false, workflowCollapsed: false });
  assert.equal(searchCommands(commands, '카메라 구도')[0]?.id, 'selectShotCamera');
  assert.equal(searchCommands(commands, '자연어 장면')[0]?.id, 'openSceneGenerator');
  assert.ok(searchCommands(commands, '타임라인').some((command) => command.id === 'focusTimeline'));
});

test('명령 검색은 현재 실행할 수 없는 Undo와 포즈 작업을 결과에서 제외한다', () => {
  const commands = buildCommandCatalog({ canUndo: false, canRedo: false, canSaveWorkspace: false, hasSelection: false, isPlaying: false, focusMode: false, workflowCollapsed: false });
  assert.equal(searchCommands(commands, '실행 취소').some((command) => command.id === 'undo'), false);
  assert.equal(searchCommands(commands, '포즈').some((command) => command.id === 'transformPose'), false);
});

test('제작 세션 메타데이터는 프롬프트·파일명·URL과 저장소 키를 제거한다', () => {
  const metadata = sanitizeSessionMetadata({
    commandId: 'focusTimeline',
    prompt: '비밀 프롬프트',
    sceneName: '비밀 장면',
    serverUrl: 'http://private:8188',
    storageKey: 'private-key',
    actionCount: 3,
  });
  assert.deepEqual(metadata, { commandId: 'focusTimeline', actionCount: 3 });
});

test('제작 세션은 첫 장면·첫 수정·첫 출력까지의 시간을 계산한다', () => {
  let session = createCreatorSession(new Date('2026-07-13T00:00:00.000Z'));
  session = appendCreatorSessionEvent(session, 'scene_applied', { source: 'natural-language' }, new Date('2026-07-13T00:00:05.000Z'));
  session = appendCreatorSessionEvent(session, 'first_edit_ready', { targetKind: 'character' }, new Date('2026-07-13T00:00:08.000Z'));
  session = appendCreatorSessionEvent(session, 'first_edit_completed', { revisionDelta: 1 }, new Date('2026-07-13T00:00:09.000Z'));
  session = appendCreatorSessionEvent(session, 'shortcut_used', { commandId: 'transformTranslate' }, new Date('2026-07-13T00:00:10.000Z'));
  session = appendCreatorSessionEvent(session, 'export_completed', { kind: 'shot-package' }, new Date('2026-07-13T00:00:20.000Z'));
  const summary = summarizeCreatorSession(session, new Date('2026-07-13T00:00:25.000Z'));
  assert.equal(summary.timeToSceneMs, 5000);
  assert.equal(summary.timeToFirstEditReadyMs, 8000);
  assert.equal(summary.timeToFirstEditMs, 9000);
  assert.equal(summary.timeToFirstExportMs, 20000);
  assert.equal(summary.shortcutExecutions, 1);
  assert.equal(summary.milestone, 'exported');
});

test('제작 세션은 이벤트를 최근 240개로 제한한다', () => {
  let session = createCreatorSession(new Date('2026-07-13T00:00:00.000Z'));
  for (let index = 0; index < 260; index += 1) {
    session = appendCreatorSessionEvent(session, 'workflow_navigated', { action: 'focusTimeline', index }, new Date(1_784_000_000_000 + index));
  }
  assert.equal(session.events.length, 240);
  assert.equal(session.events.at(-1)?.metadata.index, 259);
});

test('앱은 전역 명령 검색·키보드 단축키·로컬 세션 기록 패널을 제공한다', () => {
  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const paletteSource = readFileSync(new URL('../src/components/CommandPalette.tsx', import.meta.url), 'utf8');
  const sessionSource = readFileSync(new URL('../src/domain/sessionInsights.ts', import.meta.url), 'utf8');
  assert.ok(appSource.includes("modifier && key === 'k'"));
  assert.ok(appSource.includes("event.code === 'Space'"));
  assert.ok(appSource.includes('<CommandPalette'));
  assert.ok(appSource.includes('<SessionInsightsPanel'));
  assert.ok(paletteSource.includes('ArrowDown'));
  assert.ok(sessionSource.includes('FORBIDDEN_METADATA_KEYS'));
});

test('브라우저 스모크는 로컬 URL 정책 차단 시 CDP 단일 번들로 앱과 명령 검색을 검증한다', () => {
  const script = readFileSync(new URL('../scripts/browser-smoke.mjs', import.meta.url), 'utf8');
  assert.ok(script.includes('startStaticServer'));
  assert.ok(script.includes('buildInjectedAppBundle'));
  assert.ok(script.includes("executionMode = 'cdp-injected'"));
  assert.ok(script.includes('[role="dialog"][aria-label="명령 검색"]'));
  assert.ok(script.includes('--report='));
  assert.ok(script.includes('--platform='));
});

test('데스크톱 CI는 세 운영체제 증거를 모아 최종 strict 릴리스 게이트를 실행한다', () => {
  const workflow = readFileSync(new URL('../.github/workflows/desktop-build.yml', import.meta.url), 'utf8');
  const gateScript = readFileSync(new URL('../scripts/release-gate.mjs', import.meta.url), 'utf8');
  assert.ok(workflow.includes('release-gate:'));
  assert.ok(workflow.includes('actions/download-artifact@v4'));
  assert.ok(workflow.includes('merge-multiple: true'));
  assert.ok(workflow.includes('npm run release:gate:strict'));
  assert.ok(workflow.includes('BROWSER_SMOKE_${{ matrix.artifact_platform }}.json'));
  assert.ok(gateScript.includes('browser-smoke-platforms'));
  assert.ok(gateScript.includes('platformBrowsers.length'));
  assert.ok(gateScript.includes('nativeReports.length'));
});

test('온보딩 화면은 현재 RC 패키지 버전을 표시한다', () => {
  const onboarding = readFileSync(new URL('../src/components/Onboarding.tsx', import.meta.url), 'utf8');
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const rcLabel = packageJson.version.replace('1.0.0-rc.', 'AI Scene Director 1.0 RC');
  assert.ok(onboarding.includes(rcLabel));
});

test('Tauri 앱은 실제 WebView 완료 이벤트로 네이티브 런타임 스모크를 보고한다', () => {
  const source = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
  assert.ok(source.includes('AISD_NATIVE_SMOKE_REPORT'));
  assert.ok(source.includes('.on_page_load'));
  assert.ok(source.includes('PageLoadEvent::Finished'));
  assert.ok(source.includes('"pass", true'));
  assert.ok(source.includes('app_handle.exit(0)'));
  assert.ok(source.includes('app_handle.exit(2)'));
});

test('네이티브 런타임 스모크 실행기는 플랫폼 바이너리와 Linux Xvfb를 지원한다', () => {
  const source = readFileSync(new URL('../scripts/native-runtime-smoke.mjs', import.meta.url), 'utf8');
  assert.ok(source.includes('AISD_NATIVE_SMOKE_REPORT'));
  assert.ok(source.includes("normalizedPlatform === 'windows'"));
  assert.ok(source.includes("normalizedPlatform === 'macos'"));
  assert.ok(source.includes("commandExists('xvfb-run')"));
  assert.ok(source.includes("status !== 'pass'"));
});

test('데스크톱 CI와 최종 게이트는 3개 OS의 네이티브 런타임 보고서를 필수 증거로 사용한다', () => {
  const workflow = readFileSync(new URL('../.github/workflows/desktop-build.yml', import.meta.url), 'utf8');
  const gate = readFileSync(new URL('../scripts/release-gate.mjs', import.meta.url), 'utf8');
  assert.ok(workflow.includes('npm run native:smoke'));
  assert.ok(workflow.includes('NATIVE_RUNTIME_${{ matrix.artifact_platform }}.json'));
  assert.ok(workflow.includes('NATIVE_RUNTIME_*.json'));
  assert.ok(gate.includes("id: 'native-runtime'"));
  assert.ok(gate.includes('nativeRuntimeReports.length'));
  assert.ok(gate.includes('nativeRuntimePlatforms'));
});

test('React 편집기는 Tauri 런타임에 실제 마운트 준비 완료를 보고한다', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const bridge = readFileSync(new URL('../src/domain/desktopBridge.ts', import.meta.url), 'utf8');
  const rust = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
  assert.ok(app.includes('reportNativeSmokeReady'));
  assert.ok(app.includes('requestAnimationFrame'));
  assert.ok(bridge.includes("invoke<boolean>('native_smoke_ready')"));
  assert.ok(rust.includes('fn native_smoke_ready'));
  assert.ok(rust.includes('reactReady'));
  assert.ok(rust.includes('react readiness timeout'));
});


test('동일한 버전과 릴리스 실행 ID를 가진 3개 OS 증거만 무결성 검사를 통과한다', () => {
  const sha = 'a'.repeat(64);
  const evidence = (platform: 'linux' | 'windows' | 'macos') => ({
    browser: {
      status: 'pass', platform, version: '1.0.0-rc.13', releaseId: 'release-test-001', generatedAt: '2026-07-13T00:00:00.000Z',
      interaction: { commandPaletteOpen: true, commandInputFocused: true, commandCount: 21, buttonCount: 90 },
    },
    artifacts: {
      status: 'pass', platform, version: '1.0.0-rc.13', releaseId: 'release-test-001', generatedAt: '2026-07-13T00:00:01.000Z',
      artifacts: [{ path: `bundle/${platform}/installer`, bytes: 1024, sha256: sha }],
    },
    runtime: {
      status: 'pass', platform, version: '1.0.0-rc.13', appVersion: '1.0.0-rc.13', releaseId: 'release-test-001', generatedAt: '2026-07-13T00:00:02.000Z',
      webviewLoaded: true, reactReady: true, exitCode: 0, executableBytes: 2048, executableSha256: sha,
    },
  });
  const result = validateReleaseEvidenceMatrix({ linux: evidence('linux'), windows: evidence('windows'), macos: evidence('macos') }, '1.0.0-rc.13', 'release-test-001');
  assert.equal(result.status, 'pass');
  assert.equal(result.releaseId, 'release-test-001');
  assert.ok(result.platforms.every((platform) => platform.status === 'pass'));
});

test('다른 CI 실행의 증거·잘못된 체크섬·React 미준비 보고서는 릴리스 증거에서 차단한다', () => {
  const result = validatePlatformReleaseEvidence('linux', {
    browser: {
      status: 'pass', platform: 'linux', version: '1.0.0-rc.13', releaseId: 'release-a', generatedAt: '2026-07-13T00:00:00.000Z',
      interaction: { commandPaletteOpen: true, commandInputFocused: true, commandCount: 21, buttonCount: 90 },
    },
    artifacts: {
      status: 'pass', platform: 'linux', version: '1.0.0-rc.13', releaseId: 'release-b', generatedAt: '2026-07-13T00:00:01.000Z',
      artifacts: [{ path: 'bundle/app.deb', bytes: 1024, sha256: 'not-a-sha' }],
    },
    runtime: {
      status: 'pass', platform: 'linux', version: '1.0.0-rc.13', appVersion: '1.0.0-rc.8', releaseId: 'release-a', generatedAt: '2026-07-13T00:00:02.000Z',
      webviewLoaded: true, reactReady: false, exitCode: 2, executableBytes: 2048, executableSha256: 'b'.repeat(64),
    },
  }, '1.0.0-rc.13', 'release-a');
  assert.equal(result.status, 'fail');
  assert.ok(result.issues.some((issue) => issue.includes('실행 ID')));
  assert.ok(result.issues.some((issue) => issue.includes('SHA-256')));
  assert.ok(result.issues.some((issue) => issue.includes('React')));
  assert.ok(result.issues.some((issue) => issue.includes('버전')));
});

test('RC13 릴리스 파이프라인은 증거 ID·체크섬 매니페스트와 1.0 승격 차단 도구를 포함한다', () => {
  const workflow = readFileSync(new URL('../.github/workflows/desktop-build.yml', import.meta.url), 'utf8');
  const gate = readFileSync(new URL('../scripts/release-gate.mjs', import.meta.url), 'utf8');
  const promote = readFileSync(new URL('../scripts/promote-release.mjs', import.meta.url), 'utf8');
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(workflow.includes('AISD_RELEASE_ID'));
  assert.ok(workflow.includes('RELEASE_EVIDENCE_MANIFEST.json'));
  assert.ok(gate.includes('validateReleaseEvidenceMatrix'));
  assert.ok(gate.includes("id: 'release-evidence-integrity'"));
  assert.ok(gate.includes('RELEASE_EVIDENCE_MANIFEST.json'));
  assert.ok(promote.includes("gate.status !== 'ready'"));
  assert.ok(promote.includes("gate.evidence?.validation?.status !== 'pass'"));
  assert.equal(packageJson.scripts['release:promotion:check'], 'node scripts/promote-release.mjs');
});


test('자유 시점 기본 프레임은 피사체의 정면인 -Z 쪽에 배치된다', () => {
  const project = cloneSample();
  const scene = project.scenes[0];
  scene.entities.push({
    id: 'back-wall-test', name: '거대한 뒷벽', type: 'prop',
    transform: { position: [0, 3, 4], rotation: [0, 0, 0], scale: [20, 6, 0.2] },
    visible: true, locked: true,
    asset: { category: 'architecture', primitive: 'box', color: '#fff', material: 'matte', source: 'preset', tags: ['wall'] },
  });
  const frame = computeFrontViewFrame(scene.entities);
  assert.ok(frame.position[2] < frame.target[2], '카메라는 피사체의 -Z 정면에 있어야 한다');
  assert.ok(frame.target[2] < 2, '거대한 프리셋 뒷벽이 피사체 중심 계산을 가리지 않아야 한다');
  assert.ok(frame.distance >= 5.5);
});

test('항상 접근 가능한 사용법과 정면 맞춤 UI를 제공한다', () => {
  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const viewportSource = readFileSync(new URL('../src/components/Viewport.tsx', import.meta.url), 'utf8');
  const onboardingSource = readFileSync(new URL('../src/components/Onboarding.tsx', import.meta.url), 'utf8');
  assert.match(appSource, />사용법<\/button>/);
  assert.match(viewportSource, /정면 맞춤/);
  assert.match(onboardingSource, /왼쪽 드래그: 시점 회전/);
  assert.match(onboardingSource, /AI 씬 생성으로 시작/);
});

test('UI polish는 핵심 작업 위계와 단일 노란색 강조 토큰을 제공한다', () => {
  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const styleSource = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(appSource, /className="brand-mark"/);
  assert.match(appSource, /className="header-menu advanced-menu tools-menu"/);
  assert.match(appSource, /className="header-menu project-menu"/);
  assert.match(styleSource, /--ui-primary:\s*#fcd535/i);
  assert.match(styleSource, /--ui-canvas:\s*#0b0e11/i);
  assert.match(styleSource, /prefers-reduced-motion/);
});


test('Shot Package 사전점검은 생성 파일과 현재 샷 요약을 제공한다', () => {
  const project = cloneSample();
  const scene = project.scenes[0];
  const shot = scene.shots[0];
  const result = buildShotExportPreflight(scene, shot, { renderAvailable: true });
  assert.equal(result.canExport, true);
  assert.equal(result.renderCount, 8);
  assert.equal(result.cameraName, scene.entities.find((entity) => entity.id === shot.cameraEntityId)?.name);
  assert.ok(result.groups.some((group) => group.files.some((file) => file.includes('Depth'))));
  assert.ok(result.groups.some((group) => group.files.some((file) => file.includes('Manifest'))));
});

test('카메라 누락과 3D 렌더 불가는 Shot Package 출력을 차단한다', () => {
  const project = cloneSample();
  const scene = project.scenes[0];
  const shot = structuredClone(scene.shots[0]);
  shot.cameraEntityId = 'missing-camera';
  const result = buildShotExportPreflight(scene, shot, { renderAvailable: false });
  assert.equal(result.status, 'blocked');
  assert.equal(result.canExport, false);
  assert.equal(result.quickAction, 'selectCamera');
  assert.ok(result.issues.some((issue) => issue.includes('3D 뷰포트')));
  assert.ok(result.issues.some((issue) => issue.includes('카메라')));
});

test('행동 충돌이 있는 Shot Package는 타임라인 수정을 우선 안내한다', () => {
  const project = cloneSample();
  const scene = project.scenes[0];
  const shot = structuredClone(scene.shots[0]);
  const actor = scene.entities.find((entity) => entity.type === 'character')!;
  shot.actions = [
    { id: 'walk-a', type: 'walk', actorEntityId: actor.id, startTime: 0, duration: 2, enabled: true, parameters: { distance: 1 } },
    { id: 'turn-a', type: 'turnAround', actorEntityId: actor.id, startTime: 1, duration: 2, enabled: true, parameters: { angle: Math.PI } },
  ];
  const result = buildShotExportPreflight(scene, shot, { renderAvailable: true });
  assert.equal(result.status, 'warning');
  assert.equal(result.quickAction, 'focusTimeline');
  assert.ok(result.issues.some((issue) => issue.includes('충돌')));
});

test('AI용 내보내기는 목적 선택과 사전점검 후에만 실제 렌더를 시작한다', () => {
  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const dialogSource = readFileSync(new URL('../src/components/AIExportDialog.tsx', import.meta.url), 'utf8');
  assert.ok(appSource.includes('requestAIExport'));
  assert.ok(appSource.includes('performAIExport'));
  assert.ok(appSource.includes('<AIExportDialog'));
  assert.ok(dialogSource.includes('이미지 생성용'));
  assert.ok(dialogSource.includes('영상 생성용'));
  assert.ok(dialogSource.includes('간단 내보내기'));
  assert.ok(dialogSource.includes('문제 수정으로 이동'));
  assert.equal((dialogSource.match(/>닫기<\/button>/g) ?? []).length, 0);
  assert.match(dialogSource, /className="ai-export-close"/);
});

test('AI용 내보내기 팝업은 중복 닫기를 제거하고 읽기 가능한 최소 글자 크기를 사용한다', () => {
  const dialogSource = readFileSync(new URL('../src/components/AIExportDialog.tsx', import.meta.url), 'utf8');
  const styleSource = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.equal((dialogSource.match(/onClick=\{onClose\}/g) ?? []).length, 1);
  assert.match(dialogSource, /title="닫기">×<\/button>/);
  assert.doesNotMatch(dialogSource, /<footer>\s*<button onClick=\{onClose\}>닫기<\/button>/s);
  assert.match(styleSource, /\.ai-export-mode-grid > button > small \{[^}]*font-size:\s*13px/s);
  assert.match(styleSource, /\.ai-export-plan ul \{[^}]*font-size:\s*13px/s);
  assert.match(styleSource, /\.ai-prompt-preview textarea \{[^}]*font-size:\s*13px/s);
});

test('노트북 브라우저 검증은 1366×768에서 잘림과 작업 영역 높이를 검사한다', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const smokeSource = readFileSync(new URL('../scripts/browser-smoke.mjs', import.meta.url), 'utf8');
  const styleSource = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.ok(packageJson.scripts['browser:smoke:notebook'].includes('--profile=notebook'));
  assert.ok(packageJson.scripts['verify:rc'].includes('browser:smoke:notebook'));
  assert.ok(smokeSource.includes('1366'));
  assert.ok(smokeSource.includes('horizontalOverflow'));
  assert.ok(smokeSource.includes('작업 영역 높이가 220px보다 작습니다'));
  assert.ok(styleSource.includes('@media (max-height: 820px)'));
});


test('핵심 제품 흐름은 장면 만들기·수정·AI용 내보내기로 표시된다', () => {
  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(appSource, />장면 만들기<\/span>/);
  assert.match(appSource, />장면 수정하기<\/span>/);
  assert.match(appSource, /AI용 내보내기/);
  assert.match(appSource, /<summary>고급 도구<\/summary>/);
  assert.match(appSource, /ComfyUI 연결/);
  assert.match(appSource, /JSON 내보내기/);
});

test('재생은 완성 결과가 아닌 동작 미리보기와 검수로 설명된다', () => {
  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const commandSource = readFileSync(new URL('../src/domain/commandPalette.ts', import.meta.url), 'utf8');
  assert.match(appSource, /동작 미리보기/);
  assert.match(appSource, /생성 전 움직임 검수/);
  assert.match(commandSource, /동작 미리보기·정지/);
});

test('리그 분석과 본 매핑은 에셋 카드의 고급 리그 안에 숨겨진다', () => {
  const assetSource = readFileSync(new URL('../src/components/AssetLibraryPanel.tsx', import.meta.url), 'utf8');
  assert.match(assetSource, /className="asset-advanced-tools"/);
  assert.match(assetSource, /<summary>고급 리그<\/summary>/);
  assert.match(assetSource, /본 매핑·축 보정/);
});

test('첫 수정 안내는 뷰포트 위에 뜨지 않고 독립된 workspace 행을 사용한다', () => {
  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const styleSource = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(appSource, /className="first-edit-guide" role="status" aria-label="첫 수정 안내"/);
  assert.match(styleSource, /\.workspace\s*\{\s*grid-template-rows:\s*auto auto minmax\(0, 1fr\)/s);
  assert.match(styleSource, /\.first-edit-guide\s*\{[^}]*position:\s*relative;[^}]*grid-column:\s*1 \/ -1;[^}]*grid-row:\s*2;/s);
  assert.match(styleSource, /\.hierarchy\s*\{\s*grid-column:\s*1;\s*grid-row:\s*3;\s*\}/s);
  assert.match(styleSource, /\.viewport\s*\{\s*grid-column:\s*2;\s*grid-row:\s*3;\s*\}/s);
  assert.match(styleSource, /\.inspector\s*\{\s*grid-column:\s*3;\s*grid-row:\s*3;\s*\}/s);
});

test('브라우저 스모크는 첫 수정 안내와 뷰포트 툴바의 겹침을 실제 좌표로 검사한다', () => {
  const smokeSource = readFileSync(new URL('../scripts/browser-smoke.mjs', import.meta.url), 'utf8');
  assert.match(smokeSource, /firstEditLayout/);
  assert.match(smokeSource, /\.first-edit-guide/);
  assert.match(smokeSource, /\.viewport-toolbar/);
  assert.match(smokeSource, /첫 수정 안내가 표시되지 않았거나 뷰포트 툴바와 겹칩니다/);
});

test('메인 편집 화면은 패널·객체·샷·타임라인에 읽기 가능한 폰트 스케일을 사용한다', () => {
  const styleSource = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(styleSource, /--ui-type-body:\s*13px/);
  assert.match(styleSource, /\.panel h2 \{ font-size:\s*16px/);
  assert.match(styleSource, /\.entity strong \{ font-size:\s*14px/);
  assert.match(styleSource, /\.entity small \{ font-size:\s*11px/);
  assert.match(styleSource, /\.viewport-toolbar button \{ font-size:\s*13px/);
  assert.match(styleSource, /\.shot span \{ font-size:\s*12px/);
  assert.match(styleSource, /\.timeline-empty \{ font-size:\s*13px/);
  assert.match(styleSource, /\.command-bar input, \.command-bar select, \.command-bar button \{ font-size:\s*13px/);
});

test('AI용 내보내기 사용법은 별도 전체 페이지에서 초보·영상·ComfyUI 흐름을 설명한다', () => {
  const guideSource = readFileSync(new URL('../src/components/AIExportGuidePage.tsx', import.meta.url), 'utf8');
  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const dialogSource = readFileSync(new URL('../src/components/AIExportDialog.tsx', import.meta.url), 'utf8');
  assert.match(guideSource, /내보낸 자료를 생성 AI에 적용하는 방법/);
  assert.match(guideSource, /기준 이미지와 최종 프롬프트만 사용해도 됩니다/);
  assert.match(guideSource, /reference\.png/);
  assert.match(guideSource, /start_frame\.png/);
  assert.match(guideSource, /Pose ControlNet/);
  assert.match(guideSource, /shot_manifest\.json/);
  assert.match(guideSource, /이미지용 자료 만들기/);
  assert.match(guideSource, /영상용 자료 만들기/);
  assert.match(guideSource, /생성 서비스로 이동하는 버튼이 아니라/);
  assert.match(dialogSource, /내보낸 자료 사용법/);
  assert.match(appSource, /<AIExportGuidePage/);
  assert.match(appSource, /onOpenExport=\{openAIExportFromGuide\}/);
});



test('사용법의 이미지·영상 버튼은 생성 서비스를 연다는 오해 없이 ZIP 자료 설정으로 연결된다', () => {
  const guideSource = readFileSync(new URL('../src/components/AIExportGuidePage.tsx', import.meta.url), 'utf8');
  const dialogSource = readFileSync(new URL('../src/components/AIExportDialog.tsx', import.meta.url), 'utf8');
  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(guideSource, /영상 생성용 열기/);
  assert.doesNotMatch(guideSource, /이미지 생성용 열기/);
  assert.match(guideSource, /영상용 ZIP 설정 열기/);
  assert.match(dialogSource, /영상 생성용 자료 만들기/);
  assert.match(dialogSource, /영상 생성 사이트로 이동하지 않습니다/);
  assert.match(dialogSource, /영상 AI 자료 ZIP 만들기/);
  assert.match(appSource, /aiExportReturnToGuide/);
  assert.match(appSource, /const closeAIExport/);
});

test('AI용 내보내기 사용법은 헤더의 AI용 내보내기 바로 오른쪽에서 직접 열 수 있다', () => {
  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const styleSource = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const smokeSource = readFileSync(new URL('../scripts/browser-smoke.mjs', import.meta.url), 'utf8');
  assert.match(appSource, /primary-export[\s\S]*export-guide-header-button/);
  assert.match(appSource, /내보내기 사용법/);
  assert.match(appSource, /onClick=\{openAIExportGuide\}/);
  assert.match(appSource, /data-guide-entry="header"/);
  assert.match(styleSource, /\.export-guide-header-button\s*\{[^}]*min-width:\s*128px;[^}]*display:\s*inline-flex !important;/s);
  assert.match(styleSource, /@media \(max-width: 1320px\)[\s\S]*\.export-guide-header-button \.export-guide-label-prefix/);
  assert.doesNotMatch(styleSource, /\.export-guide-header-button \.export-guide-label\s*\{[^}]*display:\s*none/);
  assert.match(smokeSource, /headerGuideEntry/);
  assert.match(smokeSource, /헤더의 내보내기 사용법 버튼이 보이지 않거나/);
  assert.match(smokeSource, /document\.querySelector\('\.export-guide-header-button'\)\?\.click\(\)/);
});

test('AI용 내보내기 사용법 페이지는 읽기 가능한 타이포그래피와 브라우저 상호작용 검사를 가진다', () => {
  const styleSource = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const smokeSource = readFileSync(new URL('../scripts/browser-smoke.mjs', import.meta.url), 'utf8');
  assert.match(styleSource, /\.ai-export-guide-page\s*\{[^}]*position:\s*fixed;/s);
  assert.match(styleSource, /\.ai-export-guide-hero p\s*\{[^}]*font-size:\s*15px/s);
  assert.match(styleSource, /\.guide-file-row > \*\s*\{[^}]*font-size:\s*13px/s);
  assert.match(styleSource, /\.guide-final-cta h2\s*\{[^}]*font-size:\s*22px/s);
  assert.match(smokeSource, /ai-export-guide-title/);
  assert.match(smokeSource, /기준 이미지와 최종 프롬프트/);
  assert.match(smokeSource, /AI용 내보내기 사용법 페이지가 열리지 않았거나 핵심 설명이 누락됐습니다/);
  assert.match(smokeSource, /사용법 페이지에서 영상 내보내기 화면으로 이동하지 못했습니다/);
  assert.match(smokeSource, /사용법에서 연 내보내기 설정을 닫았을 때 사용법 페이지로 돌아오지 못했습니다/);
});
