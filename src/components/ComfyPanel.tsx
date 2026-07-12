import { useMemo, useRef, useState } from 'react';
import {
  ComfyClient,
  buildComfyViewUrl,
  comfyInputPath,
  createConnectionTestWorkflow,
  detectPotentialPaidNodes,
  normalizeComfyServerUrl,
  replaceWorkflowPlaceholders,
  validateWorkflow,
  type ComfyExecutionProgress,
  type ComfyOutputFile,
  type ComfySystemStats,
  type ComfyWorkflow,
} from '../domain/comfyui';
import type { GenerationResult } from '../domain/types';

export interface PreparedComfyInputs {
  files: Partial<Record<
    | 'startFrame'
    | 'endFrame'
    | 'poseStart'
    | 'poseEnd'
    | 'depthStart'
    | 'depthEnd'
    | 'maskStart'
    | 'maskEnd',
    Blob
  >>;
  prompts: {
    scene: string;
    motion: string;
    camera: string;
    negative: string;
  };
  shot: {
    name: string;
    duration: number;
  };
}

interface Props {
  open: boolean;
  onClose(): void;
  onPrepareInputs(mode: 'test' | 'full', onStatus: (message: string) => void): Promise<PreparedComfyInputs>;
  onRegisterResult(result: GenerationResult): void;
  results: GenerationResult[];
  onRemoveResult(id: string): void;
}

const PLACEHOLDER_GUIDE = [
  '__AISD_START_FRAME__', '__AISD_END_FRAME__',
  '__AISD_POSE_START__', '__AISD_POSE_END__',
  '__AISD_DEPTH_START__', '__AISD_DEPTH_END__',
  '__AISD_MASK_START__', '__AISD_MASK_END__',
  '__AISD_SCENE_PROMPT__', '__AISD_MOTION_PROMPT__',
  '__AISD_CAMERA_PROMPT__', '__AISD_NEGATIVE_PROMPT__',
  '__AISD_DURATION__', '__AISD_SEED__',
];

