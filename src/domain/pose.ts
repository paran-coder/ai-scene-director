import { Euler, Object3D, Quaternion, Vector3 } from 'three';
import { JOINT_NAMES, type HumanoidLegProportions, type HumanoidRigProportions, type JointName, type PoseState, type Vec3 } from './types.ts';

const V = (x = 0, y = 0, z = 0): Vec3 => [x, y, z];
const DEG = Math.PI / 180;

export function createNeutralPose(): PoseState {
  return Object.fromEntries(JOINT_NAMES.map((joint) => [joint, V()])) as PoseState;
}

function poseWith(changes: Partial<Record<JointName, Vec3>>): PoseState {
  return { ...createNeutralPose(), ...structuredClone(changes) };
}

export interface PosePreset {
  id: string;
  name: string;
  pose: PoseState;
}

export const POSE_PRESETS: PosePreset[] = [
  { id: 'neutral', name: '중립', pose: createNeutralPose() },
  {
    id: 't-pose', name: 'T 포즈', pose: poseWith({
      leftShoulder: V(0, 0, -90 * DEG),
      rightShoulder: V(0, 0, 90 * DEG),
    }),
  },
  {
    id: 'wave', name: '손 흔들기', pose: poseWith({
      rightShoulder: V(-35 * DEG, 0, 115 * DEG),
      rightElbow: V(0, 0, -75 * DEG),
      rightWrist: V(0, 0, 20 * DEG),
      chest: V(0, -8 * DEG, 0),
      head: V(0, 8 * DEG, 0),
    }),
  },
  {
    id: 'arms-crossed', name: '팔짱', pose: poseWith({
      leftShoulder: V(-20 * DEG, 20 * DEG, -35 * DEG),
      leftElbow: V(10 * DEG, 0, -105 * DEG),
      rightShoulder: V(-20 * DEG, -20 * DEG, 35 * DEG),
      rightElbow: V(10 * DEG, 0, 105 * DEG),
    }),
  },
  {
    id: 'conversation', name: '대화 자세', pose: poseWith({
      leftShoulder: V(-12 * DEG, 0, -22 * DEG),
      leftElbow: V(0, 0, -45 * DEG),
      rightShoulder: V(-25 * DEG, 0, 35 * DEG),
      rightElbow: V(0, 0, 65 * DEG),
      chest: V(0, -7 * DEG, 0),
      head: V(0, 10 * DEG, 0),
    }),
  },
  {
    id: 'seated', name: '앉기', pose: poseWith({
      leftHip: V(-85 * DEG, 0, 0),
      rightHip: V(-85 * DEG, 0, 0),
      leftKnee: V(95 * DEG, 0, 0),
      rightKnee: V(95 * DEG, 0, 0),
      spine: V(8 * DEG, 0, 0),
    }),
  },
  {
    id: 'running', name: '달리기', pose: poseWith({
      chest: V(12 * DEG, 0, 0),
      leftShoulder: V(-45 * DEG, 0, -8 * DEG),
      leftElbow: V(0, 0, -75 * DEG),
      rightShoulder: V(45 * DEG, 0, 8 * DEG),
      rightElbow: V(0, 0, 75 * DEG),
      leftHip: V(45 * DEG, 0, 0),
      leftKnee: V(-70 * DEG, 0, 0),
      rightHip: V(-55 * DEG, 0, 0),
      rightKnee: V(80 * DEG, 0, 0),
    }),
  },
  {
    id: 'pointing', name: '가리키기', pose: poseWith({
      rightShoulder: V(-70 * DEG, 0, 85 * DEG),
      rightElbow: V(0, 0, 8 * DEG),
      chest: V(0, -12 * DEG, 0),
      head: V(0, 12 * DEG, 0),
    }),
  },
];

export function findPosePreset(id: string): PosePreset | undefined {
  return POSE_PRESETS.find((preset) => preset.id === id);
}

