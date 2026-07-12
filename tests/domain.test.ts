import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateHandLocalPosition, findPosePreset, solveArmIK } from '../src/domain/pose.ts';
import { buildMotionPrompt, buildShotPackageManifest, buildShotPrompt, createStoredZip } from '../src/domain/export.ts';
import { resolveEntity, resolveScene, resolveSceneAtTime } from '../src/domain/resolver.ts';
import { sampleProject } from '../src/domain/sampleProject.ts';
import { applyTransaction, revertTransaction } from '../src/domain/transactions.ts';
import type { ActionBlock, Relationship, Transaction } from '../src/domain/types.ts';
import { validateAndMigrateProject } from '../src/domain/validation.ts';
import { buildComfyViewUrl, createConnectionTestWorkflow, detectPotentialPaidNodes, extractComfyOutputs, normalizeComfyServerUrl, replaceWorkflowPlaceholders, validateWorkflow } from '../src/domain/comfyui.ts';
import { analyzeScenePrompt, buildSceneFromPlan, generateSceneFromPrompt } from '../src/domain/sceneGenerator.ts';

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
  assert.equal(result.project?.schemaVersion, '0.8.0');
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
  assert.equal(manifest.schemaVersion, '0.8.0');
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
  assert.equal(result.project?.schemaVersion, '0.8.0');
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

test('0.7 프로젝트는 0.8로 마이그레이션되고 Scene 설명을 보존한다', () => {
  const legacy = cloneSample() as unknown as Record<string, unknown>;
  legacy.schemaVersion = '0.7.0';
  const scenes = legacy.scenes as Array<Record<string, unknown>>;
  scenes[0].description = '테스트 장면 설명';
  const result = validateAndMigrateProject(legacy);
  assert.equal(result.success, true);
  assert.equal(result.project?.schemaVersion, '0.8.0');
  assert.equal(result.project?.scenes[0].description, '테스트 장면 설명');
});
