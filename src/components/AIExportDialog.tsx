import { useEffect, useState } from 'react';
import type { ShotExportPreflight } from '../domain/shotExportPreflight';

export type AIExportMode = 'image' | 'video' | 'simple';

const MODE_COPY: Record<AIExportMode, { title: string; description: string; badge: string }> = {
  image: {
    title: '이미지 생성용',
    description: '기준 프레임과 Pose·Depth·Mask, 최종 프롬프트를 묶습니다.',
    badge: '스틸 이미지',
  },
  video: {
    title: '영상 생성용',
    description: '시작·종료 프레임과 동작·카메라 정보를 함께 묶습니다.',
    badge: '이미지→영상',
  },
  simple: {
    title: '간단 내보내기',
    description: '필요한 프롬프트나 기준 이미지만 빠르게 복사·저장합니다.',
    badge: '빠른 사용',
  },
};

export function AIExportDialog({
  open,
  shotName,
  preflight,
  isExporting,
  scenePrompt,
  motionPrompt,
  cameraPrompt,
  onClose,
  onExport,
  onQuickFix,
  onCopyPrompt,
  onDownloadReference,
  onDownloadStartEnd,
  onOpenGuide,
  initialMode = 'image',
}: {
  open: boolean;
  shotName: string;
  preflight: ShotExportPreflight;
  isExporting: boolean;
  scenePrompt: string;
  motionPrompt: string;
  cameraPrompt: string;
  onClose(): void;
  onExport(mode: 'image' | 'video'): void;
  onQuickFix(): void;
  onCopyPrompt(mode: 'image' | 'video'): void;
  onDownloadReference(): void;
  onDownloadStartEnd(): void;
  onOpenGuide(): void;
  initialMode?: AIExportMode;
}) {
  const [mode, setMode] = useState<AIExportMode>(initialMode);
  useEffect(() => { if (open) setMode(initialMode); }, [open, initialMode]);
  if (!open) return null;

  const previewPrompt = mode === 'video'
    ? `${scenePrompt}\n\n[동작]\n${motionPrompt}\n\n[카메라]\n${cameraPrompt}`
    : `${scenePrompt}\n\n[카메라]\n${cameraPrompt}`;
  const renderCount = mode === 'image' ? 4 : mode === 'video' ? 8 : 1;

  return (
    <div className="modal-backdrop ai-export-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="ai-export-dialog" role="dialog" aria-modal="true" aria-label="AI용 내보내기">
        <header className="modal-header ai-export-header">
          <div>
            <span className={`export-preflight-badge ${preflight.status}`}>{preflight.title}</span>
            <strong>AI용 내보내기</strong>
            <small>{shotName}의 장면 정보를 생성 AI가 이해하기 쉬운 자료로 변환합니다.</small>
          </div>
          <div className="ai-export-header-actions">
            <button className="ai-export-guide-link" onClick={onOpenGuide}>내보낸 자료 사용법</button>
            <button className="ai-export-close" onClick={onClose} aria-label="AI용 내보내기 닫기" title="닫기">×</button>
          </div>
        </header>

        <div className="ai-export-content">
          <section className="ai-export-mode-grid" aria-label="내보내기 목적 선택">
            {(Object.keys(MODE_COPY) as AIExportMode[]).map((item) => (
              <button key={item} className={mode === item ? 'active' : ''} onClick={() => setMode(item)}>
                <span>{MODE_COPY[item].badge}</span>
                <strong>{MODE_COPY[item].title}</strong>
                <small>{MODE_COPY[item].description}</small>
              </button>
            ))}
          </section>

          <div className="ai-export-summary-grid">
            <div><span>현재 샷</span><b>{shotName}</b></div>
            <div><span>카메라</span><b>{preflight.cameraName}</b></div>
            <div><span>길이</span><b>{preflight.duration.toFixed(1)}초</b></div>
            <div><span>생성 이미지</span><b>{renderCount}장</b></div>
          </div>

          {(preflight.issues.length > 0 || preflight.advisories.length > 0) && (
            <section className="export-review-notices">
              {preflight.issues.map((issue) => <p className="blocked" key={issue}>수정 필요 · {issue}</p>)}
              {preflight.advisories.map((advisory) => <p className="warning" key={advisory}>확인 · {advisory}</p>)}
            </section>
          )}

          {mode !== 'simple' ? (
            <div className="ai-export-plan">
              <section>
                <h3>{mode === 'image' ? '이미지 AI에 전달할 자료' : '영상 AI에 전달할 자료'}</h3>
                <ul>
                  {mode === 'image' ? <>
                    <li>기준 이미지 1장</li>
                    <li>Pose·Depth·객체 마스크</li>
                    <li>장면·카메라·네거티브 프롬프트</li>
                    <li>Shot Manifest JSON</li>
                  </> : <>
                    <li>시작·종료 프레임</li>
                    <li>시작·종료 Pose·Depth·객체 마스크</li>
                    <li>장면·동작·카메라·네거티브 프롬프트</li>
                    <li>샷 길이와 구조가 포함된 Manifest</li>
                  </>}
                </ul>
              </section>
              <section className="ai-prompt-preview">
                <div><h3>AI에 전달할 프롬프트</h3><button onClick={() => onCopyPrompt(mode)}>프롬프트 복사</button></div>
                <textarea readOnly value={previewPrompt} aria-label="AI 프롬프트 미리보기" />
              </section>
            </div>
          ) : (
            <section className="simple-export-actions">
              <button onClick={() => onCopyPrompt('image')}><b>프롬프트 복사</b><span>장면과 카메라 설명을 클립보드에 복사</span></button>
              <button disabled={!preflight.canExport || isExporting} onClick={onDownloadReference}><b>기준 이미지 다운로드</b><span>현재 샷의 시작 프레임 PNG</span></button>
              <button disabled={!preflight.canExport || isExporting} onClick={onDownloadStartEnd}><b>시작·종료 이미지</b><span>영상 AI에 사용할 두 프레임 ZIP</span></button>
              <button disabled={!preflight.canExport || isExporting} onClick={() => onExport('video')}><b>전체 자료 ZIP</b><span>프레임·제어 이미지·프롬프트·Manifest</span></button>
            </section>
          )}

          <p className="export-local-note">외부 서버로 업로드하지 않고 현재 브라우저에서 렌더·압축합니다.</p>
        </div>

        {mode !== 'simple' && (
          <footer>
            {!preflight.canExport && <button className="export-fix-button" onClick={onQuickFix}>문제 수정으로 이동</button>}
            {preflight.canExport && (
              <button className="export-confirm-button" disabled={isExporting} onClick={() => onExport(mode)}>
                {isExporting ? '생성 중…' : mode === 'image' ? '이미지 AI 자료 ZIP' : '영상 AI 자료 ZIP'}
              </button>
            )}
          </footer>
        )}
      </section>
    </div>
  );
}
