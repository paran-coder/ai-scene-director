import { useEffect, useMemo, useState } from 'react';
import { downloadBlob, safeFilename } from '../domain/export';
import { analyzeProjectHealth, repairProjectSafely, type ProjectHealthReport } from '../domain/projectDoctor';
import { buildVisualSnapshot } from '../domain/visualSnapshot';
import { createSupportBundle } from '../domain/supportBundle';
import { listRecoverySnapshots } from '../domain/recovery';
import { CURRENT_SCHEMA_VERSION } from '../domain/validation';
import type { Project } from '../domain/types';
import type { RenderQualityProfile, RuntimeDiagnostics } from '../domain/runtimeDiagnostics';

interface ProjectDoctorPanelProps {
  open: boolean;
  project: Project;
  runtime: RuntimeDiagnostics | null;
  renderQuality: RenderQualityProfile;
  onRenderQualityChange(profile: RenderQualityProfile): void;
  onApplyProject(project: Project): boolean;
  onClose(): void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ProjectDoctorPanel({
  open,
  project,
  runtime,
  renderQuality,
  onRenderQualityChange,
  onApplyProject,
  onClose,
}: ProjectDoctorPanelProps) {
  const [report, setReport] = useState<ProjectHealthReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const scene = project.scenes.find((item) => item.id === project.activeSceneId) ?? project.scenes[0];
  const shot = scene?.shots[0];
  const snapshot = useMemo(() => scene && shot ? buildVisualSnapshot(scene, shot, 0) : null, [scene, shot, project.revision]);

  const runAudit = async () => {
    setLoading(true);
    setStatus(null);
    try {
      setReport(await analyzeProjectHealth(project, runtime ?? undefined));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void runAudit();
  }, [open, project.revision, runtime?.score]);

  if (!open) return null;

  const repair = () => {
    const result = repairProjectSafely(project);
    if (result.validationErrors.length) {
      setStatus(`자동 복구 후에도 ${result.validationErrors.length}개의 검증 오류가 남았습니다.`);
      return;
    }
    if (!result.changes.length) {
      setStatus('자동으로 수정할 안전한 항목이 없습니다.');
      return;
    }
    const applied = onApplyProject(result.project);
    setStatus(applied ? `${result.changes.length}개 항목을 안전하게 복구했습니다.` : '복구 프로젝트를 적용하지 못했습니다.');
  };

  const downloadDiagnostics = () => {
    if (!report) return;
    const payload = {
      app: 'AI Scene Director',
      appVersion: CURRENT_SCHEMA_VERSION,
      projectId: project.id,
      projectName: project.name,
      projectRevision: project.revision,
      schemaVersion: project.schemaVersion,
      report,
      visualSnapshot: snapshot ? { signature: snapshot.signature, entityCount: snapshot.entityCount } : null,
    };
    downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      `${safeFilename(project.name)}_diagnostics.json`,
    );
  };

  const downloadPreview = () => {
    if (!snapshot) return;
    downloadBlob(
      new Blob([snapshot.svg], { type: 'image/svg+xml' }),
      `${safeFilename(project.name)}_${safeFilename(shot?.name ?? 'shot')}_visual-snapshot.svg`,
    );
  };

