import { createEnvironmentState, createPresetEntities, resolveEnvironmentPreset, type EnvironmentPreset } from './environmentPresets.ts';
import { createNeutralPose, findPosePreset } from './pose.ts';
import type { ActionBlock, CharacterAgeGroup, CharacterPresentation, CharacterRole, Entity, EntityAssetData, Relationship, Scene, Shot, Vec3 } from './types.ts';

export type GeneratedShotKind =
  | 'wide'
  | 'medium'
  | 'closeUp'
  | 'overShoulder'
  | 'insert'
  | 'tracking'
  | 'lowAngle'
  | 'highAngle';

export interface GeneratedCharacterPlan {
  name: string;
  descriptor: string;
  role: CharacterRole;
  ageGroup: CharacterAgeGroup;
  presentation: CharacterPresentation;
  occupation?: string;
  outfitSummary: string;
  outfitColors: string[];
  hairColor: string;
  skinTone: string;
}

export interface GeneratedPropPlan {
  name: string;
  count: number;
  source: 'prompt' | 'preset';
  category?: EntityAssetData['category'];
}

export interface GeneratedShotPlan {
  kind: GeneratedShotKind;
  name: string;
  description: string;
  duration: number;
  subjectCharacterIndex?: number;
  subjectPropName?: string;
}

export interface SceneGenerationPlan {
  sourceText: string;
  title: string;
  location: string;
  atmosphere: string[];
  environmentPreset: EnvironmentPreset;
  characters: GeneratedCharacterPlan[];
  props: GeneratedPropPlan[];
  autoProps: GeneratedPropPlan[];
  shots: GeneratedShotPlan[];
  detectedRelations: string[];
  warnings: string[];
}

const CHARACTER_WORDS = [
  '남학생', '여학생', '할아버지', '할머니', '경찰관', '간호사', '주인공',
  '여성', '남성', '여자', '남자', '소년', '소녀', '아이', '노인', '경찰',
  '형사', '직원', '손님', '요리사', '의사', '군인', '학생',
];

const LOCATION_WORDS = [
  '편의점 앞', '카페 내부', '카페', '거리', '골목', '방', '거실', '사무실',
  '옥상', '숲', '해변', '식당', '학교', '지하철', '창고', '스튜디오',
  '주차장', '공원', '호텔', '병원', '교실', '부엌', '침실',
];

const ATMOSPHERE_WORDS = [
  '비 오는 밤', '비', '눈', '밤', '낮', '새벽', '석양', '안개', '네온',
  '따뜻한', '차가운', '긴장된', '쓸쓸한', '밝은', '어두운', '몽환적인',
];

const PRODUCT_WORDS = ['제품', '상품', '헤드폰', '향수', '시계', '신발', '스마트폰', '화장품', '가전', '패키지'];

interface PropDefinition {
  keyword: string;
  name: string;
  scale: Vec3;
  baseY: number;
}

const PROP_DEFINITIONS: PropDefinition[] = [
  { keyword: '테이블', name: '테이블', scale: [2.2, 0.8, 1.2], baseY: 0.4 },
  { keyword: '책상', name: '책상', scale: [2.2, 0.8, 1.1], baseY: 0.4 },
  { keyword: '의자', name: '의자', scale: [0.85, 0.9, 0.85], baseY: 0.45 },
  { keyword: '커피 컵', name: '커피 컵', scale: [0.22, 0.3, 0.22], baseY: 0.15 },
  { keyword: '컵', name: '컵', scale: [0.22, 0.3, 0.22], baseY: 0.15 },
  { keyword: '우산', name: '우산', scale: [0.15, 1.4, 0.15], baseY: 0.7 },
  { keyword: '자전거', name: '자전거', scale: [1.6, 1.1, 0.45], baseY: 0.55 },
  { keyword: '가방', name: '가방', scale: [0.55, 0.7, 0.3], baseY: 0.35 },
  { keyword: '소파', name: '소파', scale: [2.4, 1.0, 0.95], baseY: 0.5 },
  { keyword: '자동차', name: '자동차', scale: [3.5, 1.5, 1.8], baseY: 0.75 },
  { keyword: '문', name: '문', scale: [1.2, 2.4, 0.18], baseY: 1.2 },
  { keyword: '창문', name: '창문', scale: [1.8, 1.4, 0.12], baseY: 1.5 },
  { keyword: '침대', name: '침대', scale: [2.2, 0.7, 3.2], baseY: 0.35 },
  { keyword: '노트북', name: '노트북', scale: [0.55, 0.08, 0.38], baseY: 0.04 },
  { keyword: '전화기', name: '전화기', scale: [0.18, 0.32, 0.06], baseY: 0.16 },
  { keyword: '책', name: '책', scale: [0.35, 0.08, 0.48], baseY: 0.04 },
  { keyword: '헤드폰', name: '헤드폰', scale: [0.8, 0.72, 0.32], baseY: 0.36 },
  { keyword: '향수', name: '향수', scale: [0.28, 0.55, 0.22], baseY: 0.275 },
  { keyword: '시계', name: '시계', scale: [0.42, 0.12, 0.42], baseY: 0.06 },
  { keyword: '신발', name: '신발', scale: [0.72, 0.34, 0.3], baseY: 0.17 },
  { keyword: '스마트폰', name: '스마트폰', scale: [0.18, 0.34, 0.035], baseY: 0.02 },
  { keyword: '병', name: '병', scale: [0.18, 0.55, 0.18], baseY: 0.275 },
];

