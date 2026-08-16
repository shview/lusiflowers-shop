-- Cloudflare D1 初始化脚本：在 Cloudflare 控制台 D1 > Console 中执行一次
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category_id INTEGER DEFAULT NULL,
  price TEXT DEFAULT '',
  description TEXT DEFAULT '',
  image_url TEXT DEFAULT '',
  link TEXT DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1,
  sold_out INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT DEFAULT ''
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('site_name', '商品展示');
INSERT OR IGNORE INTO settings (key, value) VALUES ('announcement', '欢迎光临，这里是公告区。');
INSERT OR IGNORE INTO settings (key, value) VALUES ('watermark_on', '1');
INSERT OR IGNORE INTO settings (key, value) VALUES ('og_on', '0');
INSERT OR IGNORE INTO categories (name, sort) VALUES ('推荐', 0);
