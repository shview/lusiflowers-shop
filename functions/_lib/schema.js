// 轻量自动迁移：老库缺列时补上。
// 仅在 ALTER 成功或报"duplicate column"（列已存在）时才标记完成；
// 其他错误（如表还不存在）下次请求重试。
let migrated = false;

const COLUMNS = [
  `ALTER TABLE products ADD COLUMN sold_out INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE products ADD COLUMN views INTEGER NOT NULL DEFAULT 0`,
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
    migrated = true;
  } catch (e) {
    console.error('schema migration retry later:', e.message);
  }
}
