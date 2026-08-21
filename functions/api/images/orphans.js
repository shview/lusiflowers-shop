import { json } from '../../_lib/auth.js';
import { referencedKeys } from '../../_lib/imgrefs.js';

// /api/images/orphans  孤儿图片检测、清理与旧格式迁移（需登录）
// images/ 孤儿 = R2 中存在但没有任何商品主图/描述、也没有被站点设置（图标/二维码）引用的展示图
// orig/  清理范围：与孤儿展示图同名配对的原图 + 旧格式残留（按上传时间无法与被引用展示图配对）
const PAIR_WINDOW_MS = 5000;

async function listAll(env, prefix) {
  const items = [];
  let cursor;
  do {
    const page = await env.BUCKET.list({ prefix, cursor });
    for (const obj of page.objects || []) {
      items.push({ key: obj.key, uploaded: obj.uploaded ? obj.uploaded.getTime() : 0, size: obj.size || 0 });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return items;
}

async function scan(env) {
  const [imageItems, origItems, thumbItems, refs] = await Promise.all([
    listAll(env, 'images/'),
    listAll(env, 'orig/'),
    listAll(env, 'thumb/'),
    referencedKeys(env),
  ]);
  const bytesOf = arr => arr.reduce((a, b) => a + (b.size || 0), 0);

  const imageSet = new Set(imageItems.map(i => i.key));
  const orphanImages = imageItems.filter(i => !refs.has(i.key)).map(i => i.key);
  const orphanSet = new Set(orphanImages);

  // 同名配对：孤儿展示图 → 原图（新格式）；展示图被引用 → 原图保留
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
  const legacyPairs = []; // [{orig, img}] 配对成功：旧格式原图 → 在售展示图
  const legacyOrphans = [];
  for (const o of legacyAll) {
    let best = null;
    for (const i of liveImages) {
      const d = Math.abs(i.uploaded - o.uploaded);
      if (d <= PAIR_WINDOW_MS && (!best || d < best.d)) best = { d, img: i.key };
    }
    if (best) legacyPairs.push({ orig: o.key, img: best.img });
    else legacyOrphans.push(o.key);
  }

  return { refs, imageItems, origItems, thumbItems, orphanImages, pairedOrphanOrigs, legacyPairs, legacyOrphans, bytesOf };
}

// GET：扫描并报告（不删除）
export async function onRequestGet(context) {
  const { env } = context;
  const r = await scan(env);
  const legacyLive = r.legacyPairs.length;
  return json({
    referenced: r.refs.size,
    images_total: r.imageItems.length,
    images_bytes: r.bytesOf(r.imageItems),
    orig_bytes: r.bytesOf(r.origItems),
    thumb_bytes: r.bytesOf(r.thumbItems),
    orig_total: r.origItems.length,
    orphan_images_total: r.orphanImages.length,
    orphan_images: r.orphanImages,
    legacy_orphan_origs: r.legacyOrphans,
    legacy_live_origs: legacyLive,
    legacy_note: r.legacyOrphans.length
      ? '另有 ' + r.legacyOrphans.length + ' 个旧格式原图与在售图片无法配对（判定为残留，可清理）；'
        + legacyLive + ' 个与在售图片配对成功（保留）'
      : (legacyLive ? '旧格式原图 ' + legacyLive + ' 个均已与在售图片配对（保留）' : ''),
  });
}

// POST：两个用途
//   {keys:[...]}          回收指定展示图中未被引用的（未保存自动回收用）
//   {action:'migrate_legacy'} 旧格式原图就地迁移：复制到与展示图同名的新格式位置后删除旧键；
//                              无法配对的残留直接删除
export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: '参数错误' }, 400);

  if (body.action === 'migrate_legacy') {
    const r = await scan(env);
    let migrated = 0;
    for (const pair of r.legacyPairs) {
      try {
        const obj = await env.BUCKET.get(pair.orig);
        if (!obj) continue;
        const imgName = pair.img.slice('images/'.length); // 含扩展名
        await env.BUCKET.put('orig/' + imgName, obj.body, {
          httpMetadata: obj.httpMetadata || undefined,
        });
        await env.BUCKET.delete(pair.orig);
        migrated++;
      } catch (e) { /* 单个失败不阻断 */ }
    }
    // 配不上对的残留：直接删除
    if (r.legacyOrphans.length) {
      await Promise.allSettled(r.legacyOrphans.map(k => env.BUCKET.delete(k)));
    }
    return json({ ok: true, migrated, deleted_orphans: r.legacyOrphans.length });
  }

  if (Array.isArray(body.keys) && body.keys.length) {
    const wanted = body.keys.filter(k => /^images\/[A-Za-z0-9._-]+$/.test(k));
    if (!wanted.length) return json({ ok: true, deleted: 0, kept: 0 });
    const refs = await referencedKeys(env);
    const doomed = wanted.filter(k => !refs.has(k));
    const all = [];
    doomed.forEach(k => {
      all.push(k, k.replace(/^images\//, 'orig/'), k.replace(/^images\//, 'thumb/'));
    });
    if (all.length) await Promise.allSettled(all.map(k => env.BUCKET.delete(k)));
    return json({ ok: true, deleted: doomed.length, kept: wanted.length - doomed.length });
  }

  return json({ error: '参数错误' }, 400);
}

// DELETE：清理孤儿（body.keys 可指定，默认全部孤儿）
export async function onRequestDelete(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => null);

  let doomed;
  if (body && Array.isArray(body.keys) && body.keys.length) {
    doomed = body.keys.filter(k =>
      (/^images\/[A-Za-z0-9._-]+$/.test(k) || /^orig\/[A-Za-z0-9._-]+$/.test(k) || /^thumb\/[A-Za-z0-9._-]+$/.test(k)) && !k.includes('..')
    );
  } else {
    const r = await scan(env);
    doomed = [];
    r.orphanImages.forEach(k => {
      doomed.push(k, k.replace(/^images\//, 'orig/'), k.replace(/^images\//, 'thumb/'));
    });
    doomed = doomed.concat(r.pairedOrphanOrigs, r.legacyOrphans);
  }

  if (!doomed.length) return json({ ok: true, deleted: 0 });
  await Promise.allSettled(doomed.map(k => env.BUCKET.delete(k)));
  return json({ ok: true, deleted: doomed.length });
}
