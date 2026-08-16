import { json } from '../_lib/auth.js';
import { effectiveViewCode, viewCookieToken } from '../_lib/viewcode.js';

const COOKIE = 'shop_view';

// GET /api/view  前台探测是否启用了访问密码（公开）
export async function onRequestGet({ env }) {
  let on = false;
  try {
    const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'view_protect'`).first();
    on = row && row.value === '1';
  } catch (e) { /* 默认未开启 */ }
  return json({ protected: on });
}

// POST /api/view {password}  校验访问码，成功签发 7 天 Cookie
export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.ADMIN_SESSION_SECRET) {
    return json({ error: '服务端未配置签名密钥' }, 500);
  }

  let base = '';
  let hours = 0;
  try {
    const rows = await env.DB.prepare(
      `SELECT key, value FROM settings WHERE key IN ('view_password','view_pw_hours')`
    ).all();
    (rows.results || []).forEach(r => {
      if (r.key === 'view_password') base = r.value || '';
      if (r.key === 'view_pw_hours') hours = Number(r.value) || 0;
    });
  } catch (e) {
    return json({ error: '读取配置失败' }, 500);
  }
  if (!base) return json({ error: '未设置访问口令' }, 500);

  const body = await request.json().catch(() => null);
  const input = body && typeof body.password === 'string' ? body.password.trim().toUpperCase() : '';

  const expected = await effectiveViewCode(base, hours);
  if (!input || input !== expected) {
    // 拖慢爆破：每次失败固定延迟 800ms（Workers 并发下也显著降低尝试速率）
    await new Promise(r => setTimeout(r, 800));
    return json({ error: '访问码不正确' }, 401);
  }

  const token = await viewCookieToken(env.ADMIN_SESSION_SECRET, base);
  return json({ ok: true }, 200, {
    'Set-Cookie': `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`,
  });
}

export { COOKIE };
