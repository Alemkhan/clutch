// Loads the pack from content/questions/*.json and content/sets/*.json and checks every record's shape,
// so a broken edit fails tests and server start instead of reaching a player.
// A new topic needs its two files below and an entry in PackTopic.
import type { PackQuestion, PackSet, PackSetMember, PackTopic } from './types';

import artQ from '../../../../content/questions/art.json';
import bodyQ from '../../../../content/questions/body.json';
import filmQ from '../../../../content/questions/film.json';
import foodQ from '../../../../content/questions/food.json';
import historyQ from '../../../../content/questions/history.json';
import kazakhstanQ from '../../../../content/questions/kazakhstan.json';
import languageQ from '../../../../content/questions/language.json';
import literatureQ from '../../../../content/questions/literature.json';
import mathQ from '../../../../content/questions/math.json';
import musicQ from '../../../../content/questions/music.json';
import natureQ from '../../../../content/questions/nature.json';
import popcultureQ from '../../../../content/questions/popculture.json';
import scienceQ from '../../../../content/questions/science.json';
import spaceQ from '../../../../content/questions/space.json';
import sportQ from '../../../../content/questions/sport.json';
import techQ from '../../../../content/questions/tech.json';
import worldQ from '../../../../content/questions/world.json';

import artS from '../../../../content/sets/art.json';
import bodyS from '../../../../content/sets/body.json';
import filmS from '../../../../content/sets/film.json';
import foodS from '../../../../content/sets/food.json';
import historyS from '../../../../content/sets/history.json';
import kazakhstanS from '../../../../content/sets/kazakhstan.json';
import languageS from '../../../../content/sets/language.json';
import literatureS from '../../../../content/sets/literature.json';
import mathS from '../../../../content/sets/math.json';
import musicS from '../../../../content/sets/music.json';
import natureS from '../../../../content/sets/nature.json';
import popcultureS from '../../../../content/sets/popculture.json';
import scienceS from '../../../../content/sets/science.json';
import spaceS from '../../../../content/sets/space.json';
import sportS from '../../../../content/sets/sport.json';
import techS from '../../../../content/sets/tech.json';
import worldS from '../../../../content/sets/world.json';

const QUESTION_FILES: Record<PackTopic, unknown> = {
  science: scienceQ, space: spaceQ, nature: natureQ, body: bodyQ, history: historyQ, literature: literatureQ,
  art: artQ, music: musicQ, film: filmQ, popculture: popcultureQ, sport: sportQ, food: foodQ, math: mathQ,
  language: languageQ, tech: techQ, world: worldQ, kazakhstan: kazakhstanQ,
};

const SET_FILES: Record<PackTopic, unknown> = {
  science: scienceS, space: spaceS, nature: natureS, body: bodyS, history: historyS, literature: literatureS,
  art: artS, music: musicS, film: filmS, popculture: popcultureS, sport: sportS, food: foodS, math: mathS,
  language: languageS, tech: techS, world: worldS, kazakhstan: kazakhstanS,
};

const DIFFICULTIES = ['Easy', 'Medium', 'Hard', 'Expert'];
const STATUSES = ['pending', 'approved', 'blocked'];
const ORIGINS = ['authored', 'wikidata', 'notebooklm'];
const LICENSES = ['CC0', 'original'];

type Json = Record<string, unknown>;

function fail(where: string, problem: string): never {
  throw new TypeError(`content ${where}: ${problem}`);
}

function text(r: Json, key: string, where: string, optional = false): void {
  const v = r[key];
  if (v === undefined && optional) return;
  if (typeof v !== 'string' || (!optional && v.trim() === '')) fail(where, `«${key}» must be a non-empty string`);
}

function texts(r: Json, key: string, where: string, min: number, optional = false): void {
  const v = r[key];
  if (v === undefined && optional) return;
  if (!Array.isArray(v) || v.length < min || v.some((x) => typeof x !== 'string' || x.trim() === '')) {
    fail(where, `«${key}» must be a list of at least ${min} non-empty strings`);
  }
}