export function mirrorPose(pose: PoseState): PoseState {
  const mirrored = createNeutralPose();
  const swapPairs: Array<[JointName, JointName]> = [
    ['leftShoulder', 'rightShoulder'],
    ['leftElbow', 'rightElbow'],
    ['leftWrist', 'rightWrist'],
    ['leftHip', 'rightHip'],
    ['leftKnee', 'rightKnee'],
    ['leftAnkle', 'rightAnkle'],
  ];
  const paired = new Set<JointName>();
  for (const [left, right] of swapPairs) {
    paired.add(left);
    paired.add(right);
    const l = pose[right];
    const r = pose[left];
    mirrored[left] = [l[0], -l[1], -l[2]];
    mirrored[right] = [r[0], -r[1], -r[2]];
  }
  for (const joint of JOINT_NAMES) {
    if (paired.has(joint)) continue;
    const value = pose[joint];
    mirrored[joint] = [value[0], -value[1], -value[2]];
  }
  return mirrored;
}

function setRotation(object: Object3D, rotation: Vec3): void {
  object.rotation.set(rotation[0], rotation[1], rotation[2], 'XYZ');
}

function createTorsoFrame(pose: PoseState, pelvisHeight = 0.9): { root: Object3D; chest: Object3D } {
  const root = new Object3D();
  root.position.set(0, pelvisHeight, 0);
  setRotation(root, pose.pelvis);

  const spine = new Object3D();
  spine.position.set(0, 0.18, 0);
  setRotation(spine, pose.spine);
  root.add(spine);

  const chest = new Object3D();
  chest.position.set(0, 0.25, 0);
  setRotation(chest, pose.chest);
  spine.add(chest);
  root.updateMatrixWorld(true);
  return { root, chest };
}

function armProportions(side: 'left' | 'right', proportions?: HumanoidRigProportions) {
  return proportions?.[`${side}Arm`] ?? {
    shoulderOffset: [side === 'left' ? -0.32 : 0.32, 0.16, 0] as Vec3,
    upperLength: 0.34,
    lowerLength: 0.32,
  };
}

export function calculateHandLocalPosition(pose: PoseState, side: 'left' | 'right', proportions?: HumanoidRigProportions): Vec3 {
  const { root, chest } = createTorsoFrame(pose, proportions?.pelvisHeight ?? 0.9);
  const metrics = armProportions(side, proportions);
  const shoulder = new Object3D();
  shoulder.position.set(...metrics.shoulderOffset);
  setRotation(shoulder, pose[`${side}Shoulder`]);
  chest.add(shoulder);

  const elbow = new Object3D();
  elbow.position.set(0, -metrics.upperLength, 0);
  setRotation(elbow, pose[`${side}Elbow`]);
  shoulder.add(elbow);

  const wrist = new Object3D();
  wrist.position.set(0, -metrics.lowerLength, 0);
  setRotation(wrist, pose[`${side}Wrist`]);
  elbow.add(wrist);

  root.updateMatrixWorld(true);
  const result = wrist.getWorldPosition(new Vector3());
  return result.toArray() as Vec3;
}

function quaternionToVec3(quaternion: Quaternion): Vec3 {
  const euler = new Euler().setFromQuaternion(quaternion, 'XYZ');
  return [euler.x, euler.y, euler.z];
}

