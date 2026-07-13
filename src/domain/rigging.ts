import { Euler, Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import {
  JOINT_NAMES,
  type HumanoidArmProportions,
  type HumanoidLegProportions,
  type HumanoidRigProfile,
  type HumanoidRigProportions,
  type JointName,
  type PoseState,
  type Vec3,
} from './types.ts';

const JSON_CHUNK_TYPE = 0x4e4f534a;
const DEFAULT_LEFT_ARM: HumanoidArmProportions = { shoulderOffset: [-0.32, 0.16, 0], upperLength: 0.34, lowerLength: 0.32 };
const DEFAULT_RIGHT_ARM: HumanoidArmProportions = { shoulderOffset: [0.32, 0.16, 0], upperLength: 0.34, lowerLength: 0.32 };
const DEFAULT_LEFT_LEG: HumanoidLegProportions = { hipOffset: [-0.16, -0.08, 0], upperLength: 0.44, lowerLength: 0.42, footLength: 0.29 };
const DEFAULT_RIGHT_LEG: HumanoidLegProportions = { hipOffset: [0.16, -0.08, 0], upperLength: 0.44, lowerLength: 0.42, footLength: 0.29 };

interface GltfNode {
  name?: string;
  children?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  matrix?: number[];
}
interface GltfSkin { joints?: number[]; skeleton?: number }
interface GltfAnimation { name?: string }
interface GltfJson { nodes?: GltfNode[]; skins?: GltfSkin[]; animations?: GltfAnimation[] }

const aliases: Record<JointName, string[]> = {
  pelvis: ['hips', 'hip', 'pelvis', 'root'],
  spine: ['spine', 'spine1', 'spine01', 'abdomen'],
  chest: ['spine2', 'spine02', 'chest', 'upperchest', 'upperbody'],
  neck: ['neck', 'neck1'],
  head: ['head'],
  leftShoulder: ['leftupperarm', 'leftarm', 'upperarml', 'lupperarm', 'arml', 'leftshoulder', 'lshoulder', 'shoulderl', 'leftclavicle', 'claviclel'],
  leftElbow: ['leftforearm', 'leftlowerarm', 'lelbow', 'forearml', 'lowerarml', 'llowerarm'],
  leftWrist: ['lefthand', 'leftwrist', 'lhand', 'handl', 'wristl'],
  rightShoulder: ['rightupperarm', 'rightarm', 'upperarmr', 'rupperarm', 'armr', 'rightshoulder', 'rshoulder', 'shoulderr', 'rightclavicle', 'clavicler'],
  rightElbow: ['rightforearm', 'rightlowerarm', 'relbow', 'forearmr', 'lowerarmr', 'rlowerarm'],
  rightWrist: ['righthand', 'rightwrist', 'rhand', 'handr', 'wristr'],
  leftHip: ['leftupleg', 'leftthigh', 'lthigh', 'thighl', 'upperlegl', 'lupperleg'],
  leftKnee: ['leftleg', 'leftlowerleg', 'leftshin', 'lknee', 'calfl', 'lowerlegl', 'llowerleg', 'shinl'],
  leftAnkle: ['leftfoot', 'leftankle', 'lfoot', 'footl', 'anklel'],
  rightHip: ['rightupleg', 'rightthigh', 'rthigh', 'thighr', 'upperlegr', 'rupperleg'],
  rightKnee: ['rightleg', 'rightlowerleg', 'rightshin', 'rknee', 'calfr', 'lowerlegr', 'rlowerleg', 'shinr'],
  rightAnkle: ['rightfoot', 'rightankle', 'rfoot', 'footr', 'ankler'],
};

function normalizeBoneName(value: string): string {
  return value.toLowerCase()
    .replace(/^mixamorig[:_]?/i, '')
    .replace(/^armature[|:_-]?/i, '')
    .replace(/[^a-z0-9]/g, '');
}

function parseGlbJson(bytes: Uint8Array): GltfJson {
  if (bytes.byteLength < 20) throw new Error('GLB JSON 청크가 없습니다.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) throw new Error('glTF 2.0 GLB가 아닙니다.');
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + length;
    if (end > bytes.byteLength) throw new Error('GLB 청크 길이가 올바르지 않습니다.');
    if (type === JSON_CHUNK_TYPE) {
      const jsonText = new TextDecoder().decode(bytes.slice(start, end)).replace(/\u0000+$/g, '').trim();
      return JSON.parse(jsonText) as GltfJson;
    }
    offset = end;
  }
  throw new Error('GLB JSON 청크를 찾지 못했습니다.');
}

function scoreCandidate(normalized: string, alias: string, aliasIndex: number): number {
  const priority = Math.max(0, 20 - aliasIndex);
  if (normalized === alias) return 100 + priority;
  if (normalized.endsWith(alias)) return 80 + priority;
  if (normalized.includes(alias)) return 60 + priority;
  return 0;
}

export function mapHumanoidBones(nodeNames: string[]): Partial<Record<JointName, string>> {
  const normalized = nodeNames.map((name) => ({ name, normalized: normalizeBoneName(name) }));
  const used = new Set<string>();
  const result: Partial<Record<JointName, string>> = {};
  for (const joint of JOINT_NAMES) {
    let best: { name: string; score: number } | null = null;
    for (const candidate of normalized) {
      if (!candidate.normalized || used.has(candidate.name)) continue;
      for (const [aliasIndex, alias] of aliases[joint].entries()) {
        const score = scoreCandidate(candidate.normalized, alias, aliasIndex);
        if (score > (best?.score ?? 0)) best = { name: candidate.name, score };
      }
    }
    if (best && best.score >= 60) {
      result[joint] = best.name;
      used.add(best.name);
    }
  }
  return result;
}

function finiteVec3(value: unknown, fallback: Vec3 = [0, 0, 0]): Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number' && Number.isFinite(item))
    ? [value[0], value[1], value[2]]
    : [...fallback];
}

