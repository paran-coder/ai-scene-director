import { useEffect, useMemo, useRef, useState } from 'react';
import { commandCategoryLabel, searchCommands, type AppCommand, type AppCommandId } from '../domain/commandPalette';

export function CommandPalette({ open, commands, onClose, onExecute }: {
  open: boolean;
  commands: AppCommand[];
  onClose(): void;
  onExecute(id: AppCommandId): void;
}) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchCommands(commands, query), [commands, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    window.setTimeout(() => inputRef.current?.focus(), 20);
  }, [open]);

  useEffect(() => setActiveIndex((index) => Math.min(index, Math.max(0, results.length - 1))), [results.length]);

  if (!open) return null;
  const execute = (command: AppCommand | undefined) => {
    if (!command) return;
    onExecute(command.id);
    onClose();
  };

  return (
    <div className="modal-backdrop command-palette-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="command-palette" role="dialog" aria-modal="true" aria-label="명령 검색">
        <div className="command-palette-search">
          <span>⌘K</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
            placeholder="작업 또는 기능 검색"
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose();
              if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((index) => Math.min(results.length - 1, index + 1)); }
              if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => Math.max(0, index - 1)); }
              if (event.key === 'Enter') { event.preventDefault(); execute(results[activeIndex]); }
            }}
          />
          <button onClick={onClose}>닫기</button>
        </div>
        <div className="command-palette-results">
          {results.length === 0 && <div className="command-empty">일치하는 명령이 없습니다.</div>}
          {results.map((command, index) => (
            <button
              key={command.id}
              className={index === activeIndex ? 'active' : ''}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => execute(command)}
            >
              <span className="command-category">{commandCategoryLabel(command.category)}</span>
              <strong>{command.label}</strong>
              <small>{command.description}</small>
              {command.shortcut && <kbd>{command.shortcut}</kbd>}
            </button>
          ))}
        </div>
        <footer>↑↓ 이동 · Enter 실행 · Esc 닫기 · 기록에는 프롬프트와 파일명이 저장되지 않습니다.</footer>
      </section>
    </div>
  );
}