  const downloadSupportBundle = async () => {
    if (!report) return;
    setStatus('개인정보를 제거한 지원 번들을 생성하고 있습니다.');
    try {
      const bundle = await createSupportBundle({
        project,
        report,
        runtime,
        snapshot,
        recoverySnapshots: listRecoverySnapshots(),
        appVersion: CURRENT_SCHEMA_VERSION,
      });
      downloadBlob(bundle, `${safeFilename(project.name)}_support_bundle.zip`);
      setStatus('지원 번들을 저장했습니다. GLB·참조 이미지·프롬프트 원문은 포함되지 않습니다.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '지원 번들을 생성하지 못했습니다.');
    }
  };

  const issueGroups = {
    error: report?.issues.filter((item) => item.severity === 'error') ?? [],
    warning: report?.issues.filter((item) => item.severity === 'warning') ?? [],
    info: report?.issues.filter((item) => item.severity === 'info') ?? [],
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal project-doctor" role="dialog" aria-modal="true" aria-label="프로젝트 점검">
        <header className="modal-header">
          <div>
            <strong>프로젝트 점검</strong>
            <span>저장·에셋·Action·실행 환경을 1.0 후보 기준으로 검사합니다.</span>
          </div>
          <button onClick={onClose}>닫기</button>
        </header>

        <div className="doctor-summary">
          <div className={`doctor-score ${report?.status ?? 'attention'}`}>
            <b>{loading ? '…' : report?.score ?? 0}</b>
            <span>상태 점수</span>
          </div>
          <div className="doctor-runtime">
            <strong>렌더 품질</strong>
            <select value={renderQuality} onChange={(event) => onRenderQualityChange(event.target.value as RenderQualityProfile)}>
              <option value="auto">자동 권장</option>
              <option value="performance">성능 우선</option>
              <option value="balanced">균형</option>
              <option value="quality">품질 우선</option>
            </select>
            <span>환경 점수 {runtime?.score ?? '확인 중'} · 권장 {runtime?.recommendedQuality ?? 'balanced'}</span>
            {runtime?.probe.renderer && <small>{runtime.probe.renderer}</small>}
          </div>
          {snapshot && (
            <div className="doctor-visual-signature">
              <strong>결정적 시각 스냅샷</strong>
              <span>{snapshot.signature}</span>
              <small>WebGL 없이도 Scene 상태 변화를 비교하는 회귀 기준입니다.</small>
            </div>
          )}
        </div>

        {snapshot && <div className="doctor-preview" dangerouslySetInnerHTML={{ __html: snapshot.svg }} />}

        {report && (
          <div className="doctor-stats">
            <span>Scene <b>{report.stats.scenes}</b></span>
            <span>Shot <b>{report.stats.shots}</b></span>
            <span>Entity <b>{report.stats.entities}</b></span>
            <span>Action <b>{report.stats.actions}</b></span>
            <span>GLB <b>{report.stats.glbAssets}</b> · {formatBytes(report.stats.glbBytes)}</span>
            <span>참조 이미지 <b>{report.stats.referenceImages}</b> · {formatBytes(report.stats.referenceImageBytes)}</span>
            <span>JSON {formatBytes(report.stats.projectJsonBytes)}</span>
          </div>
        )}

        <div className="doctor-actions">
          <button onClick={() => void runAudit()} disabled={loading}>{loading ? '검사 중…' : '다시 검사'}</button>
          <button onClick={repair} disabled={loading || !report?.issues.some((item) => item.repairable)}>안전 복구 적용</button>
          <button onClick={downloadDiagnostics} disabled={!report}>진단 JSON</button>
          <button onClick={downloadPreview} disabled={!snapshot}>시각 스냅샷 SVG</button>
          <button onClick={() => void downloadSupportBundle()} disabled={!report}>지원 번들 ZIP</button>
        </div>
        {status && <div className="doctor-status">{status}</div>}

        <div className="doctor-issues">
          {(['error', 'warning', 'info'] as const).map((severity) => issueGroups[severity].length > 0 && (
            <section key={severity}>
              <h3>{severity === 'error' ? '차단 문제' : severity === 'warning' ? '주의 항목' : '환경 안내'} <span>{issueGroups[severity].length}</span></h3>
              {issueGroups[severity].map((item) => (
                <article className={`doctor-issue ${severity}`} key={item.id}>
                  <div>
                    <strong>{item.message}</strong>
                    {item.location && <span>{item.location}</span>}
                  </div>
                  {item.repairable && <em>안전 복구 가능</em>}
                </article>
              ))}
            </section>
          ))}
          {!loading && report?.issues.length === 0 && <div className="doctor-empty">검사된 문제 없이 1.0 후보 기준을 통과했습니다.</div>}
        </div>
      </section>
    </div>
  );
}
