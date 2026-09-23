// General-knowledge question bank in the show style (easy → expert ladder).
// Universal (no US-centric items), RU + EN. Not wired into the game yet —
// content pool for future categories / scripted challenges.

export type BankCategory = 'science' | 'history' | 'popculture' | 'food' | 'sport' | 'math';

export interface BankQuestion {
  category: BankCategory;
  difficulty: 'Easy' | 'Medium' | 'Hard' | 'Expert';
  promptRu: string;
  promptEn: string;
  correctRu: string;
  correctEn: string;
  note?: string;
}

export const BANK_CATEGORY_LABELS_RU: Record<BankCategory, string> = {
  science: 'Наука и природа',
  history: 'История',
  popculture: 'Поп-культура',
  food: 'Еда',
  sport: 'Спорт',
  math: 'Математика и логика',
};

export const questionBank: BankQuestion[] = [
  // ---------- Наука и природа ----------
  { category: 'science', difficulty: 'Easy', promptRu: 'Какую планету называют «Красной планетой»?', promptEn: 'Which planet is called the Red Planet?', correctRu: 'Марс', correctEn: 'Mars' },
  { category: 'science', difficulty: 'Easy', promptRu: 'Сколько костей в скелете взрослого человека?', promptEn: 'How many bones are in the adult human body?', correctRu: '206', correctEn: '206' },
  { category: 'science', difficulty: 'Easy', promptRu: 'Каким газом мы дышим, чтобы жить?', promptEn: 'Which gas do we breathe to live?', correctRu: 'кислород', correctEn: 'oxygen' },
  { category: 'science', difficulty: 'Medium', promptRu: 'Самое быстрое наземное животное?', promptEn: 'The fastest land animal?', correctRu: 'гепард', correctEn: 'cheetah' },
  { category: 'science', difficulty: 'Medium', promptRu: 'Что измеряют по шкале Рихтера?', promptEn: 'What is measured on the Richter scale?', correctRu: 'силу землетрясений', correctEn: 'earthquakes' },
  { category: 'science', difficulty: 'Medium', promptRu: 'Сколько зубов у взрослого человека (в норме)?', promptEn: 'How many teeth does an adult human have?', correctRu: '32', correctEn: '32' },
  { category: 'science', difficulty: 'Hard', promptRu: 'Какая планета Солнечной системы самая горячая?', promptEn: 'Which planet in the solar system is the hottest?', correctRu: 'Венера (а не Меркурий!)', correctEn: 'Venus (not Mercury!)', note: 'ловушка: Меркурий ближе к Солнцу, но у Венеры парниковый эффект' },
  { category: 'science', difficulty: 'Hard', promptRu: 'Какой орган вырабатывает инсулин?', promptEn: 'Which organ produces insulin?', correctRu: 'поджелудочная железа', correctEn: 'pancreas' },
  { category: 'science', difficulty: 'Hard', promptRu: 'Чему примерно равна скорость света?', promptEn: 'Approximately how fast is the speed of light?', correctRu: '300 000 км/с', correctEn: '300,000 km/s' },
  { category: 'science', difficulty: 'Expert', promptRu: 'Сколько хромосом у человека?', promptEn: 'How many chromosomes do humans have?', correctRu: '46', correctEn: '46' },
  { category: 'science', difficulty: 'Expert', promptRu: 'Какой металл жидкий при комнатной температуре?', promptEn: 'Which metal is liquid at room temperature?', correctRu: 'ртуть', correctEn: 'mercury' },
  { category: 'science', difficulty: 'Expert', promptRu: 'Самая большая клетка человеческого тела?', promptEn: 'The largest cell in the human body?', correctRu: 'яйцеклетка', correctEn: 'the egg cell' },

  // ---------- История ----------
  { category: 'history', difficulty: 'Easy', promptRu: 'В каком году началась Вторая мировая война?', promptEn: 'In what year did World War II begin?', correctRu: '1939', correctEn: '1939' },
  { category: 'history', difficulty: 'Easy', promptRu: 'Кто был первым человеком в космосе?', promptEn: 'Who was the first human in space?', correctRu: 'Юрий Гагарин', correctEn: 'Yuri Gagarin' },
  { category: 'history', difficulty: 'Easy', promptRu: 'Как называют древнеегипетские гробницы фараонов?', promptEn: 'What are the ancient Egyptian tombs of pharaohs called?', correctRu: 'пирамиды', correctEn: 'pyramids' },
  { category: 'history', difficulty: 'Medium', promptRu: 'Кто написал «Мону Лизу»?', promptEn: 'Who painted the Mona Lisa?', correctRu: 'Леонардо да Винчи', correctEn: 'Leonardo da Vinci' },
  { category: 'history', difficulty: 'Medium', promptRu: 'Какая цивилизация построила Мачу-Пикчу?', promptEn: 'Which civilization built Machu Picchu?', correctRu: 'инки', correctEn: 'the Inca' },
  { category: 'history', difficulty: 'Medium', promptRu: 'Каким государством правил Наполеон?', promptEn: 'What state did Napoleon rule?', correctRu: 'Французская империя', correctEn: 'the French Empire' },
  { category: 'history', difficulty: 'Hard', promptRu: 'Кто был последним российским императором?', promptEn: 'Who was the last Russian emperor?', correctRu: 'Николай II', correctEn: 'Nicholas II' },
  { category: 'history', difficulty: 'Hard', promptRu: 'Какой город был захвачен османами в 1453 году?', promptEn: 'Which city fell to the Ottomans in 1453?', correctRu: 'Константинополь', correctEn: 'Constantinople' },
  { category: 'history', difficulty: 'Hard', promptRu: 'Сколько лет на самом деле длилась Столетняя война?', promptEn: 'How long did the Hundred Years\u2019 War actually last?', correctRu: '116 лет', correctEn: '116 years', note: 'классическая ловушка' },
  { category: 'history', difficulty: 'Expert', promptRu: 'Кто была первой женщиной-премьер-министром в мире?', promptEn: 'Who was the world\u2019s first woman prime minister?', correctRu: 'Индира Ганди', correctEn: 'Indira Gandhi', note: 'строго: сэримво Бандаранаике (Шри-Ланка, 1960) — но в масс-тривиа обычно Ганди; уточнить перед использованием' },
  { category: 'history', difficulty: 'Expert', promptRu: 'Выстрел крейсёра «Аврора» — начало какого события?', promptEn: 'The cruiser Aurora\u2019s shot began which event?', correctRu: 'штурм Зимнего (Октябрьская революция)', correctEn: 'the Storming of the Winter Palace' },
  { category: 'history', difficulty: 'Expert', promptRu: 'Какая династия правила Китаем дольше всех?', promptEn: 'Which dynasty ruled China the longest?', correctRu: 'Чжоу (около 790 лет)', correctEn: 'Zhou (~790 years)' },

  // ---------- Поп-культура ----------
  { category: 'popculture', difficulty: 'Easy', promptRu: 'Кого называют «королём поп-музыки»?', promptEn: 'Who is called the King of Pop?', correctRu: 'Майкл Джексон', correctEn: 'Michael Jackson' },
  { category: 'popculture', difficulty: 'Easy', promptRu: 'Супергерой, который поднимает молот Мьёльнир?', promptEn: 'Which superhero wields the hammer Mjölnir?', correctRu: 'Тор', correctEn: 'Thor' },
  { category: 'popculture', difficulty: 'Easy', promptRu: 'Приложение с бесконечными короткими видео?', promptEn: 'The app with endless short videos?', correctRu: 'TikTok', correctEn: 'TikTok' },
  { category: 'popculture', difficulty: 'Medium', promptRu: 'Фильм про парк с живыми динозаврами?', promptEn: 'The movie about a park with living dinosaurs?', correctRu: '«Парк Юрского периода»', correctEn: 'Jurassic Park' },
  { category: 'popculture', difficulty: 'Medium', promptRu: 'Певица с альбомом «1989»?', promptEn: 'The singer with the album 1989?', correctRu: 'Тейлор Свифт', correctEn: 'Taylor Swift' },
  { category: 'popculture', difficulty: 'Medium', promptRu: 'Серия игр про итальянского водопроводчика?', promptEn: 'The game series about an Italian plumber?', correctRu: 'Super Mario', correctEn: 'Super Mario' },
  { category: 'popculture', difficulty: 'Hard', promptRu: 'Режиссёр «Титаника» и «Аватара»?', promptEn: 'Director of Titanic and Avatar?', correctRu: 'Джеймс Кэмерон', correctEn: 'James Cameron' },
  { category: 'popculture', difficulty: 'Hard', promptRu: 'Какая группа исполнила Bohemian Rhapsody?', promptEn: 'Which band performed Bohemian Rhapsody?', correctRu: 'Queen', correctEn: 'Queen' },
  { category: 'popculture', difficulty: 'Hard', promptRu: 'Стриминговый сервис, выпустивший «Очень странные дела»?', promptEn: 'The streaming service behind Stranger Things?', correctRu: 'Netflix', correctEn: 'Netflix' },
  { category: 'popculture', difficulty: 'Expert', promptRu: 'Первый полнометражный анимационный фильм Disney?', promptEn: 'Disney\u2019s first full-length animated film?', correctRu: '«Белоснежка и семь гномов» (1937)', correctEn: 'Snow White (1937)' },
  { category: 'popculture', difficulty: 'Expert', promptRu: 'Самый кассовый фильм в истории (после ре-релиза 2021 года)?', promptEn: 'The highest-grossing film in history (after its 2021 re-release)?', correctRu: '«Аватар»', correctEn: 'Avatar' },
  { category: 'popculture', difficulty: 'Expert', promptRu: 'The Beatles — из какого города?', promptEn: 'The Beatles are from which city?', correctRu: 'Ливерпуль', correctEn: 'Liverpool' },

  // ---------- Еда ----------
  { category: 'food', difficulty: 'Easy', promptRu: 'Главный ингредиент гуакамоле?', promptEn: 'The main ingredient of guacamole?', correctRu: 'авокадо', correctEn: 'avocado' },
  { category: 'food', difficulty: 'Easy', promptRu: 'Какая страна — родина пиццы?', promptEn: 'Which country invented pizza?', correctRu: 'Италия', correctEn: 'Italy' },
  { category: 'food', difficulty: 'Easy', promptRu: 'Зелёная острая приправа, которую подают к суши?', promptEn: 'The spicy green condiment served with sushi?', correctRu: 'васаби', correctEn: 'wasabi' },
  { category: 'food', difficulty: 'Medium', promptRu: 'Самая дорогая специя в мире?', promptEn: 'The most expensive spice in the world?', correctRu: 'шафран', correctEn: 'saffron' },
  { category: 'food', difficulty: 'Medium', promptRu: 'Что такое хумус по составу?', promptEn: 'What is hummus made of?', correctRu: 'паста из нута', correctEn: 'chickpea paste' },
  { category: 'food', difficulty: 'Medium', promptRu: 'Фрукт, который называют «королём фруктов» и запрещают в отелях за запах?', promptEn: 'The \u201cking of fruits\u201d banned in hotels for its smell?', correctRu: 'дуриан', correctEn: 'durian' },
  { category: 'food', difficulty: 'Hard', promptRu: 'Какая страна на самом деле придумала круассан?', promptEn: 'Which country actually invented the croissant?', correctRu: 'Австрия (не Франция!)', correctEn: 'Austria (not France!)', note: 'ловушка: все говорят Франция' },
  { category: 'food', difficulty: 'Hard', promptRu: 'Из какого ореха делают марципан?', promptEn: 'Marzipan is made from which nut?', correctRu: 'миндаль', correctEn: 'almonds' },
  { category: 'food', difficulty: 'Hard', promptRu: 'Какая страна ест больше всего шоколада на душу населения?', promptEn: 'Which country eats the most chocolate per capita?', correctRu: 'Швейцария', correctEn: 'Switzerland' },
  { category: 'food', difficulty: 'Expert', promptRu: 'Рыба фугу опасна, потому что содержит…?', promptEn: 'Fugu fish is dangerous because it contains…?', correctRu: 'тетродотоксин (смертельный яд)', correctEn: 'tetrodotoxin' },
  { category: 'food', difficulty: 'Expert', promptRu: 'Основа вустерширского соуса, о которой мало кто знает?', promptEn: 'The little-known base ingredient of Worcestershire sauce?', correctRu: 'анчоусы', correctEn: 'anchovies' },
  { category: 'food', difficulty: 'Expert', promptRu: 'Что такое «печёное картофельное пюре по-французски», если перевести название блюда «гратен дофинуа»?', promptEn: 'What is gratin dauphinois, in plain words?', correctRu: 'запечённый картофель со сливками и сыром', correctEn: 'potatoes baked in cream and cheese' },

  // ---------- Спорт ----------
  { category: 'sport', difficulty: 'Easy', promptRu: 'Сколько игроков одной команды на поле в футболе?', promptEn: 'How many players per team are on the field in football/soccer?', correctRu: '11', correctEn: '11' },
  { category: 'sport', difficulty: 'Easy', promptRu: 'Какая страна — родина Олимпийских игр?', promptEn: 'Which country birthed the Olympic Games?', correctRu: 'Греция', correctEn: 'Greece' },
  { category: 'sport', difficulty: 'Easy', promptRu: 'В каком спорте играют шайбой?', promptEn: 'Which sport uses a puck?', correctRu: 'хоккей', correctEn: 'hockey' },
  { category: 'sport', difficulty: 'Medium', promptRu: 'Как часто проходит чемпионат мира по футболу?', promptEn: 'How often is the FIFA World Cup held?', correctRu: 'раз в 4 года', correctEn: 'every 4 years' },
  { category: 'sport', difficulty: 'Medium', promptRu: 'Теннисный турнир на траве в Лондоне?', promptEn: 'The grass tennis tournament in London?', correctRu: 'Уимблдон', correctEn: 'Wimbledon' },
  { category: 'sport', difficulty: 'Medium', promptRu: 'Сколько клеток на шахматной доске?', promptEn: 'How many squares are on a chessboard?', correctRu: '64', correctEn: '64' },
  { category: 'sport', difficulty: 'Hard', promptRu: 'Единственная страна, игравшая на всех чемпионатах мира по футболу?', promptEn: 'The only country to play in every FIFA World Cup?', correctRu: 'Бразилия', correctEn: 'Brazil' },
  { category: 'sport', difficulty: 'Hard', promptRu: 'Официальная длина марафона?', promptEn: 'The official marathon distance?', correctRu: '42,195 км (42 км 195 м)', correctEn: '42.195 km' },
  { category: 'sport', difficulty: 'Hard', promptRu: 'Рекордсмен по золотым олимпийским медалям за карьеру?', promptEn: 'The record holder for career Olympic gold medals?', correctRu: 'Майкл Фелпс (23)', correctEn: 'Michael Phelps (23)' },
  { category: 'sport', difficulty: 'Expert', promptRu: 'Где прошли первые зимние Олимпийские игры?', promptEn: 'Where were the first Winter Olympics held?', correctRu: 'Шамони, Франция (1924)', correctEn: 'Chamonix, France (1924)' },
  { category: 'sport', difficulty: 'Expert', promptRu: 'За какое минимальное число ходов можно поставить мат в шахматах?', promptEn: 'The minimum number of moves for checkmate in chess?', correctRu: '2 («детский мат» невозможен — это «дуракный мат»)', correctEn: '2 (fool\u2019s mate)' },
  { category: 'sport', difficulty: 'Expert', promptRu: 'Кто держит самый высокий рейтинг в истории шахмат?', promptEn: 'Who holds the highest chess rating in history?', correctRu: 'Магнус Карлсен (2882)', correctEn: 'Magnus Carlsen (2882)' },

  // ---------- Математика и логика ----------
  { category: 'math', difficulty: 'Easy', promptRu: 'Сколько будет 7 × 8?', promptEn: 'What is 7 × 8?', correctRu: '56', correctEn: '56' },
  { category: 'math', difficulty: 'Easy', promptRu: 'Сколько градусов в прямом угле?', promptEn: 'How many degrees in a right angle?', correctRu: '90', correctEn: '90' },
  { category: 'math', difficulty: 'Easy', promptRu: 'Что тяжелее: килограмм железа или килограмм пуха?', promptEn: 'Which is heavier: a kilogram of iron or a kilogram of feathers?', correctRu: 'одинаково', correctEn: 'equal', note: 'классика-ловушка' },
  { category: 'math', difficulty: 'Medium', promptRu: 'Сколько секунд в одном часе?', promptEn: 'How many seconds in an hour?', correctRu: '3600', correctEn: '3,600' },
  { category: 'math', difficulty: 'Medium', promptRu: 'Чему равно число π с точностью до двух знаков?', promptEn: 'What is pi to two decimal places?', correctRu: '3,14', correctEn: '3.14' },
  { category: 'math', difficulty: 'Medium', promptRu: 'Сколько вершин у куба?', promptEn: 'How many vertices does a cube have?', correctRu: '8', correctEn: '8' },
  { category: 'math', difficulty: 'Hard', promptRu: 'Сколько нулей в одном миллиарде?', promptEn: 'How many zeros in a billion?', correctRu: '9', correctEn: '9' },
  { category: 'math', difficulty: 'Hard', promptRu: 'Чему равно 15% от 200?', promptEn: 'What is 15% of 200?', correctRu: '30', correctEn: '30' },
  { category: 'math', difficulty: 'Hard', promptRu: 'Продолжите последовательность: 1, 1, 2, 3, 5, 8, …?', promptEn: 'Continue the sequence: 1, 1, 2, 3, 5, 8, …?', correctRu: '13 (числа Фибоначчи)', correctEn: '13 (Fibonacci)' },
  { category: 'math', difficulty: 'Expert', promptRu: 'Сколько диагоналей у пятиугольника?', promptEn: 'How many diagonals does a pentagon have?', correctRu: '5', correctEn: '5' },
  { category: 'math', difficulty: 'Expert', promptRu: 'Чему равно 2 в десятой степени?', promptEn: 'What is 2 to the 10th power?', correctRu: '1024', correctEn: '1024' },
  { category: 'math', difficulty: 'Expert', promptRu: 'Сколько существует простых чисел меньше 20?', promptEn: 'How many prime numbers are below 20?', correctRu: '8 (2, 3, 5, 7, 11, 13, 17, 19)', correctEn: '8' },
];
