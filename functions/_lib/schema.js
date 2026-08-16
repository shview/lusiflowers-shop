// 轻量自动迁移：老库缺列时补上。
// 仅在 ALTER 成功或报"duplicate column"（列已存在）时才标记完成；
// 其他错误（如表还不存在）下次请求重试。
let migrated = false;

export async function ensureSchema(env) {
  if (migrated || !env.DB) return;
  try {
    await env.DB.prepare(`ALTER TABLE products ADD COLUMN sold_out INTEGER NOT NULL DEFAULT 0`).run();
    migrated = true;
  } catch (e) {
    const msg = String(e.message || '');
    if (msg.includes('duplicate column')) {
      migrated = true; // 已迁移过
    } else {
      console.error('schema migration retry later:', msg);
    }
  }
}