const SHOT_KEYWORDS: Array<{ pattern: RegExp; kind: GeneratedShotKind; name: string }> = [
  { pattern: /오버\s*숄더|오버숄더/gi, kind: 'overShoulder', name: '오버숄더 샷' },
  { pattern: /클로즈\s*업|클로즈업/gi, kind: 'closeUp', name: '클로즈업' },
  { pattern: /와이드|전경|전체\s*샷/gi, kind: 'wide', name: '와이드 샷' },
  { pattern: /미디엄|중간\s*샷/gi, kind: 'medium', name: '미디엄 샷' },
  { pattern: /인서트|손\s*샷|소품\s*샷/gi, kind: 'insert', name: '인서트 샷' },
  { pattern: /트래킹|따라가(?:는|며|도록)?\s*샷|추적\s*샷/gi, kind: 'tracking', name: '트래킹 샷' },
  { pattern: /로우\s*앵글|낮은\s*앵글/gi, kind: 'lowAngle', name: '로우 앵글' },
  { pattern: /하이\s*앵글|높은\s*앵글/gi, kind: 'highAngle', name: '하이 앵글' },
];

const KOREAN_NUMBERS: Record<string, number> = {
  한: 1, 하나: 1, 두: 2, 둘: 2, 세: 3, 셋: 3, 네: 4, 넷: 4, 다섯: 5,
  여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10,
};

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function cleanDescriptor(value: string): string {
  return value
    .replace(/^(그리고|또한|처음에는?|다음(?:은|에는?)?|마지막에는?)\s*/g, '')
    .replace(/^[,.\s]+|[,.\s]+$/g, '')
    .replace(/(?:장면|샷|카메라).*/g, '')
    .trim();
}

function extractLocation(text: string): string {
  return LOCATION_WORDS.find((word) => text.includes(word)) ?? '기본 스튜디오';
}

function extractAtmosphere(text: string): string[] {
  const found = unique(ATMOSPHERE_WORDS.filter((word) => text.includes(word)));
  if (found.includes('비 오는 밤')) return found.filter((word) => word !== '비' && word !== '밤').slice(0, 5);
  return found.slice(0, 5);
}

function isPlausibleName(value: string): boolean {
  const blocked = new Set([
    ...CHARACTER_WORDS,
    ...LOCATION_WORDS.flatMap((word) => word.split(' ')),
    ...PROP_DEFINITIONS.map((prop) => prop.keyword),
    '처음', '다음', '마지막', '카메라', '장면', '영상', '두 사람', '세 사람',
  ]);
  return /^[가-힣]{2,4}$/.test(value) && !blocked.has(value);
}

function extractProperNames(text: string): string[] {
  const names: string[] = [];
  const pair = text.match(/^\s*([가-힣]{2,4})\s*(?:과|와)\s*([가-힣]{2,4})(?:이|가|은|는)\s/);
  if (pair) {
    if (isPlausibleName(pair[1])) names.push(pair[1]);
    if (isPlausibleName(pair[2])) names.push(pair[2]);
  }
  const single = text.match(/^\s*([가-힣]{2,4})(?:이|가|은|는)\s/);
  if (!names.length && single && isPlausibleName(single[1])) names.push(single[1]);
  return unique(names);
}

function characterRoleKey(role: string): string {
  if (['여성', '여자'].includes(role)) return 'adult-woman';
  if (['남성', '남자'].includes(role)) return 'adult-man';
  if (['남학생', '소년'].includes(role)) return 'young-man';
  if (['여학생', '소녀'].includes(role)) return 'young-woman';
  return role;
}

function extractCharacterDescriptors(text: string): string[] {
  const descriptors: string[] = [];
  const seenRoles = new Set<string>();
  const regex = new RegExp([...CHARACTER_WORDS].sort((a, b) => b.length - a.length).join('|'), 'g');
  for (const match of text.matchAll(regex)) {
    const roleKey = characterRoleKey(match[0]);
    if (seenRoles.has(roleKey)) continue;
    const index = match.index ?? 0;
    const prior = text.slice(0, index);
    const boundaryCandidates = [
      prior.lastIndexOf('.'), prior.lastIndexOf(','), prior.lastIndexOf('그리고'),
      prior.lastIndexOf(' 다음'), prior.lastIndexOf(' 마지막'), prior.lastIndexOf(' 처음'),
      prior.lastIndexOf('와 '), prior.lastIndexOf('과 '),
    ];
    const start = Math.max(...boundaryCandidates) + 1;
    const descriptor = cleanDescriptor(text.slice(start, index + match[0].length));
    if (descriptor && descriptor.length <= 35) {
      descriptors.push(descriptor);
      seenRoles.add(roleKey);
    }
  }
  return unique(descriptors);
}

