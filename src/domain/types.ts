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

export type CharacterRole = 'lead' | 'supporting' | 'background';
export type CharacterAgeGroup = 'child' | 'teen' | 'adult' | 'senior' | 'unspecified';
export type CharacterPresentation = 'feminine' | 'masculine' | 'neutral' | 'unspecified';

export interface CharacterAppearance {
  role: CharacterRole;
  descriptor: string;
  ageGroup: CharacterAgeGroup;
  presentation: CharacterPresentation;
  occupation?: string;
  outfitSummary: string;
  outfitColors: string[];
  hairColor: string;
  skinTone: string;
}

export interface CharacterData {
  pose: PoseState;
  appearance: CharacterAppearance;
}

export type AssetPrimitive = 'box' | 'cylinder' | 'sphere' | 'plane';
export type AssetCategory = 'environment' | 'architecture' | 'furniture' | 'handheld' | 'vehicle' | 'decor' | 'lighting' | 'generic';

export interface EntityAssetData {
  presetId?: string;
  modelAssetId?: string;
  category: AssetCategory;
  primitive: AssetPrimitive;
  color: string;
  material: 'matte' | 'metal' | 'glass' | 'emissive';
  source: 'preset' | 'prompt' | 'manual';
  tags: string[];
}


export type AssetLibraryKind = 'glb';
export type AssetLibraryCategory = 'character' | 'prop' | 'environment';

export interface AssetLibraryItem {
  id: string;
  name: string;
  kind: AssetLibraryKind;
  category: AssetLibraryCategory;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  createdAt: string;
  originalFilename: string;
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
  asset?: EntityAssetData;
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

export interface SceneEnvironment {
  presetId: string;
  name: string;
  location: string;
  backgroundColor: string;
  floorColor: string;
  palette: string[];
  atmosphere: string[];
}

export interface Scene {
  id: string;
  name: string;
  description?: string;
  environment: SceneEnvironment;
  entities: Entity[];
  shots: Shot[];
}

export interface Project {
  id: string;
  schemaVersion: string;
  name: string;
  revision: number;
  activeSceneId: string;
  assetLibrary: AssetLibraryItem[];
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



export interface AddAssetLibraryItemOperation {
  type: 'addAssetLibraryItem';
  item: AssetLibraryItem;
}

export interface RemoveAssetLibraryItemOperation {
  type: 'removeAssetLibraryItem';
  item: AssetLibraryItem;
  previousEntityAssets: Array<{ sceneId: string; entityId: string; asset?: EntityAssetData }>;
}

export interface UpdateEntityAssetOperation {
  type: 'updateEntityAsset';
  sceneId: string;
  entityId: string;
  previousAsset?: EntityAssetData;
  nextAsset?: EntityAssetData;
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
  | AddAssetLibraryItemOperation
  | RemoveAssetLibraryItemOperation
  | UpdateEntityAssetOperation
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
