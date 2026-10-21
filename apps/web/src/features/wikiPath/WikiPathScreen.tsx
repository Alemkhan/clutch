import { useEffect, useMemo, useState } from 'react';
import type { StartWikiPathResponse, WikiPathBoardResponse, WikiPathPage, WikiPathRunSummary, WikiPathTodayResponse } from '@clutch/shared';
import { clickWikiPath, fetchWikiPathBoard, startWikiPath } from '../../platform/api';
import { ScreenHeader } from '../../ui/ScreenHeader';
import { approvedWikiLink, sanitizeWikiArticle, wikiLinkFromAnchor } from './wikiArticle';
import type { WikiPathTodayState } from './useWikiPathToday';

type ScreenState =
  | { status: 'idle' }
  | { status: 'loading'; label: string }
  | { status: 'error'; title: string; retry: () => void }
  | { status: 'active'; challenge: NonNullable<WikiPathTodayResponse['challenge']>; run: WikiPathRunSummary; page: WikiPathPage }
  | { status: 'completed'; challenge: NonNullable<WikiPathTodayResponse['challenge']>; run: WikiPathRunSummary; board: WikiPathBoardResponse | null };

export interface WikiPathScreenProps {
  today: WikiPathTodayState;
  onRetryToday: () => void;
  onBack: () => void;
}

export async function followApprovedWikiLink(
  title: string,
  allowedTitles: ReadonlyMap<string, string>,
  navigate: (approvedTitle: string) => Promise<unknown>,
): Promise<boolean> {
  const approved = approvedWikiLink(title, allowedTitles);
  if (!approved) return false;
  await navigate(approved);
  return true;
}

function Completion({ run, board }: { run: WikiPathRunSummary; board: WikiPathBoardResponse | null }) {
  return <section className="wp-completion" aria-live="polite">
    <span className="wp-completion-check" aria-hidden="true">✓</span>
    <p className="wp-eyebrow">Маршрут завершён</p>
    <h2>Цель достигнута</h2>
    <p>Ты дошёл за <strong>{run.clicks}</strong> {run.clicks === 1 ? 'переход' : run.clicks >= 2 && run.clicks <= 4 ? 'перехода' : 'переходов'}.</p>
    {board && <section className="wp-board" aria-label="Таблица Вики-пути">
      <h3>Результаты дня</h3>
      {board.ownRank !== null && <p className="wp-own-rank">Твоё место: {board.ownRank}</p>}
      {board.entries.length === 0 ? <p>Пока нет завершённых маршрутов.</p> : <ol>
        {board.entries.map((entry) => <li key={entry.playerId}>
          <span className="wp-board-rank">{entry.rank}.</span><span className="wp-board-name">{entry.displayName}</span><span>{entry.clicks} {entry.clicks === 1 ? 'переход' : entry.clicks >= 2 && entry.clicks <= 4 ? 'перехода' : 'переходов'}</span>
        </li>)}
      </ol>}
    </section>}
    {!board && <p className="wp-board-error">Таблица доступна в Telegram. Если ты уже там — попробуй открыть результаты позже.</p>}
  </section>;
}

