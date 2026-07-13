export type RenderQualityProfile = 'auto' | 'performance' | 'balanced' | 'quality';
export type EffectiveRenderQuality = Exclude<RenderQualityProfile, 'auto'>;

export interface RuntimeCapabilityProbe {
  webgl: boolean;
  webgl2: boolean;
  indexedDb: boolean;
  fileSystemAccess: boolean;
  tauri: boolean;
  hardwareConcurrency?: number;
  deviceMemoryGb?: number;
  maxTextureSize?: number;
  renderer?: string;
  userAgent?: string;
}

export interface RuntimeDiagnosticIssue {
  code: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
}

export interface RuntimeDiagnostics {
  probe: RuntimeCapabilityProbe;
  score: number;
  status: 'unsupported' | 'limited' | 'ready';
  recommendedQuality: EffectiveRenderQuality;
  issues: RuntimeDiagnosticIssue[];
}

export interface ViewportQualitySettings {
  profile: EffectiveRenderQuality;
  dpr: [number, number];
  antialias: boolean;
  shadows: boolean;
  powerPreference: 'default' | 'high-performance' | 'low-power';
  showInfiniteGrid: boolean;
}

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function evaluateRuntimeCapabilities(probe: RuntimeCapabilityProbe): RuntimeDiagnostics {
  const issues: RuntimeDiagnosticIssue[] = [];
  let score = 100;

  if (!probe.webgl) {
    score = 0;
    issues.push({ code: 'webgl-unavailable', severity: 'critical', message: 'WebGL을 사용할 수 없어 3D 뷰포트를 실행할 수 없습니다.' });
  } else if (!probe.webgl2) {
    score -= 20;
    issues.push({ code: 'webgl1-only', severity: 'warning', message: 'WebGL 1만 지원되어 대형 GLB와 그림자 성능이 제한될 수 있습니다.' });
  }

  if (finitePositive(probe.deviceMemoryGb)) {
    if (probe.deviceMemoryGb < 4) {
      score -= 22;
      issues.push({ code: 'low-memory', severity: 'warning', message: `기기 메모리가 약 ${probe.deviceMemoryGb}GB로 감지되어 성능 모드를 권장합니다.` });
    } else if (probe.deviceMemoryGb < 8) {
      score -= 8;
      issues.push({ code: 'moderate-memory', severity: 'info', message: `기기 메모리가 약 ${probe.deviceMemoryGb}GB로 감지되었습니다.` });
    }
  }

  if (finitePositive(probe.hardwareConcurrency)) {
    if (probe.hardwareConcurrency < 4) {
      score -= 18;
      issues.push({ code: 'low-cpu', severity: 'warning', message: `${probe.hardwareConcurrency}개 논리 코어가 감지되어 복잡한 씬에서 성능이 낮을 수 있습니다.` });
    } else if (probe.hardwareConcurrency < 8) {
      score -= 6;
    }
  }

  if (finitePositive(probe.maxTextureSize) && probe.maxTextureSize < 4096) {
    score -= 18;
    issues.push({ code: 'small-texture-limit', severity: 'warning', message: `최대 텍스처 크기가 ${probe.maxTextureSize}px로 낮아 고해상도 에셋이 축소될 수 있습니다.` });
  }

  if (!probe.indexedDb) {
    score -= 25;
    issues.push({ code: 'indexeddb-unavailable', severity: 'critical', message: 'IndexedDB를 사용할 수 없어 GLB와 참조 이미지 로컬 보관이 제한됩니다.' });
  }

  if (!probe.fileSystemAccess && !probe.tauri) {
    issues.push({ code: 'folder-api-unavailable', severity: 'info', message: '프로젝트 폴더 직접 저장을 지원하지 않아 ZIP 다운로드 방식을 사용합니다.' });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const status: RuntimeDiagnostics['status'] = !probe.webgl || !probe.indexedDb
    ? 'unsupported'
    : score < 65
      ? 'limited'
      : 'ready';
  const recommendedQuality: EffectiveRenderQuality = score < 55
    ? 'performance'
    : score < 82
      ? 'balanced'
      : 'quality';

  return { probe, score, status, recommendedQuality, issues };
}

export function resolveRenderQuality(profile: RenderQualityProfile, diagnostics?: RuntimeDiagnostics | null): EffectiveRenderQuality {
  return profile === 'auto' ? diagnostics?.recommendedQuality ?? 'balanced' : profile;
}

export function viewportQualitySettings(profile: EffectiveRenderQuality): ViewportQualitySettings {
  if (profile === 'performance') {
    return {
      profile,
      dpr: [0.75, 1],
      antialias: false,
      shadows: false,
      powerPreference: 'low-power',
      showInfiniteGrid: false,
    };
  }
  if (profile === 'quality') {
    return {
      profile,
      dpr: [1, 2],
      antialias: true,
      shadows: true,
      powerPreference: 'high-performance',
      showInfiniteGrid: true,
    };
  }
  return {
    profile,
    dpr: [1, 1.5],
    antialias: true,
    shadows: true,
    powerPreference: 'default',
    showInfiniteGrid: true,
  };
}

export function probeBrowserRuntime(): RuntimeDiagnostics {
  const globalObject = globalThis as typeof globalThis & {
    __TAURI__?: unknown;
    showDirectoryPicker?: unknown;
    navigator?: Navigator & { deviceMemory?: number };
  };
  const navigatorObject = globalObject.navigator;
  const probe: RuntimeCapabilityProbe = {
    webgl: false,
    webgl2: false,
    indexedDb: typeof indexedDB !== 'undefined',
    fileSystemAccess: typeof globalObject.showDirectoryPicker === 'function',
    tauri: Boolean(globalObject.__TAURI__),
    hardwareConcurrency: navigatorObject?.hardwareConcurrency,
    deviceMemoryGb: navigatorObject?.deviceMemory,
    userAgent: navigatorObject?.userAgent,
  };

  try {
    const canvas = document.createElement('canvas');
    const webgl2 = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false });
    const webgl = webgl2 ?? canvas.getContext('webgl', { failIfMajorPerformanceCaveat: false });
    probe.webgl2 = Boolean(webgl2);
    probe.webgl = Boolean(webgl);
    if (webgl) {
      probe.maxTextureSize = Number(webgl.getParameter(webgl.MAX_TEXTURE_SIZE));
      const debugInfo = webgl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) probe.renderer = String(webgl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL));
    }
  } catch {
    probe.webgl = false;
    probe.webgl2 = false;
  }

  return evaluateRuntimeCapabilities(probe);
}
