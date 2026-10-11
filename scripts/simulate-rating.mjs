// Симуляция моделей сравнения для режима «соло до 100%».
//
// Калибровка взята из docs/PLAYTEST_01.md (86 прохождений, 389 ответов, 220 ударов).
// Сложность стран в данных не измерена — она задаётся разбросом ENTITY_SIGMA,
// и по нему идёт развёртка. Это гипотеза, а не замер.
//
// Запуск: node scripts/simulate-rating.mjs [--runs=20000]

const RUNS = Number(process.argv.find((a) => a.startsWith('--runs='))?.slice(7) ?? 20000);

// --- ГСЧ с зерном, чтобы прогон воспроизводился ---------------------------

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let rng = mulberry32(20261011);
const gauss = () => {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
};

// --- Замеренные константы -------------------------------------------------

const MAX_PROGRESS = 100;
const ROUND_CAP = 20;

// Распределение удара при верном ответе (PLAYTEST_01, 220 попыток).
const HAMMER = [
  { award: 25, p: 0.6 },
  { award: 18, p: 0.33 },
  { award: 12, p: 0.04 },
  { award: 5, p: 0.01 },
  { award: 0, p: 0.02 },
];
const HAMMER_MEAN = HAMMER.reduce((s, h) => s + h.award * h.p, 0);

function rollHammer() {
  let r = rng();
  for (const h of HAMMER) {
    r -= h.p;
    if (r <= 0) return h.award;
  }
  return HAMMER[0].award;
}

const logit = (p) => Math.log(p / (1 - p));
const sigmoid = (x) => 1 / (1 + Math.exp(-x));

// Форматы: доля верных у среднего игрока (PLAYTEST_01) и наблюдаемая частота формата.
// Для «открытый + контур» (0/16) взята поправка Лапласа: 0.5/17.
const FORMATS = [
  { id: 'выбор + текст', rate: 105 / 158, weight: 158 },
  { id: 'выбор + флаг', rate: 77 / 135, weight: 135 },
  { id: 'выбор + контур', rate: 16 / 37, weight: 37 },
  { id: 'открытый + флаг', rate: 13 / 24, weight: 24 },
  { id: 'открытый + текст', rate: 9 / 19, weight: 19 },
  { id: 'открытый + контур', rate: 0.5 / 17, weight: 16 },
].map((f) => ({ ...f, b: -logit(f.rate) }));

const FORMAT_TOTAL = FORMATS.reduce((s, f) => s + f.weight, 0);

function drawFormat() {
  let r = rng() * FORMAT_TOTAL;
  for (const f of FORMATS) {
    r -= f.weight;
    if (r <= 0) return f;
  }
  return FORMATS[0];
}

// --- Вопросы и наборы -----------------------------------------------------

// b — сложность в логитах: P(верно) = sigmoid(тета - b).
function drawQuestion(entitySigma) {
  const format = drawFormat();
  return { b: format.b + gauss() * entitySigma, format: format.id };
}

function drawSet(entitySigma, size = ROUND_CAP) {
  return Array.from({ length: size }, () => drawQuestion(entitySigma));
}

/** Пар набора: за сколько кругов его закрыл бы эталонный игрок (тета = 0). */
function par(set) {
  let progress = 0;
  for (let i = 0; i < set.length; i += 1) {
    progress += sigmoid(-set[i].b) * HAMMER_MEAN;
    if (progress >= MAX_PROGRESS) return i + 1;
  }
  return set.length + 1; // не закрывается в принципе
}

/**
 * Набор с бюджетом сложности: пересобираем, пока пар не попадёт в целевое окно.
 * Это и есть «честный состав» — каждый набор одинаково труден для эталона.
 */
function drawBalancedSet(entitySigma, targetPar, tolerance = 0.5) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const set = drawSet(entitySigma);
    if (Math.abs(par(set) - targetPar) <= tolerance) return set;
  }
  return drawSet(entitySigma);
}

// --- Забег ----------------------------------------------------------------

/**
 * Играет до 100% или до потолка. Возвращает круги и достигнутый прогресс.
 * `flatHammer` заменяет случайный удар средней наградой — так изолируется вклад мини-игры.
 */
