import { useState } from 'react';

const STORAGE_KEY = 'ai-scene-director-onboarding-front-view-v1';

const STEPS = [
  {
    title: '1. 화면 방향부터 맞추기',
    body: '처음 열면 자유 시점이 장면의 정면에서 시작합니다. 화면이 돌아갔다면 뷰포트 위의 ‘정면 맞춤’을 누르세요.',
    checklist: ['왼쪽 드래그: 시점 회전', '오른쪽 드래그: 화면 이동', '마우스 휠: 확대·축소'],
  },
  {
    title: '2. 자연어로 장면 초안 만들기',
    body: '상단의 ‘AI 씬 생성’을 누르고 장소, 인물, 소품, 원하는 샷 순서를 문장으로 입력합니다.',
    checklist: ['예: 카페에서 두 사람이 마주 앉아 대화한다', '와이드 → 오버숄더 → 클로즈업처럼 샷 순서 입력', '분석 결과를 확인한 뒤 장면 적용'],
  },
  {
    title: '3. 인물과 소품 직접 수정하기',
    body: '왼쪽 씬 계층에서 객체를 선택한 뒤 뷰포트의 이동·회전·크기 버튼으로 위치와 방향을 수정합니다.',
    checklist: ['W: 이동', 'E: 회전', 'R: 크기', 'P: 캐릭터 포즈·IK'],
  },
  {
    title: '4. 샷과 카메라 구성하기',
    body: '화면 아래 Shot 카드를 선택해 샷별 카메라와 구도를 편집합니다. ‘샷 카메라’를 누르면 실제 출력 구도를 확인할 수 있습니다.',
    checklist: ['+ 새 샷: 다른 구도 추가', '샷 카메라: 실제 렌즈 화면 확인', '오른쪽 속성: FOV·화면비·조명 수정'],
  },
  {
    title: '5. 타임라인에 행동 넣기',
    body: '걷기, 집기, 뒤돌기, 카메라 이동을 선택하고 ‘현재 시간에 추가’를 누릅니다. 생성된 블록은 드래그해 시간을 조절합니다.',
    checklist: ['재생으로 결과 확인', '블록 가장자리 드래그: 길이 조절', '0초에서 기본 위치와 포즈 수정'],
  },
  {
    title: '6. 점검하고 출력하기',
    body: '‘프로젝트 점검’으로 카메라·관계·행동 오류를 확인한 뒤 ‘Shot Package’로 프레임, Pose, Depth, Mask와 프롬프트를 출력합니다.',
    checklist: ['Ctrl/Cmd+K: 모든 기능 검색', 'Ctrl/Cmd+S: 프로젝트 저장', '도움이 필요하면 상단 ‘사용법’을 다시 열기'],
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
  const current = STEPS[step];
  return (
    <div className="onboarding-backdrop" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <section className="onboarding-card">
        <div className="onboarding-progress" aria-label={`${step + 1}/${STEPS.length}`}>
          {STEPS.map((_, index) => <i key={index} className={index <= step ? 'active' : ''} />)}
        </div>
        <span className="eyebrow">AI Scene Director 1.0 RC10 · 빠른 사용법 · {step + 1}/{STEPS.length}</span>
        <h2 id="onboarding-title">{current.title}</h2>
        <p>{current.body}</p>
        <ul className="onboarding-checklist">
          {current.checklist.map((item) => <li key={item}>{item}</li>)}
        </ul>
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
