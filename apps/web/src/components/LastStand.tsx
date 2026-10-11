import { useEffect, useRef, useState } from 'react';
import { ScreenHeader } from './ScreenHeader';
import { TimerBar } from './TimerBar';
import { playSound } from '../lib/sounds';
import { useLastStand, type LeaderboardView } from '../lib/useLastStand';
import {
  LAST_STAND_SOURCE_LABELS,
  LAST_STAND_TOTAL_ROUNDS,
  buildRevealRows,
  eliminationText,
  formatAnswerTime,
  lastStandAbsoluteDeadline,
  rankLeaderboard,
  roundLabel,
  survivedText,
  type LastStandState,
  type RevealSnapshot,
} from '../lib/lastStandRun';

interface LastStandProps {
  onHome: () => void;
}

export function LastStand({ onHome }: LastStandProps) {
  const run = useLastStand();
  const { state, leaderboard } = run;

  if (leaderboard.status !== 'closed') {
    return <LastStandLeaderboard view={leaderboard} onRetry={run.openLeaderboard} onClose={run.closeLeaderboard} />;
  }

  switch (state.stage) {
    case 'intro':
      return (
        <LastStandIntro onStart={run.start} onLeaderboard={run.openLeaderboard} onBack={onHome} />
      );
    case 'loading':
      return <LastStandStatus title="Собираем забег" body="Подбираем соперников и первую категорию…" loading />;
    case 'error':
      return (
        <LastStandStatus
          title="Забег не начался"
          body={state.error ?? 'Не удалось начать забег.'}
          onRetry={run.start}
          onBack={onHome}
        />
      );
    case 'round':
      return (
        <LastStandRoundScreen
          key={`${state.runId}:${state.round?.index}`}
          state={state}
          submitting={run.submitting}
          onSubmit={run.submit}
        />
      );
    case 'reveal':
      return state.reveal
        ? (
          <LastStandReveal
            snapshot={state.reveal}
            survived={state.survived}
            finalRound={state.pendingRound === null}
            onContinue={run.continueFromReveal}
          />
        )
        : null;
    case 'final':
      return (
        <LastStandFinal
          state={state}
          onAgain={run.start}
          onLeaderboard={run.openLeaderboard}
          onHome={onHome}
        />
      );
  }
}

// ---------- intro / loading / error ----------

interface IntroProps {
  onStart: () => void;
  onLeaderboard: () => void;
  onBack: () => void;
}

export function LastStandIntro({ onStart, onLeaderboard, onBack }: IntroProps) {
  return (
    <section className="ls-screen">
      <ScreenHeader onBack={onBack} backAriaLabel="Назад на главный экран" title="Last Stand" />
      <p className="screen-subtitle">
        Объявляется категория стран. Назови любую страну из неё, но не ту, которую раньше тебя назвал соперник.
      </p>
      <ul className="ls-rules">
        <li>Переживи как можно больше кругов, максимум {LAST_STAND_TOTAL_ROUNDS}.</li>
        <li>Если страну уже заняли, назови другую, пока идёт время.</li>
        <li>Ответы соперников раскрываются после круга.</li>
      </ul>
      <button type="button" className="cta-btn" onClick={() => { onStart(); }}>
        Начать забег <span aria-hidden="true">→</span>
      </button>
      <button type="button" className="ghost-btn" onClick={() => { onLeaderboard(); }}>
        Таблица дня
      </button>
    </section>
  );
}

interface StatusProps {
  title: string;
  body: string;
  loading?: boolean;
  onRetry?: () => void;
  onBack?: () => void;
}

export function LastStandStatus({ title, body, loading, onRetry, onBack }: StatusProps) {
  return (
    <section className="ls-screen ls-center">
      <h2 className="screen-title">{title}</h2>
      <p
        className="screen-subtitle"
        role={loading ? 'status' : 'alert'}
      >
        {body}
      </p>
      {onRetry && (
        <button type="button" className="cta-btn" onClick={() => { onRetry(); }}>
          Повторить
        </button>
      )}
      {onBack && (
        <button type="button" className="ghost-btn" onClick={() => { onBack(); }}>
          На главный экран
        </button>
      )}
    </section>
  );
}

