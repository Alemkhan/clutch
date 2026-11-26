// Тексты статичных карточек на языке из ?l= (ru|en|kk, по умолчанию ru).
// Совпадают с apps/api/src/share/shareText.ts (outcome.headline, hint, call, playInTelegram):
// статичная карточка - запасная картинка той же карточки матча, что рисует Worker.
(function () {
  var TEXT = {
    ru: {
      headline: { win: 'Я вытащил клатч!', loss: 'Почти получилось!', tie: 'Ничья' },
      hint: 'у всех один набор вопросов',
      call: 'Сыграешь лучше?',
      button: 'Играть в Telegram',
    },
    en: {
      headline: { win: 'I pulled off the clutch!', loss: 'So close!', tie: 'It’s a tie' },
      hint: 'same questions for everyone',
      call: 'Can you do better?',
      button: 'Play in Telegram',
    },
    kk: {
      headline: { win: 'Клатч менікі!', loss: 'Аз қалды!', tie: 'Тең түстік' },
      hint: 'барлығына бір сұрақтар жинағы',
      call: 'Жақсырақ ойнай аласың ба?',
      button: 'Telegram-да ойна',
    },
  };
  var requested = new URLSearchParams(window.location.search).get('l');
  var locale = Object.prototype.hasOwnProperty.call(TEXT, requested) ? requested : 'ru';
  var text = TEXT[locale];
  var outcome = document.body.getAttribute('data-outcome');
  document.documentElement.lang = locale;
  document.querySelectorAll('[data-t]').forEach(function (element) {
    var value = text[element.getAttribute('data-t')];
    element.textContent = typeof value === 'object' ? value[outcome] : value;
  });
  // Длинная строка (казахский, английский) ужимается, пока не влезет в свою ширину.
  // Меряем после загрузки шрифта: запасной шрифт другой ширины.
  document.fonts.ready.then(function () {
    document.querySelectorAll('.headline, .call, .hint, .btn').forEach(function (element) {
      var size = parseFloat(window.getComputedStyle(element).fontSize);
      while (element.scrollWidth > element.clientWidth && size > 16) {
        size -= 1;
        element.style.fontSize = size + 'px';
      }
    });
  });
})();
