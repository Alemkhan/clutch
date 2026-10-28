export type BoardKind = 'daily' | 'duels' | 'wikiPath';
export function BoardKindSwitch({ kind, onKind }: { kind: BoardKind; onKind: (kind: BoardKind) => void }) {
  const items: ReadonlyArray<[BoardKind, string]> = [['daily', 'Забег дня'], ['duels', 'Дуэли'], ['wikiPath', 'Вики-путь']];
  return (
    <div className="board-kind" role="tablist" aria-label="Таблица">
      {items.map(([id, label]) => (
        <button key={id} type="button" role="tab" aria-selected={id === kind} className={id === kind ? 'board-kind-btn active' : 'board-kind-btn'} onClick={() => { if (id !== kind) onKind(id); }}>
          {label}
        </button>
      ))}
    </div>
  );
}
