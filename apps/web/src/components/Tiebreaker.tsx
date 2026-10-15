import { useEffect, useRef, useState } from 'react';
import {
  isBestAnswerOfDay,
  TIEBREAKER_MIN_ANSWERS_FOR_PERCENTILE,
  type TiebreakerAnsweredView,
  type TiebreakerExplanation,
  type TiebreakerQuestionView,
} from '@clutch/shared';
import { answerTiebreaker, logAnalyticsEvent } from '../lib/api';
import {
  canShareViaTelegram,
  getTelegramIdentity,
  openExternalLink,
  shareViaTelegram,
} from '../lib/telegram';
import { formatCountdownClock } from '../lib/tiebreakerClock';
import { resolveGameLink, shareTiebreakerResult } from '../lib/tiebreakerShare';
import { useDayCountdown } from '../lib/useDayCountdown';
import { parseTiebreakerInput, tiebreakerInputHint } from '../lib/tiebreakerInput';
import { TiebreakerSubmitter } from '../lib/tiebreakerSubmit';
import {
  answersText,
  distributionAxisTicks,
  distributionBars,
  distributionSummary,
  formatAsOfDate,
  formatDayMonth,
  formatMultiplier,
  formatQuantity,
  formatQuantityBreakable,
  formatTiebreakerNumber,
  safeSourceUrl,
  sourceHost,
  standingText,
} from '../lib/tiebreakerView';
import { useTiebreakerToday, type TiebreakerTodayState } from '../lib/useTiebreakerToday';
import { ScreenHeader } from './ScreenHeader';

export type TiebreakerSubmitStatus = 'idle' | 'sending' | 'network' | 'rejected' | 'stale';

// ---- Ответ ----

interface AnswerFormProps {
  question: TiebreakerQuestionView;
  /** Браузерный гость: в развязке ничьих его ответ не учитывается. */
  guest: boolean;
  status: TiebreakerSubmitStatus;
  onSubmit: (guess: number) => void;
  /** Для тестов: начальный ввод и шаг подтверждения. */
  initialText?: string;
  initialConfirm?: boolean;
}

export function TiebreakerAnswerForm({
  question,
  guest,
  status,
  onSubmit,
  initialText = '',
  initialConfirm = false,
}: AnswerFormProps) {
  const [text, setText] = useState(initialText);
  const [confirming, setConfirming] = useState(initialConfirm);
  const [touched, setTouched] = useState(initialText !== '');
  const formRef = useRef<HTMLDivElement>(null);
  const parsed = parseTiebreakerInput(text);
  const hint = touched && !parsed.ok ? tiebreakerInputHint(parsed.error) : null;
  const sending = status === 'sending';

  // Экранная клавиатура сжимает viewport: подтягиваем форму (поле и кнопку) в видимую часть, как в OpenAnswerInput.
  useEffect(() => {
    let frameId: number | null = null;
    const reveal = () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        frameId = null;
        formRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
    };
    window.visualViewport?.addEventListener('resize', reveal);
    return () => {
      window.visualViewport?.removeEventListener('resize', reveal);
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, []);

  const proceed = () => {
    setTouched(true);
    if (parsed.ok && !sending) setConfirming(true);
  };

  return (
    <div className="tb-form" ref={formRef}>
      <label className="tb-label" htmlFor="tb-guess">Твоя прикидка{question.unit ? `, ${question.unit}` : ''}</label>
      <input
        id="tb-guess"
        className="open-answer-input tb-input"
        type="text"
        inputMode="decimal"
        enterKeyHint="done"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        placeholder="Например, 1 500 или 1,5 млн"
        value={text}
        disabled={sending || confirming}
        aria-invalid={hint ? true : undefined}
        aria-describedby={hint ? 'tb-hint tb-note' : 'tb-note'}
        onChange={(event) => { setText(event.target.value); setConfirming(false); }}
        onBlur={() => setTouched(true)}
        onFocus={(event) => event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' })}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          if (!confirming) proceed();
        }}
      />
      {hint && <p id="tb-hint" className="tb-hint" role="alert">{hint}</p>}
      <p id="tb-note" className="tb-note">
        Можно писать «тыс», «млн», «млрд». Запятая — десятичная.
      </p>
      {guest && (
        <p className="tb-guest" role="note">
          В развязке ничьих считается только ответ из Telegram. Здесь можно ответить и посмотреть результат, но на ничьи он не повлияет.
        </p>
      )}

      {confirming && parsed.ok ? (
        <div className="tb-confirm" role="group" aria-label="Подтверждение ответа">
          <p className="tb-confirm-text">
            Отправить <strong>{formatQuantity(parsed.value, question.unit)}</strong>? Ответ нельзя изменить.
          </p>
          <button type="button" className="cta-btn" disabled={sending} onClick={() => { onSubmit(parsed.value); }}>
            {sending ? 'Отправляем…' : 'Отправить ответ'}
          </button>
          <button type="button" className="ghost-btn" disabled={sending} onClick={() => setConfirming(false)}>
            Исправить
          </button>
        </div>
      ) : (
        <button type="button" className="cta-btn" disabled={!parsed.ok} onClick={proceed}>
          Ответить
        </button>
      )}

      {status === 'network' && (
        <p className="tb-hint" role="alert">Не удалось отправить: нет связи. Ответ не потерян — нажми ещё раз.</p>
      )}
      {status === 'rejected' && (
        <p className="tb-hint" role="alert">Сервер не принял ответ. Проверь число и попробуй ещё раз.</p>
      )}
      {status === 'stale' && (
        <p className="tb-hint" role="status">Вопрос дня сменился. Вот новый.</p>
      )}
    </div>
  );
}

