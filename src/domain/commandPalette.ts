export type CommandCategory = 'workflow' | 'edit' | 'timeline' | 'view' | 'project' | 'help';

export type AppCommandId =
  | 'openSceneGenerator'
  | 'focusSceneHierarchy'
  | 'focusShotStrip'
  | 'focusTimeline'
  | 'openProjectDoctor'
  | 'exportShotPackage'
  | 'toggleFocusMode'
  | 'toggleWorkflow'
  | 'undo'
  | 'redo'
  | 'transformTranslate'
  | 'transformRotate'
  | 'transformScale'
  | 'transformPose'
  | 'togglePlayback'
  | 'resetPlayhead'
  | 'addShot'
  | 'duplicateShot'
  | 'selectShotCamera'
  | 'saveProject'
  | 'exportProjectBundle'
  | 'openOnboarding'
  | 'openSessionInsights';

export interface AppCommand {
  id: AppCommandId;
  label: string;
  description: string;
  category: CommandCategory;
  keywords: string[];
  shortcut?: string;
  enabled?: boolean;
}

export interface CommandContext {
  canUndo: boolean;
  canRedo: boolean;
  canSaveWorkspace: boolean;
  hasSelection: boolean;
  isPlaying: boolean;
  focusMode: boolean;
  workflowCollapsed: boolean;
}

const COMMANDS: Omit<AppCommand, 'enabled'>[] = [
  { id: 'openSceneGenerator', label: 'AI 장면 초안 만들기', description: '자연어로 인물·소품·카메라·샷을 구성합니다.', category: 'workflow', keywords: ['자연어', 'scene', '장면', '초안'], shortcut: 'G' },
  { id: 'focusSceneHierarchy', label: '장면 구성으로 이동', description: '씬 계층과 핵심 피사체를 엽니다.', category: 'workflow', keywords: ['객체', '인물', '소품', '계층'], shortcut: 'Alt+2' },
  { id: 'focusShotStrip', label: '샷 설계로 이동', description: '샷 목록과 카메라 구성을 엽니다.', category: 'workflow', keywords: ['shot', '카메라', '구도'], shortcut: 'Alt+3' },
  { id: 'focusTimeline', label: '관계·동작으로 이동', description: '타임라인과 Action 편집으로 이동합니다.', category: 'workflow', keywords: ['action', '동작', '타임라인'], shortcut: 'Alt+4' },
  { id: 'openProjectDoctor', label: '프로젝트 점검 열기', description: '출력 차단 문제와 저장 상태를 검사합니다.', category: 'workflow', keywords: ['검사', '진단', '복구'], shortcut: 'Alt+5' },
  { id: 'exportShotPackage', label: '현재 샷 출력', description: '프레임·Pose·Depth·Mask·Manifest를 ZIP으로 만듭니다.', category: 'workflow', keywords: ['export', '출력', '패키지'], shortcut: 'Alt+6' },
  { id: 'undo', label: '실행 취소', description: '마지막 편집을 되돌립니다.', category: 'edit', keywords: ['undo', '되돌리기'], shortcut: 'Ctrl/Cmd+Z' },
  { id: 'redo', label: '다시 실행', description: '취소한 편집을 다시 적용합니다.', category: 'edit', keywords: ['redo', '재실행'], shortcut: 'Ctrl/Cmd+Shift+Z' },
  { id: 'transformTranslate', label: '이동 도구', description: '선택 객체를 이동합니다.', category: 'edit', keywords: ['move', 'translate', '이동'], shortcut: 'W' },
  { id: 'transformRotate', label: '회전 도구', description: '선택 객체를 회전합니다.', category: 'edit', keywords: ['rotate', '회전'], shortcut: 'E' },
  { id: 'transformScale', label: '크기 도구', description: '선택 객체의 크기를 조절합니다.', category: 'edit', keywords: ['scale', '크기'], shortcut: 'R' },
  { id: 'transformPose', label: '포즈 도구', description: '선택 인물의 관절과 IK를 편집합니다.', category: 'edit', keywords: ['pose', '포즈', '관절'], shortcut: 'P' },
  { id: 'togglePlayback', label: '타임라인 재생·정지', description: '현재 샷의 Action을 재생하거나 정지합니다.', category: 'timeline', keywords: ['play', '재생', '정지'], shortcut: 'Space' },
  { id: 'resetPlayhead', label: '재생 헤드를 처음으로', description: '현재 샷의 0초로 이동합니다.', category: 'timeline', keywords: ['home', '처음', '0초'], shortcut: 'Home' },
  { id: 'addShot', label: '새 샷 추가', description: '현재 장면에 새로운 샷을 만듭니다.', category: 'timeline', keywords: ['shot', '샷', '추가'], shortcut: 'Ctrl/Cmd+Shift+N' },
  { id: 'duplicateShot', label: '현재 샷 복제', description: '현재 샷의 카메라·관계·Action을 복제합니다.', category: 'timeline', keywords: ['duplicate', '복제'], shortcut: 'Ctrl/Cmd+D' },
  { id: 'selectShotCamera', label: '카메라 구도·렌즈 편집', description: '현재 샷 카메라 구도와 렌즈를 속성 패널에서 편집합니다.', category: 'timeline', keywords: ['camera', '카메라', '렌즈'], shortcut: 'C' },
  { id: 'toggleFocusMode', label: '집중 모드 전환', description: '보조 패널을 숨기거나 다시 표시합니다.', category: 'view', keywords: ['focus', '집중', '패널'], shortcut: 'F' },
  { id: 'toggleWorkflow', label: '연출 흐름 접기·펼치기', description: '상단 제작 안내판의 크기를 전환합니다.', category: 'view', keywords: ['workflow', '연출', '접기'], shortcut: 'Shift+F' },
  { id: 'saveProject', label: '프로젝트 저장', description: '연결된 폴더에 저장하거나 프로젝트 번들을 내보냅니다.', category: 'project', keywords: ['save', '저장', '폴더'], shortcut: 'Ctrl/Cmd+S' },
  { id: 'exportProjectBundle', label: '프로젝트 번들 내보내기', description: '프로젝트 JSON과 로컬 에셋을 하나의 ZIP으로 저장합니다.', category: 'project', keywords: ['bundle', '번들', '백업'] },
  { id: 'openOnboarding', label: '도움말 열기', description: '핵심 제작 흐름과 기본 조작을 다시 봅니다.', category: 'help', keywords: ['help', '도움말', '온보딩'], shortcut: '?' },
  { id: 'openSessionInsights', label: '제작 세션 기록 보기', description: '현재 세션의 익명 단계·시간·명령 사용 기록을 확인합니다.', category: 'help', keywords: ['session', '세션', '사용성', '기록'] },
];

