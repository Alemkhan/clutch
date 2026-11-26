-- «Сдаться» в Вики пути: маршрут закрывается без результата и в таблицу дня не попадает.
-- Статус остаётся 'in_progress' (CHECK таблицы менять не нужно); сдавшийся - gave_up_at IS NOT NULL.
ALTER TABLE wiki_path_runs ADD COLUMN gave_up_at INTEGER;
