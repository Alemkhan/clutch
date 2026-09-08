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

export function isAnswerCorrect(
  input: string,
  correctAnswers: string[],
  maxDistance: number = 1
): { correct: boolean; matchedAnswer: string | null } {
  const normalized = normalizeAnswer(input);
  if (!normalized) return { correct: false, matchedAnswer: null };

  for (const answer of correctAnswers) {
    const normalizedAnswer = normalizeAnswer(answer);
    if (normalized === normalizedAnswer) {
      return { correct: true, matchedAnswer: answer };
    }
    const distance = levenshtein(normalized, normalizedAnswer);
    const tolerance = Math.max(maxDistance, Math.floor(normalizedAnswer.length / 5));
    if (distance <= tolerance) {
      return { correct: true, matchedAnswer: answer };
    }
  }

  return { correct: false, matchedAnswer: null };
}
