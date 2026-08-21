import { json, isAuthed } from '../_lib/auth.js';
import { effectiveViewCode, nextRotateAt } from '../_lib/viewcode.js';
import { imgKeysFromUrls, referencedKeys } from '../_lib/imgrefs.js';

// GET /api/settings  公开（脱敏：不返回访问口令）；登录后附加访问码信息
export async function onRequestGet(context) {
  const { request, env } = context;
  const { results } = await env.DB.prepare(`SELECT key, value FROM settings`).all();
  const settings = {};
  for (const row of results) settings[row.key] = row.value;

  const authed = await isAuthed(env, request);
  if (!authed) {
    // 敏感项不对外
    delete settings.view_password;
  } else {
    settings._view = {
      code: settings.view_password ? await effectiveViewCode(settings.view_password, settings.view_pw_hours) : '',
      next_rotate_at: nextRotateAt(settings.view_pw_hours),
    };
  }
  return json({ settings });
}

// PUT /api/settings { key: value, ... }  整体保存
export async function onRequestPut(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: '请求格式错误' }, 400);

  const allowed = ['site_name', 'home_title', 'favicon_url', 'announcement', 'watermark_on', 'og_on',
                   'view_protect', 'view_password', 'view_pw_hours', 'compress_on',
                   'contact_on', 'contact_img', 'contact_text', 'contact_link'];

  // 记录图标/二维码的旧值，保存后用于回收被替换的图片
  const oldImg = { favicon_url: '', contact_img: '' };
  try {
    const rows = await env.DB.prepare(
      `SELECT key, value FROM settings WHERE key IN ('favicon_url', 'contact_img')`
    ).all();
    (rows.results || []).forEach(r => { oldImg[r.key] = r.value || ''; });
  } catch (e) { /* 忽略 */ }

  const stmts = [];
  for (const [k, v] of Object.entries(body)) {
    if (!allowed.includes(k)) continue;
    stmts.push(env.DB.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).bind(k, String(v ?? '')));
  }
  if (!stmts.length) return json({ error: '没有可保存的设置' }, 400);
  await env.DB.batch(stmts);

  // 图标/二维码被替换或移除时，旧图若无其他引用则回收（尽力而为，失败不影响保存）
  try {
    for (const key of ['favicon_url', 'contact_img']) {
      const oldV = oldImg[key];
      const newV = body[key] !== undefined ? String(body[key] ?? '') : oldV;
      if (!oldV || oldV === newV) continue;
      const oldKeys = [...imgKeysFromUrls([oldV])];
      if (!oldKeys.length || !env.BUCKET) continue;
      const refs = await referencedKeys(env);
      const doomed = oldKeys.flatMap(k => !refs.has(k)
        ? [k, k.replace(/^images\//, 'orig/'), k.replace(/^images\//, 'thumb/')] : []);
      if (doomed.length) await Promise.allSettled(doomed.map(k => env.BUCKET.delete(k)));
    }
  } catch (e) { console.error('replace image recycle failed:', e.message); }

  return json({ ok: true });
}
