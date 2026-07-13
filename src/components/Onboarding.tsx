import { useState } from 'react';

const STORAGE_KEY = 'ai-scene-director-onboarding-1.0-rc6';

const STEPS = [
  {
    title: '1. 자연어로 초안 만들기',
    body: '상단의 AI 씬 생성에서 장소, 인물, 소품과 원하는 샷 순서를 한 문장으로 입력합니다.',
  },
  {
    title: '2. 씬과 포즈 직접 수정하기',
    body: '왼쪽 씬 계층에서 객체를 선택하고 뷰포트의 이동·회전·포즈 핸들로 결과를 다듬습니다.',
  },
  {
    title: '3. 타임라인에서 행동 배치하기',
    body: '걷기, 집기, 카메라 이동 블록을 드래그하고 여러 블록을 선택해 함께 이동하거나 삭제합니다.',
  },
  {
    title: '4. 명령 검색으로 빠르게 이동하기',
    body: 'Ctrl/Cmd+K를 누르면 장면 생성, 카메라, 타임라인, 저장과 출력 명령을 검색할 수 있습니다. W·E·R·P는 이동·회전·크기·포즈 도구입니다.',
  },
  {
    title: '5. 저장하고 생성 도구로 넘기기',
    body: '프로젝트 번들에는 GLB와 참조 이미지가 포함됩니다. Shot Package는 프레임, Pose, Depth, Mask와 프롬프트를 내보냅니다.',
  },
];

export function shouldShowOnboarding(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) !== 'done'; } catch { return true; }
}

export function Onboarding({ open, onClose, onOpenSceneGenerator }: { open: boolean; onClose(): void; onOpenSceneGenerator(): void }) {
  const [step, setStep] = useState(0);
  if (!open) return null;
  const finish = () => {
    try { localStorage.setItem(STORAGE_KEY, 'done'); } catch { /* private mode */ }
    setStep(0);
    onClose();
  };
  return (
    <div className="onboarding-backdrop" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <section className="onboarding-card">
        <div className="onboarding-progress" aria-label={`${step + 1}/${STEPS.length}`}>
          {STEPS.map((_, index) => <i key={index} className={index <= step ? 'active' : ''} />)}
        </div>
        <span className="eyebrow">AI Scene Director 1.0 RC9</span>
        <h2 id="onboarding-title">{STEPS[step].title}</h2>
        <p>{STEPS[step].body}</p>
        <div className="onboarding-actions">
          <button onClick={finish}>건너뛰기</button>
          {step > 0 && <button onClick={() => setStep((value) => value - 1)}>이전</button>}
          {step < STEPS.length - 1
            ? <button className="primary" onClick={() => setStep((value) => value + 1)}>다음</button>
            : <button className="primary" onClick={() => { finish(); onOpenSceneGenerator(); }}>첫 씬 만들기</button>}
        </div>
      </section>
    </div>
  );
}
