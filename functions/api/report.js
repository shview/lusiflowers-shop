import { json } from '../_lib/auth.js';

// GET /api/report  浏览报表（需登录）：TOP5 商品 + 近 7 天每日浏览总量
export async function onRequestGet({ env }) {
  const [top, trend] = await Promise.all([
    env.DB.prepare(
      `SELECT id, name, views FROM products ORDER BY views DESC, sort ASC, id ASC LIMIT 5`
    ).all(),
    env.DB.prepare(
      `SELECT day, SUM(views) AS v FROM product_views_daily
       WHERE day >= date('now', '-6 days') GROUP BY day ORDER BY day ASC`
    ).all(),
  ]);
  return json({ top: top.results || [], trend: trend.results || [] });
}