function playRun(theta, set, { flatHammer = false } = {}) {
  let progress = 0;
  for (let round = 0; round < Math.min(set.length, ROUND_CAP); round += 1) {
    if (rng() < sigmoid(theta - set[round].b)) {
      progress += flatHammer ? HAMMER_MEAN : rollHammer();
    }
    if (progress >= MAX_PROGRESS) {
      return { rounds: round + 1, progress: MAX_PROGRESS, finished: true };
    }
  }
  return { rounds: ROUND_CAP, progress, finished: false };
}

// --- Статистика -----------------------------------------------------------

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

function describe(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    mean: mean(values),
    sd: sd(values),
    p10: quantile(sorted, 0.1),
    p50: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9),
  };
}

const f = (x, d = 1) => x.toFixed(d);
const pct = (x) => `${(x * 100).toFixed(1)}%`;

function table(rows) {
  const keys = Object.keys(rows[0]);
  const width = keys.map((k) => Math.max(k.length, ...rows.map((r) => String(r[k]).length)));
  const line = (cells) => '  ' + cells.map((c, i) => String(c).padEnd(width[i])).join('  ');
  console.log(line(keys));
  console.log('  ' + width.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) console.log(line(keys.map((k) => row[k])));
}

// Уровни умения. тета = 0 — средний игрок из замера (56.6% верных).
const LEVELS = [
  { name: 'слабый   (тета -1.0)', theta: -1 },
  { name: 'ниже сред(тета -0.5)', theta: -0.5 },
  { name: 'средний  (тета  0.0)', theta: 0 },
  { name: 'выше сред(тета +0.5)', theta: 0.5 },
  { name: 'сильный  (тета +1.0)', theta: 1 },
];

const SIGMAS = [0, 0.5, 1, 1.5];
const GAPS = [0.25, 0.5, 1];

// =========================================================================
console.log('\n=== 1. Доходит ли игрок до 100% за 20 кругов ===\n');
console.log(`  Средняя награда за верный ответ: ${f(HAMMER_MEAN, 2)} очка`);
console.log(`  Эталонный круг (тета 0): ${f(sigmoid(0 - 0) * 0 + mean(FORMATS.map((x) => sigmoid(-x.b))) * HAMMER_MEAN, 1)} очков\n`);

for (const sigma of SIGMAS) {
  const rows = LEVELS.map((level) => {
    const rounds = [];
    let capped = 0;
    let progressWhenCapped = [];
    for (let i = 0; i < RUNS; i += 1) {
      const run = playRun(level.theta, drawSet(sigma));
      rounds.push(run.rounds);
      if (!run.finished) {
        capped += 1;
        progressWhenCapped.push(run.progress);
      }
    }
    const d = describe(rounds);
    return {
      'уровень': level.name,
      'круги p50': f(d.p50, 0),
      'p10–p90': `${f(d.p10, 0)}–${f(d.p90, 0)}`,
      'разброс sd': f(d.sd, 2),
      'не дошёл': pct(capped / RUNS),
      'прогресс если не дошёл': progressWhenCapped.length ? f(mean(progressWhenCapped), 0) + '%' : '—',
    };
  });
  console.log(`  разброс сложности стран sigma = ${sigma}`);
  table(rows);
  console.log('');
}

// =========================================================================
console.log('\n=== 2. Откуда берётся разброс результата ===\n');
console.log('  Один и тот же игрок (тета 0) на РАЗНЫХ наборах против него же на ОДНОМ наборе.');
console.log('  «sd внутри игрока» = ответы + удар на фиксированном наборе.\n');

