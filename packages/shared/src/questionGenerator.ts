import type { Question, Difficulty } from './index';
import { countries, flagUrl, outlineUrl, type Country } from './countries';

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function pickOne<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickDistractors<T>(arr: T[], exclude: T, count: number): T[] {
  const pool = arr.filter((item) => item !== exclude);
  return shuffle(pool).slice(0, count);
}

function buildOptions(correct: Country, distractors: Country[], textFn: (c: Country) => string) {
  const all = shuffle([correct, ...distractors]);
  const options = all.map((c, i) => ({
    id: String.fromCharCode(97 + i),
    text: textFn(c),
  }));
  const correctOptionId = String.fromCharCode(97 + all.findIndex((c) => c.code === correct.code));
  return { options, correctOptionId };
}

export function generateFlagToCountry(): Question {
  const correct = pickOne(countries);
  const distractors = pickDistractors(countries, correct, 3);
  const { options, correctOptionId } = buildOptions(correct, distractors, (c) => c.name);

  return {
    id: `flag_country_${correct.code}`,
    type: 'multiple_choice',
    answerType: 'multiple_choice',
    category: 'Geography',
    subcategory: 'Flags',
    difficulty: 'Easy',
    prompt: 'Which country does this flag belong to?',
    mediaType: 'flag',
    mediaUrl: flagUrl(correct.code),
    options,
    correctOptionId,
    explanation: `This is the flag of ${correct.name}.`,
    status: 'approved',
    createdAt: new Date().toISOString(),
  };
}

export function generateCountryToCapital(difficulty: Difficulty = 'Medium'): Question {
  const correct = pickOne(countries);
  const distractors = pickDistractors(countries, correct, 3);
  const { options, correctOptionId } = buildOptions(correct, distractors, (c) => c.capital);

  return {
    id: `capital_${correct.code}`,
    type: 'multiple_choice',
    answerType: 'multiple_choice',
    category: 'Geography',
    subcategory: 'Capitals',
    difficulty,
    prompt: `What is the capital of ${correct.name}?`,
    options,
    correctOptionId,
    explanation: `The capital of ${correct.name} is ${correct.capital}.`,
    status: 'approved',
    createdAt: new Date().toISOString(),
  };
}

export function generateFlagToCapital(): Question {
  const correct = pickOne(countries);
  const distractors = pickDistractors(countries, correct, 3);
  const { options, correctOptionId } = buildOptions(correct, distractors, (c) => c.capital);

  return {
    id: `flag_capital_${correct.code}`,
    type: 'multiple_choice',
    answerType: 'multiple_choice',
    category: 'Geography',
    subcategory: 'Flags & Capitals',
    difficulty: 'Hard',
    prompt: 'What is the capital of the country with this flag?',
    mediaType: 'flag',
    mediaUrl: flagUrl(correct.code),
    options,
    correctOptionId,
    explanation: `This is the flag of ${correct.name}. Its capital is ${correct.capital}.`,
    status: 'approved',
    createdAt: new Date().toISOString(),
  };
}

export function generateOutlineToCountry(): Question {
  const correct = pickOne(countries);
  const distractors = pickDistractors(countries, correct, 3);
  const { options, correctOptionId } = buildOptions(correct, distractors, (c) => c.name);

  return {
    id: `outline_country_${correct.code}`,
    type: 'multiple_choice',
    answerType: 'multiple_choice',
    category: 'Geography',
    subcategory: 'Outlines',
    difficulty: 'Medium',
    prompt: 'Which country has this shape?',
    mediaType: 'outline',
    mediaUrl: outlineUrl(correct.code),
    options,
    correctOptionId,
    explanation: `This is the outline of ${correct.name}.`,
    status: 'approved',
    createdAt: new Date().toISOString(),
  };
}

