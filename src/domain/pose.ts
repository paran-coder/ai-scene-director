import { Euler, Object3D, Quaternion, Vector3 } from 'three';
import { JOINT_NAMES, type JointName, type PoseState, type Vec3 } from './types.ts';

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

function createTorsoFrame(pose: PoseState): { root: Object3D; chest: Object3D } {
  const root = new Object3D();
  root.position.set(0, 0.9, 0);
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

export function calculateHandLocalPosition(pose: PoseState, side: 'left' | 'right'): Vec3 {
  const { root, chest } = createTorsoFrame(pose);
  const sign = side === 'left' ? -1 : 1;
  const shoulder = new Object3D();
  shoulder.position.set(sign * 0.32, 0.16, 0);
  setRotation(shoulder, pose[`${side}Shoulder`]);
  chest.add(shoulder);

  const elbow = new Object3D();
  elbow.position.set(0, -0.34, 0);
  setRotation(elbow, pose[`${side}Elbow`]);
  shoulder.add(elbow);

  const wrist = new Object3D();
  wrist.position.set(0, -0.32, 0);
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

export function solveArmIK(pose: PoseState, side: 'left' | 'right', target: Vec3): PoseState {
  const next = structuredClone(pose);
  const { root, chest } = createTorsoFrame(pose);
  const targetInCharacter = new Vector3(...target);
  const targetInChest = chest.worldToLocal(targetInCharacter.clone());
  const sign = side === 'left' ? -1 : 1;
  const shoulderPosition = new Vector3(sign * 0.32, 0.16, 0);
  const toTarget = targetInChest.sub(shoulderPosition);

  const upperLength = 0.34;
  const lowerLength = 0.32;
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