// ---- Вскрытие ----

/** Деления шкалы под столбиками; первое и последнее прижаты к краям, чтобы подпись не вылезала за карточку. */
function DistributionAxis() {
  const ticks = distributionAxisTicks();
  return (
    <div className="tb-axis" aria-hidden="true">
      {ticks.map((tick, index) => {
        const edge = index === 0 ? 'start' : index === ticks.length - 1 ? 'end' : 'mid';
        return (
          <span
            key={tick.label}
            className={`tb-axis-tick ${edge}${tick.exact ? ' exact' : ''}`}
            style={{ left: `${tick.position * 100}%` }}
          >
            {tick.label}
          </span>
        );
      })}
    </div>
  );
}

function DistributionChart({ answered }: { answered: TiebreakerAnsweredView }) {
  const bars = distributionBars(answered);
  return (
    <section className="tb-block" aria-labelledby="tb-dist-title">
      <div className="tb-block-head">
        <h3 id="tb-dist-title" className="tb-block-title">Как ответили все</h3>
        <span className="tb-block-meta">{answersText(answered.totalAnswers)}</span>
      </div>
      <figure className="tb-chart">
        <div className="tb-bars" role="img" aria-label={distributionSummary(answered)}>
          {bars.map((bar) => (
            <span key={bar.index} className="tb-bar-slot" aria-hidden="true">
              <span
                className={bar.mine ? `tb-bar ${bar.side} mine` : `tb-bar ${bar.side}`}
                style={{ height: `${Math.max(bar.count > 0 ? 4 : 0, Math.round(bar.height * 100))}%` }}
              />
              {bar.mine && <span className="tb-bar-flag">ты</span>}
            </span>
          ))}
        </div>
        <DistributionAxis />
        <figcaption className="tb-legend" aria-hidden="true">
          <span><i className="tb-swatch under" />занизили</span>
          <span><i className="tb-swatch over" />завысили</span>
        </figcaption>
      </figure>
    </section>
  );
}

/** Ссылка-источник: http(s) открывается через openExternalLink, всё остальное — текстом. */
function SourceLink({ url, title }: { url: string; title: string }) {
  const safeUrl = safeSourceUrl(url);
  if (!safeUrl) return <span>{title}</span>;
  return (
    <a
      href={safeUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => { if (openExternalLink(safeUrl)) event.preventDefault(); }}
    >
      {title}
    </a>
  );
}

function stepsText(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  const word = mod100 >= 11 && mod100 <= 14 ? 'шагов' : mod10 === 1 ? 'шаг' : mod10 >= 2 && mod10 <= 4 ? 'шага' : 'шагов';
  return `${count} ${word}`;
}

/**
 * «Как прикинуть»: шаги с источниками и формула словами. Свёрнут по умолчанию — вскрытие начинается
 * с промаха, а не с разбора. Раскрывашка — обычная <button>, поэтому работает с клавиатуры.
 */
export function TiebreakerExplanationBlock({
  explanation,
  defaultOpen = false,
}: {
  explanation: TiebreakerExplanation;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={open ? 'tb-explain open' : 'tb-explain'}>
      <button
        type="button"
        className="tb-explain-toggle"
        aria-expanded={open}
        aria-controls={open ? 'tb-explain-body' : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="tb-explain-head">
          <span className="tb-explain-title">Как прикинуть</span>
          <span className="tb-explain-sub">{stepsText(explanation.steps.length)} · {explanation.summary}</span>
        </span>
        <svg className="tb-explain-chevron" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div id="tb-explain-body" className="tb-explain-body">
          <ol className="tb-steps">
            {explanation.steps.map((step, index) => (
              <li key={index} className="tb-step">
                <span className="tb-step-label">{step.label}</span>
                <span className="tb-step-value">{formatQuantity(step.value, step.unit)}</span>
                <span className="tb-step-source">
                  <SourceLink url={step.sourceUrl} title={step.sourceTitle} />
                  {step.asOf ? ` · ${formatAsOfDate(step.asOf)}` : ''}
                </span>
              </li>
            ))}
          </ol>
          <p className="tb-explain-summary">{explanation.summary}</p>
        </div>
      )}
    </section>
  );
}

