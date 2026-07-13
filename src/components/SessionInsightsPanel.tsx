import { useMemo } from 'react';
import { clearCreatorSessions, summarizeCreatorSession, type CreatorSessionRecord } from '../domain/sessionInsights';

function duration(ms: number | null): string {
  if (ms === null) return '아직 도달하지 않음';
  if (ms < 60_000) return `${Math.max(0, Math.round(ms / 1000))}초`;
  return `${Math.floor(ms / 60_000)}분 ${Math.round((ms % 60_000) / 1000)}초`;
}

export function SessionInsightsPanel({ open, session, onClose, onClear }: {
  open: boolean;
  session: CreatorSessionRecord;
  onClose(): void;
  onClear(): void;
}) {
  const summary = useMemo(() => summarizeCreatorSession(session), [session]);
  if (!open) return null;
  const download = () => {
    const blob = new Blob([JSON.stringify({ session, summary }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `ai-scene-director-session-${session.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const clear = () => {
    if (!window.confirm('이 브라우저에 저장된 제작 세션 기록을 모두 삭제할까요?')) return;
    clearCreatorSessions();
    onClear();
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="session-insights" role="dialog" aria-modal="true" aria-label="제작 세션 기록">
        <header><div><strong>제작 세션 기록</strong><span>로컬 전용 · 원문 프롬프트와 파일명 미수집</span></div><button onClick={onClose}>닫기</button></header>
        <div className="session-summary-grid">
          <div><span>현재 단계</span><b>{({ started: '시작', 'scene-created': '장면 생성', 'first-edit-ready': '첫 수정 준비', 'first-edit-completed': '첫 수정 완료', exported: '출력 완료' } as const)[summary.milestone]}</b></div>
          <div><span>세션 길이</span><b>{duration(summary.durationMs)}</b></div>
          <div><span>첫 장면</span><b>{duration(summary.timeToSceneMs)}</b></div>
          <div><span>첫 수정 준비</span><b>{duration(summary.timeToFirstEditReadyMs)}</b></div>
          <div><span>첫 실제 수정</span><b>{duration(summary.timeToFirstEditMs)}</b></div>
          <div><span>첫 출력</span><b>{duration(summary.timeToFirstExportMs)}</b></div>
          <div><span>명령·단축키</span><b>{summary.commandExecutions} · {summary.shortcutExecutions}</b></div>
        </div>
        <div className="session-event-list">
          {[...session.events].reverse().slice(0, 40).map((event) => (
            <div key={event.id}><time>{duration(event.elapsedMs)}</time><strong>{event.type}</strong><small>{Object.entries(event.metadata).map(([key, value]) => `${key}: ${value}`).join(' · ') || '메타데이터 없음'}</small></div>
          ))}
          {session.events.length === 0 && <p>아직 기록된 제작 이벤트가 없습니다.</p>}
        </div>
        <footer><button onClick={download}>익명 기록 JSON</button><button className="danger" onClick={clear}>기록 삭제</button></footer>
      </section>
    </div>
  );
}
