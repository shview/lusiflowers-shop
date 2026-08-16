// 整站访问密码：支持固定口令与按时间自动轮换的动态访问码
// 访问码 = SHA-256(基础口令 + '|' + 时间桶).hex 前 8 位（大写），16^8 ≈ 43 亿组合
// 时间桶 = floor(当前小时 / 轮换小时数)；轮换关闭时桶恒为 0（访问码固定）

export async function effectiveViewCode(base, hours) {
  const h = Number(hours) || 0;
  const bucket = h > 0 ? Math.floor(Date.now() / 3600000 / h) : 0;
  const digest = await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(String(base) + '|' + bucket));
  const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 8).toUpperCase();
}

// 下次自动更换的时间戳（毫秒）；不轮换返回 null
export function nextRotateAt(hours) {
  const h = Number(hours) || 0;
  if (h <= 0) return null;
  const bucket = Math.floor(Date.now() / 3600000 / h);
  return (bucket + 1) * h * 3600000;
}

// 访问凭证 Cookie：与基础口令绑定，改口令即全部失效
export async function viewCookieToken(secret, base) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode('view-ok:' + base));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
