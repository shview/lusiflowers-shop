import { json, isAuthed } from '../_lib/auth.js';

// GET /api/products?category=<id>  前台只返回 visible=1；?all=1 仅登录后有效
// POST /api/products  新增商品
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const categoryId = url.searchParams.get('category');
  const includeHidden = url.searchParams.get('all') === '1' && (await isAuthed(env, request));

  let sql = `
    SELECT p.id, p.name, p.category_id, p.price, p.description, p.image_url, p.link, p.sort, p.visible, p.sold_out, p.views, p.created_at,
           c.name AS category_name
    FROM products p LEFT JOIN categories c ON c.id = p.category_id
    WHERE 1=1`;
  const binds = [];
  if (!includeHidden) sql += ` AND p.visible = 1`;
  if (categoryId && categoryId !== 'all') {
    sql += ` AND p.category_id = ?`;
    binds.push(Number(categoryId));
  }
  sql += ` ORDER BY p.sort ASC, p.id DESC`;

  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return json({ products: results });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.name !== 'string' || !body.name.trim()) {
    return json({ error: '商品名称不能为空' }, 400);
  }

  const stmt = env.DB.prepare(`
    INSERT INTO products (name, category_id, price, description, image_url, link, sort, visible, sold_out)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const info = await stmt.bind(
    body.name.trim(),
    body.category_id ? Number(body.category_id) : null,
    String(body.price ?? ''),
    String(body.description ?? ''),
    String(body.image_url ?? ''),
    String(body.link ?? ''),
    Number(body.sort ?? 0) || 0,
    body.visible === false ? 0 : 1,
    body.sold_out ? 1 : 0,
  ).run();

  return json({ id: info.meta.last_row_id });
}
