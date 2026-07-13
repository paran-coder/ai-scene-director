import { Component, type ErrorInfo, type ReactNode } from 'react';
import { saveRecoverySnapshot } from '../domain/recovery';
import { useEditorStore } from '../store/editorStore';

interface Props { children: ReactNode }
interface State { error: Error | null }

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    const state = useEditorStore.getState();
    saveRecoverySnapshot(state.project, state.activeShotId, 'error');
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="fatal-error">
        <h1>편집 화면을 복구할 수 없습니다.</h1>
        <p>오류 직전 프로젝트를 복구 스냅샷으로 저장했습니다.</p>
        <pre>{this.state.error.message}</pre>
        <button onClick={() => window.location.reload()}>앱 다시 열기</button>
      </main>
    );
  }
}