{
  const rows = SIGMAS.map((sigma) => {
    const varied = [];
    for (let i = 0; i < RUNS; i += 1) varied.push(playRun(0, drawSet(sigma)).rounds);

    rng = mulberry32(777);
    const fixedSet = drawSet(sigma);
    const fixed = [];
    for (let i = 0; i < RUNS; i += 1) fixed.push(playRun(0, fixedSet).rounds);

    // Тот же фиксированный набор, но удар заменён средней наградой:
    // остаётся только случайность самих ответов.
    rng = mulberry32(777);
    const noHammer = [];
    for (let i = 0; i < RUNS; i += 1) noHammer.push(playRun(0, fixedSet, { flatHammer: true }).rounds);

    const sdVaried = sd(varied);
    const sdFixed = sd(fixed);
    const sdAnswers = sd(noHammer);
    // Дисперсия складывается: вклад = разница квадратов sd.
    const sdSet = Math.sqrt(Math.max(0, sdVaried ** 2 - sdFixed ** 2));
    const sdHammer = Math.sqrt(Math.max(0, sdFixed ** 2 - sdAnswers ** 2));
    const total = sdVaried ** 2;
    return {
      'sigma': sigma,
      'sd всего': f(sdVaried, 2),
      'вклад набора': pct(sdSet ** 2 / total),
      'вклад молотка': pct(sdHammer ** 2 / total),
      'вклад ответов': pct(sdAnswers ** 2 / total),
    };
  });
  table(rows);
}

// =========================================================================
console.log('\n\n=== 2b. Что будет, если сузить награду молотка ===\n');
console.log('  Та же модель, удар заменён средней наградой (мини-игра перестаёт быть лотереей).\n');

{
  const rows = [];
  for (const flat of [false, true]) {
    const row = { 'молоток': flat ? 'фиксированный 21.5' : 'как сейчас 25/18/12/5/0' };
    for (const gap of GAPS) {
      let correct = 0;
      let ties = 0;
      for (let i = 0; i < RUNS; i += 1) {
        const setA = drawSet(1);
        const setB = drawSet(1);
        const runA = playRun(gap / 2, setA, { flatHammer: flat });
        const runB = playRun(-gap / 2, setB, { flatHammer: flat });
        const scoreA = runA.rounds / par(setA);
        const scoreB = runB.rounds / par(setB);
        if (scoreA === scoreB) ties += 1;
        else if (scoreA < scoreB) correct += 1;
      }
      row[`разница ${gap}`] = `${pct(correct / RUNS)} (ничьи ${pct(ties / RUNS)})`;
    }
    rows.push(row);
  }
  table(rows);
}

// =========================================================================
console.log('\n\n=== 3. Варианты сравнения: как часто побеждает действительно сильнейший ===\n');
console.log('  Пара игроков с разницей умения. A играет свой набор, B — свой (реванш на новых вопросах).');
console.log('  «правильный исход» = выиграл тот, у кого тета выше.\n');

const VARIANTS = {
  'A. сырые круги': (setA, setB, runA, runB) => [runA.rounds, runB.rounds],
  'B. набор по бюджету': (setA, setB, runA, runB) => [runA.rounds, runB.rounds],
  'C. круги / пар набора': (setA, setB, runA, runB) => [runA.rounds / par(setA), runB.rounds / par(setB)],
  'D. бюджет + пар': (setA, setB, runA, runB) => [runA.rounds / par(setA), runB.rounds / par(setB)],
};

for (const sigma of [0.5, 1, 1.5]) {
  const rows = [];
  for (const variant of Object.keys(VARIANTS)) {
    const balanced = variant.startsWith('B') || variant.startsWith('D');
    const row = { 'вариант': variant };
    for (const gap of GAPS) {
      let correct = 0;
      let ties = 0;
      for (let i = 0; i < RUNS; i += 1) {
        const thetaA = gap / 2;
        const thetaB = -gap / 2;
        const setA = balanced ? drawBalancedSet(sigma, 9) : drawSet(sigma);
        const setB = balanced ? drawBalancedSet(sigma, 9) : drawSet(sigma);
        const runA = playRun(thetaA, setA);
        const runB = playRun(thetaB, setB);
        const [scoreA, scoreB] = VARIANTS[variant](setA, setB, runA, runB);
        if (scoreA === scoreB) ties += 1;
        else if (scoreA < scoreB) correct += 1;
      }
      row[`разница ${gap}`] = `${pct(correct / RUNS)} (ничьи ${pct(ties / RUNS)})`;
    }
    rows.push(row);
  }
  console.log(`  sigma = ${sigma}`);
  table(rows);
  console.log('');
}

// =========================================================================
console.log('\n=== 4. Сходимость рейтинга ===\n');
console.log('  Elo, K=32, старт 1000. 200 игроков, тета ~ N(0, 0.6). Корреляция рейтинга с истинным умением.\n');

