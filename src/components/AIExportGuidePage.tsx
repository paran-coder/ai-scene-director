import { useEffect } from 'react';
import type { AIExportMode } from './AIExportDialog';

type GuideFileRow = {
  file: string;
  meaning: string;
  use: string;
};

const FILE_ROWS: GuideFileRow[] = [
  { file: 'reference.png', meaning: '전체 구도와 인물·소품 배치를 보여주는 기준 이미지', use: '일반 이미지 AI에서 거의 항상 사용' },
  { file: 'final_prompt.txt', meaning: '장면·인물·카메라 정보를 합친 최종 프롬프트', use: '이미지·영상 AI의 프롬프트 입력란' },
  { file: 'negative_prompt.txt', meaning: '원하지 않는 형태와 오류를 줄이는 문장', use: '네거티브 프롬프트를 지원할 때' },
  { file: 'pose.png', meaning: '인물의 자세를 고정하기 위한 포즈 가이드', use: 'Pose·OpenPose·ControlNet 입력' },
  { file: 'depth.png', meaning: '카메라에서 본 앞뒤 거리와 공간 구조', use: 'Depth 제어를 지원하는 워크플로' },
  { file: 'entity_mask.png', meaning: '인물과 소품의 영역을 구분하는 마스크', use: '인페인팅·영역별 수정·합성' },
  { file: 'start_frame.png', meaning: '영상이 시작되는 장면 이미지', use: '이미지 기반 영상 AI의 시작 이미지' },
  { file: 'end_frame.png', meaning: '영상이 도달해야 하는 종료 장면', use: '시작·종료 프레임을 함께 받는 영상 AI' },
  { file: 'motion_prompt.txt', meaning: '인물과 소품이 시간에 따라 움직이는 방식', use: '영상 AI의 동작 설명 입력란' },
  { file: 'camera_prompt.txt', meaning: '카메라 구도와 이동 방식', use: '카메라 움직임 또는 프롬프트 입력란' },
  { file: 'shot_manifest.json', meaning: '샷 길이·객체·관계·카메라 구조 데이터', use: 'ComfyUI·자동화·개발자 워크플로' },
];

