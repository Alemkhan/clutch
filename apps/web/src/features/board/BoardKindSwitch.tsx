import { useMessages } from '../../i18n/messages';
import { m } from './messages';
export type BoardKind = 'daily' | 'duels' | 'wikiPath';
export function BoardKindSwitch({ kind, onKind }: { kind: BoardKind; onKind: (kind: BoardKind) => void }) {
  const t = useMessages(m);
  const items: ReadonlyArray<[BoardKind, string]> = [['daily', t.kindDaily], ['duels', t.kindDuels], ['wikiPath', t.kindWikiPath]];
  return (
    <div className="board-kind" role="tablist" aria-label={t.kindLabel}>
      {items.map(([id, label]) => (
        <button key={id} type="button" role="tab" aria-selected={id === kind} className={id === kind ? 'board-kind-btn active' : 'board-kind-btn'} onClick={() => { if (id !== kind) onKind(id); }}>
          {label}
        </button>
      ))}
    </div>
  );
}
