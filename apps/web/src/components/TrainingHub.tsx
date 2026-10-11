import { useState } from 'react';
import { PRACTICE_LEVELS, type PracticeLevel, type Question } from '@clutch/shared';
import { mistakeCount } from '../lib/mistakeLog';
import { ScreenHeader } from './ScreenHeader';
import { Training } from './Training';

interface TrainingHubProps {
  /** Вопросы отработки ошибок: собираются при входе в раздел. */
  questions: Question[];
  onAnswered: (questionId: string, correct: boolean) => void;
  onStartBot: (level: PracticeLevel) => void;
  onBack: () => void;
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

/** «Тренировка»: практика без зачёта. Два входа: игра против бота и отработка ошибок. */
export function TrainingHub({ questions, onAnswered, onStartBot, onBack }: TrainingHubProps) {
  const [view, setView] = useState<View>('menu');

  if (view === 'mistakes') {
    return (
      <Training
        questions={questions}
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
