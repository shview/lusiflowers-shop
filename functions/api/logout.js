import { json, COOKIE_NAME } from '../_lib/auth.js';

export async function onRequestPost() {
  return json({ ok: true }, 200, {
    'Set-Cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
  });
}