export function rebuildHumanoidRigProfile(
  profile: HumanoidRigProfile,
  boneMap: Partial<Record<JointName, string>> = profile.boneMap,
  axisCorrections: Partial<Record<JointName, Vec3>> = profile.axisCorrections ?? {},
): HumanoidRigProfile {
  const used = new Set<string>();
  const cleanMap: Partial<Record<JointName, string>> = {};
  const cleanCorrections: Partial<Record<JointName, Vec3>> = {};
  for (const joint of JOINT_NAMES) {
    const bone = boneMap[joint];
    if (!bone || !profile.nodeNames.includes(bone) || used.has(bone)) continue;
    cleanMap[joint] = bone;
    used.add(bone);
    cleanCorrections[joint] = finiteVec3(axisCorrections[joint]);
  }
  const mappedJointCount = JOINT_NAMES.filter((joint) => Boolean(cleanMap[joint])).length;
  return {
    ...structuredClone(profile),
    boneMap: cleanMap,
    axisCorrections: cleanCorrections,
    mappedJointCount,
    missingJoints: JOINT_NAMES.filter((joint) => !cleanMap[joint]),
    status: mappedJointCount >= 14 ? 'humanoid' : mappedJointCount >= 7 ? 'partial' : 'none',
  };
}

function nodeLocalMatrix(node: GltfNode): Matrix4 {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) return new Matrix4().fromArray(node.matrix);
  const position = new Vector3(...finiteVec3(node.translation));
  const rotation = Array.isArray(node.rotation) && node.rotation.length === 4
    ? new Quaternion(node.rotation[0], node.rotation[1], node.rotation[2], node.rotation[3])
    : new Quaternion();
  const scale = new Vector3(...finiteVec3(node.scale, [1, 1, 1]));
  return new Matrix4().compose(position, rotation, scale);
}

function buildNodeWorldMatrices(nodes: GltfNode[]): Matrix4[] {
  const parents = new Array<number>(nodes.length).fill(-1);
  nodes.forEach((node, index) => (node.children ?? []).forEach((child) => { if (child >= 0 && child < nodes.length) parents[child] = index; }));
  const cache = new Map<number, Matrix4>();
  const visiting = new Set<number>();
  const resolve = (index: number): Matrix4 => {
    const existing = cache.get(index);
    if (existing) return existing.clone();
    if (visiting.has(index)) return nodeLocalMatrix(nodes[index] ?? {});
    visiting.add(index);
    const local = nodeLocalMatrix(nodes[index] ?? {});
    const parent = parents[index];
    const world = parent >= 0 ? resolve(parent).multiply(local) : local;
    visiting.delete(index);
    cache.set(index, world.clone());
    return world;
  };
  return nodes.map((_, index) => resolve(index));
}

