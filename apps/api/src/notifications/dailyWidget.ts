import { createSeededRandom, hashSeed, livePackRecords, type PackQuestion, type PackRecord } from '@clutch/shared';

/**
 * Ежедневный «Вопрос дня» как HTML-виджет Telegram (Bot API 10.4, sendWidget). Ответ проверяется
 * внутри сообщения, к боту запросов нет. Правильный ответ лежит в коде виджета: для вопроса-тизера
 * это допустимо, в зачёт игры он не идёт.
 */

/** Лимиты Telegram: HTML в UTF-8 и он же после zlib level 9 (сжатие проверяет тест на всём пуле). */
export const WIDGET_MAX_HTML_BYTES = 32768;
export const WIDGET_MAX_ZLIB_BYTES = 4096;
export const WIDGET_PROMPT_MAX = 140;
export const WIDGET_OPTION_MAX = 36;

export interface DailyWidgetData {
  questionId: string;
  prompt: string;
  options: string[];
  answerIndex: number;
  explanation: string;
}

/** Одобренный вопрос, который хорошо смотрится кнопками: без картинки, короткие варианты, есть пояснение. */
export function isWidgetQuestion(record: PackRecord): record is PackQuestion & { explanationRu: string } {
  return record.kind === 'single' && Boolean(record.explanationRu) && !record.image
    && record.topic !== 'kazakhstan' && (record.difficulty === 'Easy' || record.difficulty === 'Medium')
    && record.promptRu.length <= WIDGET_PROMPT_MAX
    && [record.answerRu, ...record.distractorsRu.slice(0, 3)].every((text) => text.length <= WIDGET_OPTION_MAX)
    && record.distractorsRu.length >= 3;
}

export function widgetQuestionPool(pool: readonly PackRecord[] = livePackRecords()): PackQuestion[] {
  return pool.filter(isWidgetQuestion);
}

/** Один вопрос на день: одинаковый у всех получателей, варианты перемешаны детерминированно. */
export function dailyWidgetQuestion(dateKey: string, pool: readonly PackRecord[] = livePackRecords()): DailyWidgetData | null {
  const candidates = widgetQuestionPool(pool);
  if (!candidates.length) return null;
  const record = candidates[Math.floor(createSeededRandom(hashSeed(`widget:${dateKey}`))() * candidates.length)];
  const random = createSeededRandom(hashSeed(`widget-options:${record.id}`));
  const options = [record.answerRu, ...record.distractorsRu.slice(0, 3)];
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return {
    questionId: record.id,
    prompt: record.promptRu,
    options,
    answerIndex: options.indexOf(record.answerRu),
    explanation: record.explanationRu ?? '',
  };
}

const STYLE = `:root{--bg:var(--tg-theme-bg-color,#fff);--tx:var(--tg-theme-text-color,#111);--hint:var(--tg-theme-hint-color,#888);--btn:var(--tg-theme-secondary-bg-color,#f1f1f4);--acc:var(--tg-theme-button-color,#2a8af6);--acct:var(--tg-theme-button-text-color,#fff)}
body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.35 -apple-system,system-ui,sans-serif}
#w{padding:12px 12px calc(12px + env(safe-area-inset-bottom))}
#h{font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--hint);margin-bottom:6px}
#q{font-weight:700;font-size:16px;margin:0 0 10px}
#o{display:grid;gap:6px}
.b{display:block;width:100%;padding:10px 12px;border:0;border-radius:10px;background:var(--btn);color:var(--tx);font:inherit;text-align:left;transition:background .2s,transform .1s}
.b:active{transform:scale(.98)}
.b.ok{background:#2fb35a;color:#fff}
.b.no{background:#e5484d;color:#fff}
.b.dim{opacity:.55}
#r{margin-top:10px;font-weight:700}
#e{margin:4px 0 0;color:var(--hint);font-size:13px}
#c{margin-top:10px;width:100%;padding:11px;border:0;border-radius:10px;background:var(--acc);color:var(--acct);font:inherit;font-weight:700}`;

// Выбор хранится в localStorage сообщения: открыл заново — видит свой ответ.
const SCRIPT = `const W=window.TelegramWidget;let pick=null;
try{const v=localStorage.getItem('pick');if(v!==null)pick=Number(v)}catch(e){}
const $=(id)=>document.getElementById(id);
function render(){$('q').textContent=D.q;const box=$('o');box.innerHTML='';
D.o.forEach((text,i)=>{const b=document.createElement('button');
b.className='b'+(pick===null?'':i===D.a?' ok':i===pick?' no':' dim');b.textContent=text;
b.addEventListener('click',()=>choose(i));box.appendChild(b)});
const z=$('z');z.innerHTML='';if(pick===null)return;
const r=document.createElement('div');r.id='r';r.textContent=pick===D.a?'Верно! 🔥':'Мимо. Правильно: '+D.o[D.a];
const e=document.createElement('p');e.id='e';e.textContent=D.e;
const c=document.createElement('button');c.id='c';c.textContent='Играть дальше →';
c.addEventListener('click',()=>{if(W)W.openTelegramLink(D.l)});z.append(r,e,c)}
function choose(i){if(pick!==null)return;pick=i;
try{localStorage.setItem('pick',String(i))}catch(e){}
try{if(W)W.HapticFeedback.notificationOccurred(i===D.a?'success':'error')}catch(e){}
render()}
render();if(W)W.ready();`;

/** HTML виджета. Данные идут JSON-ом в <script>, «</» экранируется, чтобы не закрыть тег. */
export function buildDailyWidgetHtml(data: DailyWidgetData, playLink: string): string {
  const payload = JSON.stringify({ q: data.prompt, o: data.options, a: data.answerIndex, e: data.explanation, l: playLink })
    .replace(/<\//g, '<\\/');
  return `<style>${STYLE}</style><div id="w"><div id="h">Вопрос дня · Clutch</div><p id="q"></p><div id="o"></div><div id="z"></div></div><script>const D=${payload};${SCRIPT}</script>`;
}
