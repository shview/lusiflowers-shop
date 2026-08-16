import { json } from '../../../_lib/auth.js';

// POST /api/products/:id/view  浏览量 +1（公开，middleware 已放行）
export async function onRequestPost(context) {
  const { env, params } = context;
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: '参数错误' }, 400);
  await env.DB.prepare(`UPDATE products SET views = views + 1 WHERE id = ?`).bind(id).run();
  return json({ ok: true });
}