function computeRigProportions(json: GltfJson, boneMap: Partial<Record<JointName, string>>): HumanoidRigProportions | undefined {
  const nodes = json.nodes ?? [];
  if (!nodes.length) return undefined;
  const indexByName = new Map<string, number>();
  nodes.forEach((node, index) => { if (node.name && !indexByName.has(node.name)) indexByName.set(node.name, index); });
  const worldMatrices = buildNodeWorldMatrices(nodes);
  const positions: Partial<Record<JointName, Vector3>> = {};
  for (const joint of JOINT_NAMES) {
    const name = boneMap[joint];
    const index = name ? indexByName.get(name) : undefined;
    if (index === undefined) continue;
    positions[joint] = new Vector3().setFromMatrixPosition(worldMatrices[index]);
  }
  const values = Object.values(positions).filter((position): position is Vector3 => Boolean(position));
  if (values.length < 4) return undefined;
  let minY = Infinity;
  let maxY = -Infinity;
  values.forEach((value) => { minY = Math.min(minY, value.y); maxY = Math.max(maxY, value.y); });
  let referenceHeight = maxY - minY;
  if (!Number.isFinite(referenceHeight) || referenceHeight < 0.1) {
    referenceHeight = positions.head && positions.pelvis ? positions.head.distanceTo(positions.pelvis) * 2 : 1.8;
  }
  const normalizationScale = 1.8 / Math.max(0.1, referenceHeight);
  const chestPosition = positions.chest ?? positions.spine ?? positions.pelvis ?? new Vector3();
  const arm = (side: 'left' | 'right', fallback: HumanoidArmProportions): HumanoidArmProportions => {
    const shoulder = positions[`${side}Shoulder`];
    const elbow = positions[`${side}Elbow`];
    const wrist = positions[`${side}Wrist`];
    if (!shoulder || !elbow || !wrist) return structuredClone(fallback);
    const shoulderOffset = shoulder.clone().sub(chestPosition).multiplyScalar(normalizationScale).toArray() as Vec3;
    const upperLength = shoulder.distanceTo(elbow) * normalizationScale;
    const lowerLength = elbow.distanceTo(wrist) * normalizationScale;
    return {
      shoulderOffset,
      upperLength: upperLength > 0.08 && upperLength < 1 ? upperLength : fallback.upperLength,
      lowerLength: lowerLength > 0.08 && lowerLength < 1 ? lowerLength : fallback.lowerLength,
    };
  };
  const pelvisPosition = positions.pelvis ?? new Vector3(0, minY + referenceHeight * 0.5, 0);
  const leg = (side: 'left' | 'right', fallback: HumanoidLegProportions): HumanoidLegProportions => {
    const hip = positions[`${side}Hip`];
    const knee = positions[`${side}Knee`];
    const ankle = positions[`${side}Ankle`];
    if (!hip || !knee || !ankle) return structuredClone(fallback);
    const hipOffset = hip.clone().sub(pelvisPosition).multiplyScalar(normalizationScale).toArray() as Vec3;
    const upperLength = hip.distanceTo(knee) * normalizationScale;
    const lowerLength = knee.distanceTo(ankle) * normalizationScale;
    const safeUpper = upperLength > 0.12 && upperLength < 1.2 ? upperLength : fallback.upperLength;
    const safeLower = lowerLength > 0.12 && lowerLength < 1.2 ? lowerLength : fallback.lowerLength;
    return {
      hipOffset,
      upperLength: safeUpper,
      lowerLength: safeLower,
      footLength: Math.max(0.16, Math.min(0.5, safeLower * 0.69)),
    };
  };
  const pelvisHeight = (pelvisPosition.y - minY) * normalizationScale;
  return {
    referenceHeight,
    pelvisHeight: Number.isFinite(pelvisHeight) && pelvisHeight > 0.45 && pelvisHeight < 1.4 ? pelvisHeight : 0.9,
    leftArm: arm('left', DEFAULT_LEFT_ARM),
    rightArm: arm('right', DEFAULT_RIGHT_ARM),
    leftLeg: leg('left', DEFAULT_LEFT_LEG),
    rightLeg: leg('right', DEFAULT_RIGHT_LEG),
  };
}

