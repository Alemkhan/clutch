export interface LanguageEntry {
  script: string;
  id: string;
  nameRu: string;
  sample: string;
  factRu: string;
}

// Sample phrases are short, neutral greetings/questions chosen so the language
// is identifiable — by unique script, or by signature letters/diacritics.
export const languages: LanguageEntry[] = [
  { id: 'ka', script: 'georgian', nameRu: 'Грузинский', sample: 'გამარჯობა, როგორ ხარ?', factRu: 'Грузинское письмо не родственно никакому другому алфавиту в мире.' },
  { id: 'hy', script: 'armenian', nameRu: 'Армянский', sample: 'Բարև ձեզ, ինչպես եք?', factRu: 'Алфавит создал Месроп Маштоц в 405 году — ему больше 1600 лет.' },
  { id: 'el', script: 'greek', nameRu: 'Греческий', sample: 'Καλημέρα, τι κάνεις;', factRu: 'Первый алфавит в истории с буквами для гласных.' },
  { id: 'he', script: 'hebrew', nameRu: 'Иврит', sample: 'שלום, מה קורה?', factRu: 'Мёртвый почти 2000 лет — и возрождённый как разговорный в XX веке.' },
  { id: 'ar', script: 'arabic', nameRu: 'Арабский', sample: 'مرحبا، كيف حالك؟', factRu: 'Пишется справа налево, гласные на письме почти не отражаются.' },
  { id: 'fa', script: 'arabic', nameRu: 'Персидский (фарси)', sample: 'سلام، حال شما چطور است؟', factRu: 'Индоевропейский язык, но записанный арабской вязью.' },
  { id: 'ur', script: 'arabic', nameRu: 'Урду', sample: 'خوش آمدید، آپ کیسے ہیں؟', factRu: 'Близкий родственник хинди — но пишется персидской вязью.' },
  { id: 'hi', script: 'devanagari', nameRu: 'Хинди', sample: 'नमस्ते, आप कैसे हैं?', factRu: 'Письмо деванагари: буквы висят на общей линии сверху.' },
  { id: 'bn', script: 'bengali', nameRu: 'Бенгальский', sample: 'নমস্কার, কেমন আছেন?', factRu: 'На нём говорят больше 270 миллионов человек — топ-6 мира.' },
  { id: 'ta', script: 'tamil', nameRu: 'Тамильский', sample: 'வணக்கம், எப்படி இருக்கிறீர்கள்?', factRu: 'Живёт более 2000 лет почти без изменений — классический язык Индии.' },
  { id: 'si', script: 'sinhala', nameRu: 'Сингальский', sample: 'ආයුබෝවන්, ඔබ කොහොමද?', factRu: 'Язык Шри-Ланки с почти круглыми буквами.' },
  { id: 'th', script: 'thai', nameRu: 'Тайский', sample: 'สวัสดีครับ, คุณเป็นอย่างไรบ้าง', factRu: 'Пять тонов и письмо без пробелов между словами.' },
  { id: 'lo', script: 'lao', nameRu: 'Лаосский', sample: 'ສະບາຍດີ, ທ່ານເປັນແນວໃດ', factRu: 'Похож на тайский, но буквы заметно более круглые.' },
  { id: 'km', script: 'khmer', nameRu: 'Кхмерский', sample: 'សួស្តី, អ្នកសុខសប្បាយទេ?', factRu: 'В кхмерском алфавите 74 буквы — самый длинный в мире.' },
  { id: 'my', script: 'myanmar', nameRu: 'Бирманский', sample: 'မင်္ဂလာပါ၊ နေကောင်းလား?', factRu: 'Буквы-кружки: их рисовали на пальмовых листьях, чтобы не рвать волокна.' },
  { id: 'vi', script: 'latin', nameRu: 'Вьетнамский', sample: 'Xin chào, bạn có khỏe không?', factRu: 'Латиница с диакритикой, которую придумали французские миссионеры.' },
  { id: 'ko', script: 'hangul', nameRu: 'Корейский', sample: '안녕하세요, 어떻게 지내세요?', factRu: 'Хангыль изобретён учёными в 1443 году — его называют самым логичным алфавитом.' },
  { id: 'ja', script: 'kana', nameRu: 'Японский', sample: 'こんにちは、お元気ですか', factRu: 'Единственный язык, использующий три письменности одновременно.' },
  { id: 'zh', script: 'han', nameRu: 'Китайский', sample: '你好吗？', factRu: 'Один иероглиф = один слог и одно значение. Читать учатся годами.' },
  { id: 'mn', script: 'cyrillic', nameRu: 'Монгольский', sample: 'Сайн байна уу, та юу байна?', factRu: 'Кириллица с двумя дополнительными буквами — но традиционное письмо пишется сверху вниз.' },
  { id: 'am', script: 'geez', nameRu: 'Амхарский', sample: 'ሰላም፣ እንዴት ነህ?', factRu: 'Государственный язык Эфиопии с собственным письмом геэз.' },
  { id: 'fi', script: 'latin', nameRu: 'Финский', sample: 'Hyvää päivää, mitä kuuluu?', factRu: '15 падежей и слова-чемпионы по длине.' },
  { id: 'et', script: 'latin', nameRu: 'Эстонский', sample: 'Tere, kuidas sul läheb?', factRu: '14 падежей — и это не рекорд среди соседей.' },
  { id: 'hu', script: 'latin', nameRu: 'Венгерский', sample: 'Jó napot, hogy vagy?', factRu: 'Не индоевропейский: его ближайший родственник — ханты-мансийский.' },
  { id: 'cs', script: 'latin', nameRu: 'Чешский', sample: 'Dobrý den, jak se máš?', factRu: 'Буква ř есть только в чешском — иностранцы её не выговаривают.' },
  { id: 'pl', script: 'latin', nameRu: 'Польский', sample: 'Dzień dobry, jak się masz?', factRu: 'Слова вроде «szczęście» — чемпионат по согласным подряд.' },
  { id: 'ro', script: 'latin', nameRu: 'Румынский', sample: 'Bună ziua, ce faceți?', factRu: 'Романский язык, со всех сторон окружённый славянскими.' },
  { id: 'tr', script: 'latin', nameRu: 'Турецкий', sample: 'Merhaba, nasılsın?', factRu: 'Буква ğ («мягкая г») не произносится вообще.' },
  { id: 'az', script: 'latin', nameRu: 'Азербайджанский', sample: 'Salam, necəsən?', factRu: 'Буква ə — звук «шва», редкий гость в алфавитах.' },
  { id: 'is', script: 'latin', nameRu: 'Исландский', sample: 'Góðan daginn, hvernig hefur þú það?', factRu: 'Буква þ — прямая наследница рун. Язык викингов почти не изменился.' },
  { id: 'cy', script: 'latin', nameRu: 'Валлийский', sample: 'Bore da, sut dych chi?', factRu: 'Сочетание ll — звук, которого нет почти больше нигде.' },
  { id: 'ga', script: 'latin', nameRu: 'Ирландский', sample: 'Dia dhuit, conas atá tú?', factRu: 'Государственный язык ЕС, на котором ежедневно говорят меньше 100 тысяч человек.' },
  { id: 'mt', script: 'latin', nameRu: 'Мальтийский', sample: 'Bonġu, kif int?', factRu: 'Единственный семитский язык ЕС — и единственный такой на латинице.' },
  { id: 'eu', script: 'latin', nameRu: 'Баскский', sample: 'Kaixo, zer moduz?', factRu: 'Язык-изолята: у него нет ни одного доказанного родственника.' },
  { id: 'la', script: 'latin', nameRu: 'Латынь', sample: 'Salve, quid agis?', factRu: 'Мёртвый язык — но официально живой в Ватикане.' },
  { id: 'eo', script: 'latin', nameRu: 'Эсперанто', sample: 'Saluton, kiel vi fartas?', factRu: 'Искусственный язык Заменгофа (1887) — самый успешный из всех придуманных.' },
  { id: 'sw', script: 'latin', nameRu: 'Суахили', sample: 'Jambo, habari gani?', factRu: 'Язык-посредник всей Восточной Африки, на нём говорят в 10+ странах.' },
];
