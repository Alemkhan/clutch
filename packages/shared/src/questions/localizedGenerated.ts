/**
 * Вопросы генераторов (флаги, столицы, контуры, языки, «Другие флаги») на языке игрока.
 * Генератор собирает вопрос по-русски; здесь тот же вопрос пересказывается шаблоном нужного языка,
 * а названия берутся из переводов content/i18n/<locale>/{countries,languages,historic-flags,other-flags}.json.
 * Id вопроса, порядок и id вариантов не меняются - только текст.
 */
import enCountries from '../../../../content/i18n/en/countries.json';
import kkCountries from '../../../../content/i18n/kk/countries.json';
import enLanguages from '../../../../content/i18n/en/languages.json';
import kkLanguages from '../../../../content/i18n/kk/languages.json';
import enHistoric from '../../../../content/i18n/en/historic-flags.json';
import kkHistoric from '../../../../content/i18n/kk/historic-flags.json';
import enOther from '../../../../content/i18n/en/other-flags.json';
import kkOther from '../../../../content/i18n/kk/other-flags.json';
import type { Question } from '../index';
import type { Locale } from '../i18n/locale';
import { countries } from './countries';
import { historicFlags } from './historicFlags';
import { languages } from './languages';

type Translated = Exclude<Locale, 'ru'>;
type CountryText = { name: string; capital: string };
type LanguageText = { name: string; fact: string };
type HistoricText = { label: string; era: string; fact: string };

const COUNTRY_TEXT: Record<Translated, Record<string, CountryText>> = { en: enCountries, kk: kkCountries };
const LANGUAGE_TEXT: Record<Translated, Record<string, LanguageText>> = { en: enLanguages, kk: kkLanguages };
const HISTORIC_TEXT: Record<Translated, Record<string, HistoricText>> = { en: enHistoric, kk: kkHistoric };
const OTHER_TEXT: Record<Translated, Record<string, { label: string }>> = { en: enOther, kk: kkOther };

const countryByCode = new Map(countries.map((country) => [country.code, country]));
const countryByNameRu = new Map(countries.map((country) => [country.nameRu, country]));
const countryByCapitalRu = new Map(countries.map((country) => [country.capitalRu, country]));
const languageById = new Map(languages.map((language) => [language.id, language]));
const languageByNameRu = new Map(languages.map((language) => [language.nameRu, language]));
const flagById = new Map(historicFlags.map((flag) => [flag.id, flag]));
const flagByOptionRu = new Map(historicFlags.map((flag) => [`${flag.labelRu} (${flag.era})`, flag]));

const KIND: Record<Translated, { flag: string; coat: string }> = {
  en: { flag: 'Flag of', coat: 'Coat of arms of' },
  kk: { flag: 'туы', coat: 'елтаңбасы' },
};

const ERA_CURRENT: Record<Translated, string> = { en: 'current', kk: 'қазіргі' };

/** Подпись символа: «Флаг Алматы (действует)» → «Flag of Almaty (current)». */
function flagLabel(flag: (typeof historicFlags)[number], locale: Translated): { label: string; era: string } | null {
  if (flag.inventoryId) {
    const place = OTHER_TEXT[locale][flag.inventoryId]?.label;
    if (!place) return null;
    const kind = KIND[locale][flag.assetKind === 'coat_of_arms' ? 'coat' : 'flag'];
    const label = locale === 'en' ? `${kind} ${place}` : `${place} ${kind}`;
    return { label, era: flag.era === 'действует' ? ERA_CURRENT[locale] : flag.era };
  }
  const t = HISTORIC_TEXT[locale][flag.id];
  return t ? { label: t.label, era: t.era } : null;
}

function countryName(code: string, locale: Translated): string | null {
  return COUNTRY_TEXT[locale][code]?.name ?? null;
}

function capitalName(code: string, locale: Translated): string | null {
  return COUNTRY_TEXT[locale][code]?.capital ?? null;
}

