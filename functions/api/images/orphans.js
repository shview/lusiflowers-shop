import { json } from '../../_lib/auth.js';

// /api/images/orphans  孤儿图片检测与清理（需登录）
// images/ 孤儿 = R2 中存在但没有任何商品（含隐藏）的主图/描述引用的展示图 → 可安全清理
// orig/  清理范围：
//   a) 与孤儿展示图同名配对的原图（新命名格式）
//   b) 旧格式原图（按自身内容哈希命名，无法按名配对）：按上传时间戳与「被引用展示图」
//      就近配对（±5 秒内视为同一次上传的展示图+原图），配不上的视为孤儿
const PAIR_WINDOW_MS = 5000;

async function listAll(env, prefix) {
  const items = [];
  let cursor;
  do {
    const page = await env.BUCKET.list({ prefix, cursor });
    for (const obj of page.objects || []) {
      items.push({ key: obj.key, uploaded: obj.uploaded ? obj.uploaded.getTime() : 0 });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return items;
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
  const [imageItems, origItems, refs] = await Promise.all([
    listAll(env, 'images/'),
    listAll(env, 'orig/'),
    referencedKeys(env),
  ]);

  const imageSet = new Set(imageItems.map(i => i.key));
  const orphanImages = imageItems.filter(i => !refs.has(i.key)).map(i => i.key);
  const orphanSet = new Set(orphanImages);

  // 同名配对：孤儿展示图 → 原图（新格式）；展示图仍被引用 → 原图保留
  const pairedOrphanOrigs = origItems
    .filter(o => orphanSet.has('images/' + o.key.slice('orig/'.length)))
    .map(o => o.key);
  const namePairedLive = origItems
    .filter(o => {
      const img = 'images/' + o.key.slice('orig/'.length);
      return imageSet.has(img) && !orphanSet.has(img);
    })
    .map(o => o.key);

  // 旧格式原图：按上传时间与被引用展示图就近配对
  const liveImages = imageItems.filter(i => refs.has(i.key));
  const legacyAll = origItems.filter(o =>
    !pairedOrphanOrigs.includes(o.key) && !namePairedLive.includes(o.key)
  );
  const legacyOrphans = legacyAll
    .filter(o => !liveImages.some(i => Math.abs(i.uploaded - o.uploaded) <= PAIR_WINDOW_MS))
    .map(o => o.key);
  const legacyLive = legacyAll
    .filter(o => liveImages.some(i => Math.abs(i.uploaded - o.uploaded) <= PAIR_WINDOW_MS))
    .map(o => o.key);

  return {
    refs,
    imageItems,
    orphanImages,
    pairedOrphanOrigs,
    legacyOrphans,
    legacyLive,
  };
}

// GET：扫描并报告（不删除）
export async function onRequestGet(context) {
  const { env } = context;
  const r = await scan(env);
  const cleanable = r.orphanImages.length + r.pairedOrphanOrigs.length + r.legacyOrphans.length;
  return json({
    referenced: r.refs.size,
    images_total: r.imageItems.length,
    orphan_images_total: r.orphanImages.length,
    orphan_images: r.orphanImages,
    legacy_orphan_origs: r.legacyOrphans,
    legacy_live_origs: r.legacyLive.length,
    legacy_note: r.legacyOrphans.length
      ? '另有 ' + r.legacyOrphans.length + ' 个旧格式原图与在售图片无法配对（按上传时间判定为残留，可清理）；'
        + r.legacyLive.length + ' 个与在售图片配对成功（保留）'
      : (r.legacyLive.length ? '旧格式原图 ' + r.legacyLive.length + ' 个均已与在售图片配对（保留）' : ''),
  });
}

// POST：清理指定 keys 中「未被任何商品引用」的展示图（未保存自动回收用）
// 返回实际删除数；被其他商品引用的同名图会被保留
export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.keys) || !body.keys.length) return json({ error: '参数错误' }, 400);

  const wanted = body.keys.filter(k => /^images\/[A-Za-z0-9._-]+$/.test(k));
  if (!wanted.length) return json({ ok: true, deleted: 0, kept: 0 });

  const refs = await referencedKeys(env);
  const doomed = wanted.filter(k => !refs.has(k));
  // 同名原图一并清理（存在才删，不存在为空操作）
  const all = [];
  doomed.forEach(k => { all.push(k, k.replace(/^images\//, 'orig/')); });
  if (all.length) await Promise.allSettled(all.map(k => env.BUCKET.delete(k)));
  return json({ ok: true, deleted: doomed.length, kept: wanted.length - doomed.length });
}

// DELETE：清理孤儿展示图 + 配对原图 + 旧格式残留原图（body.keys 可指定，默认全部）
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
    doomed = r.orphanImages.concat(r.pairedOrphanOrigs, r.legacyOrphans);
  }

  if (!doomed.length) return json({ ok: true, deleted: 0 });
  await Promise.allSettled(doomed.map(k => env.BUCKET.delete(k)));
  return json({ ok: true, deleted: doomed.length });
}
