import { json } from '../../_lib/auth.js';

async function getOne(env, id) {
  const row = await env.DB.prepare(`SELECT id FROM products WHERE id = ?`).bind(id).first();
  return row;
}

// PUT /api/products/:id  更新商品（支持部分字段）
export async function onRequestPut(context) {
  const { request, env, params } = context;
  const id = Number(params.id);
  if (!(await getOne(env, id))) return json({ error: '商品不存在' }, 404);

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: '请求格式错误' }, 400);

  const allowed = ['name', 'price', 'description', 'image_url', 'link'];
  const sets = [];
  const binds = [];
  for (const k of allowed) {
    if (body[k] !== undefined) {
      sets.push(`${k} = ?`);
      binds.push(String(body[k]));
    }
  }
  if (body.category_id !== undefined) {
    sets.push(`category_id = ?`);
    binds.push(body.category_id === null || body.category_id === '' ? null : Number(body.category_id));
  }
  if (body.sort !== undefined) {
    sets.push(`sort = ?`);
    binds.push(Number(body.sort) || 0);
  }
  if (body.visible !== undefined) {
    sets.push(`visible = ?`);
    binds.push(body.visible ? 1 : 0);
  }
  if (sets.length === 0) return json({ error: '没有可更新的字段' }, 400);

  binds.push(id);
  await env.DB.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return json({ ok: true });
}

// DELETE /api/products/:id
export async function onRequestDelete(context) {
  const { env, params } = context;
  const id = Number(params.id);
  if (!(await getOne(env, id))) return json({ error: '商品不存在' }, 404);
  await env.DB.prepare(`DELETE FROM products WHERE id = ?`).bind(id).run();
  return json({ ok: true });
}