function extractRequestedCharacterCount(text: string): number | undefined {
  const digit = text.match(/(\d+)\s*(?:명|사람)/);
  if (digit) return Math.max(1, Math.min(8, Number(digit[1])));
  for (const [word, value] of Object.entries(KOREAN_NUMBERS)) {
    if (new RegExp(`${word}\\s*(?:명|사람)`).test(text)) return value;
  }
  if (text.includes('두 사람')) return 2;
  return undefined;
}

const COLOR_WORDS: Array<{ keyword: string; value: string }> = [
  { keyword: '검은', value: '#111827' }, { keyword: '검정', value: '#111827' },
  { keyword: '흰', value: '#f8fafc' }, { keyword: '하얀', value: '#f8fafc' },
  { keyword: '빨간', value: '#dc2626' }, { keyword: '붉은', value: '#dc2626' },
  { keyword: '파란', value: '#2563eb' }, { keyword: '푸른', value: '#2563eb' },
  { keyword: '초록', value: '#16a34a' }, { keyword: '녹색', value: '#16a34a' },
  { keyword: '노란', value: '#eab308' }, { keyword: '베이지', value: '#d6b58a' },
  { keyword: '회색', value: '#64748b' }, { keyword: '갈색', value: '#92400e' },
  { keyword: '분홍', value: '#ec4899' }, { keyword: '보라', value: '#7c3aed' },
];

const OUTFIT_WORDS = ['교복', '정장', '코트', '드레스', '후드티', '재킷', '셔츠', '작업복', '제복', '군복', '간호사복', '운동복', '가죽 재킷'];
const OCCUPATION_WORDS = ['경찰관', '간호사', '경찰', '형사', '직원', '요리사', '의사', '군인', '학생'];

function inferPresentation(descriptor: string): CharacterPresentation {
  if (/여성|여자|여학생|소녀|할머니|간호사/.test(descriptor)) return 'feminine';
  if (/남성|남자|남학생|소년|할아버지|군인|경찰관|형사/.test(descriptor)) return 'masculine';
  return 'unspecified';
}

function inferAgeGroup(descriptor: string): CharacterAgeGroup {
  if (/아이/.test(descriptor)) return 'child';
  if (/남학생|여학생|소년|소녀|학생/.test(descriptor)) return 'teen';
  if (/할아버지|할머니|노인/.test(descriptor)) return 'senior';
  if (/여성|남성|여자|남자|경찰|형사|직원|요리사|의사|군인|간호사/.test(descriptor)) return 'adult';
  return 'unspecified';
}

function inferOutfit(descriptor: string): { summary: string; colors: string[] } {
  const outfitWord = OUTFIT_WORDS.find((word) => descriptor.includes(word));
  const colors = unique(COLOR_WORDS.filter((item) => descriptor.includes(item.keyword)).map((item) => item.value));
  if (outfitWord) {
    const colorWord = COLOR_WORDS.find((item) => descriptor.includes(item.keyword))?.keyword;
    return { summary: `${colorWord ? `${colorWord} ` : ''}${outfitWord}`.trim(), colors: colors.length ? colors : ['#475569'] };
  }
  return { summary: '기본 의상', colors: colors.length ? colors : ['#475569'] };
}

function inferHairColor(descriptor: string): string {
  if (/금발|금색 머리/.test(descriptor)) return '#d6b85a';
  if (/갈색 머리/.test(descriptor)) return '#6b4423';
  if (/회색 머리|백발/.test(descriptor)) return '#cbd5e1';
  return '#1c1917';
}