export function generateOutlineToCountryOpen(): Question {
  const correct = pickOne(countries);
  return {
    id: `open_outline_country_${correct.code}`,
    type: 'multiple_choice',
    answerType: 'open_answer',
    category: 'Geography',
    subcategory: 'Type the Country (Outline)',
    difficulty: 'Expert',
    prompt: 'Type the name of the country with this shape:',
    mediaType: 'outline',
    mediaUrl: outlineUrl(correct.code),
    options: [],
    correctOptionId: '',
    correctAnswers: [correct.name],
    explanation: `This is the outline of ${correct.name}.`,
    status: 'approved',
    createdAt: new Date().toISOString(),
  };
}

export function generateCapitalOpenAnswer(): Question {
  const correct = pickOne(countries);
  return {
    id: `open_capital_${correct.code}`,
    type: 'multiple_choice',
    answerType: 'open_answer',
    category: 'Geography',
    subcategory: 'Type the Capital',
    difficulty: 'Hard',
    prompt: `Type the capital of ${correct.name}`,
    options: [],
    correctOptionId: '',
    correctAnswers: [correct.capital],
    explanation: `The capital of ${correct.name} is ${correct.capital}.`,
    status: 'approved',
    createdAt: new Date().toISOString(),
  };
}

// Builds an ordered, fixed capital quiz for a specific list of country codes —
// used for tournaments that replay a specific real recorded quiz, rather than
// the random pool used by generateMatch.
export function generateFixedCapitalQuiz(countryCodes: string[]): Question[] {
  return countryCodes
    .map((code) => countries.find((c) => c.code === code))
    .filter((c): c is Country => Boolean(c))
    .map((country) => ({
      id: `capital_fixed_${country.code}`,
      type: 'multiple_choice' as const,
      answerType: 'open_answer' as const,
      category: 'Geography',
      subcategory: 'Capitals',
      difficulty: 'Hard' as const,
      prompt: `What is the capital of ${country.name}?`,
      options: [],
      correctOptionId: '',
      correctAnswers: [country.capital],
      explanation: `The capital of ${country.name} is ${country.capital}.`,
      status: 'approved' as const,
      createdAt: new Date().toISOString(),
    }));
}

export function generateFlagToCountryOpen(): Question {
  const correct = pickOne(countries);
  return {
    id: `open_flag_country_${correct.code}`,
    type: 'multiple_choice',
    answerType: 'open_answer',
    category: 'Geography',
    subcategory: 'Type the Country',
    difficulty: 'Expert',
    prompt: 'Type the name of the country with this flag:',
    mediaType: 'flag',
    mediaUrl: flagUrl(correct.code),
    options: [],
    correctOptionId: '',
    correctAnswers: [correct.name],
    explanation: `This is the flag of ${correct.name}.`,
    status: 'approved',
    createdAt: new Date().toISOString(),
  };
}

export function generateMatch(numQuestions: number = 10, openRatio: number = 0.3): Question[] {
  const mcGenerators = [generateFlagToCountry, generateCountryToCapital, generateFlagToCapital, generateOutlineToCountry];
  const openGenerators = [generateCapitalOpenAnswer, generateFlagToCountryOpen, generateOutlineToCountryOpen];
  const numOpen = Math.round(numQuestions * openRatio);
  const numMC = numQuestions - numOpen;
  const questions: Question[] = [];
  const usedCodes = new Set<string>();
  let attempts = 0;

  const tryAdd = (generator: () => Question): boolean => {
    const question = generator();
    const countryCode = question.id.split('_').pop()!;
    if (!usedCodes.has(countryCode)) {
      usedCodes.add(countryCode);
      questions.push(question);
      return true;
    }
    return false;
  };

  while (questions.length < numMC && attempts < 100) {
    tryAdd(pickOne(mcGenerators));
    attempts++;
  }

  attempts = 0;
  while (questions.length < numQuestions && attempts < 100) {
    tryAdd(pickOne(openGenerators));
    attempts++;
  }

  return shuffle(questions);
}
