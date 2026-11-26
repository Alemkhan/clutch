-- «На глазок» text without em dashes, like the rest of the project: the questions came in through
-- earlier migrations, so the rows are fixed in place. Same rule as the bundled content: em dash to hyphen.
UPDATE tiebreaker_questions
SET prompt = REPLACE(prompt, char(8212), '-'),
    card_prompt = REPLACE(card_prompt, char(8212), '-'),
    explanation_json = REPLACE(explanation_json, char(8212), '-')
WHERE instr(prompt, char(8212)) > 0
   OR instr(IFNULL(card_prompt, ''), char(8212)) > 0
   OR instr(IFNULL(explanation_json, ''), char(8212)) > 0;
