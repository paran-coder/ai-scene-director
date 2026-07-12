export type Vec3 = [number, number, number];

export interface Transform {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

export const JOINT_NAMES = [
  'pelvis',
  'spine',
  'chest',
  'neck',
  'head',
  'leftShoulder',
  'leftElbow',
  'leftWrist',
  'rightShoulder',
  'rightElbow',
  'rightWrist',
  'leftHip',
  'leftKnee',
  'leftAnkle',
  'rightHip',
  'rightKnee',
  'rightAnkle',
] as const;

export type JointName = (typeof JOINT_NAMES)[number];
export type PoseState = Record<JointName, Vec3>;

export interface CharacterData {
  pose: PoseState;
}

export type EntityType = 'character' | 'prop' | 'camera' | 'light';

export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  transform: Transform;
  visible: boolean;
  locked: boolean;
  character?: CharacterData;
}

export type OverridePath =
  | 'transform.position'
  | 'transform.rotation'
  | 'transform.scale'
  | 'visible'
  | 'character.pose';

export type OverrideValue = Vec3 | boolean | PoseState;

export interface ShotOverride {
  id: string;
  entityId: string;
  path: OverridePath;
  value: OverrideValue;
}

export type RelationshipType = 'lookAt' | 'hold' | 'sitOn' | 'placeOn';
export type HandSide = 'left' | 'right';

export interface RelationshipParameters {
  hand?: HandSide;
  lookMode?: 'head' | 'body';
  offset?: Vec3;
  verticalOffset?: number;
  alignRotation?: boolean;
}

export interface Relationship {
  id: string;
  type: RelationshipType;
  sourceEntityId: string;
  targetEntityId: string;
  parameters: RelationshipParameters;
  active: boolean;
}

export type ActionType =
  | 'walk'
  | 'turnAround'
  | 'pickUp'
  | 'putDown'
  | 'cameraDolly'
  | 'cameraOrbit';

export interface ActionParameters {
  direction?: Vec3;
  distance?: number;
  angle?: number;
  hand?: HandSide;
  surfaceEntityId?: string;
  clockwise?: boolean;
}

export interface ActionBlock {
  id: string;
  type: ActionType;
  actorEntityId: string;
  targetEntityId?: string;
  startTime: number;
  duration: number;
  parameters: ActionParameters;
  enabled: boolean;
}

export type GenerationOutputKind = 'image' | 'video' | 'audio' | 'file';

export interface GenerationOutput {
  nodeId: string;
  filename: string;
  subfolder: string;
  type: string;
  kind: GenerationOutputKind;
}

export interface GenerationResult {
  id: string;
  provider: 'comfyui';
  serverUrl: string;
  promptId: string;
  workflowName: string;
  createdAt: string;
  outputs: GenerationOutput[];
}

export interface Shot {
  id: string;
  name: string;
  order: number;
  duration: number;
  cameraEntityId: string;
  overrides: ShotOverride[];
  relationships: Relationship[];
  actions: ActionBlock[];
  generationResults: GenerationResult[];
}

export interface Scene {
  id: string;
  name: string;
  description?: string;
  entities: Entity[];
  shots: Shot[];
}

export interface Project {
  id: string;
  schemaVersion: string;
  name: string;
  revision: number;
  activeSceneId: string;
  scenes: Scene[];
}

export interface UpdateEntityOperation {
  type: 'updateEntity';
  sceneId: string;
  shotId: string;
  entityId: string;
  path: OverridePath;
  previousValue: OverrideValue;
  nextValue: OverrideValue;
}

export interface AddEntityOperation {
  type: 'addEntity';
  sceneId: string;
  entity: Entity;
}

export interface RemoveEntityOperation {
  type: 'removeEntity';
  sceneId: string;
  entity: Entity;
  overridesByShot: Record<string, ShotOverride[]>;
  relationshipsByShot: Record<string, Relationship[]>;
  actionsByShot: Record<string, ActionBlock[]>;
}

export interface UpdateBaseEntityOperation {
  type: 'updateBaseEntity';
  sceneId: string;
  entityId: string;
  path: 'name' | 'visible' | 'locked';
  previousValue: string | boolean;
  nextValue: string | boolean;
}

export interface AddRelationshipOperation {
  type: 'addRelationship';
  sceneId: string;
  shotId: string;
  relationship: Relationship;
}

export interface RemoveRelationshipOperation {
  type: 'removeRelationship';
  sceneId: string;
  shotId: string;
  relationship: Relationship;
}

export interface AddActionOperation {
  type: 'addAction';
  sceneId: string;
  shotId: string;
  action: ActionBlock;
}

export interface RemoveActionOperation {
  type: 'removeAction';
  sceneId: string;
  shotId: string;
  action: ActionBlock;
}

export interface UpdateActionOperation {
  type: 'updateAction';
  sceneId: string;
  shotId: string;
  previousAction: ActionBlock;
  nextAction: ActionBlock;
}

export interface AddShotOperation {
  type: 'addShot';
  sceneId: string;
  shot: Shot;
}

export interface RemoveShotOperation {
  type: 'removeShot';
  sceneId: string;
  shot: Shot;
}

export interface AddGenerationResultOperation {
  type: 'addGenerationResult';
  sceneId: string;
  shotId: string;
  result: GenerationResult;
}

export interface RemoveGenerationResultOperation {
  type: 'removeGenerationResult';
  sceneId: string;
  shotId: string;
  result: GenerationResult;
}


export interface ReplaceSceneOperation {
  type: 'replaceScene';
  sceneId: string;
  previousScene: Scene;
  nextScene: Scene;
}

export interface UpdateShotOperation {
  type: 'updateShot';
  sceneId: string;
  shotId: string;
  path: 'name' | 'duration' | 'order';
  previousValue: string | number;
  nextValue: string | number;
}

export type Operation =
  | UpdateEntityOperation
  | AddEntityOperation
  | RemoveEntityOperation
  | UpdateBaseEntityOperation
  | AddRelationshipOperation
  | RemoveRelationshipOperation
  | AddActionOperation
  | RemoveActionOperation
  | UpdateActionOperation
  | AddGenerationResultOperation
  | RemoveGenerationResultOperation
  | AddShotOperation
  | RemoveShotOperation
  | ReplaceSceneOperation
  | UpdateShotOperation;

export interface Transaction {
  id: string;
  title: string;
  createdAt: string;
  operations: Operation[];
}

export type TransformMode = 'translate' | 'rotate' | 'scale' | 'pose';
