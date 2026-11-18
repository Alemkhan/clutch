-- Wiki-path daily routes for English and Kazakh Wikipedia, 2026-11-19 .. 2026-12-02.
-- Titles derived from the Russian routes in 0014 via ru.wikipedia langlinks (canonical titles).
-- Replacements:
--   kk 2026-11-20: 'Чебурашка' has no kk.wikipedia article -> start replaced with 'Микки Маус'
--                  (target 'Күн жүйесі' kept); both verified to exist on kk.wikipedia.
-- Notes: en 'Жираф' links to 'Giraffe'; kk 'Бешбармак' links to 'Ет (тағам)'.

INSERT INTO wiki_path_challenges (id, date_key, lang, start_title, target_title, created_at) VALUES
  ('wiki-en-2026-11-19', '2026-11-19', 'en', 'Kumis', 'Eiffel Tower', 1794441600000),
  ('wiki-en-2026-11-20', '2026-11-20', 'en', 'Cheburashka', 'Solar System', 1794441600000),
  ('wiki-en-2026-11-21', '2026-11-21', 'en', 'Tetris', 'Ancient Egypt', 1794441600000),
  ('wiki-en-2026-11-22', '2026-11-22', 'en', 'Lionel Messi', 'Genghis Khan', 1794441600000),
  ('wiki-en-2026-11-23', '2026-11-23', 'en', 'Penguin', 'Sahara', 1794441600000),
  ('wiki-en-2026-11-24', '2026-11-24', 'en', 'Beshbarmak', 'The Beatles', 1794441600000),
  ('wiki-en-2026-11-25', '2026-11-25', 'en', 'Coffee', 'Isaac Newton', 1794441600000),
  ('wiki-en-2026-11-26', '2026-11-26', 'en', 'Giraffe', 'Mount Everest', 1794441600000),
  ('wiki-en-2026-11-27', '2026-11-27', 'en', 'Pokémon', 'Great Wall of China', 1794441600000),
  ('wiki-en-2026-11-28', '2026-11-28', 'en', 'Chocolate', 'Atlantis', 1794441600000),
  ('wiki-en-2026-11-29', '2026-11-29', 'en', 'Well, Just You Wait!', 'Titanic', 1794441600000),
  ('wiki-en-2026-11-30', '2026-11-30', 'en', 'Barbie', 'Dinosaur', 1794441600000),
  ('wiki-en-2026-12-01', '2026-12-01', 'en', 'Leo Tolstoy', 'Artificial intelligence', 1794441600000),
  ('wiki-en-2026-12-02', '2026-12-02', 'en', 'New Year', 'North Pole', 1794441600000),
  ('wiki-kk-2026-11-19', '2026-11-19', 'kk', 'Қымыз', 'Эйфель мұнарасы', 1794441600000),
  ('wiki-kk-2026-11-20', '2026-11-20', 'kk', 'Микки Маус', 'Күн жүйесі', 1794441600000),
  ('wiki-kk-2026-11-21', '2026-11-21', 'kk', 'Тетрис', 'Ежелгі Мысыр', 1794441600000),
  ('wiki-kk-2026-11-22', '2026-11-22', 'kk', 'Лионель Месси', 'Шыңғыс хан', 1794441600000),
  ('wiki-kk-2026-11-23', '2026-11-23', 'kk', 'Пингвинтәрізділер', 'Сахара', 1794441600000),
  ('wiki-kk-2026-11-24', '2026-11-24', 'kk', 'Ет (тағам)', 'The Beatles', 1794441600000),
  ('wiki-kk-2026-11-25', '2026-11-25', 'kk', 'Кофе', 'Исаак Ньютон', 1794441600000),
  ('wiki-kk-2026-11-26', '2026-11-26', 'kk', 'Керік', 'Джомолунгма', 1794441600000),
  ('wiki-kk-2026-11-27', '2026-11-27', 'kk', 'Покемон', 'Ұлы Қытай қорғаны', 1794441600000),
  ('wiki-kk-2026-11-28', '2026-11-28', 'kk', 'Шоколад', 'Атлантида', 1794441600000),
  ('wiki-kk-2026-11-29', '2026-11-29', 'kk', 'Қап, бәлем, тұра тұр! (мультфильм)', 'Титаник', 1794441600000),
  ('wiki-kk-2026-11-30', '2026-11-30', 'kk', 'Барби', 'Динозаврлар', 1794441600000),
  ('wiki-kk-2026-12-01', '2026-12-01', 'kk', 'Лев Николаевич Толстой', 'Жасанды интеллект', 1794441600000),
  ('wiki-kk-2026-12-02', '2026-12-02', 'kk', 'Жаңа жыл', 'Солтүстік полюс', 1794441600000);