export function WikiPathScreen({ today, onRetryToday, onBack }: WikiPathScreenProps) {
  const [screen, setScreen] = useState<ScreenState>({ status: 'idle' });
  const [pendingTitle, setPendingTitle] = useState<string | null>(null);
  const [navigationMessage, setNavigationMessage] = useState('Нажимай только на разрешённые ссылки в статье.');

  useEffect(() => {
    if (today.status !== 'completed' || !today.today.challenge || !today.today.run) return;
    let cancelled = false;
    const run = today.today.run;
    setScreen({ status: 'loading', label: 'Загружаю результаты…' });
    fetchWikiPathBoard().then((board) => {
      if (!cancelled) setScreen({ status: 'completed', challenge: today.today.challenge!, run, board });
    }).catch(() => {
      if (!cancelled) setScreen({ status: 'completed', challenge: today.today.challenge!, run, board: null });
    });
    return () => { cancelled = true; };
  }, [today]);

  const runAction = async (action: () => Promise<StartWikiPathResponse>, label: string) => {
    setScreen({ status: 'loading', label });
    try {
      const result = await action();
      if (result.run.status === 'completed') {
        let board: WikiPathBoardResponse | null = null;
        try { board = await fetchWikiPathBoard(); } catch { /* Completion summary remains useful without the board. */ }
        setScreen({ status: 'completed', challenge: result.challenge, run: result.run, board });
      } else setScreen({ status: 'active', challenge: result.challenge, run: result.run, page: result.currentPage });
    } catch {
      setScreen({ status: 'error', title: 'Не удалось загрузить статью.', retry: () => { void runAction(action, label); } });
    }
  };

  const run = screen.status === 'active' ? screen.run : null;
  const page = screen.status === 'active' ? screen.page : null;
  const sanitized = useMemo(() => {
    if (!page) return null;
    try { return sanitizeWikiArticle(page); } catch { return null; }
  }, [page]);

  const navigate = async (title: string) => {
    if (!run) return;
    setPendingTitle(title);
    setNavigationMessage(`Открываю «${title}»…`);
    try {
      const result = await clickWikiPath(run.runId, { title });
      if (result.run.status === 'completed') {
        let board: WikiPathBoardResponse | null = null;
        try { board = await fetchWikiPathBoard(); } catch { /* Keep the completion summary visible. */ }
        const activeChallenge = screen.status === 'active' ? screen.challenge : challenge;
        if (activeChallenge) setScreen({ status: 'completed', challenge: activeChallenge, run: result.run, board });
      } else {
        setScreen((current) => current.status === 'active' ? { ...current, run: result.run, page: result.currentPage } : current);
        setNavigationMessage('Нажимай только на разрешённые ссылки в статье.');
      }
      setPendingTitle(null);
    } catch {
      setPendingTitle(title);
      setNavigationMessage(`Не удалось открыть «${title}». Попробуй ещё раз.`);
    }
  };

  const handleArticleClick = (event: React.MouseEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest('a[data-wiki-title]');
    if (!anchor || !event.currentTarget.contains(anchor)) return;
    event.preventDefault();
    if (pendingTitle || screen.status !== 'active' || !sanitized) return;
    const title = wikiLinkFromAnchor(anchor);
    if (title) void followApprovedWikiLink(title, sanitized.allowedTitles, navigate);
  };

  const challenge = screen.status === 'active' || screen.status === 'completed'
    ? screen.challenge
    : today.status === 'available' || today.status === 'in_progress' || today.status === 'completed'
      ? today.today.challenge : null;
  const clicks = screen.status === 'active' || screen.status === 'completed' ? screen.run.clicks : 0;
  const path = screen.status === 'active' ? screen.run.path : [];

  return <section className="wp-screen">
    <ScreenHeader onBack={onBack} />
    <div className="wp-head">
      <h1 className="wp-title">Вики-путь</h1>
      <span className="wp-mode-label">Ежедневный режим</span>
    </div>
    {challenge && <section className="wp-mission" aria-label="Маршрут дня">
      <div className="wp-mission-point"><span>Старт</span><strong>{challenge.startTitle}</strong></div>
      <div className="wp-mission-score"><strong>{clicks}</strong><span>переходов</span></div>
      <div className="wp-mission-point wp-target"><span>Цель</span><strong>{challenge.targetTitle}</strong></div>
    </section>}
    {screen.status === 'active' && <nav className="wp-breadcrumbs" aria-label="Пройденный путь">
      <span>{challenge?.startTitle ?? 'Старт'}</span><span aria-hidden="true">→</span>
      {path.length > 2 && <><span>{path.length - 2} перехода</span><span aria-hidden="true">→</span></>}
      <strong>{page?.title}</strong>
    </nav>}
    {screen.status === 'idle' && (today.status === 'available' || today.status === 'in_progress') && <section className="wp-start">
      <p>{today.status === 'in_progress' ? `Ты уже прошёл ${today.today.run?.clicks ?? 0} переходов.` : 'Пройди от стартовой статьи до цели, переходя по ссылкам внутри статей.'}</p>
      <button type="button" className="wp-primary" onClick={() => { void runAction(startWikiPath, today.status === 'in_progress' ? 'Продолжаю маршрут…' : 'Загружаю стартовую статью…'); }}>
        {today.status === 'in_progress' ? 'Продолжить' : 'Начать маршрут'}
      </button>
    </section>}
    {screen.status === 'idle' && today.status === 'loading' && <p className="wp-status" aria-busy="true">Загружаю маршрут дня…</p>}
    {screen.status === 'idle' && today.status === 'error' && <section className="wp-error"><p>Не удалось загрузить маршрут дня.</p><button className="wp-secondary" onClick={onRetryToday}>Повторить</button></section>}
    {screen.status === 'idle' && today.status === 'absent' && <p className="wp-status">Сегодня маршрута нет.</p>}
    {screen.status === 'loading' && <p className="wp-status" aria-busy="true">{screen.label}</p>}
    {screen.status === 'error' && <section className="wp-error" role="alert"><p>{screen.title}</p><button type="button" className="wp-secondary" onClick={screen.retry}>Повторить</button></section>}
    {screen.status === 'active' && sanitized && <>
      <p className="wp-status" role="status">{pendingTitle ? navigationMessage : navigationMessage}</p>
      {pendingTitle && <button type="button" className="wp-secondary wp-retry-link" onClick={() => { void navigate(pendingTitle); }}>Повторить переход</button>}
      <article className="wp-article" aria-label={sanitized.title} onClick={handleArticleClick} aria-busy={!!pendingTitle}>
        <h2>{sanitized.title}</h2><div dangerouslySetInnerHTML={{ __html: sanitized.html }} />
      </article>
    </>}
    {screen.status === 'active' && !sanitized && <section className="wp-error" role="alert"><p>Не удалось безопасно подготовить статью.</p><button type="button" className="wp-secondary" onClick={() => { void runAction(startWikiPath, 'Повторно загружаю статью…'); }}>Повторить</button></section>}
    {screen.status === 'completed' && <Completion run={screen.run} board={screen.board} />}
  </section>;
}