export type TiebreakerShareStatus = 'idle' | 'copied' | 'failed';

interface RevealProps {
  question: TiebreakerQuestionView;
  answered: TiebreakerAnsweredView;
  /** Сколько осталось до следующего вопроса, мс. */
  msLeft: number;
  shareStatus?: TiebreakerShareStatus;
  onShare?: () => void;
  /** Для тестов: разбор развёрнут сразу. */
  explanationOpen?: boolean;
}

export function TiebreakerReveal({
  question,
  answered,
  msLeft,
  shareStatus = 'idle',
  onShare,
  explanationOpen = false,
}: RevealProps) {
  const safeUrl = safeSourceUrl(answered.sourceUrl);
  const standing = standingText(answered.percentile);
  const best = isBestAnswerOfDay(answered.percentile);
  return (
    <div className="tb-reveal">
      <section className="tb-result" aria-label="Твой результат">
        <div className="tb-result-top">
          <div className="tb-result-miss">
            <span className="tb-result-label">Твой промах</span>
            <span className={best ? 'tb-miss best' : 'tb-miss'}>{formatMultiplier(answered.multiplier)}</span>
          </div>
          {standing && <p className="tb-result-standing">{standing}</p>}
        </div>
        {answered.percentile === null && (
          <p className="tb-result-note">
            Процент игроков покажем, когда ответят {TIEBREAKER_MIN_ANSWERS_FOR_PERCENTILE}. Пока ответов: {formatTiebreakerNumber(answered.totalAnswers)}.
          </p>
        )}
        <dl className="tb-compare">
          <div className="tb-compare-row">
            <dt>Твой ответ</dt>
            <dd>{formatQuantityBreakable(answered.guess, question.unit)}</dd>
          </div>
          <div className="tb-compare-row">
            <dt>Правильный</dt>
            <dd>{formatQuantityBreakable(answered.answer, question.unit)}</dd>
          </div>
        </dl>
        <button type="button" className="tb-share-btn" onClick={() => { onShare?.(); }}>
          Поделиться результатом
        </button>
        {shareStatus === 'copied' && <p className="tb-share-note" role="status">Скопировано</p>}
        {shareStatus === 'failed' && <p className="tb-share-note" role="alert">Не удалось поделиться</p>}
      </section>

      <DistributionChart answered={answered} />

      <div className="tb-explain-wrap">
        {answered.explanation && (
          <TiebreakerExplanationBlock explanation={answered.explanation} defaultOpen={explanationOpen} />
        )}
        <p className="tb-source">
          {safeUrl ? (
            <a
              href={safeUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => { if (openExternalLink(safeUrl)) event.preventDefault(); }}
            >
              Источник: {sourceHost(safeUrl)}
            </a>
          ) : (
            <span>Источник: {answered.sourceUrl}</span>
          )}
          {' · '}данные на {formatAsOfDate(answered.asOfDate)}
        </p>
      </div>

      <div className="tb-next">
        <span className="tb-next-label">Следующий вопрос</span>
        <span className="tb-next-timer">{formatCountdownClock(msLeft)}</span>
      </div>
    </div>
  );
}

// ---- Экран ----

interface ScreenViewProps {
  state: TiebreakerTodayState;
  guest: boolean;
  submitStatus: TiebreakerSubmitStatus;
  /** Сколько осталось до конца игровых суток, мс. */
  msLeft?: number;
  shareStatus?: TiebreakerShareStatus;
  onBack: () => void;
  onRetry: () => void;
  onSubmit: (guess: number) => void;
  onShare?: () => void;
  /** Для тестов: разбор развёрнут сразу. */
  explanationOpen?: boolean;
}

