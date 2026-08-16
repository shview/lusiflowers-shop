import { json } from '../_lib/auth.js';

// GET /api/export  导出全部数据（需登录，middleware 已拦截）
export async function onRequestGet(context) {
  const { env } = context;
  const [cats, prods, sets] = await Promise.all([
    env.DB.prepare('SELECT id, name, sort FROM categories ORDER BY sort ASC, id ASC').all(),
    env.DB.prepare(`
      SELECT id, name, category_id, price, description, image_url, link, sort, visible, sold_out, created_at
      FROM products ORDER BY sort ASC, id DESC`).all(),
    env.DB.prepare('SELECT key, value FROM settings').all(),
  ]);

  return json({
    exported_at: new Date().toISOString(),
    categories: cats.results || [],
    products: prods.results || [],
    settings: sets.results || [],
  });
}
