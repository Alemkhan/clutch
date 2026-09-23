// Questions reconstructed from a real "last one standing" elimination quiz show
// transcript. Ordered by the show's escalating difficulty ladder ($5 → $200).
// RU + EN fields; correctAnswers accept both languages (fuzzy match).

export interface ShowQuestion {
  tier: string;
  difficulty: 'Easy' | 'Medium' | 'Hard' | 'Expert';
  promptRu: string;
  promptEn: string;
  correctRu: string;
  correctEn: string;
  askedTo?: string;
  outcome: 'correct' | 'wrong';
  note?: string;
}

export const SHOW_QUESTIONS: ShowQuestion[] = [
  // ---------- $5 (Easy) ----------
  { tier: '$5', difficulty: 'Easy', promptRu: 'Какая страна находится к северу от Казахстана?', promptEn: 'Which country is located directly north of Kazakhstan?', correctRu: 'Россия', correctEn: 'Russia', outcome: 'correct', note: 'replaced US-specific original' },
  { tier: '$5', difficulty: 'Easy', promptRu: 'Сколько будет 40 разделить на 10?', promptEn: 'What is 40 divided by 10?', correctRu: '4', correctEn: '4', outcome: 'correct' },
  { tier: '$5', difficulty: 'Easy', promptRu: 'Какой язык основной в Мексике?', promptEn: 'What is the main language spoken in Mexico?', correctRu: 'испанский', correctEn: 'Spanish', outcome: 'correct' },
  { tier: '$5', difficulty: 'Easy', promptRu: 'Жёлтый изогнутый фрукт, растёт гроздьями в тропиках, богат калием?', promptEn: 'Yellow curved fruit that grows in tropical clusters, high in potassium?', correctRu: 'банан', correctEn: 'banana', outcome: 'correct' },
  { tier: '$5', difficulty: 'Easy', promptRu: 'Какое знаменитое судно затонуло после столкновения с айсбергом в первом рейсе 1912 года?', promptEn: 'Which famous ocean vessel sank after colliding with an iceberg on its maiden voyage in 1912?', correctRu: 'Титаник', correctEn: 'Titanic', outcome: 'correct', note: 'host: hardest of the round' },
  { tier: '$5', difficulty: 'Easy', promptRu: 'Самый распространённый язык в Польше?', promptEn: 'What is the most spoken language in Poland?', correctRu: 'польский', correctEn: 'Polish', outcome: 'correct' },
  { tier: '$5', difficulty: 'Easy', promptRu: 'Жёлтый + красная краска поровну — какой цвет получится?', promptEn: 'Mixing equal parts yellow and red paint gives what color?', correctRu: 'оранжевый', correctEn: 'orange', outcome: 'correct' },
  { tier: '$5', difficulty: 'Easy', promptRu: 'Столица Великобритании?', promptEn: 'Capital of the United Kingdom?', correctRu: 'Лондон', correctEn: 'London', outcome: 'correct' },
  { tier: '$10', difficulty: 'Easy', promptRu: 'Какой океан омывает Африку с востока?', promptEn: 'Which ocean lies east of Africa?', correctRu: 'Индийский', correctEn: 'Indian', outcome: 'correct', note: 'replaced US-specific original' },
  { tier: '$5', difficulty: 'Easy', promptRu: 'На каком континенте Германия?', promptEn: 'What continent is Germany in?', correctRu: 'Европа', correctEn: 'Europe', outcome: 'correct' },
  { tier: '$5', difficulty: 'Easy', promptRu: 'Какая планета ближе всего к Солнцу?', promptEn: 'Which planet is closest to the Sun?', correctRu: 'Меркурий', correctEn: 'Mercury', outcome: 'correct', note: 'replaced US-specific original' },
  { tier: '$5', difficulty: 'Easy', promptRu: 'Назови любую страну в Азии', promptEn: 'Name a country in Asia', correctRu: 'Индия (любая страна Азии)', correctEn: 'India (any Asian country)', outcome: 'correct' },

  // ---------- $10 (Easy-Medium) ----------
  { tier: '$10', difficulty: 'Easy', promptRu: 'Какой процесс превращает жидкость в твёрдое тело?', promptEn: 'By what process does a liquid turn into a solid?', correctRu: 'замерзание/кристаллизация', correctEn: 'freezing', outcome: 'correct' },
  { tier: '$10', difficulty: 'Easy', promptRu: 'Сколько цветов у радуги?', promptEn: 'How many colors are in a rainbow?', correctRu: '7', correctEn: '7', outcome: 'correct', note: 'replaced US-branded original' },
  { tier: '$10', difficulty: 'Easy', promptRu: 'Разбитый предмет, сулящий 7 лет неудач?', promptEn: 'Household object causing 7 years of bad luck if broken?', correctRu: 'зеркало', correctEn: 'mirror', outcome: 'correct' },
  { tier: '$10', difficulty: 'Easy', promptRu: 'Какая гора — самая высокая в мире?', promptEn: 'What is the tallest mountain in the world?', correctRu: 'Эверест', correctEn: 'Everest', outcome: 'correct', note: 'replaced US-specific original' },
  { tier: '$10', difficulty: 'Easy', promptRu: 'Какая компания разработала Windows?', promptEn: 'Which company developed the Windows operating system?', correctRu: 'Microsoft', correctEn: 'Microsoft', outcome: 'correct' },
  { tier: '$10', difficulty: 'Easy', promptRu: 'Из какого фрукта делают изюм?', promptEn: 'Raisins are made from what fruit?', correctRu: 'виноград', correctEn: 'grapes', outcome: 'correct' },
  { tier: '$10', difficulty: 'Easy', promptRu: 'Сколько дней в високосном году?', promptEn: 'How many days are in a leap year?', correctRu: '366', correctEn: '366', outcome: 'correct', note: 'replaced US-specific original' },
  { tier: '$10', difficulty: 'Easy', promptRu: 'Какой океан содержит почти половину воды Земли?', promptEn: 'What ocean holds nearly half of the Earth\'s water?', correctRu: 'Тихий', correctEn: 'Pacific', outcome: 'correct' },
  { tier: '$10', difficulty: 'Easy', promptRu: 'Пирофобия — боязнь чего?', promptEn: 'Pyrophobia is a fear of what?', correctRu: 'огня', correctEn: 'fire', outcome: 'correct' },
  { tier: '$10', difficulty: 'Easy', promptRu: 'Какой город — столица Японии?', promptEn: 'What city is the capital of Japan?', correctRu: 'Токио', correctEn: 'Tokyo', outcome: 'correct', note: 'replaced US-specific original' },
  { tier: '$10', difficulty: 'Easy', promptRu: 'В какой стране Европы находится Эйфелева башня?', promptEn: 'In which European country can you visit the Eiffel Tower?', correctRu: 'Франция', correctEn: 'France', outcome: 'correct' },
  { tier: '$10', difficulty: 'Medium', promptRu: 'Самая длинная река Южной Америки?', promptEn: 'What is the longest river in South America?', correctRu: 'Амазонка', correctEn: 'Amazon', outcome: 'correct', note: 'contestant barely knew' },

  // ---------- $15 (Medium) ----------
  { tier: '$15', difficulty: 'Medium', promptRu: 'Дополните цитату: «Один маленький шаг для человека, один гигантский скачок для…»', promptEn: 'Fill in the blank: "One small step for man, one giant leap for ___".', correctRu: 'человечества', correctEn: 'mankind', outcome: 'correct' },
  { tier: '$15', difficulty: 'Medium', promptRu: 'Сколько ног у муравья?', promptEn: 'How many legs does an ant have?', correctRu: '6', correctEn: '6', outcome: 'correct' },
  { tier: '$15', difficulty: 'Medium', promptRu: 'Назовите что-нибудь меньше зёрнышка риса (10 секунд)', promptEn: 'Name something smaller than a grain of rice (10 seconds)', correctRu: 'песчинка (любой верный вариант)', correctEn: 'a grain of sand (any valid)', outcome: 'correct' },
  { tier: '$15', difficulty: 'Medium', promptRu: 'Какой художник отрезал часть своего уха?', promptEn: 'Which painter cut off part of his own ear?', correctRu: 'Ван Гог', correctEn: 'Van Gogh', outcome: 'correct' },
  { tier: '$15', difficulty: 'Medium', promptRu: 'Единственное млекопитающее, способное к настоящему полёту?', promptEn: 'The only mammal capable of true flight?', correctRu: 'летучая мышь', correctEn: 'a bat', outcome: 'correct' },
  { tier: '$15', difficulty: 'Medium', promptRu: 'Испанский вариант имени Джон?', promptEn: 'What is the Spanish version of the name John?', correctRu: 'Хуан', correctEn: 'Juan', outcome: 'correct' },
  { tier: '$15', difficulty: 'Medium', promptRu: 'Какой газ растения поглощают для фотосинтеза?', promptEn: 'Primary gas plants absorb for photosynthesis?', correctRu: 'углекислый газ', correctEn: 'carbon dioxide', outcome: 'correct' },
  { tier: '$15', difficulty: 'Medium', promptRu: 'Кто написал серию книг о Гарри Поттере?', promptEn: 'Who wrote the Harry Potter book series?', correctRu: 'Джоан Роулинг', correctEn: 'J.K. Rowling', outcome: 'correct', note: 'replaced US-specific original' },
  { tier: '$15', difficulty: 'Medium', promptRu: 'Мягкое белое волокно из коробочки растения?', promptEn: 'Soft white natural fiber from a plant pod?', correctRu: 'хлопок', correctEn: 'cotton', outcome: 'correct' },
  { tier: '$15', difficulty: 'Medium', promptRu: 'Число 30 римскими цифрами?', promptEn: 'The number 30 in Roman numerals?', correctRu: 'XXX', correctEn: 'XXX', outcome: 'correct' },
  { tier: '$15', difficulty: 'Medium', promptRu: 'Египетский памятник: тело льва, голова человека?', promptEn: 'Legendary Egyptian monument with a lion\'s body and human head?', correctRu: 'Сфинкс', correctEn: 'The Sphinx', outcome: 'correct' },
  { tier: '$15', difficulty: 'Medium', promptRu: 'У какой страны больше всего часовых поясов?', promptEn: 'Which country has the most time zones?', correctRu: 'Франция (12, с заморскими территориями)', correctEn: 'France (12, with territories)', outcome: 'correct', note: 'replaced US-specific original' },

  // ---------- $50 (Hard) ----------
  { tier: '$50', difficulty: 'Hard', promptRu: 'Как ещё называют коленную чашечку?', promptEn: 'What is another name for the kneecap?', correctRu: 'пателла/надколенник', correctEn: 'patella', outcome: 'correct' },
  { tier: '$50', difficulty: 'Hard', promptRu: 'Кто написал роман «1984»?', promptEn: 'Who wrote the novel 1984?', correctRu: 'Джордж Оруэлл', correctEn: 'George Orwell', outcome: 'correct' },
  { tier: '$50', difficulty: 'Hard', promptRu: 'Какое распространённое мужское имя начинается с двойной L?', promptEn: 'What common male first name starts with a double L?', correctRu: 'Ллойд', correctEn: 'Lloyd', outcome: 'correct' },
  { tier: '$50', difficulty: 'Hard', promptRu: 'Епископ Рима в католической церкви — как этот титул называют чаще?', promptEn: 'In the Catholic Church, the Bishop of Rome is commonly known as?', correctRu: 'Папа Римский', correctEn: 'The Pope', outcome: 'wrong', askedTo: 'contestant answered "priest"', note: 'elimination question' },
  { tier: '$50', difficulty: 'Hard', promptRu: 'Какая горная порода образовалась из лавы или магмы?', promptEn: 'What rock solidified from lava or magma?', correctRu: 'магматическая (изверженная)', correctEn: 'igneous', outcome: 'correct' },
  { tier: '$50', difficulty: 'Hard', promptRu: 'Назовите страну с буквой W в названии', promptEn: 'Name a country with the letter W in its name', correctRu: 'Уэльс* (принято; строгий список: Ботсвана, Малави, Швейцария…)', correctEn: 'Wales* (accepted on show; strict: Botswana, Malawi, Switzerland…)', outcome: 'correct', note: 'host accepted Wales; technically a constituent country' },
  { tier: '$50', difficulty: 'Hard', promptRu: 'Какая планета самая дальняя от Солнца (без Плутона)?', promptEn: 'Not counting Pluto, which planet is farthest from the sun?', correctRu: 'Нептун', correctEn: 'Neptune', outcome: 'correct' },
  { tier: '$50', difficulty: 'Hard', promptRu: 'Если человек из Бразилии — бразилец, то человек из Нидерландов — …?', promptEn: 'If someone from Brazil is Brazilian, someone from the Netherlands is…?', correctRu: 'голландец/нидерландец', correctEn: 'Dutch', outcome: 'correct' },
  { tier: '$50', difficulty: 'Hard', promptRu: 'Назовите страну, флаг которой более чем наполовину красный', promptEn: 'Name a country whose flag is 50%+ red', correctRu: 'Канада (пример: Китай, Турция…)', correctEn: 'Canada (also: China, Turkey…)', outcome: 'correct' },
  { tier: '$50', difficulty: 'Hard', promptRu: 'Что означает www в адресной строке браузера?', promptEn: 'What does www stand for in a browser address bar?', correctRu: 'World Wide Web', correctEn: 'World Wide Web', outcome: 'correct' },
  { tier: '$50', difficulty: 'Hard', promptRu: 'Сколько сторон у декагона?', promptEn: 'How many sides does a decagon have?', correctRu: '10', correctEn: '10', outcome: 'correct' },
  { tier: '$50', difficulty: 'Hard', promptRu: 'Первая женщина-пилот, совершившая одиночный перелёт через Атлантику?', promptEn: 'First woman pilot to fly solo across the Atlantic?', correctRu: 'Амелия Эрхарт', correctEn: 'Amelia Earhart', outcome: 'wrong', askedTo: 'contestant had no answer', note: 'elimination question' },

  // ---------- $100 (Expert) ----------
  { tier: '$100', difficulty: 'Expert', promptRu: 'Самая маленькая страна мира по площади?', promptEn: 'Smallest country in the world by area?', correctRu: 'Ватикан', correctEn: 'Vatican City', outcome: 'correct' },
  { tier: '$100', difficulty: 'Expert', promptRu: 'Какая страна первой в мире дала женщинам право голоса?', promptEn: 'Which country was the first to give women the right to vote?', correctRu: 'Новая Зеландия (1893)', correctEn: 'New Zealand (1893)', outcome: 'correct', note: 'replaced US-specific original' },
  { tier: '$100', difficulty: 'Expert', promptRu: 'В какой стране живёт больше всего тигров?', promptEn: 'What country has the most tigers in the world?', correctRu: 'Индия', correctEn: 'India', outcome: 'correct' },
  { tier: '$100', difficulty: 'Expert', promptRu: 'Самый длинный континентальный горный хребет мира?', promptEn: 'Longest continental mountain range in the world?', correctRu: 'Анды', correctEn: 'The Andes', outcome: 'correct' },
  { tier: '$100', difficulty: 'Expert', promptRu: 'Какая страна имеет три официальных языка: нидерландский, французский и немецкий?', promptEn: 'What country has Dutch, French and German as official languages?', correctRu: 'Бельгия', correctEn: 'Belgium', outcome: 'correct' },
  { tier: '$100', difficulty: 'Expert', promptRu: 'Как называют специалиста, который в страховании анализирует риски и рассчитывает премии?', promptEn: 'In insurance, who analyzes risk and prices premiums?', correctRu: 'актуарий', correctEn: 'actuary', outcome: 'wrong', askedTo: 'answered "insurance broker"', note: 'elimination question' },
  { tier: '$100', difficulty: 'Expert', promptRu: 'Какая часть мозга отвечает за суждение?', promptEn: 'What part of the brain controls judgment?', correctRu: 'лобная доля', correctEn: 'frontal lobe', outcome: 'correct' },
  { tier: '$100', difficulty: 'Expert', promptRu: 'Сколько сердец у осьминога?', promptEn: 'How many hearts does an octopus have?', correctRu: '3', correctEn: '3', outcome: 'correct', note: 'replaced US-specific original (was an elimination question)' },
  { tier: '$100', difficulty: 'Expert', promptRu: 'Что изначально продавал Amazon?', promptEn: 'What did Amazon originally sell?', correctRu: 'книги', correctEn: 'books', outcome: 'correct' },
  { tier: '$100', difficulty: 'Expert', promptRu: 'Первая женщина — лауреат Нобелевской премии?', promptEn: 'First woman to win a Nobel Prize?', correctRu: 'Мария Кюри', correctEn: 'Marie Curie', outcome: 'correct' },
  { tier: '$100', difficulty: 'Expert', promptRu: 'Два главных газа Солнца?', promptEn: 'Two main gases that make up the sun?', correctRu: 'водород и гелий', correctEn: 'hydrogen and helium', outcome: 'correct' },

  // ---------- $200 (Expert) ----------
  { tier: '$200', difficulty: 'Expert', promptRu: 'Как фамилия матери Брэди? (внутренняя шутка шоу)', promptEn: 'What is Brady\'s mother\'s maiden name? (show in-joke)', correctRu: '—', correctEn: '—', outcome: 'wrong', askedTo: 'unanswerable in-joke', note: 'skip — not a real question' },
  { tier: '$200', difficulty: 'Expert', promptRu: 'Три самые населённые страны, начинающиеся на букву I?', promptEn: 'Top three most populated countries starting with the letter I?', correctRu: 'Индия, Индонезия, Иран', correctEn: 'India, Indonesia, Iran', outcome: 'correct' },
  { tier: '$200', difficulty: 'Expert', promptRu: 'Сколько будет 222 разделить на 6?', promptEn: 'What is 222 divided by 6?', correctRu: '37', correctEn: '37', outcome: 'wrong', askedTo: 'answered 36', note: 'elimination question' },
  { tier: '$200', difficulty: 'Expert', promptRu: 'Как называют кольцеобразный коралловый остров с лагуной?', promptEn: 'Name for a ring-shaped coral reef island surrounding a lagoon?', correctRu: 'атолл', correctEn: 'atoll', outcome: 'wrong', askedTo: 'nobody answered', note: 'elimination question' },
  { tier: '$200', difficulty: 'Expert', promptRu: 'Луковицы каких цветов когда-то были валютой?', promptEn: 'Which flower bulbs were once exchanged as currency?', correctRu: 'тюльпаны', correctEn: 'tulips', outcome: 'correct' },
  { tier: '$200', difficulty: 'Expert', promptRu: 'Кого часто считают создателем первого автомобиля?', promptEn: 'Who is often credited with creating the world\'s first car?', correctRu: 'Карл Бенц', correctEn: 'Karl Benz', outcome: 'wrong', askedTo: 'answered Ford', note: 'elimination question; show mentioned French steam car + Mercedes-Benz' },
  { tier: '$200', difficulty: 'Expert', promptRu: 'Фамилия отца и сына — политиков Пьера и Джастина?', promptEn: 'Last name of father-son politicians Pierre and Justin?', correctRu: 'Трюдо', correctEn: 'Trudeau', outcome: 'correct' },
  { tier: '$200', difficulty: 'Expert', promptRu: 'Самая редкая группа крови у человека?', promptEn: 'Rarest blood type in humans?', correctRu: 'AB (IV) отрицательная', correctEn: 'AB negative', outcome: 'correct' },
];
