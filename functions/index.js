// GET /  首页：注入浏览器标题、favicon 与（开启时的）OG 分享卡片信息
// 微信/QQ/微博等抓取的是 HTML 源码（不执行 JS），因此由服务端写入 meta 标签。
export async function onRequestGet(context) {
  const { request, env } = context;

  const res = await env.ASSETS.fetch(new URL('/index.html', request.url));
  if (res.status !== 200) return res;
  let html = await res.text();

  let title = '商品展示';
  let desc = '';
  let image = '';
  let ogOn = false;
  let favicon = '';

  try {
    const settingsRows = await env.DB.prepare('SELECT key, value FROM settings').all();
    const s = {};
    (settingsRows.results || []).forEach(r => { s[r.key] = r.value; });
    title = s.home_title || s.site_name || title;
    desc = String(s.announcement || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    ogOn = s.og_on === '1';
    if (s.favicon_url) favicon = new URL(s.favicon_url, request.url).href;

    if (ogOn) {
      const firstProduct = await env.DB.prepare(
        `SELECT image_url FROM products WHERE visible = 1 AND image_url != '' ORDER BY sort ASC, id DESC LIMIT 1`
      ).first();
      if (firstProduct && firstProduct.image_url) {
        image = new URL(firstProduct.image_url, request.url).href;
      }
    }
  } catch (e) {
    // 数据库不可用时保留默认值，不影响页面
  }

  const esc = v => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  if (ogOn) {
    const img = image || new URL('/favicon.svg', request.url).href;
    html = html
      .replaceAll('__OG_TITLE__', esc(title))
      .replaceAll('__OG_DESC__', esc(desc))
      .replaceAll('__OG_IMAGE__', img);
  } else {
    // 关闭分享卡片时移除 og 标签（避免抓取器读到空内容）
    html = html
      .replace(/[ \t]*<meta property="og:[^>]*>\n/g, '')
      .replaceAll('__OG_TITLE__', esc(title))
      .replaceAll('__OG_DESC__', esc(desc))
      .replaceAll('__OG_IMAGE__', '');
  }

  if (!favicon) favicon = new URL('/favicon.svg', request.url).href;
  html = html.replaceAll('__FAVICON_URL__', favicon);

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
}
