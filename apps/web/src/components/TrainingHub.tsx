import { useCallback, useEffect, useState } from 'react';
import { PRACTICE_LEVELS, type PracticeLevel, type PublicQuestion } from '@clutch/shared';
import { checkTrainingAnswer, fetchTrainingMistakes, fetchTrainingQuestions, logAnalyticsEvent, submitQuestionReport } from '../lib/api';
import { ScreenHeader } from './ScreenHeader';
import { Training, type TrainingReportInput } from './Training';

interface TrainingHubProps {
  onStartBot: (level: PracticeLevel) => void;
  onBack: () => void;
  /** true, пока идёт практика ошибок: App прячет нижнюю навигацию. */
  onPlayingChange?: (playing: boolean) => void;
}

type View = 'menu' | 'bots' | 'mistakes';

/** Выбор уровня бота: название и одна строка о силе. */
export function PracticeLevelList({ onStartBot }: { onStartBot: (level: PracticeLevel) => void }) {
  return (
    <>
      {PRACTICE_LEVELS.map((level) => (
        <button key={level.id} type="button" className="training-entry" onClick={() => { onStartBot(level); }}>
          <span className="training-entry-title">{level.name}</span>
          <span className="training-entry-meta">{level.caption}</span>
        </button>
      ))}
    </>
  );
}

type MistakeLoad =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; questions: PublicQuestion[] };

interface MistakePracticeProps {
  ids: string[];
  onBack: () => void;
  exitLabel?: string;
}

/** Репорт из отработки ошибок: забега нет, runId не приходит. */
const reportTrainingProblem = (input: TrainingReportInput) =>
  submitQuestionReport({ ...input, mode: 'training' }).then(() => undefined);

/** Загрузка вопросов отработки с сервера (без ответов) и сама отработка. Журнал ошибок ведёт сервер: id приходят оттуда же, чужие сервер отклоняет. */
export function MistakePractice({ ids, onBack, exitLabel }: MistakePracticeProps) {
  const [load, setLoad] = useState<MistakeLoad>(ids.length === 0 ? { status: 'ready', questions: [] } : { status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (ids.length === 0) {
      setLoad({ status: 'ready', questions: [] });
      return undefined;
    }
    const controller = new AbortController();
    setLoad({ status: 'loading' });
    fetchTrainingQuestions(ids, controller.signal).then((response) => {
      if (controller.signal.aborted) return;
      // Порядок сессии задал сервер; вопросы приходят в том же порядке.
      setLoad({ status: 'ready', questions: response.questions });
      // Категория сессии — категория первого вопроса: набор ошибок бывает смешанным.
      if (response.questions.length > 0) {
        logAnalyticsEvent('training_started', { category: response.questions[0].category });
      }
    }).catch(() => {
      if (!controller.signal.aborted) setLoad({ status: 'error' });
    });
    return () => controller.abort();
  }, [ids, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  if (load.status === 'loading') {
    return (
      <section className="training-screen">
        <ScreenHeader onBack={onBack} title="Отработка ошибок" />
        <div className="matchmaking-loading" role="status"><span /> Загружаем вопросы</div>
      </section>
    );
  }
  if (load.status === 'error') {
    return (
      <section className="training-screen">
        <ScreenHeader onBack={onBack} title="Отработка ошибок" />
        <p className="matchmaking-error" role="alert">Не удалось загрузить вопросы. Проверь соединение и повтори.</p>
        <button type="button" className="cta-btn" onClick={retry}>Повторить</button>
      </section>
    );
  }
  return (
    <Training
      questions={load.questions}
      check={checkTrainingAnswer}
      onBack={onBack}
      exitLabel={exitLabel}
      onReport={reportTrainingProblem}
    />
  );
}

/** «Тренировка»: практика без зачёта. Два входа: игра против бота и отработка ошибок. */
/** Журнал ошибок живёт на сервере: экран показывает только то, что сервер ответил. */
export type MistakeSummary =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; count: number; ids: string[] };

export function mistakeMeta(summary: MistakeSummary): string {
  if (summary.status === 'loading') return 'Загружаем…';
  if (summary.status === 'error') return 'Не удалось загрузить ошибки';
  return summary.count > 0 ? `Ошибок накоплено: ${summary.count}` : 'Пока нет ошибок';
}

/** Меню «Тренировки»: два входа. Выделено, чтобы состояния журнала проверялись без сети. */
export function TrainingMenu({ summary, onBots, onMistakes, onBack }: {
  summary: MistakeSummary;
  onBots: () => void;
  onMistakes: () => void;
  onBack: () => void;
}) {
  return (
    <section className="training-screen">
      <ScreenHeader onBack={onBack} title="Тренировка" />
      <p className="training-note">Не идёт в зачёт</p>
      <button type="button" className="training-entry" onClick={onBots}>
        <span className="training-entry-title">Игра против ботов</span>
        <span className="training-entry-meta">Четыре уровня сложности</span>
      </button>
      <button type="button" className="training-entry" onClick={onMistakes} disabled={summary.status === 'loading'}>
        <span className="training-entry-title">Отработка ошибок</span>
        <span className="training-entry-meta">{mistakeMeta(summary)}</span>
      </button>
    </section>
  );
}

export function TrainingHub({ onStartBot, onBack, onPlayingChange }: TrainingHubProps) {
  const [view, setView] = useState<View>('menu');
  const [summary, setSummary] = useState<MistakeSummary>({ status: 'loading' });

  // Список ошибок берётся с сервера при каждом возврате в меню: после отработки он изменился.
  useEffect(() => {
    if (view !== 'menu') return undefined;
    const controller = new AbortController();
    setSummary({ status: 'loading' });
    fetchTrainingMistakes(controller.signal).then((response) => {
      if (!controller.signal.aborted) setSummary({ status: 'ready', count: response.count, ids: response.ids });
    }).catch(() => {
      if (!controller.signal.aborted) setSummary({ status: 'error' });
    });
    return () => controller.abort();
  }, [view]);

  useEffect(() => {
    onPlayingChange?.(view === 'mistakes');
    return () => onPlayingChange?.(false);
  }, [view, onPlayingChange]);

  if (view === 'mistakes') {
    return (
      <MistakePractice
        ids={summary.status === 'ready' ? summary.ids : []}
        onBack={() => setView('menu')}
        exitLabel="К тренировке"
      />
    );
  }

  if (view === 'bots') {
    return (
      <section className="training-screen">
        <ScreenHeader onBack={() => setView('menu')} title="Против бота" />
        <PracticeLevelList onStartBot={onStartBot} />
      </section>
    );
  }

  return (
    <TrainingMenu
      summary={summary}
      onBots={() => setView('bots')}
      onMistakes={() => setView('mistakes')}
      onBack={onBack}
    />
  );
}