function extractCharacters(text: string): GeneratedCharacterPlan[] {
  const properNames = extractProperNames(text);
  const descriptors = extractCharacterDescriptors(text);
  const count = extractRequestedCharacterCount(text);
  const values = properNames.length ? properNames : descriptors;
  const hasExplicitCharacterCue = values.length > 0 || count !== undefined || CHARACTER_WORDS.some((word) => text.includes(word));
  const productOnly = PRODUCT_WORDS.some((word) => text.includes(word)) && !hasExplicitCharacterCue;
  const desiredCount = productOnly ? 0 : Math.max(values.length, count ?? 0, 1);
  const characters: GeneratedCharacterPlan[] = [];
  for (let index = 0; index < desiredCount; index += 1) {
    const name = values[index] ?? `인물 ${index + 1}`;
    const descriptor = descriptors[index] ?? name;
    const outfit = inferOutfit(descriptor);
    const explicitLead = /주인공/.test(descriptor);
    const explicitBackground = /엑스트라|배경 인물/.test(descriptor);
    const role: CharacterRole = explicitLead ? 'lead' : explicitBackground ? 'background' : index === 0 ? 'lead' : index === 1 ? 'supporting' : 'background';
    characters.push({
      name,
      descriptor,
      role,
      ageGroup: inferAgeGroup(descriptor),
      presentation: inferPresentation(descriptor),
      occupation: OCCUPATION_WORDS.find((word) => descriptor.includes(word)),
      outfitSummary: outfit.summary,
      outfitColors: outfit.colors,
      hairColor: inferHairColor(descriptor),
      skinTone: '#d6a77a',
    });
  }
  const nameCounts = new Map<string, number>();
  return characters.map((character) => {
    const current = (nameCounts.get(character.name) ?? 0) + 1;
    nameCounts.set(character.name, current);
    return current > 1 ? { ...character, name: `${character.name} ${current}` } : character;
  });
}

function detectCount(text: string, keyword: string): number {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const afterDigit = text.match(new RegExp(`${escaped}\\s*(\\d+)\\s*개`));
  const beforeDigit = text.match(new RegExp(`(\\d+)\\s*개의?\\s*${escaped}`));
  if (afterDigit || beforeDigit) return Math.max(1, Math.min(12, Number((afterDigit ?? beforeDigit)![1])));
  for (const [word, value] of Object.entries(KOREAN_NUMBERS)) {
    if (new RegExp(`${word}\\s*개의?\\s*${escaped}`).test(text) || new RegExp(`${escaped}\\s*${word}\\s*개`).test(text)) return value;
  }
  return 1;
}

function extractProps(text: string, characterCount: number): GeneratedPropPlan[] {
  const result: GeneratedPropPlan[] = [];
  for (const definition of PROP_DEFINITIONS) {
    if (!text.includes(definition.keyword)) continue;
    if (definition.keyword === '컵' && text.includes('커피 컵')) continue;
    result.push({ name: definition.name, count: detectCount(text, definition.keyword), source: 'prompt', category: definition.name === '자전거' || definition.name === '자동차' ? 'vehicle' : definition.name === '우산' || definition.name.includes('컵') || ['가방', '책', '노트북', '병', '헤드폰', '향수', '시계', '신발', '스마트폰'].includes(definition.name) ? 'handheld' : 'furniture' });
  }
  if (/앉아|앉은|앉혀/.test(text) && !result.some((item) => item.name === '의자') && !result.some((item) => item.name === '소파')) {
    result.push({ name: '의자', count: Math.max(1, characterCount), source: 'prompt', category: 'furniture' });
  }
  if (/카페|식당|대화/.test(text) && result.some((item) => item.name.includes('컵')) && !result.some((item) => item.name === '테이블' || item.name === '책상')) {
    result.unshift({ name: '테이블', count: 1, source: 'prompt', category: 'furniture' });
  }
  return result;
}

function contextAround(text: string, index: number, radius = 55): string {
  return text.slice(Math.max(0, index - radius), Math.min(text.length, index + radius));
}

function findCharacterNearIndex(text: string, position: number, characters: GeneratedCharacterPlan[]): number | undefined {
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  characters.forEach((character, index) => {
    const shortRole = CHARACTER_WORDS.find((role) => character.descriptor.endsWith(role));
    const terms = unique([character.name, character.descriptor, shortRole ?? '']).filter(Boolean);
    terms.forEach((term) => {
      const before = text.lastIndexOf(term, position);
      if (before >= 0 && position - before < bestDistance) {
        bestDistance = position - before;
        bestIndex = index;
      }
      const after = text.indexOf(term, position);
      if (after >= 0 && after - position < bestDistance) {
        bestDistance = after - position;
        bestIndex = index;
      }
    });
  });
  return bestIndex >= 0 ? bestIndex : undefined;
}

function shotClause(text: string, index: number): string {
  const before = text.slice(0, index);
  const starts = [before.lastIndexOf('.'), before.lastIndexOf(','), before.lastIndexOf('처음'), before.lastIndexOf('다음'), before.lastIndexOf('마지막')];
  const start = Math.max(...starts);
  const afterCandidates = [text.indexOf(',', index), text.indexOf('.', index)].filter((value) => value >= 0);
  const end = afterCandidates.length ? Math.min(...afterCandidates) : text.length;
  return text.slice(start >= 0 ? start : Math.max(0, index - 40), end).replace(/^[,.\s]+/, '').trim();
}

function findPropInContext(context: string, props: GeneratedPropPlan[]): string | undefined {
  return props.find((prop) => context.includes(prop.name))?.name;
}

function totalDuration(text: string): number | undefined {
  const match = text.match(/(?:총|전체|약)?\s*(\d+(?:\.\d+)?)\s*초(?:짜리|의)?/);
  return match ? Math.max(1, Math.min(60, Number(match[1]))) : undefined;
}

