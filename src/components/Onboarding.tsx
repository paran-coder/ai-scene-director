import { useState } from 'react';

const STORAGE_KEY = 'ai-scene-director-onboarding-ai-export-v2';

const STEPS = [
  {
    title: '1. 장면 만들기',
    body: '상단의 ‘1 장면 만들기’를 누르고 장소, 인물, 소품과 원하는 구도를 자연어로 입력합니다.',
    checklist: ['예: 비 오는 밤 편의점 앞에서 두 사람이 마주 본다', '와이드·클로즈업처럼 원하는 샷을 함께 입력', '분석 결과를 확인하고 장면 적용'],
  },
  {
    title: '2. 장면 수정하기',
    body: '‘2 장면 수정하기’를 누르면 핵심 인물이나 제품이 선택됩니다. 뷰포트에서 위치·방향·포즈와 카메라를 원하는 대로 조절하세요.',
    checklist: ['왼쪽 드래그: 시점 회전 · 오른쪽 드래그: 화면 이동', 'W: 이동 · E: 회전 · R: 크기', 'P: 인물 포즈와 IK · 화면이 돌아가면 정면 맞춤'],
  },
  {
    title: '동작 미리보기는 선택 사항',
    body: '걷기나 카메라 이동이 있을 때만 ‘동작 미리보기’로 생성 전 움직임을 검수합니다. 이 재생 화면은 완성 영상이 아닙니다.',
    checklist: ['타임라인 블록을 드래그해 시작 시간 변경', '블록 가장자리로 행동 길이 조절', '정적인 이미지 장면은 미리보기를 건너뛰어도 됨'],
  },
  {
    title: '3. AI용 내보내기',
    body: '‘3 AI용 내보내기’에서 이미지 생성용, 영상 생성용 또는 간단 내보내기를 선택합니다.',
    checklist: ['이미지용: 기준 이미지 + Pose·Depth·Mask + 프롬프트', '영상용: 시작·종료 프레임 + 동작·카메라 프롬프트', '간단 내보내기: 프롬프트 복사 또는 필요한 이미지만 다운로드'],
  },
  {
    title: '고급 기능은 필요할 때만',
    body: 'ComfyUI, 프로젝트 점검, JSON, 세션 기록과 저장소 정리는 ‘고급 도구’ 안에 있습니다. 일반 제작 흐름에서는 열지 않아도 됩니다.',
    checklist: ['프로젝트 메뉴: 작업 저장·백업', '고급 도구: 외부 연결·진단·개발자용 데이터', 'Ctrl/Cmd+K: 모든 명령 검색'],
  },
];

export function shouldShowOnboarding(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) !== 'done'; } catch { return true; }
}

export function Onboarding({ open, onClose, onOpenSceneGenerator, onOpenExportGuide }: { open: boolean; onClose(): void; onOpenSceneGenerator(): void; onOpenExportGuide(): void }) {
  const [step, setStep] = useState(0);
  if (!open) return null;
  const finish = () => {
    try { localStorage.setItem(STORAGE_KEY, 'done'); } catch { /* private mode */ }
    setStep(0);
    onClose();
  };
  const current = STEPS[step];
  return (
    <div className="onboarding-backdrop" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <section className="onboarding-card">
        <div className="onboarding-progress" aria-label={`${step + 1}/${STEPS.length}`}>
          {STEPS.map((_, index) => <i key={index} className={index <= step ? 'active' : ''} />)}
        </div>
        <span className="eyebrow">AI Scene Director 1.0 RC11 · 3단계 사용법 · {step + 1}/{STEPS.length}</span>
        <h2 id="onboarding-title">{current.title}</h2>
        <p>{current.body}</p>
        <ul className="onboarding-checklist">
          {current.checklist.map((item) => <li key={item}>{item}</li>)}
        </ul>
        {step === 3 && <button className="onboarding-export-guide" onClick={onOpenExportGuide}>내보낸 자료 사용법 자세히 보기</button>}
        <div className="onboarding-actions">
          <button onClick={finish}>닫기</button>
          {step > 0 && <button onClick={() => setStep((value) => value - 1)}>이전</button>}
          {step < STEPS.length - 1
            ? <button className="primary" onClick={() => setStep((value) => value + 1)}>다음</button>
            : <button className="primary" onClick={() => { finish(); onOpenSceneGenerator(); }}>AI 씬 생성으로 시작</button>}
        </div>
      </section>
    </div>
  );
}