const PROMPTS: Record<Translated, {
  flagCountry: string;
  capital: (country: string) => string;
  flagCapital: string;
  outline: string;
  openOutline: string;
  openCapital: (country: string) => string;
  openFlag: string;
  symbol: string;
  flag: string;
  language: string;
}> = {
  en: {
    flagCountry: 'Which country’s flag is this?',
    capital: (country) => `What is the capital of ${country}?`,
    flagCapital: 'What is the capital of the country with this flag?',
    outline: 'Which country has this shape?',
    openOutline: 'Type the country with this outline:',
    openCapital: (country) => `Type the capital of ${country}.`,
    openFlag: 'Type the country with this flag:',
    symbol: 'Which symbol is this?',
    flag: 'Which flag is this?',
    language: 'Which language is this?',
  },
  kk: {
    flagCountry: 'Бұл қай елдің туы?',
    capital: (country) => `${country} елінің астанасы қай қала?`,
    flagCapital: 'Туы осындай елдің астанасы қай қала?',
    outline: 'Қай елдің пішіні осындай?',
    openOutline: 'Осы пішіндегі елдің атауын жазыңыз:',
    openCapital: (country) => `${country} елінің астанасын жазыңыз.`,
    openFlag: 'Осы туы бар елдің атауын жазыңыз:',
    symbol: 'Бұл қандай рәміз?',
    flag: 'Бұл қандай ту?',
    language: 'Бұл қай тіл?',
  },
};

const EXPLAIN: Record<Translated, {
  flagOf: (country: string) => string;
  capitalOf: (country: string, capital: string) => string;
  flagAndCapital: (country: string, capital: string) => string;
  outlineOf: (country: string) => string;
  language: (name: string, fact: string) => string;
}> = {
  en: {
    flagOf: (country) => `This is the flag of ${country}.`,
    capitalOf: (country, capital) => `${country}: the capital is ${capital}.`,
    flagAndCapital: (country, capital) => `This is the flag of ${country}. The capital is ${capital}.`,
    outlineOf: (country) => `This is the outline of ${country}.`,
    language: (name, fact) => `This is ${name}. ${fact}`,
  },
  kk: {
    flagOf: (country) => `Бұл ${country} туы.`,
    capitalOf: (country, capital) => `${country}: астанасы ${capital}.`,
    flagAndCapital: (country, capital) => `Бұл ${country} туы. Астанасы: ${capital}.`,
    outlineOf: (country) => `Бұл ${country} пішіні.`,
    language: (name, fact) => `Бұл ${name}. ${fact}`,
  },
};

/** Подписи разделов на чипе вопроса (подкатегории генераторов и тем пакета). */
export const SUBCATEGORY_LABELS: Record<Translated, Record<string, string>> = {
  en: {
    'Флаги': 'Flags', 'Столицы': 'Capitals', 'Флаги и столицы': 'Flags & capitals', 'Контуры': 'Outlines',
    'Страна по контуру': 'Country by outline', 'Столица': 'Capital', 'Страна по флагу': 'Country by flag',
    'Другие флаги': 'Other flags', 'Языки': 'Languages',
    'Наука': 'Science', 'Космос': 'Space', 'Природа': 'Nature', 'Человек': 'Human body', 'История': 'History',
    'Литература': 'Literature', 'Искусство': 'Art', 'Музыка': 'Music', 'Кино и мультфильмы': 'Film & cartoons',
    'Поп-культура': 'Pop culture', 'Спорт': 'Sport', 'Еда': 'Food', 'Математика': 'Maths', 'Язык': 'Language',
    'Технологии': 'Tech', 'Мир': 'World', 'История Казахстана': 'History of Kazakhstan',
  },
  kk: {
    'Флаги': 'Тулар', 'Столицы': 'Астаналар', 'Флаги и столицы': 'Тулар мен астаналар', 'Контуры': 'Пішіндер',
    'Страна по контуру': 'Пішін бойынша ел', 'Столица': 'Астана', 'Страна по флагу': 'Ту бойынша ел',
    'Другие флаги': 'Басқа тулар', 'Языки': 'Тілдер',
    'Наука': 'Ғылым', 'Космос': 'Ғарыш', 'Природа': 'Табиғат', 'Человек': 'Адам', 'История': 'Тарих',
    'Литература': 'Әдебиет', 'Искусство': 'Өнер', 'Музыка': 'Музыка', 'Кино и мультфильмы': 'Кино мен мультфильмдер',
    'Поп-культура': 'Поп-мәдениет', 'Спорт': 'Спорт', 'Еда': 'Тағам', 'Математика': 'Математика', 'Язык': 'Тіл',
    'Технологии': 'Технология', 'Мир': 'Әлем', 'История Казахстана': 'Қазақстан тарихы',
  },
};

function codeAfter(id: string, prefix: string): string | null {
  return id.startsWith(prefix) ? id.slice(prefix.length) : null;
}

function mapOptions(question: Question, translate: (ruText: string) => string | null): Question['options'] {
  return question.options.map((option) => ({ ...option, text: translate(option.text) ?? option.text }));
}

