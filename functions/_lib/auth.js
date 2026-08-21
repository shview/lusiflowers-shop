// 会话鉴权：登录后签发 HMAC 签名的 Cookie，API 中间件统一校验

const COOKIE_NAME = 'shop_admin';

async function hmac(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function makeSessionToken(secret, ttlMs = 12 * 3600 * 1000) {
  const exp = Date.now() + ttlMs;
  const sig = await hmac(secret, 'exp:' + exp);
  return `${exp}.${sig}`;
}

export async function verifySessionToken(env, token) {
  if (!token) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig) return false;
  if (Number(exp) < Date.now()) return false;
  const expect = await hmac(env.ADMIN_SESSION_SECRET, 'exp:' + exp);
  // 定长十六进制，直接比较即可
  return sig === expect;
}

export function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

export async function isAuthed(env, request) {
  const token = getCookie(request, COOKIE_NAME);
  return verifySessionToken(env, token);
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

export { COOKIE_NAME };

// Secure 标记仅在 https 下附加（本地 http 测试环境不支持 Secure Cookie）
export function cookieStr(value, maxAge, requestUrl) {
  const secure = String(requestUrl || "").startsWith("https") ? "; Secure" : "";
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly;${secure}; SameSite=Strict; Max-Age=${maxAge}`;
}
