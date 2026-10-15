-- «На глазок»: короткая формулировка вопроса для карточки на главной (R26h). Необязательна:
-- NULL — карточка показывает полный prompt с обрезкой. Полный prompt остаётся на экране ответа и
-- вскрытии. Лимит длины (TIEBREAKER_CARD_PROMPT_MAX в packages/shared/src/tiebreaker.ts) держит
-- скрипт заливки; подсказки ответа в тексте быть не должно. Применённую 0003 не переписываем.
ALTER TABLE tiebreaker_questions ADD COLUMN card_prompt TEXT;
