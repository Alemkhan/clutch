-- Wiki Path for 2026-11-27 replaced: «Ребёнок» -> «Водородная бомба» instead of «Покемон» -> «Великая
-- Китайская стена». Checked on 2026-11-26 against the live Wikipedias, no link from start to target:
--   ru: «Водородная бомба» redirects to «Термоядерное оружие» (the game matches by page id).
--       Three clicks: Ребёнок -> Россия -> Ядерный клуб -> Термоядерное оружие.
--   en: Child -> Armed conflicts -> Nuclear weapon -> Thermonuclear weapon ("Hydrogen bomb" redirects).
--   kk: «Сутегі бомбасы» has no article, the target is «Термоядролық қару»;
--       Бала -> 1949 -> 30 қазан -> Термоядролық қару.
-- Nobody has played the day yet; cached target and page refs for it, if any, are dropped.
DELETE FROM wiki_path_challenge_targets WHERE challenge_id IN ('wiki-2026-11-27', 'wiki-en-2026-11-27', 'wiki-kk-2026-11-27');
DELETE FROM wiki_path_page_refs WHERE challenge_id IN ('wiki-2026-11-27', 'wiki-en-2026-11-27', 'wiki-kk-2026-11-27');
UPDATE wiki_path_challenges SET start_title = 'Ребёнок', target_title = 'Водородная бомба' WHERE id = 'wiki-2026-11-27';
UPDATE wiki_path_challenges SET start_title = 'Child', target_title = 'Hydrogen bomb' WHERE id = 'wiki-en-2026-11-27';
UPDATE wiki_path_challenges SET start_title = 'Бала', target_title = 'Термоядролық қару' WHERE id = 'wiki-kk-2026-11-27';