export function TiebreakerScreenView({
  state,
  guest,
  submitStatus,
  msLeft = 0,
  shareStatus = 'idle',
  onBack,
  onRetry,
  onSubmit,
  onShare,
  explanationOpen = false,
}: ScreenViewProps) {
  const question = state.status === 'ready' ? state.today.question : null;
  const answered = state.status === 'ready' ? state.today.answered : null;

  return (
    <section className="tb-screen">
      <ScreenHeader onBack={onBack} />

      <div className="tb-head">
        <h1 className="tb-title">
          На глазок{question && <> <span className="tb-num">#{question.number}</span></>}
        </h1>
        {state.status === 'ready' && question && <span className="tb-date">{formatDayMonth(state.today.dateKey)}</span>}
      </div>

      {state.status === 'loading' && (
        <div className="matchmaking-loading" role="status"><span /> Загружаем вопрос</div>
      )}

      {state.status === 'error' && (
        <div className="my-runs-message">
          <p className="matchmaking-error" role="alert">Не удалось загрузить вопрос. Проверь соединение и попробуй ещё раз.</p>
          <button type="button" className="cta-btn" onClick={onRetry}>Повторить</button>
        </div>
      )}

      {state.status === 'ready' && !question && (
        <div className="my-runs-message">
          <p className="matchmaking-error">Сегодня вопроса нет. Загляни завтра.</p>
          <button type="button" className="ghost-btn" onClick={onBack}>Назад</button>
        </div>
      )}

      {question && (
        <>
          <p className="tb-prompt">{question.prompt}</p>
          {answered ? (
            <TiebreakerReveal
              question={question}
              answered={answered}
              msLeft={msLeft}
              shareStatus={shareStatus}
              onShare={onShare}
              explanationOpen={explanationOpen}
            />
          ) : (
            <TiebreakerAnswerForm
              key={question.id}
              question={question}
              guest={guest}
              status={submitStatus}
              onSubmit={onSubmit}
            />
          )}
        </>
      )}
    </section>
  );
}

export function TiebreakerScreen({ onBack }: { onBack: () => void }) {
  const { state, reload, setToday } = useTiebreakerToday();
  const [submitStatus, setSubmitStatus] = useState<TiebreakerSubmitStatus>('idle');
  const [shareStatus, setShareStatus] = useState<TiebreakerShareStatus>('idle');
  const submitter = useRef<TiebreakerSubmitter | null>(null);
  submitter.current ??= new TiebreakerSubmitter({ answer: answerTiebreaker });
  const guest = getTelegramIdentity() === null;
  // Смена суток: вопрос уже другой, перечитываем.
  const msLeft = useDayCountdown(reload);

  // Подтверждение «Скопировано» гаснет само, чтобы не висеть до ухода с экрана.
  useEffect(() => {
    if (shareStatus === 'idle') return undefined;
    const id = window.setTimeout(() => setShareStatus('idle'), 3000);
    return () => window.clearTimeout(id);
  }, [shareStatus]);

  const share = () => {
    if (state.status !== 'ready' || !state.today.question || !state.today.answered) return;
    const { question, answered } = state.today;
    const hasNative = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
    void shareTiebreakerResult(
      question.number,
      answered,
      resolveGameLink(import.meta.env.VITE_TELEGRAM_BOT_LINK as string | undefined, window.location.origin),
      {
        telegramShare: canShareViaTelegram(),
        nativeShare: hasNative,
        effects: {
          telegramShare: shareViaTelegram,
          nativeShare: hasNative ? (data) => navigator.share(data) : undefined,
          copy: (text) => navigator.clipboard.writeText(text),
        },
      },
    ).then((result) => {
      // Событие без текста и без ответа: только факт, что поделились.
      if (result === 'shared' || result === 'copied') logAnalyticsEvent('tiebreaker_shared');
      setShareStatus(result === 'copied' ? 'copied' : result === 'failed' ? 'failed' : 'idle');
    });
  };

  const submit = (guess: number) => {
    if (state.status !== 'ready' || !state.today.question) return;
    const questionId = state.today.question.id;
    setSubmitStatus('sending');
    void submitter.current!.submit({ questionId, guess }).then((outcome) => {
      if (!outcome) return;
      switch (outcome.kind) {
        case 'answered':
          // Событие без guess и ответа: на сервере они и так есть, а в аналитике им делать нечего.
          logAnalyticsEvent('tiebreaker_answered');
          setSubmitStatus('idle');
          setToday(outcome.state);
          break;
        case 'already_answered':
          setSubmitStatus('idle');
          if (outcome.state) setToday(outcome.state);
          else reload();
          break;
        case 'stale':
          setSubmitStatus('stale');
          reload();
          break;
        case 'network':
          setSubmitStatus('network');
          break;
        case 'rejected':
          setSubmitStatus('rejected');
          break;
      }
    });
  };

  return (
    <TiebreakerScreenView
      state={state}
      guest={guest}
      submitStatus={submitStatus}
      msLeft={msLeft}
      shareStatus={shareStatus}
      onBack={onBack}
      onRetry={reload}
      onSubmit={submit}
      onShare={share}
    />
  );
}
