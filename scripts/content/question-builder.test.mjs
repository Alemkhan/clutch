import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendQuestion, buildQuestion, createQuestionBuilderServer } from './question-builder.mjs';

const input = { topic:'science', difficulty:'Medium', promptRu:'Какой газ преобладает в атмосфере Земли?', answerRu:'Азот', acceptedRu:'N₂\nАзот', acceptedEn:'Nitrogen', d1:'Кислород', d2:'Аргон', d3:'Углекислый газ', openAnswer:'true', sourceUrl:'https://youtube.com/watch?v=abc', sourceTitle:'Научный ролик' };
let temp;
afterEach(() => { if (temp) fs.rmSync(temp, {recursive:true, force:true}); temp = undefined; });
const fixture = () => { temp = fs.mkdtempSync(path.join(os.tmpdir(), 'clutch-builder-')); return path.join(temp, 'content'); };

describe('local question builder', () => {
  it('creates a pending authored/original question and appends atomically without changing records', async () => {
    const contentDir = fixture(); fs.mkdirSync(path.join(contentDir,'questions'), {recursive:true});
    const initial = [{id:'legacy', promptRu:'Existing'}];
    fs.writeFileSync(path.join(contentDir,'questions/science.json'), JSON.stringify(initial));
    const record = buildQuestion(input); const saved = await appendQuestion(record, {contentDir});
    expect(saved).toMatchObject({editorialStatus:'pending',origin:'authored',license:'original',kind:'single'});
    expect(saved.id).toMatch(/^au-science-/);
    const records = JSON.parse(fs.readFileSync(path.join(contentDir,'questions/science.json'),'utf8'));
    expect(records[0]).toEqual(initial[0]); expect(records).toHaveLength(2);
    await expect(appendQuestion(record, {contentDir})).rejects.toThrow(/уже есть/);
  });

  it('rejects invalid fields, wrong choices, and traversal topics', () => {
    expect(() => buildQuestion({...input, topic:'../science'})).toThrow(/тема/i);
    expect(() => buildQuestion({...input, d3:''})).toThrow(/ровно три/);
    expect(() => buildQuestion({...input, sourceTitle:''})).toThrow(/Название источника/);
    expect(() => buildQuestion({...input, sourceUrl:'file:///etc/passwd'})).toThrow(/HTTP/);
  });

  it('only binds to loopback and serves the form over HTTP', async () => {
    expect(() => createQuestionBuilderServer({host:'0.0.0.0'})).toThrow(/loopback/);
    const server = createQuestionBuilderServer({contentDir:fixture(), port:0});
    await new Promise(resolve => server.once('listening', resolve));
    try {
      const address = server.address(); const response = await fetch(`http://127.0.0.1:${address.port}/`);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('не копируйте вопрос дословно');
      expect(html).toContain('<option value="science">Наука</option>');
      expect(html).toContain('<option value="Medium">Средняя</option>');
      expect(html).toContain('<details><summary>Дополнительные поля</summary>');
      expect(html).toContain('details{border:1px solid');
      const detailsAt = html.indexOf('<details>');
      const detailsEnd = html.indexOf('</details>', detailsAt);
      for (const field of ['name="d1" required','name="d2" required','name="d3" required','name="openAnswer"','name="sourceUrl" type="url" required','name="sourceTitle" required']) {
        expect(html.indexOf(field), field).toBeLessThan(detailsAt);
      }
      for (const field of ['name="acceptedRu"','name="acceptedEn"','name="explanationRu"','name="sourceHint"','name="reviewNote"']) {
        expect(html.indexOf(field), field).toBeGreaterThan(detailsAt);
        expect(html.indexOf(field), field).toBeLessThan(detailsEnd);
      }
      expect(html.indexOf('<button>')).toBeGreaterThan(detailsEnd);
      expect(html).toContain("join('\\n')");
      expect(html).not.toContain("join('\\\\n')");
      expect(html).toContain('#card{white-space:pre-line}');
      const post = await fetch(`http://127.0.0.1:${address.port}/api/questions`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
      expect(post.status).toBe(201);
      const saved = JSON.parse(fs.readFileSync(path.join(temp,'content/questions/science.json'),'utf8'))[0];
      expect(saved).toMatchObject({editorialStatus:'pending',origin:'authored',license:'original',sourceTitle:'Научный ролик'});
      expect(saved.id).toMatch(/^au-science-/);
      const duplicate = await fetch(`http://127.0.0.1:${address.port}/api/questions`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
      expect(duplicate.status).toBe(400);
      const textPlain = await fetch(`http://127.0.0.1:${address.port}/api/questions`, {method:'POST',headers:{'content-type':'text/plain'},body:JSON.stringify({...input,promptRu:'Другой вопрос'})});
      expect(textPlain.status).toBe(415);
      const crossOrigin = await fetch(`http://127.0.0.1:${address.port}/api/questions`, {method:'POST',headers:{'content-type':'application/json','origin':'http://attacker.example'},body:JSON.stringify({...input,promptRu:'Ещё один вопрос'})});
      expect(crossOrigin.status).toBe(403);
      expect(JSON.parse(fs.readFileSync(path.join(temp,'content/questions/science.json'),'utf8'))).toHaveLength(1);
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
});