function extractShots(text: string, characters: GeneratedCharacterPlan[], props: GeneratedPropPlan[]): GeneratedShotPlan[] {
  const matches: Array<{ index: number; kind: GeneratedShotKind; name: string; context: string }> = [];
  for (const keyword of SHOT_KEYWORDS) {
    keyword.pattern.lastIndex = 0;
    for (const match of text.matchAll(keyword.pattern)) {
      const index = match.index ?? 0;
      matches.push({ index, kind: keyword.kind, name: keyword.name, context: contextAround(text, index) });
    }
  }
  matches.sort((a, b) => a.index - b.index);
  const deduped = matches.filter((item, index) => index === 0 || item.index - matches[index - 1].index > 4).slice(0, 8);
  const requestedTotal = totalDuration(text);

  if (deduped.length) {
    const defaultDuration = requestedTotal ? requestedTotal / deduped.length : 4;
    return deduped.map((item, index) => ({
      kind: item.kind,
      name: `${index + 1}. ${item.name}`,
      description: shotClause(text, item.index) || item.name,
      duration: Number(Math.max(1, defaultDuration).toFixed(1)),
      subjectCharacterIndex: findCharacterNearIndex(text, item.index, characters)
        ?? (item.kind === 'closeUp' || item.kind === 'overShoulder' || item.kind === 'tracking' ? Math.min(index, characters.length - 1) : undefined),
      subjectPropName: item.kind === 'insert' ? findPropInContext(item.context, props) ?? props[0]?.name : undefined,
    }));
  }

  const defaults: GeneratedShotPlan[] = [
    { kind: 'wide', name: '1. 공간과 인물 와이드', description: '장소와 모든 등장인물을 보여주는 도입 샷', duration: 4 },
    { kind: 'medium', name: '2. 주요 행동 미디엄', description: '주요 인물의 관계와 행동을 보여주는 샷', duration: 4, subjectCharacterIndex: 0 },
    { kind: 'closeUp', name: '3. 주인공 클로즈업', description: '주요 인물의 표정과 반응을 보여주는 샷', duration: 3, subjectCharacterIndex: 0 },
  ];
  if (requestedTotal) {
    const each = requestedTotal / defaults.length;
    defaults.forEach((shot) => { shot.duration = Number(Math.max(1, each).toFixed(1)); });
  }
  return defaults;
}

export function analyzeScenePrompt(input: string): SceneGenerationPlan {
  const text = normalizeText(input);
  const characters = extractCharacters(text);
  const props = extractProps(text, characters.length);
  const location = extractLocation(text);
  const atmosphere = extractAtmosphere(text);
  const environmentPreset = resolveEnvironmentPreset(location);
  const autoProps: GeneratedPropPlan[] = environmentPreset.props
    .filter((presetProp) => !props.some((prop) => prop.name === presetProp.name || presetProp.name.includes(prop.name)))
    .map((presetProp) => ({ name: presetProp.name, count: 1, source: 'preset', category: presetProp.category }));
  const shots = extractShots(text, characters, props);
  const detectedRelations: string[] = [];
  if (/마주\s*보|서로\s*바라/.test(text) && characters.length >= 2) detectedRelations.push('등장인물이 서로 바라봄');
  if (/들고|들어/.test(text) && props.length) detectedRelations.push('인물이 소품을 손에 듦');
  if (/앉아|앉은|앉혀/.test(text)) detectedRelations.push('인물이 좌석에 앉음');
  if (/떠나|걸어|다가/.test(text)) detectedRelations.push('인물 이동 행동');
  const warnings: string[] = [];
  if (characters.length >= 5) warnings.push('주요 인물이 5명 이상이면 생성 모델의 인물 일관성이 낮아질 수 있습니다.');
  if (shots.length === 3 && !SHOT_KEYWORDS.some((keyword) => { keyword.pattern.lastIndex = 0; return keyword.pattern.test(text); })) {
    warnings.push('샷 설명이 없어 와이드·미디엄·클로즈업 기본 구성을 제안했습니다.');
  }
  if (location === '기본 스튜디오') warnings.push('장소가 명확하지 않아 기본 스튜디오로 설정했습니다.');

  return {
    sourceText: text,
    title: `${location} 장면`,
    location,
    atmosphere,
    environmentPreset,
    characters,
    props,
    autoProps,
    shots,
    detectedRelations,
    warnings,
  };
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-|-$/g, '').slice(0, 28) || 'item';
}

function entityId(prefix: string, name: string, index: number): string {
  return `${prefix}-${slug(name)}-${index + 1}`;
}

function propDefinition(name: string): PropDefinition {
  return PROP_DEFINITIONS.find((definition) => definition.name === name) ?? {
    keyword: name, name, scale: [0.8, 0.8, 0.8], baseY: 0.4,
  };
}

