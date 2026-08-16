import { json } from '../_lib/auth.js';

// GET /api/categories  公开
export async function onRequestGet(context) {
  const { env } = context;
  const { results } = await env.DB.prepare(
    `SELECT id, name, sort FROM categories ORDER BY sort ASC, id ASC`
  ).all();
  return json({ categories: results });
}

// POST /api/categories { name }
export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => null);
  const name = body?.name?.trim();
  if (!name) return json({ error: '分类名不能为空' }, 400);

  try {
    const info = await env.DB.prepare(`INSERT INTO categories (name) VALUES (?)`).bind(name).run();
    return json({ id: info.meta.last_row_id });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return json({ error: '分类已存在' }, 409);
    throw e;
  }
}
