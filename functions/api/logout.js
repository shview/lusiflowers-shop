import { json, cookieStr } from '../_lib/auth.js';

export async function onRequestPost(context) {
  return json({ ok: true }, 200, {
    'Set-Cookie': cookieStr('', 0, context.request.url),
  });
}