// ---------- round ----------

interface RoundProps {
  state: LastStandState;
  submitting: boolean;
  onSubmit: (answer: string) => void;
}

export function LastStandRoundScreen({ state, submitting, onSubmit }: RoundProps) {
  const round = state.round;
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef('');
  valueRef.current = value;

  // Occupied: the typed country is gone, start from an empty field. Invalid keeps the text.
  useEffect(() => {
    if (state.notice === 'occupied') {
      setValue('');
      inputRef.current?.focus({ preventScroll: true });
    }
  }, [state.noticeSeq, state.notice]);

  useEffect(() => {
    let frameId: number | null = null;
    const revealInput = () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        frameId = null;
        inputRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
    };
    inputRef.current?.focus({ preventScroll: true });
    revealInput();
    window.visualViewport?.addEventListener('resize', revealInput);
    return () => {
      window.visualViewport?.removeEventListener('resize', revealInput);
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, []);

  if (!round) return null;

  const deadlineAtMs = lastStandAbsoluteDeadline(state);
  const handleSubmit = () => {
    if (submitting) return;
    onSubmit(valueRef.current);
  };
  // At the deadline the field text (if any) goes out once; an empty field means "no answer".
  const handleExpire = () => onSubmit(valueRef.current);

  return (
    <section className="ls-screen ls-round">
      <div className="ls-round-meta">
        <span className="category-chip">{roundLabel(round.index)}</span>
        <TimerBar
          durationMs={state.deadlineMs}
          deadlineMs={deadlineAtMs}
          onExpire={handleExpire}
          paused={submitting}
        />
      </div>

      <h2 className="ls-category" id="ls-category-title">{round.titleRu}</h2>
      <p className="ls-hint">Назови страну из этой категории. Не совпади с тем, кто ответил раньше.</p>

      {state.notice === 'occupied' && (
        <div className="ls-notice ls-notice-occupied" role="alert">
          <strong>Занято!</strong> Соперник был быстрее. Называй другую страну.
        </div>
      )}
      {state.notice === 'invalid' && (
        <div className="ls-notice ls-notice-invalid" role="status">
          Не узнаю такую страну. Проверь написание, время идёт.
        </div>
      )}
      {state.sendError && (
        <div className="ls-notice ls-notice-error" role="alert">{state.sendError}</div>
      )}

      <div className="open-answer ls-answer">
        <input
          ref={inputRef}
          type="text"
          className="open-answer-input"
          aria-label={`Страна из категории: ${round.titleRu}`}
          value={value}
          readOnly={submitting}
          onChange={(event) => setValue(event.target.value)}
          onFocus={() => inputRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            handleSubmit();
          }}
          placeholder="Название страны…"
          enterKeyHint="send"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <button
          type="button"
          className="open-answer-submit"
          aria-label="Отправить ответ"
          onClick={handleSubmit}
          disabled={submitting}
        >
          {submitting ? 'Отправляем…' : state.sendError ? 'Повторить' : 'Отправить'}
        </button>
      </div>

      {state.opponents.length > 0 && (
        <ul className="ls-opponents" aria-label="Соперники">
          {state.opponents.map((o, i) => (
            <li key={`${i}:${o.displayName}`}>{o.displayName} <span className="ls-source">{LAST_STAND_SOURCE_LABELS[o.source]}</span></li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------- reveal ----------

interface RevealProps {
  snapshot: RevealSnapshot;
  survived: number;
  finalRound: boolean;
  onContinue: () => void;
}

export function LastStandReveal({ snapshot, survived, finalRound, onContinue }: RevealProps) {
  const rows = buildRevealRows(snapshot);
  return (
    <section className="ls-screen">
      <h2 className="screen-title">Ответы круга</h2>
      <ul className="ls-reveal" aria-label="Ответы участников по времени">
        {rows.map((row) => (
          <li key={row.key} className={`ls-reveal-row${row.isPlayer ? ' me' : ''}${row.fastest ? ' fastest' : ''}`}>
            <span className="ls-reveal-name">{row.displayName}{row.sourceLabel && <span className="ls-source"> {row.sourceLabel}</span>}</span>
            <span className="ls-reveal-answer">{row.answer}</span>
            <span className="ls-reveal-time">
              {formatAnswerTime(row.atMs)}
              {row.fastest && <span className="ls-reveal-flag"> · быстрее всех</span>}
            </span>
          </li>
        ))}
      </ul>
      {!snapshot.player && (
        <p className="ls-hint">Твоего ответа в этом круге нет.</p>
      )}
      <p className="ls-hint" role="status">Пережито: {survivedText(survived)}</p>
      <button type="button" className="cta-btn" onClick={() => { onContinue(); }}>
        {finalRound ? 'К итогу' : 'Следующий круг'} <span aria-hidden="true">→</span>
      </button>
    </section>
  );
}

// ---------- final ----------

interface FinalProps {
  state: Pick<LastStandState, 'survived' | 'outcome' | 'reason'>;
  onAgain: () => void;
  onLeaderboard: () => void;
  onHome: () => void;
}

export function LastStandFinal({ state, onAgain, onLeaderboard, onHome }: FinalProps) {
  const cleared = state.outcome === 'cleared';
  return (
    <section className="ls-screen ls-center">
      <span className="home-kicker">Last Stand</span>
      <h2 className="screen-title">{cleared ? 'Забег пройден!' : 'Ты выбыл'}</h2>
      <p className="ls-score" aria-label={`Пережито кругов: ${survivedText(state.survived)}`}>
        {survivedText(state.survived)}
      </p>
      <p className="screen-subtitle" role="status">
        {cleared ? 'Все круги пережиты, ты остался последним.' : eliminationText(state.reason)}
      </p>
      <button type="button" className="cta-btn" onClick={() => { onAgain(); }}>
        Ещё раз
      </button>
      <button type="button" className="ghost-btn" onClick={() => { onLeaderboard(); }}>
        Таблица дня
      </button>
      <button type="button" className="ghost-btn" onClick={() => { onHome(); }}>
        На главный экран
      </button>
    </section>
  );
}

// ---------- leaderboard ----------

interface LeaderboardProps {
  view: LeaderboardView;
  onRetry: () => void;
  onClose: () => void;
}

export function LastStandLeaderboard({ view, onRetry, onClose }: LeaderboardProps) {
  return (
    <section className="ls-screen">
      <ScreenHeader onBack={onClose} backAriaLabel="Закрыть таблицу дня" title="Таблица дня" titleAs="h2" />
      {view.status === 'ready' && <p className="ls-hint">{view.data.dateKey}</p>}
      {view.status === 'loading' && <p className="screen-subtitle" role="status">Загружаем таблицу…</p>}
      {view.status === 'error' && (
        <>
          <p className="screen-subtitle" role="alert">{view.error}</p>
          <button type="button" className="cta-btn" onClick={() => { onRetry(); }}>
            Повторить
          </button>
        </>
      )}
      {view.status === 'ready' && view.data.entries.length === 0 && (
        <p className="screen-subtitle">Сегодня ещё никто не закончил забег.</p>
      )}
      {view.status === 'ready' && view.data.entries.length > 0 && (
        <ol className="ls-board" aria-label="Лидерборд дня">
          {rankLeaderboard(view.data.entries).map((entry, i) => (
            <li key={`${i}:${entry.displayName}`} className="ls-board-row">
              <span className="ls-board-place">{entry.place}</span>
              <span className="ls-board-name">{entry.displayName}</span>
              <span className="ls-board-score">{entry.survived} из {LAST_STAND_TOTAL_ROUNDS}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