function characterPosition(index: number, count: number): Vec3 {
  const spacing = count <= 2 ? 2 : 1.6;
  return [Number(((index - (count - 1) / 2) * spacing).toFixed(3)), 0, 0];
}

function lookRotation(position: Vec3, target: Vec3): Vec3 {
  const dx = target[0] - position[0];
  const dy = target[1] - position[1];
  const dz = target[2] - position[2];
  return [Math.atan2(dy, Math.max(0.0001, Math.hypot(dx, dz))), Math.atan2(-dx, -dz), 0];
}

function averagePosition(entities: Entity[]): Vec3 {
  if (!entities.length) return [0, 1, 0];
  const sum = entities.reduce((acc, entity) => [
    acc[0] + entity.transform.position[0],
    acc[1] + entity.transform.position[1],
    acc[2] + entity.transform.position[2],
  ] as Vec3, [0, 0, 0] as Vec3);
  return [sum[0] / entities.length, sum[1] / entities.length + 1, sum[2] / entities.length];
}

function promptPropAsset(name: string, category: EntityAssetData['category'] = 'generic'): EntityAssetData {
  const primitive = /컵|병|우산/.test(name) ? 'cylinder' : /자동차|자전거/.test(name) ? 'box' : 'box';
  const color = name.includes('우산') ? '#1f2937'
    : name.includes('자전거') ? '#2563eb'
      : name.includes('컵') ? '#f8fafc'
        : name.includes('테이블') || name.includes('책상') ? '#8b5e3c'
          : name.includes('의자') ? '#8b6f47'
            : name.includes('가방') ? '#334155'
              : '#a8a29e';
  return { category, primitive, color, material: 'matte', source: 'prompt', tags: [name, category] };
}

function createPropEntities(plan: SceneGenerationPlan): Entity[] {
  const explicitNames = plan.props.map((prop) => prop.name);
  const presetEntities = createPresetEntities(plan.environmentPreset).filter((entity) => {
    if (!entity.asset || !['furniture', 'handheld', 'vehicle'].includes(entity.asset.category)) return true;
    return !explicitNames.some((name) => entity.name.includes(name) || name.includes(entity.name));
  });
  const entities: Entity[] = [...presetEntities];
  let sequence = 0;
  for (const prop of plan.props) {
    const definition = propDefinition(prop.name);
    for (let index = 0; index < prop.count; index += 1) {
      const x = ((sequence % 5) - 2) * 1.25;
      const z = 1.1 + Math.floor(sequence / 5) * 1.15;
      let position: Vec3 = [x, definition.baseY, z];
      if (prop.name === '테이블' || prop.name === '책상') position = [0, definition.baseY, 0.35];
      if (prop.name === '의자') {
        const characterX = characterPosition(index, Math.max(1, prop.count))[0];
        position = [characterX, definition.baseY, 0.9];
      }
      if (prop.name.includes('컵')) position = [(-0.35 + index * 0.45), definition.baseY, 0.35];
      if (prop.name === '우산') position = [-1.4 + index * 0.7, definition.baseY, -0.2];
      if (prop.name === '자전거') position = [1.8, definition.baseY, 0.7 + index * 0.8];
      entities.push({
        id: entityId('prop', prop.name, sequence),
        name: prop.count > 1 ? `${prop.name} ${index + 1}` : prop.name,
        type: 'prop',
        transform: { position, rotation: [0, 0, 0], scale: [...definition.scale] },
        visible: true,
        locked: false,
        asset: promptPropAsset(prop.name, prop.category),
      });
      sequence += 1;
    }
  }
  return entities;
}

function cameraTransform(kind: GeneratedShotKind, subject: Entity | undefined, prop: Entity | undefined, allCharacters: Entity[]): { position: Vec3; rotation: Vec3 } {
  const groupTarget = averagePosition(allCharacters);
  const target: Vec3 = prop
    ? [prop.transform.position[0], prop.transform.position[1], prop.transform.position[2]]
    : subject
      ? [subject.transform.position[0], subject.transform.position[1] + 1.35, subject.transform.position[2]]
      : groupTarget;
  let position: Vec3;
  switch (kind) {
    case 'wide': position = [groupTarget[0], 2.5, groupTarget[2] + 8]; break;
    case 'medium': position = [target[0] + 0.25, 1.8, target[2] + 4.6]; break;
    case 'closeUp': position = [target[0] + 0.15, 1.62, target[2] + 2.35]; break;
    case 'overShoulder': position = [target[0] + 1.15, 1.7, target[2] + 3.1]; break;
    case 'insert': position = [target[0] + 0.2, target[1] + 0.65, target[2] + 1.8]; break;
    case 'tracking': position = [target[0], 1.8, target[2] + 5.2]; break;
    case 'lowAngle': position = [target[0] + 0.2, 0.75, target[2] + 3.2]; break;
    case 'highAngle': position = [target[0] + 0.4, 3.4, target[2] + 4.1]; break;
  }
  return { position, rotation: lookRotation(position, target) };
}

