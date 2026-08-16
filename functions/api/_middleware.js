import { isAuthed, json, getCookie } from '../_lib/auth.js';
import { ensureSchema } from '../_lib/schema.js';
import { viewCookieToken } from '../_lib/viewcode.js';

const VIEW_COOKIE = 'shop_view';

// 校验访客访问码 Cookie（开启保护时）
async function hasViewAccess(env, request) {
  let on = false, base = '';
  try {
    const rows = await env.DB.prepare(
      `SELECT key, value FROM settings WHERE key IN ('view_protect','view_password')`
    ).all();
    (rows.results || []).forEach(r => {
      if (r.key === 'view_protect') on = r.value === '1';
      if (r.key === 'view_password') base = r.value || '';
    });
  } catch (e) { return true; /* 读不到配置时不拦截 */
  }
  if (!on || !base) return true;

  const token = getCookie(request, VIEW_COOKIE);
  if (!token || !env.ADMIN_SESSION_SECRET) return false;
  return token === await viewCookieToken(env.ADMIN_SESSION_SECRET, base);
}

// /api/* 统一入口
export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // 顺带完成老库的缺列迁移（每 isolate 一次，失败不影响请求）
  try { await ensureSchema(env); } catch (e) { /* 忽略 */ }

  // 无需登录的公开入口
  if (path === '/api/login' || path === '/api/view') return next();

  // 浏览计数（公开，POST /api/products/:id/view）
  const isViewPing = request.method === 'POST' && /^\/api\/products\/\d+\/view$/.test(path);

  const publicRead =
    request.method === 'GET' &&
    (path === '/api/products' || path === '/api/categories' || path === '/api/settings' ||
     path.startsWith('/api/img/'));

  if (isViewPing || publicRead) {
    // 整站访问密码：仅拦数据接口，图片与浏览计数放行；管理员会话直接放行
    if (!isViewPing && !path.startsWith('/api/img/')) {
      const adminAuthed = getCookie(request, 'shop_admin') ? await isAuthed(env, request) : false;
      if (!adminAuthed && !(await hasViewAccess(env, request))) {
        return json({ error: '本站已开启访问密码', need_view_password: true }, 401);
      }
    }
    return next();
  }

  if (!(await isAuthed(env, request))) {
    return json({ error: '未登录或会话已过期' }, 401);
  }
  return next();
}
