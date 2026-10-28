/**
 * Узкие категории стран для Last Stand. Берём только бесспорный состав: он закреплён
 * документом или официальным списком организации. Поэтому нет «Скандинавии» — у неё
 * три разных определения, — и нет xk/ps/tw/il и спорных территорий.
 * `titleRu` показывается игроку как есть, вопрос вокруг него собирает режим.
 */
export interface NarrowCategory {
  id: string;
  titleRu: string;
  /** Коды стран из `countries.ts`. */
  countryCodes: string[];
  sourceUrl: string;
  sourceTitle: string;
  lastVerifiedAt: string;
}

export const NARROW_CATEGORY_MIN_MEMBERS = 2;
export const NARROW_CATEGORY_MAX_MEMBERS = 6;

export const narrowCategories: NarrowCategory[] = [
  {
    id: 'two-koreas',
    titleRu: 'Две Кореи',
    countryCodes: ['kp', 'kr'],
    sourceUrl: 'https://www.un.org/en/about-us/member-states',
    sourceTitle: 'United Nations: Member States (KP и KR, оба приняты 17.09.1991)',
    lastVerifiedAt: '2026-10-08',
  },
  {
    id: 'benelux',
    titleRu: 'Страны Бенилюкса',
    countryCodes: ['be', 'nl', 'lu'],
    sourceUrl: 'https://www.benelux.int/',
    sourceTitle: 'Benelux Union: официальный сайт',
    lastVerifiedAt: '2026-10-08',
  },
  {
    id: 'baltic-assembly',
    titleRu: 'Страны Балтийской ассамблеи',
    countryCodes: ['ee', 'lv', 'lt'],
    sourceUrl: 'https://baltasam.org/about-us/how-do-we-work',
    sourceTitle: 'Baltic Assembly: How do we work?',
    lastVerifiedAt: '2026-10-08',
  },
  {
    id: 'visegrad-group',
    titleRu: 'Страны Вышеградской группы: Центральная Европа',
    countryCodes: ['cz', 'hu', 'pl', 'sk'],
    sourceUrl: 'https://www.visegradfund.org/news/30th-anniversary-visegrad-group',
    sourceTitle: 'International Visegrad Fund: 30th anniversary of the Visegrad Group',
    lastVerifiedAt: '2026-10-08',
  },
  {
    id: 'nordic-council',
    titleRu: 'Страны Северного совета',
    countryCodes: ['dk', 'fi', 'is', 'no', 'se'],
    sourceUrl: 'https://www.riksdagen.se/en/how-the-riksdag-works/the-international-work-of-the-riksdag/parliamentary-assemblies/the-nordic-council/',
    sourceTitle: 'Sveriges riksdag: The Nordic Council',
    lastVerifiedAt: '2026-10-08',
  },
  {
    id: 'usmca',
    titleRu: 'Страны Северной Америки: США, Мексика, Канада',
    countryCodes: ['us', 'mx', 'ca'],
    sourceUrl: 'https://ustr.gov/trade-agreements/free-trade-agreements/united-states-mexico-canada-agreement',
    sourceTitle: 'USTR: United States-Mexico-Canada Agreement',
    lastVerifiedAt: '2026-10-08',
  },
  {
    id: 'eaeu',
    titleRu: 'Страны Евразийского экономического союза',
    countryCodes: ['am', 'by', 'kz', 'kg', 'ru'],
    sourceUrl: 'https://eaeunion.org/',
    sourceTitle: 'Евразийский экономический союз: официальный сайт (государства-члены)',
    lastVerifiedAt: '2026-10-08',
  },
  // Состав верен, но не заведены: Испаньола (ht+do) и Тимор (tl+id) слишком нишевые,
  // Новая Гвинея (pg+id) задевает спор о западной части острова.
];