/** Открытый ответ засчитывается на всех трёх языках: сначала язык игрока. */
function withAnswers(question: Question, localized: (string | null)[]): string[] {
  const all = [...localized, ...(question.correctAnswers ?? [])].filter((item): item is string => Boolean(item));
  return [...new Set(all)];
}

export function localizeGeneratedQuestion(question: Question, locale: Locale): Question {
  if (locale === 'ru') return question;
  const p = PROMPTS[locale];
  const e = EXPLAIN[locale];
  const subcategory = question.subcategory ? SUBCATEGORY_LABELS[locale][question.subcategory] ?? question.subcategory : undefined;
  const base = { ...question, ...(subcategory ? { subcategory } : {}) };
  const otherLocale: Translated = locale === 'en' ? 'kk' : 'en';
  const id = question.id;
  const countryOption = (ruText: string) => {
    const country = countryByNameRu.get(ruText);
    return country ? countryName(country.code, locale) : null;
  };
  const capitalOption = (ruText: string) => {
    const country = countryByCapitalRu.get(ruText);
    return country ? capitalName(country.code, locale) : null;
  };

  let code: string | null;
  if ((code = codeAfter(id, 'flag_country_')) && countryByCode.has(code)) {
    const name = countryName(code, locale) ?? '';
    return { ...base, prompt: p.flagCountry, options: mapOptions(question, countryOption), explanation: e.flagOf(name) };
  }
  if ((code = codeAfter(id, 'flag_capital_')) && countryByCode.has(code)) {
    return {
      ...base, prompt: p.flagCapital, options: mapOptions(question, capitalOption),
      explanation: e.flagAndCapital(countryName(code, locale) ?? '', capitalName(code, locale) ?? ''),
    };
  }
  if ((code = codeAfter(id, 'capital_fixed_') ?? codeAfter(id, 'open_capital_')) && countryByCode.has(code)) {
    const name = countryName(code, locale) ?? '';
    return {
      ...base, prompt: p.openCapital(name),
      correctAnswers: withAnswers(question, [capitalName(code, locale), capitalName(code, otherLocale)]),
      explanation: e.capitalOf(name, capitalName(code, locale) ?? ''),
    };
  }
  if ((code = codeAfter(id, 'capital_')) && countryByCode.has(code)) {
    const name = countryName(code, locale) ?? '';
    return {
      ...base, prompt: p.capital(name), options: mapOptions(question, capitalOption),
      explanation: e.capitalOf(name, capitalName(code, locale) ?? ''),
    };
  }
  if ((code = codeAfter(id, 'open_outline_country_') ?? codeAfter(id, 'open_flag_country_')) && countryByCode.has(code)) {
    const outline = id.startsWith('open_outline_');
    const name = countryName(code, locale) ?? '';
    return {
      ...base, prompt: outline ? p.openOutline : p.openFlag,
      correctAnswers: withAnswers(question, [name, countryName(code, otherLocale)]),
      explanation: outline ? e.outlineOf(name) : e.flagOf(name),
    };
  }
  if ((code = codeAfter(id, 'outline_country_')) && countryByCode.has(code)) {
    return { ...base, prompt: p.outline, options: mapOptions(question, countryOption), explanation: e.outlineOf(countryName(code, locale) ?? '') };
  }
  if ((code = codeAfter(id, 'lang_'))) {
    const language = languageById.get(code);
    const t = LANGUAGE_TEXT[locale][code];
    if (language && t) {
      return {
        ...base, prompt: p.language,
        options: mapOptions(question, (ruText) => {
          const other = languageByNameRu.get(ruText);
          return other ? LANGUAGE_TEXT[locale][other.id]?.name ?? null : null;
        }),
        explanation: e.language(t.name, t.fact),
      };
    }
  }
  if ((code = codeAfter(id, 'hist_flag_'))) {
    const flag = flagById.get(code);
    const label = flag ? flagLabel(flag, locale) : null;
    if (flag && label) {
      const fact = flag.inventoryId ? '' : HISTORIC_TEXT[locale][flag.id]?.fact ?? '';
      return {
        ...base,
        prompt: flag.assetKind === 'coat_of_arms' ? p.symbol : p.flag,
        options: mapOptions(question, (ruText) => {
          const other = flagByOptionRu.get(ruText);
          const text = other ? flagLabel(other, locale) : null;
          return text ? `${text.label} (${text.era})` : null;
        }),
        explanation: `${label.label}, ${label.era}.${fact ? ` ${fact}` : ''}`,
      };
    }
  }
  return base;
}
