import type { DirectorActionId, DirectorWorkflowReport } from '../domain/directorWorkflow';

interface DirectorWorkflowPanelProps {
  report: DirectorWorkflowReport;
  activeShotName: string;
  collapsed: boolean;
  focusMode: boolean;
  onAction(action: DirectorActionId): void;
  onToggleCollapsed(): void;
  onToggleFocus(): void;
}

const intentLabels = { still: '스틸 이미지', sequence: '멀티샷', motion: '영상·모션' } as const;

export function DirectorWorkflowPanel({
  report,
  activeShotName,
  collapsed,
  focusMode,
  onAction,
  onToggleCollapsed,
  onToggleFocus,
}: DirectorWorkflowPanelProps) {
  const currentStage = report.stages.find((stage) => stage.status === 'current' || stage.status === 'blocked')
    ?? report.stages.at(-1)!;

  if (collapsed) {
    return (
      <section className="director-workflow collapsed" aria-label="연출 흐름">
        <button className="director-compact-score" title="연출 흐름 펼치기" onClick={onToggleCollapsed}>
          <b>{report.score}%</b><span>{currentStage.title}</span>
        </button>
        <div className="director-compact-next">
          <span>{intentLabels[report.intent]} · {activeShotName}</span>
          <strong>{report.nextAction.label}</strong>
          <small>{report.nextAction.reason}</small>
        </div>
        <button className="director-primary-action" onClick={() => onAction(report.nextAction.id)}>바로 이동</button>
        <div className="director-view-controls">
          <button onClick={onToggleFocus}>{focusMode ? '집중 종료' : '집중 모드'}</button>
          {!focusMode && <button onClick={onToggleCollapsed}>펼치기</button>}
        </div>
      </section>
    );
  }

  return (
    <section className="director-workflow" aria-label="연출 흐름">
      <div className="director-overview">
        <div className="director-score" title="현재 장면 제작 준비도">
          <b>{report.score}</b><span>%</span>
        </div>
        <div>
          <strong>연출 흐름</strong>
          <span>{intentLabels[report.intent]} · {report.summary}</span>
          <small>현재 샷: {activeShotName} · 출력까지 약 {report.journey.estimatedStepsToExport}단계</small>
        </div>
        <div className="director-view-controls">
          <button onClick={onToggleFocus}>{focusMode ? '집중 종료' : '집중 모드'}</button>
          <button onClick={onToggleCollapsed}>접기</button>
        </div>
      </div>
      <div className="director-stages">
        {report.stages.map((stage) => (
          <button
            key={stage.id}
            className={`director-stage ${stage.status}`}
            title={`${stage.description}\n${stage.checks.filter((check) => !check.passed).map((check) => check.detail).join('\n') || '완료'}\n클릭: ${stage.actionLabel}`}
            onClick={() => onAction(stage.actionId)}
          >
            <i>{stage.status === 'complete' ? '✓' : stage.status === 'blocked' ? '!' : stage.score}</i>
            <span>{stage.title}</span>
          </button>
        ))}
      </div>
      <div className="director-next">
        <span>다음 작업</span>
        <strong>{report.nextAction.label}</strong>
        <small>{report.nextAction.reason}</small>
        <button onClick={() => onAction(report.nextAction.id)}>이 단계로 이동</button>
      </div>
    </section>
  );
}
