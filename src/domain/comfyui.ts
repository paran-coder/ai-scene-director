export type ComfyWorkflowNode = {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: Record<string, unknown>;
};

export type ComfyWorkflow = Record<string, ComfyWorkflowNode>;

export interface ComfySystemStats {
  system?: Record<string, unknown>;
  devices?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface ComfyUploadResult {
  name: string;
  subfolder?: string;
  type?: string;
}

export interface ComfyOutputFile {
  nodeId: string;
  filename: string;
  subfolder: string;
  type: string;
  kind: 'image' | 'video' | 'audio' | 'file';
  url: string;
}

export interface ComfyExecutionProgress {
  status: 'connecting' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  message: string;
  nodeId?: string;
}

export interface ComfyExecutionResult {
  promptId: string;
  outputs: ComfyOutputFile[];
  history: Record<string, unknown>;
}

export type ComfyPlaceholderValues = Record<string, unknown>;

const PAID_NODE_PATTERNS = [
  /partner/i,
  /api\s*node/i,
  /kling/i,
  /runway/i,
  /luma/i,
  /veo/i,
  /sora/i,
  /ideogram/i,
  /recraft/i,
  /openai/i,
  /gemini/i,
  /flux\s*pro/i,
  /stability\s*api/i,
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeComfyServerUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed) return 'http://127.0.0.1:8188';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

export function buildComfyWebSocketUrl(serverUrl: string, clientId: string): string {
  const url = new URL(normalizeComfyServerUrl(serverUrl));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/$/, '')}/ws`;
  url.search = `clientId=${encodeURIComponent(clientId)}`;
  return url.toString();
}

export function buildComfyViewUrl(serverUrl: string, file: Pick<ComfyOutputFile, 'filename' | 'subfolder' | 'type'>): string {
  const url = new URL(`${normalizeComfyServerUrl(serverUrl)}/view`);
  url.searchParams.set('filename', file.filename);
  url.searchParams.set('subfolder', file.subfolder ?? '');
  url.searchParams.set('type', file.type || 'output');
  return url.toString();
}

export function comfyInputPath(upload: ComfyUploadResult): string {
  return upload.subfolder ? `${upload.subfolder}/${upload.name}` : upload.name;
}

export function createConnectionTestWorkflow(imageValue: string = '__AISD_START_FRAME__'): ComfyWorkflow {
  return {
    '1': {
      class_type: 'LoadImage',
      inputs: { image: imageValue },
      _meta: { title: 'AI Scene Director 시작 프레임' },
    },
    '2': {
      class_type: 'PreviewImage',
      inputs: { images: ['1', 0] },
      _meta: { title: '연결 테스트 출력' },
    },
  };
}

function replaceString(value: string, placeholders: ComfyPlaceholderValues): unknown {
  if (Object.prototype.hasOwnProperty.call(placeholders, value)) return structuredClone(placeholders[value]);
  let output = value;
  for (const [token, replacement] of Object.entries(placeholders)) {
    output = output.replaceAll(token, String(replacement ?? ''));
  }
  return output;
}

function replaceValue(value: unknown, placeholders: ComfyPlaceholderValues): unknown {
  if (typeof value === 'string') return replaceString(value, placeholders);
  if (Array.isArray(value)) return value.map((item) => replaceValue(item, placeholders));
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceValue(item, placeholders)]));
  }
  return value;
}

export function replaceWorkflowPlaceholders(workflow: ComfyWorkflow, placeholders: ComfyPlaceholderValues): ComfyWorkflow {
  return replaceValue(workflow, placeholders) as ComfyWorkflow;
}

export function validateWorkflow(workflow: unknown): { valid: boolean; errors: string[]; nodeCount: number } {
  const errors: string[] = [];
  if (!isRecord(workflow)) return { valid: false, errors: ['워크플로 루트는 객체여야 합니다.'], nodeCount: 0 };
  const entries = Object.entries(workflow);
  if (!entries.length) errors.push('워크플로에 노드가 없습니다.');
  for (const [nodeId, node] of entries) {
    if (!isRecord(node)) {
      errors.push(`${nodeId}: 노드가 객체가 아닙니다.`);
      continue;
    }
    if (typeof node.class_type !== 'string' || !node.class_type) errors.push(`${nodeId}: class_type이 없습니다.`);
    if (!isRecord(node.inputs)) errors.push(`${nodeId}: inputs가 객체가 아닙니다.`);
  }
  return { valid: errors.length === 0, errors, nodeCount: entries.length };
}

export function detectPotentialPaidNodes(
  workflow: ComfyWorkflow,
  objectInfo?: Record<string, unknown>,
): Array<{ nodeId: string; classType: string; reason: string }> {
  const findings: Array<{ nodeId: string; classType: string; reason: string }> = [];
  for (const [nodeId, node] of Object.entries(workflow)) {
    const info = objectInfo && isRecord(objectInfo[node.class_type]) ? objectInfo[node.class_type] as Record<string, unknown> : undefined;
    const haystack = [
      node.class_type,
      typeof node._meta?.title === 'string' ? node._meta.title : '',
      typeof info?.category === 'string' ? info.category : '',
      typeof info?.description === 'string' ? info.description : '',
      typeof info?.python_module === 'string' ? info.python_module : '',
    ].join(' ');
    const matched = PAID_NODE_PATTERNS.find((pattern) => pattern.test(haystack));
    if (matched) findings.push({ nodeId, classType: node.class_type, reason: `외부·유료 API 노드일 가능성: ${matched.source}` });
  }
  return findings;
}

function outputKind(key: string, filename: string): ComfyOutputFile['kind'] {
  const lower = `${key} ${filename}`.toLowerCase();
  if (/\.(mp4|webm|mov|mkv|gif)$/.test(lower) || /video|gifs/.test(lower)) return 'video';
  if (/\.(wav|mp3|flac|ogg|m4a)$/.test(lower) || /audio/.test(lower)) return 'audio';
  if (/\.(png|jpe?g|webp|bmp)$/.test(lower) || /images/.test(lower)) return 'image';
  return 'file';
}

export function extractComfyOutputs(
  historyResponse: unknown,
  promptId: string,
  serverUrl: string,
): ComfyOutputFile[] {
  if (!isRecord(historyResponse)) return [];
  const entry = isRecord(historyResponse[promptId])
    ? historyResponse[promptId] as Record<string, unknown>
    : historyResponse;
  const outputs = isRecord(entry.outputs) ? entry.outputs : {};
  const files: ComfyOutputFile[] = [];
  for (const [nodeId, nodeOutput] of Object.entries(outputs)) {
    if (!isRecord(nodeOutput)) continue;
    for (const [key, rawList] of Object.entries(nodeOutput)) {
      if (!Array.isArray(rawList)) continue;
      for (const raw of rawList) {
        if (!isRecord(raw) || typeof raw.filename !== 'string') continue;
        const file: ComfyOutputFile = {
          nodeId,
          filename: raw.filename,
          subfolder: typeof raw.subfolder === 'string' ? raw.subfolder : '',
          type: typeof raw.type === 'string' ? raw.type : 'output',
          kind: outputKind(key, raw.filename),
          url: '',
        };
        file.url = buildComfyViewUrl(serverUrl, file);
        files.push(file);
      }
    }
  }
  return files;
}

export class ComfyClient {
  readonly serverUrl: string;
  readonly clientId: string;

  constructor(serverUrl: string, clientId = crypto.randomUUID()) {
    this.serverUrl = normalizeComfyServerUrl(serverUrl);
    this.clientId = clientId;
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const response = await fetch(`${this.serverUrl}${path}`, init);
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`ComfyUI ${response.status}: ${body || response.statusText}`);
    }
    return response;
  }

  async checkConnection(): Promise<{ stats: ComfySystemStats; objectInfo: Record<string, unknown> }> {
    const [statsResponse, objectInfoResponse] = await Promise.all([
      this.request('/system_stats'),
      this.request('/object_info'),
    ]);
    return {
      stats: await statsResponse.json() as ComfySystemStats,
      objectInfo: await objectInfoResponse.json() as Record<string, unknown>,
    };
  }

  async uploadImage(blob: Blob, filename: string, subfolder = 'ai_scene_director'): Promise<ComfyUploadResult> {
    const form = new FormData();
    form.append('image', blob, filename);
    form.append('overwrite', 'true');
    form.append('type', 'input');
    form.append('subfolder', subfolder);
    const response = await this.request('/upload/image', { method: 'POST', body: form });
    const result = await response.json() as ComfyUploadResult;
    if (!result.name) throw new Error('ComfyUI가 업로드 파일명을 반환하지 않았습니다.');
    return result;
  }

  async queueWorkflow(workflow: ComfyWorkflow): Promise<{ promptId: string; number?: number }> {
    const response = await this.request('/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: this.clientId }),
    });
    const result = await response.json() as Record<string, unknown>;
    if (typeof result.prompt_id !== 'string') {
      const nodeErrors = result.node_errors ? JSON.stringify(result.node_errors) : '';
      throw new Error(`워크플로 검증 실패: ${String(result.error ?? 'prompt_id 없음')} ${nodeErrors}`.trim());
    }
    return { promptId: result.prompt_id, number: typeof result.number === 'number' ? result.number : undefined };
  }

  async getHistory(promptId: string): Promise<Record<string, unknown>> {
    const response = await this.request(`/history/${encodeURIComponent(promptId)}`);
    return await response.json() as Record<string, unknown>;
  }

  async interrupt(): Promise<void> {
    await this.request('/interrupt', { method: 'POST' });
  }

  async monitorPrompt(
    promptId: string,
    onProgress: (progress: ComfyExecutionProgress) => void,
    timeoutMs = 10 * 60 * 1000,
  ): Promise<ComfyExecutionResult> {
    let socket: WebSocket | null = null;
    let socketProgress = 0;
    try {
      socket = new WebSocket(buildComfyWebSocketUrl(this.serverUrl, this.clientId));
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as Record<string, unknown>;
          const data = isRecord(message.data) ? message.data : {};
          if (typeof data.prompt_id === 'string' && data.prompt_id !== promptId) return;
          if (message.type === 'progress' && typeof data.value === 'number' && typeof data.max === 'number' && data.max > 0) {
            socketProgress = Math.max(socketProgress, data.value / data.max);
            onProgress({ status: 'running', progress: socketProgress, message: '노드 실행 중', nodeId: typeof data.node === 'string' ? data.node : undefined });
          } else if (message.type === 'executing' && typeof data.node === 'string') {
            onProgress({ status: 'running', progress: Math.max(socketProgress, 0.05), message: `노드 ${data.node} 실행 중`, nodeId: data.node });
          } else if (message.type === 'execution_error') {
            onProgress({ status: 'failed', progress: socketProgress, message: String(data.exception_message ?? 'ComfyUI 실행 오류') });
          }
        } catch {
          // Binary preview frames and unknown extension messages are ignored.
        }
      };
    } catch {
      socket = null;
    }

    const startedAt = Date.now();
    onProgress({ status: 'queued', progress: 0, message: 'ComfyUI 실행 대기 중' });
    try {
      while (Date.now() - startedAt < timeoutMs) {
        const history = await this.getHistory(promptId);
        const entry = isRecord(history[promptId]) ? history[promptId] as Record<string, unknown> : undefined;
        if (entry) {
          const status = isRecord(entry.status) ? entry.status : undefined;
          const statusText = typeof status?.status_str === 'string' ? status.status_str : '';
          if (statusText === 'error') throw new Error('ComfyUI 워크플로 실행에 실패했습니다. History를 확인해 주세요.');
          const completed = status?.completed === true || Boolean(entry.outputs);
          if (completed) {
            const outputs = extractComfyOutputs(history, promptId, this.serverUrl);
            onProgress({ status: 'completed', progress: 1, message: `완료 · 결과 ${outputs.length}개` });
            return { promptId, outputs, history };
          }
        }
        onProgress({ status: 'running', progress: Math.max(socketProgress, 0.02), message: socketProgress > 0 ? 'ComfyUI 생성 중' : '큐 상태 확인 중' });
        await new Promise((resolve) => setTimeout(resolve, 900));
      }
      throw new Error('ComfyUI 실행 제한 시간을 초과했습니다.');
    } finally {
      socket?.close();
    }
  }
}
