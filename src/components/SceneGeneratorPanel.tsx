import { useMemo, useState } from 'react';
import { analyzeScenePrompt, type SceneGenerationPlan } from '../domain/sceneGenerator';

const EXAMPLE_PROMPT = `비 오는 밤의 편의점 앞이다. 검은 코트를 입은 여성과 교복을 입은 남학생이 마주 보고 있다. 여성은 우산을 들고 있고 남학생은 자전거 옆에 서 있다. 처음에는 두 사람이 함께 보이는 와이드 샷, 다음은 여성의 얼굴 클로즈업, 마지막에는 남학생이 자전거를 타고 떠나는 트래킹 샷으로 만들어줘.`;

interface SceneGeneratorPanelProps {
  open: boolean;
  onClose(): void;
  onApply(prompt: string): void;
}

function PlanPreview({ plan }: { plan: SceneGenerationPlan }) {
  return (
    <div className="scene-plan">
      <div className="scene-plan-summary">
        <div><span>장소</span><strong>{plan.location}</strong></div>
        <div><span>인물</span><strong>{plan.characters.length}명</strong></div>
        <div><span>소품</span><strong>{plan.props.reduce((sum, prop) => sum + prop.count, 0)}개</strong></div>
        <div><span>샷</span><strong>{plan.shots.length}개</strong></div>
      </div>

      <section>
        <h3>등장인물</h3>
        <div className="plan-chip-list">
          {plan.characters.map((character, index) => <span key={`${character.name}-${index}`} className="plan-chip character">{character.name}</span>)}
        </div>
      </section>

      <section>
        <h3>소품·환경</h3>
        <div className="plan-chip-list">
          <span className="plan-chip environment">{plan.location}</span>
          {plan.atmosphere.map((item) => <span key={item} className="plan-chip atmosphere">{item}</span>)}
          {plan.props.map((prop) => <span key={prop.name} className="plan-chip prop">{prop.name}{prop.count > 1 ? ` ×${prop.count}` : ''}</span>)}
        </div>
      </section>

      <section>
        <h3>자동 샷 구성</h3>
        <div className="generated-shot-list">
          {plan.shots.map((shot, index) => (
            <article key={`${shot.name}-${index}`}>
              <div><strong>{shot.name}</strong><span>{shot.duration}초</span></div>
              <p>{shot.description}</p>
            </article>
          ))}
        </div>
      </section>

      {plan.detectedRelations.length > 0 && (
        <section>
          <h3>감지된 연출</h3>
          <ul className="plan-list">{plan.detectedRelations.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
      )}

      {plan.warnings.length > 0 && (
        <section className="plan-warnings">
          <h3>확인 사항</h3>
          <ul>{plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </section>
      )}
    </div>
  );
}

export function SceneGeneratorPanel({ open, onClose, onApply }: SceneGeneratorPanelProps) {
  const [prompt, setPrompt] = useState(EXAMPLE_PROMPT);
  const [analyzedPrompt, setAnalyzedPrompt] = useState(EXAMPLE_PROMPT);
  const plan = useMemo(() => analyzeScenePrompt(analyzedPrompt), [analyzedPrompt]);
  if (!open) return null;

  const analyze = () => {
    const trimmed = prompt.trim();
    if (trimmed) setAnalyzedPrompt(trimmed);
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="scene-generator-panel" role="dialog" aria-modal="true" aria-label="자연어 씬 생성">
        <header>
          <div>
            <span className="eyebrow">LOCAL SCENE COMPILER</span>
            <h2>자연어로 전체 씬 만들기</h2>
            <p>외부 AI API 없이 문장을 분석해 인물·소품·관계·카메라·샷을 편집 가능한 3D 데이터로 구성합니다.</p>
          </div>
          <button className="close-button" onClick={onClose}>×</button>
        </header>

        <div className="scene-generator-content">
          <div className="scene-prompt-column">
            <label>
              장면 설명
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={12} />
            </label>
            <div className="prompt-hints">
              <span>인물</span><span>소품</span><span>장소·날씨</span><span>샷 순서</span><span>행동</span>
            </div>
            <button className="analyze-button" onClick={analyze}>장면 해석 갱신</button>
            <p className="replacement-warning">적용하면 현재 씬이 새 구성으로 교체됩니다. 한 번의 Transaction으로 기록되어 실행 취소할 수 있습니다.</p>
          </div>
          <div className="scene-preview-column">
            <PlanPreview plan={plan} />
          </div>
        </div>

        <footer>
          <button onClick={onClose}>취소</button>
          <button className="primary" disabled={!prompt.trim()} onClick={() => { onApply(prompt.trim()); onClose(); }}>현재 씬에 적용</button>
        </footer>
      </aside>
    </div>
  );
}