export async function analyzeGlbRig(blob: Blob): Promise<HumanoidRigProfile> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const json = parseGlbJson(bytes);
  const nodes = json.nodes ?? [];
  const skinJointIndices = new Set((json.skins ?? []).flatMap((skin) => skin.joints ?? []));
  const nodeNames = [...skinJointIndices]
    .map((index) => nodes[index]?.name)
    .filter((name): name is string => Boolean(name));
  const fallbackNames = nodes.map((node) => node.name).filter((name): name is string => Boolean(name));
  const candidateNames = nodeNames.length ? nodeNames : fallbackNames;
  const boneMap = mapHumanoidBones(candidateNames);
  const normalizedNames = candidateNames.map(normalizeBoneName);
  const detectedPreset = normalizedNames.some((name) => name.includes('mixamorig')) || fallbackNames.some((name) => /mixamorig/i.test(name))
    ? 'mixamo'
    : fallbackNames.some((name) => /j_bip_|vrm/i.test(name))
      ? 'vrm'
      : candidateNames.length ? 'generic' : 'none';
  return rebuildHumanoidRigProfile({
    status: 'none',
    detectedPreset,
    skeletonCount: (json.skins ?? []).length,
    nodeNames: candidateNames,
    boneMap,
    axisCorrections: {},
    proportions: computeRigProportions(json, boneMap),
    mappedJointCount: 0,
    missingJoints: [...JOINT_NAMES],
    animationClips: (json.animations ?? []).map((animation, index) => animation.name || `Animation ${index + 1}`),
  });
}

function markRestPose(root: Object3D): void {
  root.traverse((object) => {
    if (!object.name) return;
    if (!object.userData.aisdRestQuaternion) object.userData.aisdRestQuaternion = object.quaternion.toArray();
  });
}

export function applyHumanoidPoseToObject(root: Object3D, rig: HumanoidRigProfile | undefined, pose: PoseState | undefined): number {
  if (!rig || !pose || rig.status === 'none') return 0;
  markRestPose(root);
  const byName = new Map<string, Object3D>();
  root.traverse((object) => { if (object.name) byName.set(object.name, object); });
  let applied = 0;
  for (const joint of JOINT_NAMES) {
    const boneName = rig.boneMap[joint];
    const object = boneName ? byName.get(boneName) : undefined;
    if (!object) continue;
    const rest = object.userData.aisdRestQuaternion as number[] | undefined;
    if (!rest || rest.length !== 4) continue;
    const restQuaternion = new Quaternion(rest[0], rest[1], rest[2], rest[3]);
    const rotation = pose[joint];
    const delta = new Quaternion().setFromEuler(new Euler(rotation[0], rotation[1], rotation[2], 'XYZ'));
    const correctionEuler = rig.axisCorrections?.[joint] ?? [0, 0, 0];
    const correction = new Quaternion().setFromEuler(new Euler(correctionEuler[0], correctionEuler[1], correctionEuler[2], 'XYZ'));
    const convertedDelta = correction.clone().multiply(delta).multiply(correction.clone().invert());
    object.quaternion.copy(restQuaternion).multiply(convertedDelta);
    applied += 1;
  }
  root.updateMatrixWorld(true);
  return applied;
}

export function collectHumanoidJointPositions(root: Object3D, rig: HumanoidRigProfile | undefined): Partial<Record<JointName, Vec3>> {
  if (!rig || rig.status === 'none') return {};
  root.updateMatrixWorld(true);
  const byName = new Map<string, Object3D>();
  root.traverse((object) => { if (object.name) byName.set(object.name, object); });
  const result: Partial<Record<JointName, Vec3>> = {};
  const inverseRoot = root.matrixWorld.clone().invert();
  for (const joint of JOINT_NAMES) {
    const object = rig.boneMap[joint] ? byName.get(rig.boneMap[joint]!) : undefined;
    if (!object) continue;
    const position = object.getWorldPosition(new Vector3()).applyMatrix4(inverseRoot);
    result[joint] = position.toArray() as Vec3;
  }
  return result;
}
