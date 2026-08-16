import { json } from '../../_lib/auth.js';

async function getOne(env, id) {
  const row = await env.DB.prepare(`SELECT id FROM products WHERE id = ?`).bind(id).first();
  return row;
}

// 从 image_url 与描述 Markdown 中提取本站托管的图片 key（仅 /api/img/images/<file> 形式）
function extractImageKeys(product) {
  const urls = [];
  if (product.image_url) urls.push(product.image_url);
  const mdImages = String(product.description || '').match(/!\[[^\]]*\]\([^)\s]+\)/g) || [];
  for (const m of mdImages) {
    const u = m.match(/\(([^)\s]+)\)$/);
    if (u) urls.push(u[1]);
  }

  const keys = new Set();
  for (const raw of urls) {
    let pathname;
    try {
      pathname = /^https?:\/\//i.test(raw) ? new URL(raw).pathname : raw;
    } catch {
      continue;
    }
    const m = pathname.match(/^\/api\/img\/images\/([A-Za-z0-9._-]+)$/);
    if (m && !m[1].includes('..')) keys.add('images/' + m[1]);
  }
  return [...keys];
}

// 该 key 是否仍被其他商品引用（主图或描述中出现）
async function isReferencedElsewhere(env, key, excludeId) {
  const { results } = await env.DB.prepare(
    `SELECT image_url, description FROM products WHERE id != ?`
  ).bind(excludeId).all();
  return (results || []).some(p => p.image_url?.includes(key) || p.description?.includes(key));
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
  if (body.sold_out !== undefined) {
    sets.push(`sold_out = ?`);
    binds.push(body.sold_out ? 1 : 0);
  }
  if (sets.length === 0) return json({ error: '没有可更新的字段' }, 400);

  binds.push(id);
  await env.DB.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return json({ ok: true });
}

// DELETE /api/products/:id  删除商品，并同步清理 R2 中它独占引用的图片
export async function onRequestDelete(context) {
  const { env, params } = context;
  const id = Number(params.id);

  const product = await env.DB.prepare(
    `SELECT id, image_url, description FROM products WHERE id = ?`
  ).bind(id).first();
  if (!product) return json({ error: '商品不存在' }, 404);

  await env.DB.prepare(`DELETE FROM products WHERE id = ?`).bind(id).run();

  let removed = 0;
  const keys = extractImageKeys(product);
  if (keys.length && env.BUCKET) {
    const doomed = new Set();
    for (const key of keys) {
      // 仍被其他商品引用的图片保留，避免误删共用图
      if (!(await isReferencedElsewhere(env, key, id))) {
        doomed.add(key);
        // 对应的私有原图（水印模式下另存的 orig/ 前缀）一并清理
        doomed.add(key.replace(/^images\//, 'orig/'));
      }
    }
    // 尽力而为：清理失败不影响商品删除结果，仅留下孤儿文件
    await Promise.allSettled([...doomed].map(key => env.BUCKET.delete(key)));
    removed = [...doomed].filter(k => k.startsWith('images/')).length;
  }

  return json({ ok: true, removed_images: removed });
}
