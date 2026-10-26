# «На глазок»: недельный пак v3

Статус: пакет подготовлен и одобрен владельцем 2026-10-27; даты показа **2026-10-27…2026-11-02**.
Канонические данные для импорта: [tiebreaker-pack-v3.json](tiebreaker-pack-v3.json).
Для генерации SQL используется `npm run tiebreaker:load -- docs/content/tiebreaker-pack-v3.json`;
скрипт только печатает SQL и сам в D1 не пишет.

Все ответы округлены до двух значащих цифр. Вопросы задают нужные размеры и допущения,
чтобы итог не зависел от типа площадки, глубины бассейна или укладки. Дата среза источников
для пакета — 2026-10-27.

| Дата | id | Вопрос (коротко) | Ответ | Расчёт и источники |
| --- | --- | --- | ---: | --- |
| 27 октября | `tb-v3-cent-court` | Монеты 1 евроцент поместятся на площадке FIBA 28 × 15 м в плотной укладке | 1,8 млн | 420 м² × 0,9069 / (π × (16,25 мм / 2)²). Площадка: [FIBA Venue Guide](https://www.venueguide.fiba.basketball/vanue-design); диаметр монеты: [ЕЦБ](https://www.ecb.europa.eu/euro/coins/common/html/index.en.html); упаковка кругов: [Wolfram MathWorld](https://mathworld.wolfram.com/CirclePacking.html). |
| 28 октября | `tb-v3-euro-iss-mass` | Масса скольких монет 1 евро равна массе МКС | 56 млн | 419 725 кг / 7,5 г ≈ 56 млн. [NASA](https://www.nasa.gov/international-space-station/space-station-facts-and-figures/) и [ЕЦБ](https://www.ecb.europa.eu/euro/coins/common/html/index.en.html). Масса МКС меняется при стыковках; вопрос фиксирует справочную оценку NASA на дату среза. |
| 29 октября | `tb-v3-tennis-iss-altitude` | Стопка стандартных теннисных мячей до высоты орбиты МКС, около 400 км | 6 млн | 400 км / 6,7 см ≈ 6 млн. Высота: [NASA](https://science.nasa.gov/earth/earth-observatory/human-spaceflight-factsheet/); диаметр: [ITF Technical Booklet 2026](https://www.itftennis.com/media/15639/2026-technical-booklet.pdf). Орбитальная высота меняется; формулировка явно использует округлённое значение около 400 км. |
| 30 октября | `tb-v3-a4-karman-line` | Листы A4 короткой стороной в линию до условной границы космоса 100 км | 480 тыс. | 100 км / 210 мм ≈ 476 тыс. [FAI](https://www.fai.org/page/icare-boundary) задаёт принятую для рекордов высоту 100 км; [ISO 216](https://www.iso.org/standard/36631.html) — формат листов A. |
| 31 октября | `tb-v3-water-bottles-pool` | Бутылки по 1,5 л заполняют прямоугольный бассейн 50 × 25 × 2 м | 1,7 млн | 2 500 м³ = 2 500 000 л; / 1,5 л ≈ 1,67 млн. Размеры бассейна и бутылки заданы в самом вопросе. [NIST](https://www.nist.gov/pml/special-publication-811/nist-guide-si-appendix-b-conversion-factors/nist-guide-si-appendix-b8) подтверждает перевод единиц. |
| 1 ноября | `tb-v3-courts-hectare` | Площадки FIBA 28 × 15 м по площади на гектаре | 24 | 10 000 м² / 420 м² ≈ 23,8. [FIBA Venue Guide](https://www.venueguide.fiba.basketball/vanue-design); гектар = 10 000 м² по [NIST](https://www.nist.gov/pml/special-publication-811/nist-guide-si-appendix-b-conversion-factors/nist-guide-si-appendix-b8). |
| 2 ноября | `tb-v3-euro-coins-karman` | Монеты 2 евро стопкой до высоты 100 км | 45 млн | 100 км / 2,20 мм ≈ 45,5 млн. [FAI](https://www.fai.org/page/icare-boundary); толщина монеты: [ЕЦБ](https://www.ecb.europa.eu/euro/coins/common/html/index.en.html). |

## Проверка

- Вопросы не используют российскую статистику и не спрашивают одно число из справочника.
- Изменчивые параметры обозначены как приблизительные либо привязаны к справке NASA на дату среза.
- Геометрические модели явно указаны в вопросах; упаковка монет использует идеальную плотную раскладку,
  бутылки считаются по объёму жидкости, листы и монеты складываются без потерь.
- Владелец одобрил весь пакет 2026-10-27. Источники и расчёты сохранены для последующих
  исправлений по жалобам игроков.
