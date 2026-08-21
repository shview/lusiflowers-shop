// 图片引用统计（商品 + 站点设置），孤儿检测与回收共用
export function imgKeysFromUrls(urls) {
  const keys = new Set();
  for (const raw of urls) {
    let pathname;
    try {
      pathname = /^https?:\/\//i.test(raw) ? new URL(raw).pathname : String(raw);
    } catch (e) { continue; }
    const m = String(pathname).match(/^\/api\/img\/images\/([A-Za-z0-9._-]+)$/);
    if (m && !m[1].includes('..')) keys.add('images/' + m[1]);
  }
  return keys;
}

export async function referencedKeys(env) {
  const out = new Set();

  // 商品：主图 + 描述
  const { results } = await env.DB.prepare(`SELECT image_url, description FROM products`).all();
  for (const p of results || []) {
    const urls = [p.image_url || ''];
    const md = String(p.description || '').match(/!\[[^\]]*\]\([^)\s]+\)/g) || [];
    for (const m of md) {
      const u = m.match(/\(([^)\s]+)\)$/);
      if (u) urls.push(u[1]);
    }
    imgKeysFromUrls(urls).forEach(k => out.add(k));
  }

  // 站点设置：网站图标 + 联系浮窗二维码
  try {
    const s = await env.DB.prepare(
      `SELECT value FROM settings WHERE key IN ('favicon_url', 'contact_img')`
    ).all();
    for (const row of s.results || []) {
      imgKeysFromUrls([row.value || '']).forEach(k => out.add(k));
    }
  } catch (e) { /* 忽略 */ }

  return out;
}
