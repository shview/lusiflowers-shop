import { makeSessionToken, json, COOKIE_NAME, isAuthed } from '../_lib/auth.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.ADMIN_PASSWORD) {
    return json({ error: '未配置 ADMIN_PASSWORD 环境变量，请先在 Cloudflare 控制台设置' }, 500);
  }
  if (!env.ADMIN_SESSION_SECRET) {
    return json({ error: '未配置 ADMIN_SESSION_SECRET 环境变量，请先在 Cloudflare 控制台设置' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }

  // 防暴力破解：固定延迟，降低试错速度
  await new Promise(r => setTimeout(r, 300));

  if (typeof body.password !== 'string' || body.password !== env.ADMIN_PASSWORD) {
    return json({ error: '密码错误' }, 401);
  }

  const token = await makeSessionToken(env.ADMIN_SESSION_SECRET);
  return json({ ok: true }, 200, {
    'Set-Cookie': `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`,
  });
}

// 已登录状态下探测会话是否有效（后台页面刷新时用）
export async function onRequestGet(context) {
  const ok = await isAuthed(context.env, context.request);
  return json({ authed: ok }, ok ? 200 : 401);
}
