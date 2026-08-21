// 轻量自动迁移：老库缺列时补上。
// 仅在 ALTER 成功或报"duplicate column"（列已存在）时才标记完成；
// 其他错误（如表还不存在）下次请求重试。
let migrated = false;

const COLUMNS = [
  `ALTER TABLE products ADD COLUMN sold_out INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE products ADD COLUMN views INTEGER NOT NULL DEFAULT 0`,
];

const TABLES = [
  `CREATE TABLE IF NOT EXISTS product_views_daily (
    product_id INTEGER NOT NULL,
    day TEXT NOT NULL,
    views INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (product_id, day)
  )`,
];

export async function ensureSchema(env) {
  if (migrated || !env.DB) return;
  try {
    for (const sql of COLUMNS) {
      try {
        await env.DB.prepare(sql).run();
      } catch (e) {
        const msg = String(e.message || '');
        if (!msg.includes('duplicate column')) throw e;
      }
    }
    for (const sql of TABLES) {
      try {
        await env.DB.prepare(sql).run();
      } catch (e) {
        const msg = String(e.message || '');
        if (!msg.includes('already exists')) throw e;
      }
    }
    migrated = true;
  } catch (e) {
    console.error('schema migration retry later:', e.message);
  }
}