function buildBaseRelationships(plan: SceneGenerationPlan, characters: Entity[], props: Entity[]): Relationship[] {
  const relationships: Relationship[] = [];
  if (/마주\s*보|서로\s*바라/.test(plan.sourceText) && characters.length >= 2) {
    relationships.push(
      { id: 'rel-look-1', type: 'lookAt', sourceEntityId: characters[0].id, targetEntityId: characters[1].id, parameters: { lookMode: 'body' }, active: true },
      { id: 'rel-look-2', type: 'lookAt', sourceEntityId: characters[1].id, targetEntityId: characters[0].id, parameters: { lookMode: 'body' }, active: true },
    );
  } else if (/바라보|쳐다보/.test(plan.sourceText) && characters.length >= 2) {
    relationships.push({ id: 'rel-look-1', type: 'lookAt', sourceEntityId: characters[0].id, targetEntityId: characters[1].id, parameters: { lookMode: 'head' }, active: true });
  }

  const holdProp = props.find((prop) => plan.sourceText.includes(prop.name) && /들고|든 채|잡고/.test(plan.sourceText));
  if (holdProp && characters[0]) {
    relationships.push({ id: 'rel-hold-1', type: 'hold', sourceEntityId: characters[0].id, targetEntityId: holdProp.id, parameters: { hand: /왼손/.test(plan.sourceText) ? 'left' : 'right', alignRotation: true }, active: true });
  }

  const chairs = props.filter((prop) => prop.name.startsWith('의자'));
  if (/앉아|앉은|앉혀/.test(plan.sourceText)) {
    characters.forEach((character, index) => {
      const chair = chairs[index];
      if (chair) relationships.push({ id: `rel-sit-${index + 1}`, type: 'sitOn', sourceEntityId: character.id, targetEntityId: chair.id, parameters: { alignRotation: true }, active: true });
    });
  }

  const surface = props.find((prop) => prop.name === '테이블' || prop.name === '책상');
  if (surface) {
    props.filter((prop) => prop.name.includes('컵') || prop.name === '책' || prop.name === '노트북' || prop.name === '병').forEach((prop, index) => {
      if (relationships.some((relationship) => relationship.type === 'hold' && relationship.targetEntityId === prop.id)) return;
      relationships.push({
        id: `rel-place-${index + 1}`,
        type: 'placeOn', sourceEntityId: prop.id, targetEntityId: surface.id,
        parameters: { offset: [(index - 1) * 0.35, 0, 0], alignRotation: false }, active: true,
      });
    });
  }
  return relationships;
}

function buildShotActions(plan: SceneGenerationPlan, shotPlan: GeneratedShotPlan, shotIndex: number, camera: Entity, characters: Entity[]): ActionBlock[] {
  const actions: ActionBlock[] = [];
  const subject = characters[shotPlan.subjectCharacterIndex ?? Math.min(shotIndex, characters.length - 1)] ?? characters[0];
  const isLast = shotIndex === plan.shots.length - 1;
  if (subject && isLast && /떠나|걸어가|멀어지/.test(plan.sourceText)) {
    actions.push({
      id: `action-walk-${shotIndex + 1}`,
      type: 'walk', actorEntityId: subject.id, startTime: 0.5,
      duration: Math.max(1, Math.min(shotPlan.duration - 0.5, 3)),
      parameters: { direction: [0, 0, 1], distance: 2.5 }, enabled: true,
    });
  }
  if (subject && /뒤돌/.test(plan.sourceText) && isLast) {
    actions.push({ id: `action-turn-${shotIndex + 1}`, type: 'turnAround', actorEntityId: subject.id, startTime: 0.3, duration: Math.min(1.4, shotPlan.duration), parameters: { angle: Math.PI }, enabled: true });
  }
  if (shotPlan.kind === 'tracking' && subject) {
    actions.push({ id: `action-camera-track-${shotIndex + 1}`, type: 'cameraDolly', actorEntityId: camera.id, targetEntityId: subject.id, startTime: 0, duration: shotPlan.duration, parameters: { distance: 2 }, enabled: true });
  }
  if (/돌리\s*인|카메라가.*다가/.test(plan.sourceText) && subject && (shotPlan.kind === 'closeUp' || shotPlan.kind === 'medium')) {
    actions.push({ id: `action-camera-dolly-${shotIndex + 1}`, type: 'cameraDolly', actorEntityId: camera.id, targetEntityId: subject.id, startTime: 0, duration: shotPlan.duration, parameters: { distance: 1.2 }, enabled: true });
  }
  if (/오빗|주위를\s*돌/.test(plan.sourceText) && subject) {
    actions.push({ id: `action-camera-orbit-${shotIndex + 1}`, type: 'cameraOrbit', actorEntityId: camera.id, targetEntityId: subject.id, startTime: 0, duration: shotPlan.duration, parameters: { angle: Math.PI / 2, clockwise: true }, enabled: true });
  }
  return actions;
}

