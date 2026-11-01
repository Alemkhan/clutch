// Local-only editor for authored single questions. Importing this module never starts a server.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { ROOT, TOPICS, hash, sameText, withVariants } from './lib.mjs';

const DIFFICULTIES = ['Easy', 'Medium', 'Hard', 'Expert'];
const DIFFICULTY_LABELS = { Easy:'Лёгкая', Medium:'Средняя', Hard:'Сложная', Expert:'Экспертная' };
const TOPIC_LABELS = { science:'Наука', space:'Космос', nature:'Природа', body:'Человеческое тело', history:'История', literature:'Литература', art:'Искусство', music:'Музыка', film:'Кино', popculture:'Поп-культура', sport:'Спорт', food:'Еда', math:'Математика', language:'Языки', tech:'Технологии', world:'Мир', kazakhstan:'Казахстан' };
const HTML = String.raw`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Новый вопрос · Clutch</title><style>
:root{font:16px system-ui;color:#19232d;background:#f4f6f8}*{box-sizing:border-box}body{margin:auto;padding:20px;max-width:760px}h1{margin:.2em 0}p{line-height:1.45}.notice{background:#fff4d6;padding:12px;border-radius:10px}form,.preview{display:grid;gap:12px;background:white;padding:16px;border-radius:14px;margin:14px 0}label{display:grid;gap:5px;font-weight:600}input,select,textarea,button{font:inherit;padding:10px;border:1px solid #bbc5ce;border-radius:8px;width:100%}textarea{min-height:76px}button{background:#174d70;color:white;font-weight:700;border:0;cursor:pointer}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.status{min-height:1.5em}.preview{border:1px solid #d9e0e5}.muted{color:#56616b}details{border:1px solid #d9e0e5;border-radius:10px;padding:10px}summary{font-weight:700;cursor:pointer;padding:4px}details[open] summary{margin-bottom:10px}#card{white-space:pre-line}@media(max-width:520px){body{padding:12px}.grid{grid-template-columns:1fr}}
</style><body><h1>Новый вопрос</h1><p class="notice"><b>Своя формулировка:</b> если идея пришла из YouTube, не копируйте вопрос дословно. Укажите ролик и источник, затем самостоятельно сформулируйте вопрос и проверьте факт.</p><form id="f"><div class="grid"><label>Тема<select name="topic" required>${TOPICS.map(t=>`<option value="${t}">${TOPIC_LABELS[t]}</option>`).join('')}</select></label><label>Сложность<select name="difficulty">${DIFFICULTIES.map(d=>`<option value="${d}">${DIFFICULTY_LABELS[d]}</option>`).join('')}</select></label></div><label>Вопрос<textarea name="promptRu" required></textarea></label><label>Правильный ответ<input name="answerRu" required></label><div class="grid"><label>Неверный вариант 1<input name="d1" required></label><label>Неверный вариант 2<input name="d2" required></label><label>Неверный вариант 3<input name="d3" required></label><label><span>Можно отвечать вводом</span><select name="openAnswer"><option value="true">Да</option><option value="false">Нет</option></select></label></div><label>URL источника<input name="sourceUrl" type="url" required></label><label>Название источника / ролика<input name="sourceTitle" required></label><details><summary>Дополнительные поля</summary><label>Допустимые ответы на русском, по одному в строке<textarea name="acceptedRu"></textarea></label><label>Допустимые ответы на английском, по одному в строке<textarea name="acceptedEn"></textarea></label><label>Пояснение (необязательно)<textarea name="explanationRu"></textarea></label><label>Подсказка для проверки источника<textarea name="sourceHint"></textarea></label><label>Заметка редактору<textarea name="reviewNote"></textarea></label></details><button>Сохранить как pending</button></form><section class="preview"><b>Предпросмотр</b><div id="card" class="muted">Заполните вопрос и ответ.</div></section><p id="status" class="status" role="status"></p><script>
const f=document.querySelector('#f'), card=document.querySelector('#card'), status=document.querySelector('#status');function vals(){return Object.fromEntries(new FormData(f))}function preview(){const v=vals();card.textContent=[v.promptRu||'Вопрос',v.answerRu?'Ответ: '+v.answerRu:'',...['d1','d2','d3'].map((k,i)=>v[k]?'Вариант '+(i+1)+': '+v[k]:'')].filter(Boolean).join('\n')}f.addEventListener('input',preview);f.addEventListener('submit',async e=>{e.preventDefault();status.textContent='Сохраняем…';try{const r=await fetch('/api/questions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(vals())});const data=await r.json();if(!r.ok)throw Error(data.error||'Не удалось сохранить');status.textContent='Сохранено: '+data.id+' · pending. Можно добавить следующий вопрос.';f.reset();preview()}catch(err){status.textContent='Ошибка: '+err.message}});preview();
</script></body></html>`;

