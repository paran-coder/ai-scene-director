import type { DirectorActionId, DirectorStageStatus, DirectorWorkflowReport } from '../domain/directorWorkflow';

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

type MacroStage = {
  id: 'create' | 'edit' | 'export';
  title: string;
  description: string;
  score: number;
  status: DirectorStageStatus;
  actionId: DirectorActionId;
  actionLabel: string;
};

function mergeStatus(statuses: DirectorStageStatus[]): DirectorStageStatus {
  if (statuses.includes('blocked')) return 'blocked';
  if (statuses.every((status) => status === 'complete')) return 'complete';
  if (statuses.includes('current')) return 'current';
  return 'pending';
}

function buildMacroStages(report: DirectorWorkflowReport): MacroStage[] {
  const byId = new Map(report.stages.map((stage) => [stage.id, stage]));
  const make = (
    id: MacroStage['id'],
    title: string,
    description: string,
    ids: Array<'idea' | 'scene' | 'shots' | 'direction' | 'review' | 'export'>,
    fallbackAction: DirectorActionId,
    actionLabel: string,
  ): MacroStage => {
    const stages = ids.map((stageId) => byId.get(stageId)).filter(Boolean) as DirectorWorkflowReport['stages'];
    const blocked = stages.find((stage) => stage.status === 'blocked');
    const current = stages.find((stage) => stage.status === 'current');
    return {
      id,
      title,
      description,
      score: Math.round(stages.reduce((sum, stage) => sum + stage.score, 0) / Math.max(1, stages.length)),
      status: mergeStatus(stages.map((stage) => stage.status)),
      actionId: blocked?.actionId ?? current?.actionId ?? fallbackAction,
      actionLabel,
    };
  };

  return [
    make('create', '1. 장면 만들기', '자연어로 공간·인물·소품과 기본 샷을 구성합니다.', ['idea', 'scene'], 'openSceneGenerator', '장면 만들기'),
    make('edit', '2. 장면 수정하기', '배치·카메라·관계·동작을 원하는 연출로 다듬습니다.', ['shots', 'direction', 'review'], 'selectPrimarySubject', '장면 수정하기'),
    make('export', '3. AI용 내보내기', '이미지·영상 생성 AI용 프레임, 제어 이미지와 프롬프트를 만듭니다.', ['export'], 'exportShotPackage', 'AI용 내보내기'),
  ];
}

export function DirectorWorkflowPanel({
  report,
  activeShotName,
  collapsed,
  focusMode,
  onAction,
  onToggleCollapsed,
  onToggleFocus,
}: DirectorWorkflowPanelProps) {
  const stages = buildMacroStages(report);
  const currentStage = stages.find((stage) => stage.status === 'current' || stage.status === 'blocked')
    ?? stages.at(-1)!;

  if (collapsed) {
    return (
      <section className="director-workflow collapsed" aria-label="3단계 제작 흐름">
        <button className="director-compact-score" title="제작 흐름 펼치기" onClick={onToggleCollapsed}>
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
    <section className="director-workflow" aria-label="3단계 제작 흐름">
      <div className="director-overview">
        <div className="director-score" title="현재 장면 제작 준비도">
          <b>{report.score}</b><span>%</span>
        </div>
        <div>
          <strong>3단계 제작 흐름</strong>
          <span>{intentLabels[report.intent]} · {report.summary}</span>
          <small>현재 샷: {activeShotName} · AI용 내보내기까지 약 {report.journey.estimatedStepsToExport}단계</small>
        </div>
        <div className="director-view-controls">
          <button onClick={onToggleFocus}>{focusMode ? '집중 종료' : '집중 모드'}</button>
          <button onClick={onToggleCollapsed}>접기</button>
        </div>
      </div>
      <div className="director-stages macro">
        {stages.map((stage) => (
          <button
            key={stage.id}
            className={`director-stage ${stage.status}`}
            title={`${stage.description}\n클릭: ${stage.actionLabel}`}
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