export function AIExportGuidePage({
  open,
  canRender,
  onClose,
  onOpenExport,
  onCopyPrompt,
  onDownloadReference,
}: {
  open: boolean;
  canRender: boolean;
  onClose(): void;
  onOpenExport(mode: AIExportMode): void;
  onCopyPrompt(): void;
  onDownloadReference(): void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <section className="ai-export-guide-page" role="dialog" aria-modal="true" aria-labelledby="ai-export-guide-title">
      <header className="ai-export-guide-header">
        <div className="ai-export-guide-brand">
          <span className="brand-mark" aria-hidden="true">AS</span>
          <div>
            <strong>AI용 내보내기 사용법</strong>
            <span>장면을 이미지·영상 생성 AI에 적용하는 방법</span>
          </div>
        </div>
        <button className="ai-export-guide-close" onClick={onClose} aria-label="AI용 내보내기 사용법 닫기">편집기로 돌아가기</button>
      </header>

      <main className="ai-export-guide-main">
        <section className="ai-export-guide-hero">
          <div>
            <span className="guide-eyebrow">AI EXPORT GUIDE</span>
            <h1 id="ai-export-guide-title">내보낸 자료를 생성 AI에 적용하는 방법</h1>
            <p>내보낸 ZIP은 완성 결과물이 아니라, 장면의 구도·포즈·공간·움직임을 생성 AI가 이해하기 쉽게 정리한 입력 자료입니다.</p>
          </div>
          <div className="guide-hero-actions">
            <button className="guide-primary-action" onClick={() => onOpenExport('image')}>이미지 생성용 열기</button>
            <button onClick={() => onOpenExport('video')}>영상 생성용 열기</button>
          </div>
        </section>

        <section className="guide-section" aria-labelledby="guide-quick-title">
          <div className="guide-section-heading">
            <span>가장 쉬운 시작</span>
            <h2 id="guide-quick-title">기준 이미지와 최종 프롬프트만 사용해도 됩니다</h2>
            <p>대부분의 일반 이미지 생성 서비스에서는 아래 두 자료가 핵심입니다.</p>
          </div>
          <div className="guide-quick-layout">
            <ol className="guide-step-list">
              <li><b>간단 내보내기</b><span>AI용 내보내기에서 ‘간단 내보내기’를 선택합니다.</span></li>
              <li><b>기준 이미지 저장</b><span><code>reference.png</code>를 다운로드합니다.</span></li>
              <li><b>프롬프트 복사</b><span><code>final_prompt.txt</code> 내용을 복사합니다.</span></li>
              <li><b>생성 AI에 입력</b><span>기준 이미지를 업로드하고 프롬프트를 붙여넣습니다.</span></li>
              <li><b>생성 실행</b><span>결과를 확인한 뒤 필요한 부분만 다시 장면에서 수정합니다.</span></li>
            </ol>
            <div className="guide-quick-card">
              <span>일반 이미지 AI</span>
              <strong>reference.png</strong>
              <i>+</i>
              <strong>final_prompt.txt</strong>
              <div>
                <button onClick={onCopyPrompt}>현재 프롬프트 복사</button>
                <button disabled={!canRender} onClick={onDownloadReference}>기준 이미지 다운로드</button>
              </div>
            </div>
          </div>
        </section>

        <section className="guide-purpose-grid" aria-label="내보내기 유형별 사용법">
          <article>
            <span className="guide-card-badge">스틸 이미지</span>
            <h2>이미지 생성용</h2>
            <p>한 장의 구도와 인물 자세를 유지하면서 새로운 스타일과 디테일을 생성할 때 사용합니다.</p>
            <h3>보통 이렇게 사용합니다</h3>
            <ul>
              <li><code>reference.png</code>를 이미지 참조 또는 img2img에 입력</li>
              <li><code>final_prompt.txt</code>를 프롬프트에 붙여넣기</li>
              <li>지원되는 경우 Pose·Depth·Mask를 제어 입력으로 추가</li>
            </ul>
            <button onClick={() => onOpenExport('image')}>이미지 생성용 내보내기</button>
          </article>

          <article>
            <span className="guide-card-badge">이미지 → 영상</span>
            <h2>영상 생성용</h2>
            <p>시작 장면, 종료 장면, 인물 동작과 카메라 움직임을 영상 AI에 전달할 때 사용합니다.</p>
            <h3>보통 이렇게 사용합니다</h3>
            <ul>
              <li>시작 이미지만 받는 서비스에는 <code>start_frame.png</code></li>
              <li>시작·종료를 모두 받으면 두 프레임을 함께 입력</li>
              <li><code>motion_prompt.txt</code>와 <code>camera_prompt.txt</code>를 해당 입력란에 사용</li>
            </ul>
            <button onClick={() => onOpenExport('video')}>영상 생성용 내보내기</button>
          </article>

          <article>
            <span className="guide-card-badge">빠른 사용</span>
            <h2>간단 내보내기</h2>
            <p>제어 이미지나 JSON이 필요하지 않고, 프롬프트와 필요한 프레임만 빠르게 사용할 때 적합합니다.</p>
            <h3>제공되는 작업</h3>
            <ul>
              <li>최종 프롬프트 복사</li>
              <li>기준 이미지 한 장 다운로드</li>
              <li>시작·종료 프레임 ZIP</li>
              <li>필요하면 전체 AI 자료 ZIP</li>
            </ul>
            <button onClick={() => onOpenExport('simple')}>간단 내보내기 열기</button>
          </article>
        </section>

        <section className="guide-section guide-workflow-section">
          <div className="guide-section-heading">
            <span>고급 워크플로</span>
            <h2>Pose·Depth·Mask와 ComfyUI 연결</h2>
            <p>생성 도구가 제어 이미지를 지원한다면 장면의 공간적 일관성을 더 강하게 유지할 수 있습니다.</p>
          </div>
          <div className="guide-node-flow" aria-label="ComfyUI 연결 예시">
            <div><code>reference / start frame</code><span>Load Image</span></div>
            <b>→</b>
            <div><code>pose.png</code><span>Pose ControlNet</span></div>
            <b>→</b>
            <div><code>depth.png</code><span>Depth ControlNet</span></div>
            <b>→</b>
            <div><code>entity_mask.png</code><span>Mask / Inpainting</span></div>
          </div>
          <div className="guide-prompt-map">
            <div><span>Positive Prompt</span><code>final_prompt.txt</code></div>
            <div><span>Negative Prompt</span><code>negative_prompt.txt</code></div>
            <div><span>자동화 구조</span><code>shot_manifest.json</code></div>
          </div>
        </section>

        <section className="guide-section guide-file-section">
          <div className="guide-section-heading">
            <span>파일 사전</span>
            <h2>각 파일이 의미하는 것</h2>
            <p>모든 파일을 항상 사용할 필요는 없습니다. 사용하는 생성 도구가 지원하는 입력만 선택하면 됩니다.</p>
          </div>
          <div className="guide-file-table" role="table" aria-label="AI 내보내기 파일 설명">
            <div className="guide-file-row header" role="row">
              <span role="columnheader">파일</span><span role="columnheader">의미</span><span role="columnheader">언제 사용하는가</span>
            </div>
            {FILE_ROWS.map((row) => (
              <div className="guide-file-row" role="row" key={row.file}>
                <code role="cell">{row.file}</code><span role="cell">{row.meaning}</span><span role="cell">{row.use}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="guide-final-cta">
          <div>
            <span>장면이 준비됐나요?</span>
            <h2>목적에 맞는 자료를 바로 내보내세요</h2>
            <p>이미지는 기준 프레임과 프롬프트부터, 영상은 시작·종료 프레임과 동작 설명부터 사용하면 됩니다.</p>
          </div>
          <div>
            <button onClick={() => onOpenExport('simple')}>간단 내보내기</button>
            <button onClick={() => onOpenExport('image')}>이미지 생성용</button>
            <button className="guide-primary-action" onClick={() => onOpenExport('video')}>영상 생성용</button>
          </div>
        </section>
      </main>
    </section>
  );
}