function normalize(value: string): string {
  return value.toLocaleLowerCase('ko-KR').replace(/\s+/g, ' ').trim();
}

export function buildCommandCatalog(context: CommandContext): AppCommand[] {
  return COMMANDS.map((command) => ({
    ...command,
    enabled: command.id === 'undo' ? context.canUndo
      : command.id === 'redo' ? context.canRedo
        : command.id === 'transformPose' ? context.hasSelection
          : true,
  }));
}

export function searchCommands(commands: AppCommand[], query: string): AppCommand[] {
  const normalized = normalize(query);
  if (!normalized) return commands.filter((command) => command.enabled !== false);
  const tokens = normalized.split(' ').filter(Boolean);
  return commands
    .filter((command) => command.enabled !== false)
    .map((command) => {
      const label = normalize(command.label);
      const haystack = normalize([command.label, command.description, command.category, command.shortcut ?? '', ...command.keywords].join(' '));
      if (!tokens.every((token) => haystack.includes(token))) return null;
      let score = 0;
      if (label === normalized) score += 100;
      if (label.startsWith(normalized)) score += 60;
      if (label.includes(normalized)) score += 30;
      if (haystack.includes(normalized)) score += 20;
      for (const token of tokens) {
        if (label.startsWith(token)) score += 10;
        if (command.keywords.some((keyword) => normalize(keyword) === token)) score += 8;
      }
      return { command, score };
    })
    .filter((item): item is { command: AppCommand; score: number } => Boolean(item))
    .sort((a, b) => b.score - a.score || a.command.label.localeCompare(b.command.label, 'ko'))
    .map((item) => item.command);
}

export function commandCategoryLabel(category: CommandCategory): string {
  return ({ workflow: '연출 흐름', edit: '편집', timeline: '샷·타임라인', view: '보기', project: '프로젝트', help: '도움말' } as const)[category];
}