function downloadJson(value: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function shortDevice(stats: ComfySystemStats | null): string {
  const devices = Array.isArray(stats?.devices) ? stats.devices : [];
  const device = devices[0];
  if (!device) return '장치 정보 없음';
  const name = typeof device.name === 'string' ? device.name : 'GPU/CPU';
  const vram = typeof device.vram_total === 'number' ? ` · VRAM ${(device.vram_total / 1024 ** 3).toFixed(1)}GB` : '';
  return `${name}${vram}`;
}

function fileName(base: string, suffix: string): string {
  const safe = base.replaceAll(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 48) || 'shot';
  return `${safe}_${suffix}.png`;
}

export function ComfyPanel({ open, onClose, onPrepareInputs, onRegisterResult, results, onRemoveResult }: Props) {
  const workflowInputRef = useRef<HTMLInputElement>(null);
  const [serverUrl, setServerUrl] = useState(() => localStorage.getItem('aisd-comfy-url') ?? 'http://127.0.0.1:8188');
  const [connected, setConnected] = useState(false);
  const [systemStats, setSystemStats] = useState<ComfySystemStats | null>(null);
  const [objectInfo, setObjectInfo] = useState<Record<string, unknown>>({});
  const [workflow, setWorkflow] = useState<ComfyWorkflow | null>(null);
  const [workflowName, setWorkflowName] = useState('사용자 워크플로');
  const [status, setStatus] = useState('ComfyUI 연결을 확인해 주세요.');
  const [progress, setProgress] = useState<ComfyExecutionProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [allowPaidNodes, setAllowPaidNodes] = useState(false);
  const [latestOutputs, setLatestOutputs] = useState<ComfyOutputFile[]>([]);

  const paidFindings = useMemo(
    () => workflow ? detectPotentialPaidNodes(workflow, objectInfo) : [],
    [workflow, objectInfo],
  );

  if (!open) return null;

  const connect = async () => {
    setStatus('ComfyUI 연결 확인 중…');
    setConnected(false);
    try {
      const normalized = normalizeComfyServerUrl(serverUrl);
      setServerUrl(normalized);
      localStorage.setItem('aisd-comfy-url', normalized);
      const client = new ComfyClient(normalized);
      const connection = await client.checkConnection();
      setSystemStats(connection.stats);
      setObjectInfo(connection.objectInfo);
      setConnected(true);
      setStatus(`연결됨 · 노드 ${Object.keys(connection.objectInfo).length}개 · ${shortDevice(connection.stats)}`);
    } catch (error) {
      setStatus(error instanceof Error
        ? `${error.message} · 브라우저 버전은 ComfyUI를 --enable-cors-header http://localhost:5173 옵션으로 실행해야 할 수 있습니다.`
        : 'ComfyUI에 연결하지 못했습니다.');
    }
  };

  const importWorkflow = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text()) as unknown;
      const candidate = raw && typeof raw === 'object' && !Array.isArray(raw) && 'prompt' in raw
        ? (raw as { prompt: unknown }).prompt
        : raw;
      const validation = validateWorkflow(candidate);
      if (!validation.valid) throw new Error(validation.errors[0]);
      setWorkflow(candidate as ComfyWorkflow);
      setWorkflowName(file.name.replace(/\.json$/i, ''));
      setAllowPaidNodes(false);
      setStatus(`API 워크플로 ${validation.nodeCount}개 노드 불러옴`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '워크플로 JSON을 읽지 못했습니다.');
    }
  };

  const execute = async (mode: 'test' | 'custom') => {
    if (running) return;
    if (mode === 'custom' && !workflow) {
      setStatus('먼저 ComfyUI의 API 형식 워크플로 JSON을 불러오세요.');
      return;
    }
    if (mode === 'custom' && paidFindings.length && !allowPaidNodes) {
      setStatus('외부·유료 API 가능성이 있는 노드가 있습니다. 확인 체크 후 실행해 주세요.');
      return;
    }
    setRunning(true);
    setLatestOutputs([]);
    setProgress({ status: 'connecting', progress: 0, message: '입력 준비 중' });
    try {
      const normalized = normalizeComfyServerUrl(serverUrl);
      const client = new ComfyClient(normalized);
      if (!connected) {
        const connection = await client.checkConnection();
        setSystemStats(connection.stats);
        setObjectInfo(connection.objectInfo);
        setConnected(true);
      }
      const prepared = await onPrepareInputs(mode === 'test' ? 'test' : 'full', (message) => {
        setStatus(message);
        setProgress((current) => ({ status: 'running', progress: current?.progress ?? 0, message }));
      });

      const uploadEntries = Object.entries(prepared.files).filter((entry): entry is [string, Blob] => entry[1] instanceof Blob);
      const uploaded: Record<string, string> = {};
      for (let index = 0; index < uploadEntries.length; index += 1) {
        const [key, blob] = uploadEntries[index];
        const suffixMap: Record<string, string> = {
          startFrame: 'start_frame', endFrame: 'end_frame', poseStart: 'pose_start', poseEnd: 'pose_end',
          depthStart: 'depth_start', depthEnd: 'depth_end', maskStart: 'mask_start', maskEnd: 'mask_end',
        };
        setStatus(`ComfyUI 입력 업로드 ${index + 1}/${uploadEntries.length}`);
        const result = await client.uploadImage(blob, fileName(prepared.shot.name, suffixMap[key] ?? key));
        uploaded[key] = comfyInputPath(result);
      }

      const placeholders: Record<string, unknown> = {
        __AISD_START_FRAME__: uploaded.startFrame ?? '',
        __AISD_END_FRAME__: uploaded.endFrame ?? '',
        __AISD_POSE_START__: uploaded.poseStart ?? '',
        __AISD_POSE_END__: uploaded.poseEnd ?? '',
        __AISD_DEPTH_START__: uploaded.depthStart ?? '',
        __AISD_DEPTH_END__: uploaded.depthEnd ?? '',
        __AISD_MASK_START__: uploaded.maskStart ?? '',
        __AISD_MASK_END__: uploaded.maskEnd ?? '',
        __AISD_SCENE_PROMPT__: prepared.prompts.scene,
        __AISD_MOTION_PROMPT__: prepared.prompts.motion,
        __AISD_CAMERA_PROMPT__: prepared.prompts.camera,
        __AISD_NEGATIVE_PROMPT__: prepared.prompts.negative,
        __AISD_DURATION__: prepared.shot.duration,
        __AISD_SEED__: Math.floor(Math.random() * 2_147_483_647),
      };
      const sourceWorkflow = mode === 'test' ? createConnectionTestWorkflow() : workflow!;
      const compiled = replaceWorkflowPlaceholders(sourceWorkflow, placeholders);
      const validation = validateWorkflow(compiled);
      if (!validation.valid) throw new Error(validation.errors[0]);

      setStatus('ComfyUI 큐에 워크플로 제출 중');
      const queued = await client.queueWorkflow(compiled);
      const result = await client.monitorPrompt(queued.promptId, (next) => {
        setProgress(next);
        setStatus(next.message);
      });
      setLatestOutputs(result.outputs);
      const generationResult: GenerationResult = {
        id: `comfy-result-${crypto.randomUUID()}`,
        provider: 'comfyui',
        serverUrl: normalized,
        promptId: result.promptId,
        workflowName: mode === 'test' ? '연결 테스트' : workflowName,
        createdAt: new Date().toISOString(),
        outputs: result.outputs.map(({ nodeId, filename, subfolder, type, kind }) => ({ nodeId, filename, subfolder, type, kind })),
      };
      onRegisterResult(generationResult);
      setStatus(`현재 Shot에 결과 ${result.outputs.length}개를 등록했습니다.`);
    } catch (error) {
      setProgress({ status: 'failed', progress: 0, message: error instanceof Error ? error.message : 'ComfyUI 실행 실패' });
      setStatus(error instanceof Error ? error.message : 'ComfyUI 실행에 실패했습니다.');
    } finally {
      setRunning(false);
    }
  };

  const interrupt = async () => {
    try {
      await new ComfyClient(serverUrl).interrupt();
      setStatus('ComfyUI 실행 중단을 요청했습니다.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '중단 요청 실패');
    }
  };

  const allResults = [...results].reverse();

  return (
    <div className="comfy-overlay" role="dialog" aria-modal="true" aria-label="ComfyUI 로컬 연결">
      <section className="comfy-panel">
        <header>
          <div><h2>로컬 ComfyUI</h2><p>유료 외부 API 없이 사용자 PC의 ComfyUI 워크플로를 실행합니다.</p></div>
          <button onClick={onClose}>닫기</button>
        </header>

        <div className="comfy-connection">
          <label>서버 주소<input value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} /></label>
          <button onClick={connect} disabled={running}>연결 확인</button>
          <span className={connected ? 'connected' : ''}>{status}</span>
        </div>

        <div className="comfy-grid">
          <section>
            <h3>1. 워크플로</h3>
            <div className="button-row">
              <button onClick={() => workflowInputRef.current?.click()}>API 워크플로 불러오기</button>
              <button onClick={() => downloadJson(createConnectionTestWorkflow(), 'aisd_comfy_connection_test_api.json')}>테스트 JSON 저장</button>
            </div>
            <input ref={workflowInputRef} hidden type="file" accept="application/json,.json" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importWorkflow(file);
              event.currentTarget.value = '';
            }} />
            <p className="comfy-workflow-name">{workflow ? `${workflowName} · ${Object.keys(workflow).length}개 노드` : '사용자 워크플로 없음'}</p>
            <details>
              <summary>사용 가능한 자리표시자</summary>
              <code className="placeholder-list">{PLACEHOLDER_GUIDE.join('\n')}</code>
              <p>ComfyUI에서 워크플로를 “API Format”으로 저장하고, LoadImage 파일명이나 텍스트 입력을 위 토큰으로 바꾸십시오.</p>
            </details>
            {paidFindings.length > 0 && (
              <div className="comfy-warning">
                <strong>유료 API 가능성 노드 {paidFindings.length}개</strong>
                {paidFindings.map((item) => <span key={`${item.nodeId}-${item.classType}`}>{item.nodeId}: {item.classType}</span>)}
                <label><input type="checkbox" checked={allowPaidNodes} onChange={(event) => setAllowPaidNodes(event.target.checked)} /> 비용 발생 가능성을 확인했습니다.</label>
              </div>
            )}
          </section>

          <section>
            <h3>2. 실행</h3>
            <div className="button-row">
              <button disabled={running} onClick={() => void execute('test')}>시작 프레임 연결 테스트</button>
              <button className="primary-export" disabled={running || !workflow} onClick={() => void execute('custom')}>현재 Shot 실행</button>
              {running && <button className="danger" onClick={() => void interrupt()}>중단</button>}
            </div>
            {progress && (
              <div className="comfy-progress">
                <progress max={1} value={Math.max(0, Math.min(1, progress.progress))} />
                <span>{Math.round(progress.progress * 100)}% · {progress.message}</span>
              </div>
            )}
            <div className="comfy-info">
              <span>{connected ? '연결됨' : '연결 안 됨'}</span>
              <span>{shortDevice(systemStats)}</span>
              <span>브라우저 CORS 설정이 필요할 수 있음</span>
            </div>
          </section>
        </div>

        {latestOutputs.length > 0 && (
          <section className="comfy-results">
            <h3>방금 생성한 결과</h3>
            <div className="result-grid">
              {latestOutputs.map((output) => output.kind === 'image' ? (
                <a key={`${output.nodeId}-${output.filename}`} href={output.url} target="_blank" rel="noreferrer"><img src={output.url} alt={output.filename} /><span>{output.filename}</span></a>
              ) : (
                <a key={`${output.nodeId}-${output.filename}`} href={output.url} target="_blank" rel="noreferrer"><strong>{output.kind}</strong><span>{output.filename}</span></a>
              ))}
            </div>
          </section>
        )}

        <section className="comfy-results">
          <h3>현재 Shot에 등록된 결과 · {allResults.length}개 실행</h3>
          {allResults.length === 0 ? <p>아직 등록된 ComfyUI 결과가 없습니다.</p> : allResults.map((result) => (
            <article key={result.id} className="saved-result">
              <div><strong>{result.workflowName}</strong><span>{new Date(result.createdAt).toLocaleString()} · 출력 {result.outputs.length}개</span></div>
              <div className="saved-output-links">
                {result.outputs.map((output) => (
                  <a key={`${result.id}-${output.nodeId}-${output.filename}`} href={buildComfyViewUrl(result.serverUrl, { filename: output.filename, subfolder: output.subfolder, type: output.type })} target="_blank" rel="noreferrer">{output.kind}: {output.filename}</a>
                ))}
              </div>
              <button className="danger" onClick={() => onRemoveResult(result.id)}>기록 삭제</button>
            </article>
          ))}
        </section>
      </section>
    </div>
  );
}
