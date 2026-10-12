import { useCallback, useEffect, useState } from 'react';
import { PRACTICE_LEVELS, type PracticeLevel, type PublicQuestion } from '@clutch/shared';
import { checkTrainingAnswer, fetchTrainingQuestions } from '../lib/api';
import { mistakeCount, removeMistakes } from '../lib/mistakeLog';
import { ScreenHeader } from './ScreenHeader';
import { Training } from './Training';

interface TrainingHubProps {
  /** Id ошибок для отработки: вопросы по ним сервер собирает при входе в раздел. */
  mistakeIds: string[];
  onAnswered: (questionId: string, correct: boolean) => void;
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
  onAnswered: (questionId: string, correct: boolean) => void;
  onBack: () => void;
  exitLabel?: string;
}

/** Загрузка вопросов отработки с сервера (без ответов) и сама отработка. Id, которых сервер не знает, чистятся из журнала. */
export function MistakePractice({ ids, onAnswered, onBack, exitLabel }: MistakePracticeProps) {
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
      removeMistakes(response.unknownIds);
      // Порядок сессии задал журнал ошибок: сервер отдаёт вопросы в том же порядке.
      setLoad({ status: 'ready', questions: response.questions });
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
      onAnswered={onAnswered}
      onBack={onBack}
      exitLabel={exitLabel}
    />
  );
}

/** «Тренировка»: практика без зачёта. Два входа: игра против бота и отработка ошибок. */
export function TrainingHub({ mistakeIds, onAnswered, onStartBot, onBack, onPlayingChange }: TrainingHubProps) {
  const [view, setView] = useState<View>('menu');

  useEffect(() => {
    onPlayingChange?.(view === 'mistakes');
    return () => onPlayingChange?.(false);
  }, [view, onPlayingChange]);

  if (view === 'mistakes') {
    return (
      <MistakePractice
        ids={mistakeIds}
        onAnswered={onAnswered}
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

  const mistakes = mistakeCount();
  return (
    <section className="training-screen">
      <ScreenHeader onBack={onBack} title="Тренировка" />
      <p className="training-note">Не идёт в зачёт</p>
      <button type="button" className="training-entry" onClick={() => setView('bots')}>
        <span className="training-entry-title">Игра против ботов</span>
        <span className="training-entry-meta">Четыре уровня сложности</span>
      </button>
      <button type="button" className="training-entry" onClick={() => setView('mistakes')}>
        <span className="training-entry-title">Отработка ошибок</span>
        <span className="training-entry-meta">
          {mistakes > 0 ? `Ошибок накоплено: ${mistakes}` : 'Пока нет ошибок'}
        </span>
      </button>
    </section>
  );
}