const lines = (value) => String(value ?? '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
const required = (v, label) => { if (typeof v !== 'string' || !v.trim()) throw new Error(`Заполните поле «${label}».`); return v.trim(); };

export function buildQuestion(input) {
  if (!input || typeof input !== 'object') throw new Error('Некорректные данные формы.');
  const topic = required(input.topic, 'Тема');
  if (!TOPICS.includes(topic)) throw new Error('Неизвестная тема.');
  const difficulty = required(input.difficulty, 'Сложность');
  if (!DIFFICULTIES.includes(difficulty)) throw new Error('Неизвестная сложность.');
  const promptRu = required(input.promptRu, 'Вопрос');
  const answerRu = required(input.answerRu, 'Правильный ответ');
  const distractorsRu = Array.isArray(input.distractorsRu) ? input.distractorsRu.map(x => String(x).trim()) : [input.d1,input.d2,input.d3].map(x => String(x ?? '').trim());
  if (distractorsRu.length !== 3 || distractorsRu.some(x => !x)) throw new Error('Нужно указать ровно три неверных варианта.');
  const acceptedRu = withVariants([answerRu, ...lines(input.acceptedRu)]);
  const acceptedEn = lines(input.acceptedEn);
  if (new Set(distractorsRu.map(sameText)).size !== 3 || distractorsRu.some(d => acceptedRu.some(a => sameText(a) === sameText(d)))) throw new Error('Неверные варианты должны быть разными и не совпадать с правильным ответом.');
  let sourceUrl;
  try { sourceUrl = new URL(required(input.sourceUrl, 'URL источника')).href; if (!['http:','https:'].includes(new URL(sourceUrl).protocol)) throw Error(); }
  catch { throw new Error('Укажите корректный HTTP(S) URL источника.'); }
  const sourceTitle = required(input.sourceTitle, 'Название источника / ролика');
  const record = { id:`au-${topic}-${hash(promptRu)}`, editorialStatus:'pending', kind:'single', topic, difficulty, promptRu, answerRu, acceptedRu, ...(acceptedEn.length ? {acceptedEn} : {}), distractorsRu, openAnswer: input.openAnswer !== 'false' && input.openAnswer !== false, sourceUrl, sourceTitle, origin:'authored', license:'original' };
  for (const k of ['explanationRu','sourceHint','reviewNote']) if (typeof input[k] === 'string' && input[k].trim()) record[k] = input[k].trim();
  return record;
}

export async function appendQuestion(record, { contentDir = path.join(ROOT, 'content') } = {}) {
  if (!TOPICS.includes(record?.topic)) throw new Error('Неизвестная тема.');
  const dir = path.resolve(contentDir, 'questions');
  const file = path.resolve(dir, `${record.topic}.json`);
  if (path.dirname(file) !== dir) throw new Error('Недопустимый путь темы.');
  fs.mkdirSync(dir, { recursive: true });
  const lock = `${file}.builder.lock`;
  let lockFd;
  try { lockFd = fs.openSync(lock, 'wx'); } catch { throw new Error('Файл темы занят другим сохранением. Повторите попытку.'); }
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    const entries = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
    if (!Array.isArray(entries)) throw new Error('Файл вопросов темы имеет неверный формат.');
    if (entries.some(x => sameText(x.promptRu ?? '') === sameText(record.promptRu))) throw new Error('Такой вопрос уже есть в этой теме.');
    const ids = new Set(entries.map(x => x.id));
    let candidate = record.id, n = 2;
    while (ids.has(candidate)) candidate = `${record.id}-${n++}`;
    const saved = { ...record, id:candidate };
    const fd = fs.openSync(temp, 'wx');
    try { fs.writeFileSync(fd, JSON.stringify([...entries, saved], null, 2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, file);
    return saved;
  } finally {
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch {}
    try { fs.closeSync(lockFd); } catch {}
    try { fs.unlinkSync(lock); } catch {}
  }
}

export function createQuestionBuilderServer({ contentDir = path.join(ROOT, 'content'), host = '127.0.0.1', port = 4179 } = {}) {
  if (!['127.0.0.1','::1','localhost'].includes(host)) throw new Error('Конструктор разрешено привязывать только к loopback.');
  const server = http.createServer(async (req, res) => {
    const send = (code, value, type='application/json; charset=utf-8') => { res.writeHead(code, {'content-type':type,'cache-control':'no-store'}); res.end(type.startsWith('text/html') ? value : JSON.stringify(value)); };
    if (req.method === 'GET' && req.url === '/') return send(200, HTML, 'text/html; charset=utf-8');
    if (req.method !== 'POST' || req.url !== '/api/questions') return send(404, {error:'Страница не найдена.'});
    const mime = String(req.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
    if (mime !== 'application/json') { req.resume(); return send(415, {error:'Ожидается Content-Type: application/json.'}); }
    const address = server.address();
    const expectedOrigin = address && typeof address === 'object' ? `http://127.0.0.1:${address.port}` : '';
    if (req.headers.origin && req.headers.origin !== expectedOrigin) { req.resume(); return send(403, {error:'Запрос с другого origin отклонён.'}); }
    let raw = ''; req.setEncoding('utf8');
    let tooLarge = false;
    req.on('data', chunk => {
      if (tooLarge) return;
      raw += chunk;
      if (Buffer.byteLength(raw, 'utf8') > 100_000) { tooLarge = true; raw = ''; send(413, {error:'Размер запроса превышает 100 КБ.'}); }
    });
    req.on('end', async () => {
      if (tooLarge) return;
      try { const record = buildQuestion(JSON.parse(raw)); const saved = await appendQuestion(record, {contentDir}); send(201, {id:saved.id}); }
      catch (e) { send(400, {error:e.message || 'Не удалось сохранить вопрос.'}); }
    });
  });
  return server.listen(port, host);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const portArg = Number(process.env.CONTENT_BUILDER_PORT || 4179);
  const server = createQuestionBuilderServer({ port:portArg });
  server.on('listening', () => console.log(`Конструктор открыт: http://127.0.0.1:${portArg}`));
}
