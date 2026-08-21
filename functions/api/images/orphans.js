import { json } from '../../_lib/auth.js';

// /api/images/orphans  孤儿图片检测与清理（需登录）
// images/ 孤儿 = R2 中存在但没有任何商品（含隐藏）的主图/描述引用的展示图 → 可安全清理
// orig/  自动清理仅限「与孤儿展示图同名配对」的原图（新命名格式）
//        旧格式原图（按自身内容哈希命名，无法与展示图配对）只统计报告，不自动删
async function listAll(env, prefix) {
  const keys = [];
  let cursor;
  do {
    const page = await env.BUCKET.list({ prefix, cursor });
    for (const obj of page.objects || []) keys.push(obj.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return keys;
}

async function referencedKeys(env) {
  const { results } = await env.DB.prepare(
    `SELECT image_url, description FROM products`
  ).all();
  const refs = new Set();
  for (const p of results || []) {
    const urls = [p.image_url || ''];
    const md = String(p.description || '').match(/!\[[^\]]*\]\(([^)\s]+)\)/g) || [];
    for (const m of md) {
      const u = m.match(/\(([^)\s]+)\)$/);
      if (u) urls.push(u[1]);
    }
    for (const raw of urls) {
      let pathname;
      try {
        pathname = /^https?:\/\//i.test(raw) ? new URL(raw).pathname : raw;
      } catch (e) { continue; }
      const m = pathname.match(/^\/api\/img\/images\/([A-Za-z0-9._-]+)$/);
      if (m) refs.add('images/' + m[1]);
    }
  }
  return refs;
}

async function scan(env) {
  const [imageKeys, origKeys, refs] = await Promise.all([
    listAll(env, 'images/'),
    listAll(env, 'orig/'),
    referencedKeys(env),
  ]);

  const imageSet = new Set(imageKeys);
  const orphanImages = imageKeys.filter(k => !refs.has(k));
  const orphanSet = new Set(orphanImages);

  // 与孤儿展示图同名配对的原图（新格式）→ 可随孤儿一起清理
  const pairedOrphanOrigs = origKeys.filter(k => orphanSet.has('images/' + k.slice('orig/'.length)));
  // 有展示图对应且展示图仍被引用的原图 = 正常；剩下的旧格式原图无法自动配对
  const livePaired = origKeys.filter(k => {
    const img = 'images/' + k.slice('orig/'.length);
    return imageSet.has(img) && !orphanSet.has(img);
  });
  const legacyOrigs = origKeys.filter(k => !pairedOrphanOrigs.includes(k) && !livePaired.includes(k));

  return {
    refs,
    imageKeys,
    orphanImages,
    pairedOrphanOrigs,
    legacyOrigs,
  };
}

// GET：扫描并报告（不删除）
export async function onRequestGet(context) {
  const { env } = context;
  const r = await scan(env);
  return json({
    referenced: r.refs.size,
    images_total: r.imageKeys.length,
    orphan_images_total: r.orphanImages.length,
    orphan_images: r.orphanImages,
    cleanable_total: r.orphanImages.length + r.pairedOrphanOrigs.length,
    legacy_orig_total: r.legacyOrigs.length,
    legacy_note: r.legacyOrigs.length
      ? '另有 ' + r.legacyOrigs.length + ' 个旧格式原文件无法自动配对（不参与自动清理，如需处理请手动核对 R2 orig/ 前缀）'
      : '',
  });
}

// DELETE：清理孤儿展示图 + 其配对原图（body.keys 可指定，默认全部）
export async function onRequestDelete(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => null);

  let doomed;
  if (body && Array.isArray(body.keys) && body.keys.length) {
    doomed = body.keys.filter(k =>
      (/^images\/[A-Za-z0-9._-]+$/.test(k) || /^orig\/[A-Za-z0-9._-]+$/.test(k)) && !k.includes('..')
    );
  } else {
    const r = await scan(env);
    doomed = r.orphanImages.concat(r.pairedOrphanOrigs);
  }

  if (!doomed.length) return json({ ok: true, deleted: 0 });
  await Promise.allSettled(doomed.map(k => env.BUCKET.delete(k)));
  return json({ ok: true, deleted: doomed.length });
}
