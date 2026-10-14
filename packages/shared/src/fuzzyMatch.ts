export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const d: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      );
    }
  }

  return d[m][n];
}

export function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.,!?;:'"]/g, '');
}

/** Short answers are too easy to turn into another valid fact with one edit. */
export const EXACT_MATCH_MAX_LENGTH = 4;

/** Two edits are only reasonable when both strings still contain substantial context. */
export const TWO_EDIT_MIN_LENGTH = 10;

const NUMERIC_ANSWER = /^\p{Decimal_Number}+$/u;

function requiresExactMatch(answer: string): boolean {
  return answer.length <= EXACT_MATCH_MAX_LENGTH || NUMERIC_ANSWER.test(answer);
}

function allowedDistance(input: string, answer: string): number {
  if (requiresExactMatch(input) || requiresExactMatch(answer)) return 0;
  return Math.min(input.length, answer.length) >= TWO_EDIT_MIN_LENGTH ? 2 : 1;
}

export function isAnswerCorrect(
  input: string,
  correctAnswers: readonly string[],
): { correct: boolean; matchedAnswer: string | null } {
  const normalized = normalizeAnswer(input);
  if (!normalized) return { correct: false, matchedAnswer: null };

  for (const answer of correctAnswers) {
    const normalizedAnswer = normalizeAnswer(answer);
    if (normalized === normalizedAnswer) {
      return { correct: true, matchedAnswer: answer };
    }
    const tolerance = allowedDistance(normalized, normalizedAnswer);
    if (tolerance === 0) continue;
    const distance = levenshtein(normalized, normalizedAnswer);
    if (distance <= tolerance) {
      return { correct: true, matchedAnswer: answer };
    }
  }

  return { correct: false, matchedAnswer: null };
}
