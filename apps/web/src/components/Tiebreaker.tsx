import { useEffect, useRef, useState } from 'react';
import {
  TIEBREAKER_MIN_ANSWERS_FOR_PERCENTILE,
  type TiebreakerAnsweredView,
  type TiebreakerExplanation,
  type TiebreakerQuestionView,
} from '@clutch/shared';
import { answerTiebreaker, logAnalyticsEvent } from '../lib/api';
import { getTelegramIdentity, openExternalLink } from '../lib/telegram';
import { parseTiebreakerInput, tiebreakerInputHint } from '../lib/tiebreakerInput';
import { TiebreakerSubmitter } from '../lib/tiebreakerSubmit';
import {
  distributionBars,
  distributionSummary,
  formatAsOfDate,
  formatMultiplier,
  formatQuantity,
  formatTiebreakerNumber,
  safeSourceUrl,
  sourceHost,
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

function DistributionChart({ answered }: { answered: TiebreakerAnsweredView }) {
  const bars = distributionBars(answered);
  return (
    <figure className="tb-chart">
      <div className="tb-bars" role="img" aria-label={distributionSummary(answered)}>
        {bars.map((bar) => (
          <span key={bar.index} className="tb-bar-slot" aria-hidden="true">
            <span
              className={bar.mine ? 'tb-bar mine' : 'tb-bar'}
              style={{ height: `${Math.max(bar.count > 0 ? 4 : 0, Math.round(bar.height * 100))}%` }}
            />
            {bar.mine && <span className="tb-bar-flag">ты</span>}
          </span>
        ))}
      </div>
      <div className="tb-axis" aria-hidden="true">
        <span>меньше в 1000 раз</span>
        <span>точно</span>
        <span>больше в 1000 раз</span>
      </div>
      <figcaption className="tb-chart-caption">Ответов за сегодня: {formatTiebreakerNumber(answered.totalAnswers)}</figcaption>
    </figure>
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

/** «Как прикинуть»: шаги с источниками и формула словами. Показывается только на вскрытии. */
export function TiebreakerExplanationBlock({ explanation }: { explanation: TiebreakerExplanation }) {
  return (
    <section className="tb-explain" aria-labelledby="tb-explain-title">
      <h3 id="tb-explain-title" className="tb-explain-title">Как прикинуть</h3>
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
    </section>
  );
}

export function TiebreakerReveal({ question, answered }: { question: TiebreakerQuestionView; answered: TiebreakerAnsweredView }) {
  const safeUrl = safeSourceUrl(answered.sourceUrl);
  return (
    <div className="tb-reveal">
      <p className="tb-answer-label">Правильный ответ</p>
      <p className="tb-answer">{formatQuantity(answered.answer, question.unit)}</p>
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

      {answered.explanation && <TiebreakerExplanationBlock explanation={answered.explanation} />}

      <dl className="tb-yours">
        <div>
          <dt>Твой ответ</dt>
          <dd>{formatQuantity(answered.guess, question.unit)}</dd>
        </div>
        <div>
          <dt>Промах</dt>
          <dd className="tb-mult">{formatMultiplier(answered.multiplier)}</dd>
        </div>
      </dl>

      {answered.percentile !== null ? (
        <p className="tb-percentile">Ближе, чем {answered.percentile}% игроков</p>
      ) : (
        <p className="tb-note">
          Процент игроков покажем, когда ответят {TIEBREAKER_MIN_ANSWERS_FOR_PERCENTILE}. Пока ответов: {formatTiebreakerNumber(answered.totalAnswers)}.
        </p>
      )}

      <DistributionChart answered={answered} />
    </div>
  );
}

// ---- Экран ----

interface ScreenViewProps {
  state: TiebreakerTodayState;
  guest: boolean;
  submitStatus: TiebreakerSubmitStatus;
  onBack: () => void;
  onRetry: () => void;
  onSubmit: (guess: number) => void;
}

export function TiebreakerScreenView({ state, guest, submitStatus, onBack, onRetry, onSubmit }: ScreenViewProps) {
  const question = state.status === 'ready' ? state.today.question : null;
  const answered = state.status === 'ready' ? state.today.answered : null;

  return (
    <section className="tb-screen">
      <ScreenHeader onBack={onBack} title="На глазок" />

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
            <TiebreakerReveal question={question} answered={answered} />
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
  const submitter = useRef<TiebreakerSubmitter | null>(null);
  submitter.current ??= new TiebreakerSubmitter({ answer: answerTiebreaker });
  const guest = getTelegramIdentity() === null;

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
      onBack={onBack}
      onRetry={reload}
      onSubmit={submit}
    />
  );
}
