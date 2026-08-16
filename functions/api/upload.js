import { json } from '../_lib/auth.js';

// POST /api/upload  multipart/form-data，字段名 file
// 图片存入 R2（BUCKET 绑定），返回可直接访问的 URL：/api/img/<key>
const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.BUCKET) return json({ error: '未绑定 R2 存储桶（BUCKET）' }, 500);

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') return json({ error: '未收到文件' }, 400);

  const ext = ALLOWED[file.type];
  if (!ext) return json({ error: '仅支持 JPG / PNG / GIF / WebP / AVIF 图片' }, 400);
  if (file.size > MAX_SIZE) return json({ error: '图片不能超过 10MB' }, 400);

  const key = `images/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  await env.BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType: file.type, cacheControl: 'public, max-age=31536000, immutable' },
  });

  return json({ url: `/api/img/${key}`, key });
}