export function solveArmIK(pose: PoseState, side: 'left' | 'right', target: Vec3, proportions?: HumanoidRigProportions): PoseState {
  const next = structuredClone(pose);
  const { root, chest } = createTorsoFrame(pose, proportions?.pelvisHeight ?? 0.9);
  const targetInCharacter = new Vector3(...target);
  const targetInChest = chest.worldToLocal(targetInCharacter.clone());
  const metrics = armProportions(side, proportions);
  const shoulderPosition = new Vector3(...metrics.shoulderOffset);
  const toTarget = targetInChest.sub(shoulderPosition);

  const upperLength = metrics.upperLength;
  const lowerLength = metrics.lowerLength;
  const rawDistance = Math.max(0.03, toTarget.length());
  const distance = Math.min(upperLength + lowerLength - 0.002, Math.max(Math.abs(upperLength - lowerLength) + 0.002, rawDistance));
  const direction = toTarget.normalize();
  const clampedTarget = shoulderPosition.clone().addScaledVector(direction, distance);

  let pole = new Vector3(0, 0, 1);
  pole.sub(direction.clone().multiplyScalar(pole.dot(direction)));
  if (pole.lengthSq() < 1e-5) pole = new Vector3(1, 0, 0);
  pole.normalize();

  const along = (upperLength * upperLength - lowerLength * lowerLength + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
  const elbowPosition = shoulderPosition.clone()
    .addScaledVector(direction, along)
    .addScaledVector(pole, height);

  const upperDirection = elbowPosition.clone().sub(shoulderPosition).normalize();
  const lowerDirection = clampedTarget.clone().sub(elbowPosition).normalize();
  const down = new Vector3(0, -1, 0);

  const shoulderQuaternion = new Quaternion().setFromUnitVectors(down, upperDirection);
  const forearmWorldQuaternion = new Quaternion().setFromUnitVectors(down, lowerDirection);
  const elbowQuaternion = shoulderQuaternion.clone().invert().multiply(forearmWorldQuaternion);

  next[`${side}Shoulder`] = quaternionToVec3(shoulderQuaternion);
  next[`${side}Elbow`] = quaternionToVec3(elbowQuaternion);
  next[`${side}Wrist`] = [0, 0, 0];
  root.clear();
  return next;
}


function legProportions(side: 'left' | 'right', proportions?: HumanoidRigProportions): HumanoidLegProportions {
  return proportions?.[`${side}Leg`] ?? {
    hipOffset: [side === 'left' ? -0.16 : 0.16, -0.08, 0],
    upperLength: 0.44,
    lowerLength: 0.42,
    footLength: 0.29,
  };
}

function createLegFrame(pose: PoseState, side: 'left' | 'right', proportions?: HumanoidRigProportions): { root: Object3D; hip: Object3D; knee: Object3D; ankle: Object3D } {
  const root = new Object3D();
  root.position.set(0, proportions?.pelvisHeight ?? 0.9, 0);
  setRotation(root, pose.pelvis);
  const metrics = legProportions(side, proportions);
  const hip = new Object3D();
  hip.position.set(...metrics.hipOffset);
  setRotation(hip, pose[`${side}Hip`]);
  root.add(hip);
  const knee = new Object3D();
  knee.position.set(0, -metrics.upperLength, 0);
  setRotation(knee, pose[`${side}Knee`]);
  hip.add(knee);
  const ankle = new Object3D();
  ankle.position.set(0, -metrics.lowerLength, 0);
  setRotation(ankle, pose[`${side}Ankle`]);
  knee.add(ankle);
  root.updateMatrixWorld(true);
  return { root, hip, knee, ankle };
}

export function calculateAnkleLocalPosition(pose: PoseState, side: 'left' | 'right', proportions?: HumanoidRigProportions): Vec3 {
  const { ankle } = createLegFrame(pose, side, proportions);
  return ankle.getWorldPosition(new Vector3()).toArray() as Vec3;
}

export function solveLegIK(pose: PoseState, side: 'left' | 'right', target: Vec3, proportions?: HumanoidRigProportions): PoseState {
  const next = structuredClone(pose);
  const metrics = legProportions(side, proportions);
  const root = new Object3D();
  root.position.set(0, proportions?.pelvisHeight ?? 0.9, 0);
  setRotation(root, pose.pelvis);
  root.updateMatrixWorld(true);

  const targetInPelvis = root.worldToLocal(new Vector3(...target));
  const hipPosition = new Vector3(...metrics.hipOffset);
  const toTarget = targetInPelvis.sub(hipPosition);
  const rawDistance = Math.max(0.03, toTarget.length());
  const distance = Math.min(
    metrics.upperLength + metrics.lowerLength - 0.002,
    Math.max(Math.abs(metrics.upperLength - metrics.lowerLength) + 0.002, rawDistance),
  );
  const direction = toTarget.normalize();
  const clampedTarget = hipPosition.clone().addScaledVector(direction, distance);

  let pole = new Vector3(0, 0, -1);
  pole.sub(direction.clone().multiplyScalar(pole.dot(direction)));
  if (pole.lengthSq() < 1e-5) pole = new Vector3(side === 'left' ? -1 : 1, 0, 0);
  pole.normalize();

  const along = (metrics.upperLength ** 2 - metrics.lowerLength ** 2 + distance ** 2) / (2 * distance);
  const height = Math.sqrt(Math.max(0, metrics.upperLength ** 2 - along ** 2));
  const kneePosition = hipPosition.clone()
    .addScaledVector(direction, along)
    .addScaledVector(pole, height);
  const upperDirection = kneePosition.clone().sub(hipPosition).normalize();
  const lowerDirection = clampedTarget.clone().sub(kneePosition).normalize();
  const down = new Vector3(0, -1, 0);
  const hipQuaternion = new Quaternion().setFromUnitVectors(down, upperDirection);
  const lowerWorldQuaternion = new Quaternion().setFromUnitVectors(down, lowerDirection);
  const kneeQuaternion = hipQuaternion.clone().invert().multiply(lowerWorldQuaternion);

  next[`${side}Hip`] = quaternionToVec3(hipQuaternion);
  next[`${side}Knee`] = quaternionToVec3(kneeQuaternion);
  next[`${side}Ankle`] = [0, 0, 0];
  return next;
}

export function groundFeet(pose: PoseState, proportions?: HumanoidRigProportions, groundY = 0): PoseState {
  let next = structuredClone(pose);
  const left = calculateAnkleLocalPosition(next, 'left', proportions);
  const right = calculateAnkleLocalPosition(next, 'right', proportions);
  const leftClearance = Math.max(0.04, (proportions?.leftLeg.footLength ?? 0.29) * 0.28);
  const rightClearance = Math.max(0.04, (proportions?.rightLeg.footLength ?? 0.29) * 0.28);
  next = solveLegIK(next, 'left', [left[0], groundY + leftClearance, left[2]], proportions);
  next = solveLegIK(next, 'right', [right[0], groundY + rightClearance, right[2]], proportions);
  return next;
}

export function calculateHumanoidJointLocalPositions(pose: PoseState, proportions?: HumanoidRigProportions): Partial<Record<JointName, Vec3>> {
  const root = new Object3D();
  root.position.set(0, proportions?.pelvisHeight ?? 0.9, 0);
  root.name = 'pelvis';
  setRotation(root, pose.pelvis);
  const nodes: Partial<Record<JointName, Object3D>> = { pelvis: root };
  const add = (joint: JointName, parent: Object3D, position: Vec3) => {
    const object = new Object3D();
    object.name = joint;
    object.position.set(...position);
    setRotation(object, pose[joint]);
    parent.add(object);
    nodes[joint] = object;
    return object;
  };
  const spine = add('spine', root, [0, 0.18, 0]);
  const chest = add('chest', spine, [0, 0.25, 0]);
  const neck = add('neck', chest, [0, 0.24, 0]);
  add('head', neck, [0, 0.15, 0]);
  for (const side of ['left', 'right'] as const) {
    const arm = armProportions(side, proportions);
    const shoulder = add(`${side}Shoulder`, chest, arm.shoulderOffset);
    const elbow = add(`${side}Elbow`, shoulder, [0, -arm.upperLength, 0]);
    add(`${side}Wrist`, elbow, [0, -arm.lowerLength, 0]);
    const leg = legProportions(side, proportions);
    const hip = add(`${side}Hip`, root, leg.hipOffset);
    const knee = add(`${side}Knee`, hip, [0, -leg.upperLength, 0]);
    add(`${side}Ankle`, knee, [0, -leg.lowerLength, 0]);
  }
  root.updateMatrixWorld(true);
  const result: Partial<Record<JointName, Vec3>> = {};
  for (const joint of JOINT_NAMES) {
    const object = nodes[joint];
    if (object) result[joint] = object.getWorldPosition(new Vector3()).toArray() as Vec3;
  }
  return result;
}