{
  const PLAYERS = 200;
  const sigma = 1;
  const checkpoints = [5, 10, 20, 40, 80, 160];
  const rows = [];

  for (const variant of ['A. сырые круги', 'D. бюджет + пар']) {
    const balanced = variant.startsWith('D');
    rng = mulberry32(4242);
    const thetas = Array.from({ length: PLAYERS }, () => gauss() * 0.6);
    const ratings = new Array(PLAYERS).fill(1000);
    const row = { 'вариант': variant };
    let games = 0;

    for (const checkpoint of checkpoints) {
      while (games < checkpoint) {
        for (let a = 0; a < PLAYERS; a += 1) {
          const b = Math.floor(rng() * PLAYERS);
          if (b === a) continue;
          const setA = balanced ? drawBalancedSet(sigma, 9) : drawSet(sigma);
          const setB = balanced ? drawBalancedSet(sigma, 9) : drawSet(sigma);
          const runA = playRun(thetas[a], setA);
          const runB = playRun(thetas[b], setB);
          const scoreA = balanced ? runA.rounds / par(setA) : runA.rounds;
          const scoreB = balanced ? runB.rounds / par(setB) : runB.rounds;
          const actual = scoreA === scoreB ? 0.5 : scoreA < scoreB ? 1 : 0;
          const expected = 1 / (1 + 10 ** ((ratings[b] - ratings[a]) / 400));
          const delta = 32 * (actual - expected);
          ratings[a] += delta;
          ratings[b] -= delta;
        }
        games += 1;
      }
      // Корреляция Пирсона рейтинга с истинной тетой.
      const mt = mean(thetas);
      const mr = mean(ratings);
      let cov = 0;
      let vt = 0;
      let vr = 0;
      for (let i = 0; i < PLAYERS; i += 1) {
        cov += (thetas[i] - mt) * (ratings[i] - mr);
        vt += (thetas[i] - mt) ** 2;
        vr += (ratings[i] - mr) ** 2;
      }
      row[`${checkpoint} партий`] = f(cov / Math.sqrt(vt * vr), 2);
    }
    rows.push(row);
  }
  table(rows);
}

console.log('');

// =========================================================================
console.log('\n=== 5. Длина партии против цен на вопросы ===\n');
console.log('  Шум падает как 1/корень(круги), поэтому длина партии — отдельный рычаг.');
console.log('  Цель = сколько очков надо набрать, потолок = 2.5 x ожидаемых кругов.\n');

{
  const sigma = 1;
  const rows = [];
  for (const target of [100, 150, 200, 300]) {
    const expectedRounds = target / (mean(FORMATS.map((x) => sigmoid(-x.b))) * HAMMER_MEAN);
    const cap = Math.ceil(expectedRounds * 2.5);
    const row = {
      'цель': `${target} очков`,
      'кругов у среднего': f(expectedRounds, 0),
      'потолок': cap,
    };

    const play = (theta, set) => {
      let progress = 0;
      for (let round = 0; round < Math.min(set.length, cap); round += 1) {
        if (rng() < sigmoid(theta - set[round].b)) progress += rollHammer();
        if (progress >= target) return { rounds: round + 1, finished: true };
      }
      return { rounds: cap, finished: false };
    };
    const parFor = (set) => {
      let progress = 0;
      for (let i = 0; i < set.length; i += 1) {
        progress += sigmoid(-set[i].b) * HAMMER_MEAN;
        if (progress >= target) return i + 1;
      }
      return set.length + 1;
    };

    for (const gap of GAPS) {
      let correct = 0;
      let unfinished = 0;
      for (let i = 0; i < RUNS; i += 1) {
        const setA = drawSet(sigma, cap);
        const setB = drawSet(sigma, cap);
        const runA = play(gap / 2, setA);
        const runB = play(-gap / 2, setB);
        if (!runA.finished || !runB.finished) unfinished += 1;
        const scoreA = runA.rounds / parFor(setA);
        const scoreB = runB.rounds / parFor(setB);
        if (scoreA < scoreB) correct += 1;
        else if (scoreA === scoreB) correct += 0.5;
      }
      row[`разница ${gap}`] = pct(correct / RUNS);
    }
    rows.push(row);
  }
  table(rows);
}

console.log('');