function oneOf(r: Json, key: string, allowed: readonly string[], where: string): void {
  if (!allowed.includes(r[key] as string)) fail(where, `«${key}» must be one of ${allowed.join(', ')}`);
}

function common(r: Json, topic: PackTopic, where: string): void {
  text(r, 'id', where);
  oneOf(r, 'editorialStatus', STATUSES, where);
  if (r.topic !== topic) fail(where, `«topic» is «${String(r.topic)}» but the file is ${topic}.json`);
  oneOf(r, 'origin', ORIGINS, where);
  oneOf(r, 'license', LICENSES, where);
  for (const key of ['sourceUrl', 'sourceTitle', 'sourceHint', 'reviewNote']) text(r, key, where, true);
}

function questionsOf(topic: PackTopic, raw: unknown): PackQuestion[] {
  if (!Array.isArray(raw)) fail(`questions/${topic}.json`, 'must be a JSON array');
  return raw.map((r: Json, i) => {
    const where = `questions/${topic}.json #${i + 1} (${String(r?.id ?? 'no id')})`;
    if (r?.kind !== 'single') fail(where, '«kind» must be «single»');
    common(r, topic, where);
    oneOf(r, 'difficulty', DIFFICULTIES, where);
    text(r, 'promptRu', where);
    text(r, 'answerRu', where);
    texts(r, 'acceptedRu', where, 1);
    texts(r, 'acceptedEn', where, 1, true);
    texts(r, 'distractorsRu', where, 3);
    if (typeof r.openAnswer !== 'boolean') fail(where, '«openAnswer» must be true or false');
    text(r, 'explanationRu', where, true);
    if (r.generalPool !== undefined && (r.generalPool !== true || topic !== 'kazakhstan')) {
      fail(where, '«generalPool» is only «true» and only in kazakhstan.json');
    }
    if (r.image !== undefined) {
      const image = r.image as Json;
      // Только Commons: там лежат лишь свободные файлы, и превью отдаётся нужной ширины.
      if (typeof image?.url !== 'string' || !image.url.startsWith('https://commons.wikimedia.org/wiki/Special:FilePath/')) {
        fail(where, '«image.url» must be a Wikimedia Commons Special:FilePath link');
      }
      if (typeof image?.pageUrl !== 'string' || !image.pageUrl.startsWith('https://commons.wikimedia.org/wiki/File:')) {
        fail(where, '«image.pageUrl» must be a Wikimedia Commons file page');
      }
    }
    return r as unknown as PackQuestion;
  });
}

function setsOf(topic: PackTopic, raw: unknown): PackSet[] {
  if (!Array.isArray(raw)) fail(`sets/${topic}.json`, 'must be a JSON array');
  return raw.map((r: Json, i) => {
    const where = `sets/${topic}.json #${i + 1} (${String(r?.id ?? 'no id')})`;
    if (r?.kind !== 'set') fail(where, '«kind» must be «set»');
    common(r, topic, where);
    text(r, 'titleRu', where);
    text(r, 'mcPromptRu', where);
    texts(r, 'nonMembersRu', where, 3);
    if (!Array.isArray(r.members) || r.members.length < 2) fail(where, '«members» must list at least 2 answers');
    (r.members as Json[]).forEach((m, j) => {
      const at = `${where} member #${j + 1}`;
      text(m, 'id', at);
      text(m, 'answerRu', at);
      texts(m, 'acceptedRu', at, 1);
    });
    return { ...(r as unknown as PackSet), members: r.members as PackSetMember[] };
  });
}

const TOPICS = Object.keys(QUESTION_FILES) as PackTopic[];

export const contentQuestions: PackQuestion[] = TOPICS.flatMap((t) => questionsOf(t, QUESTION_FILES[t]));
export const contentSets: PackSet[] = TOPICS.flatMap((t) => setsOf(t, SET_FILES[t]));
