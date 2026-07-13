import type { ShotExportPreflight } from '../domain/shotExportPreflight';

export function ShotExportReview({
  open,
  shotName,
  preflight,
  isExporting,
  onClose,
  onConfirm,
  onQuickFix,
}: {
  open: boolean;
  shotName: string;
  preflight: ShotExportPreflight;
  isExporting: boolean;
  onClose(): void;
  onConfirm(): void;
  onQuickFix(): void;
}) {
  if (!open) return null;
  return (
    <div className="modal-backdrop shot-export-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="shot-export-review" role="dialog" aria-modal="true" aria-label="샷 패키지 출력 확인">
        <header className="modal-header">
          <div>
            <span className={`export-preflight-badge ${preflight.status}`}>{preflight.title}</span>
            <strong>{shotName} Shot Package</strong>
            <small>{preflight.summary}</small>
          </div>
          <button onClick={onClose} aria-label="출력 확인 닫기">닫기</button>
        </header>

        <div className="shot-export-content">
          <div className="export-summary-grid">
            <div><span>카메라</span><b>{preflight.cameraName}</b></div>
            <div><span>길이</span><b>{preflight.duration.toFixed(1)}초</b></div>
            <div><span>렌더</span><b>{preflight.renderCount}장</b></div>
            <div><span>객체</span><b>{preflight.entityCount}개</b></div>
          </div>

          {(preflight.issues.length > 0 || preflight.advisories.length > 0) && (
            <section className="export-review-notices">
              {preflight.issues.map((issue) => <p className="blocked" key={issue}>수정 필요 · {issue}</p>)}
              {preflight.advisories.map((advisory) => <p className="warning" key={advisory}>확인 · {advisory}</p>)}
            </section>
          )}

          <section className="export-file-plan">
            <h3>생성되는 파일</h3>
            <div>
              {preflight.groups.map((group) => (
                <article key={group.label}>
                  <strong>{group.label}</strong>
                  <ul>{group.files.map((file) => <li key={file}>{file}</li>)}</ul>
                </article>
              ))}
            </div>
          </section>

          <p className="export-local-note">모든 렌더와 ZIP 생성은 현재 브라우저에서 로컬로 처리됩니다.</p>
        </div>

        <footer>
          <button onClick={onClose}>취소</button>
          {!preflight.canExport && <button className="export-fix-button" onClick={onQuickFix}>문제 수정으로 이동</button>}
          {preflight.canExport && <button className="export-confirm-button" disabled={isExporting} onClick={onConfirm}>{isExporting ? '생성 중…' : 'Shot Package 생성'}</button>}
        </footer>
      </section>
    </div>
  );
}
