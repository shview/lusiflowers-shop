import { json } from '../../_lib/auth.js';

// PUT /api/categories/:id { name?, sort? }
export async function onRequestPut(context) {
  const { request, env, params } = context;
  const id = Number(params.id);
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: '请求格式错误' }, 400);

  const sets = [];
  const binds = [];
  if (body.name !== undefined && body.name.trim()) {
    sets.push(`name = ?`);
    binds.push(body.name.trim());
  }
  if (body.sort !== undefined) {
    sets.push(`sort = ?`);
    binds.push(Number(body.sort) || 0);
  }
  if (!sets.length) return json({ error: '没有可更新的字段' }, 400);

  binds.push(id);
  try {
    await env.DB.prepare(`UPDATE categories SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
    return json({ ok: true });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return json({ error: '分类已存在' }, 409);
    throw e;
  }
}

// DELETE /api/categories/:id  分类下的商品会被置为"无分类"，不会删除商品
export async function onRequestDelete(context) {
  const { env, params } = context;
  const id = Number(params.id);
  await env.DB.batch([
    env.DB.prepare(`UPDATE products SET category_id = NULL WHERE category_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM categories WHERE id = ?`).bind(id),
  ]);
  return json({ ok: true });
}
