// GET /p/<id>  商品直达链接：返回首页 HTML，由前端脚本自动打开对应商品详情
export async function onRequestGet(context) {
  const { request, env, params } = context;
  const id = Number(params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return Response.redirect(new URL('/', request.url), 302);
  }

  let exists = false;
  try {
    const row = await env.DB.prepare(
      `SELECT id FROM products WHERE id = ? AND visible = 1`
    ).bind(id).first();
    exists = !!row;
  } catch (e) { /* 数据库异常时仍返回首页 */ }

  if (!exists) return Response.redirect(new URL('/', request.url), 302);

  const res = await env.ASSETS.fetch(new URL('/index.html', request.url));
  const html = await res.text();
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
}
