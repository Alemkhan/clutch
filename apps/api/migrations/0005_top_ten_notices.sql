-- R25: «выбили из первой десятки» — не чаще одного сообщения на игрока за игровые сутки.
-- Строку вставляют ДО отправки (`ON CONFLICT DO NOTHING`), поэтому два одновременных запроса не дают
-- два сообщения: проигравший гонку видит 0 изменённых строк и молчит. Если Telegram отказал, место
-- в сутках всё равно занято: лучше пропустить известие, чем слать повторно. date_key — сутки игры.
CREATE TABLE top_ten_notices (
  player_id TEXT NOT NULL,
  date_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, date_key)
);