export function buildSceneFromPlan(plan: SceneGenerationPlan, sceneId = 'scene-generated'): Scene {
  const seatedPose = findPosePreset('seated')?.pose;
  const characters: Entity[] = plan.characters.map((character, index) => ({
    id: entityId('character', character.name, index),
    name: character.name,
    type: 'character',
    transform: {
      position: characterPosition(index, plan.characters.length),
      rotation: [0, plan.characters.length === 2 ? (index === 0 ? -Math.PI / 2 : Math.PI / 2) : 0, 0],
      scale: [1, 1, 1],
    },
    visible: true,
    locked: false,
    character: {
      pose: /앉아|앉은|앉혀/.test(plan.sourceText) && seatedPose ? structuredClone(seatedPose) : createNeutralPose(),
      appearance: {
        role: character.role,
        descriptor: character.descriptor,
        ageGroup: character.ageGroup,
        presentation: character.presentation,
        occupation: character.occupation,
        outfitSummary: character.outfitSummary,
        outfitColors: [...character.outfitColors],
        hairColor: character.hairColor,
        skinTone: character.skinTone,
      },
    },
    asset: { category: 'generic', primitive: 'box', color: character.outfitColors[0] ?? '#475569', material: 'matte', source: 'prompt', tags: ['character', character.role, character.outfitSummary] },
  }));
  const props = createPropEntities(plan);
  const baseRelationships = buildBaseRelationships(plan, characters, props);
  const cameras: Entity[] = [];
  const shots: Shot[] = plan.shots.map((shotPlan, index) => {
    const subject = characters[shotPlan.subjectCharacterIndex ?? 0];
    const subjectProp = props.find((prop) => prop.name === shotPlan.subjectPropName || prop.name.startsWith(`${shotPlan.subjectPropName} `));
    const transform = cameraTransform(shotPlan.kind, subject, subjectProp, characters);
    const camera: Entity = {
      id: `camera-generated-${index + 1}`,
      name: `${shotPlan.name} 카메라`,
      type: 'camera', transform: { ...transform, scale: [1, 1, 1] }, visible: true, locked: false,
      camera: { projection: 'perspective', fov: shotPlan.kind === 'closeUp' ? 38 : shotPlan.kind === 'wide' ? 55 : 48, near: 0.1, far: 100, aspectRatio: '16:9', showSafeFrame: true },
    };
    cameras.push(camera);
    return {
      id: `shot-generated-${index + 1}`,
      name: shotPlan.name,
      order: index + 1,
      duration: shotPlan.duration,
      cameraEntityId: camera.id,
      overrides: [],
      relationships: structuredClone(baseRelationships),
      actions: buildShotActions(plan, shotPlan, index, camera, characters),
      generationResults: [],
    };
  });
  const lights: Entity[] = [
    {
      id: 'light-key-generated', name: plan.atmosphere.some((word) => word.includes('밤') || word === '어두운') ? '차가운 키 라이트' : '소프트 키 라이트', type: 'light',
      transform: { position: [-3, 5, 3], rotation: [-0.6, -0.5, 0], scale: [1.2, 1.2, 1.2] }, visible: true, locked: false,
      light: { kind: 'directional', color: plan.atmosphere.some((word) => word.includes('밤') || word === '차가운') ? '#93c5fd' : '#fef3c7', intensity: 2.4, range: 14, angle: Math.PI / 4, castShadow: true },
      asset: { category: 'lighting', primitive: 'sphere', color: plan.atmosphere.some((word) => word.includes('밤') || word === '차가운') ? '#93c5fd' : '#fef3c7', material: 'emissive', source: 'preset', tags: ['key-light'] },
    },
    {
      id: 'light-fill-generated', name: '필 라이트', type: 'light',
      transform: { position: [3, 3.5, 1], rotation: [0, 0, 0], scale: [0.8, 0.8, 0.8] }, visible: true, locked: false,
      light: { kind: 'point', color: '#f8fafc', intensity: 1.2, range: 10, angle: Math.PI / 3, castShadow: false },
      asset: { category: 'lighting', primitive: 'sphere', color: '#f8fafc', material: 'emissive', source: 'preset', tags: ['fill-light'] },
    },
  ];
  return {
    id: sceneId,
    name: plan.title,
    description: plan.sourceText,
    environment: createEnvironmentState(plan.environmentPreset, plan.atmosphere),
    entities: [...characters, ...props, ...cameras, ...lights],
    shots,
    referenceImages: [],
  };
}

export function generateSceneFromPrompt(prompt: string, sceneId?: string): { plan: SceneGenerationPlan; scene: Scene } {
  const plan = analyzeScenePrompt(prompt);
  return { plan, scene: buildSceneFromPlan(plan, sceneId) };
}
