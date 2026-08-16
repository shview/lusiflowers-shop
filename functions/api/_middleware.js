import { isAuthed, json } from '../_lib/auth.js';

// /api/* 统一入口
// 放行：登录接口；前台公开只读接口（GET /api/products|categories|settings）
// 其余（写操作、上传、登出）一律要求已登录
export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/api/login') return next();

  const publicRead =
    request.method === 'GET' &&
    (path === '/api/products' || path === '/api/categories' || path === '/api/settings' ||
     path.startsWith('/api/img/'));

  if (publicRead) return next();

  if (!(await isAuthed(env, request))) {
    return json({ error: '未登录或会话已过期' }, 401);
  }
  return next();
}
