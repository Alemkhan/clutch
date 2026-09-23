import type { Tournament, Opponent, Question } from '@clutch/shared';
import { generateFixedCapitalQuiz } from '@clutch/shared';
import { miniGameConfig } from './sampleData';

// Real capitals quiz, reconstructed from the video's own Q&A order and outcomes.
// Country order matches how they were asked: Iraq, Venezuela, Portugal, Eswatini,
// Zambia, Namibia, Armenia, Antigua and Barbuda, Dominica.
const robbQuizCountryCodes = ['iq', 've', 'pt', 'sz', 'zm', 'na', 'am', 'ag', 'dm'];

const robbQuizQuestions = generateFixedCapitalQuiz(robbQuizCountryCodes);

// Correctness reflects the actual video outcome per question; response times and
// hammer-mini-game skill scores are estimates (the source is an oral quiz, so there's
// no mini-game or millisecond timing to pull from — only right/wrong and rough pacing).
const robbOpponent: Opponent = {
  id: 'test_robb_peters',
  displayName: 'Robb Peters',
  avatar: '/sprites/avatar-opponent.png',
  rounds: [
    { questionId: robbQuizQuestions[0]?.id ?? 'iq', correct: false, responseTimeMs: 4500, skillScore: 0, progressAwarded: 0 },
    { questionId: robbQuizQuestions[1]?.id ?? 've', correct: true, responseTimeMs: 2200, skillScore: 0.85, progressAwarded: 25 },
    { questionId: robbQuizQuestions[2]?.id ?? 'pt', correct: true, responseTimeMs: 2000, skillScore: 0.90, progressAwarded: 25 },
    { questionId: robbQuizQuestions[3]?.id ?? 'sz', correct: true, responseTimeMs: 3800, skillScore: 0.55, progressAwarded: 12 },
    { questionId: robbQuizQuestions[4]?.id ?? 'zm', correct: true, responseTimeMs: 2600, skillScore: 0.75, progressAwarded: 18 },
    { questionId: robbQuizQuestions[5]?.id ?? 'na', correct: true, responseTimeMs: 3200, skillScore: 0.65, progressAwarded: 12 },
    { questionId: robbQuizQuestions[6]?.id ?? 'am', correct: false, responseTimeMs: 4200, skillScore: 0, progressAwarded: 0 },
    { questionId: robbQuizQuestions[7]?.id ?? 'ag', correct: true, responseTimeMs: 2400, skillScore: 0.80, progressAwarded: 18 },
    { questionId: robbQuizQuestions[8]?.id ?? 'dm', correct: true, responseTimeMs: 2100, skillScore: 0.88, progressAwarded: 25 },
  ],
};

const robbTournament: Tournament = {
  id: 'test-robb-capitals',
  slug: 'robb-peters-capitals',
  title: 'Обыграй Robb Peters',
  description: 'Тот же квиз по столицам: 9 вопросов в исходном порядке.',
  status: 'draft',
  questionIds: robbQuizQuestions.map((q) => q.id),
  opponentId: robbOpponent.id,
  miniGame: { id: 'hammer_nail', config: miniGameConfig },
  rankingEnabled: false,
  video: {
    platform: 'youtube',
    url: 'https://www.youtube.com/watch?v=dzY4Lmx_LXU',
    contentId: 'dzY4Lmx_LXU',
  },
};

export interface Challenge {
  tournament: Tournament;
  opponent: Opponent;
  questions: Question[];
  badge: string;
}

// Add new entries here as more real videos get recorded and their outcomes logged.
export const challenges: Challenge[] = [
  { tournament: robbTournament, opponent: robbOpponent, questions: robbQuizQuestions, badge: 'Видео-челлендж' },
];

export function findChallenge(tournamentId: string): Challenge | undefined {
  return challenges.find((c) => c.tournament.id === tournamentId);
}
