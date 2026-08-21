import { json } from '../_lib/auth.js';

// POST /api/upload  multipart/form-data
//   file: 展示用图片（后台已合成水印时即为带水印版本）
//   orig: 可选，原图（存私有前缀 orig/，不对外提供访问）
//   thumb: 可选，缩略图（存公开前缀 thumb/，供卡片/网格使用，与展示图同名）
// 文件名 = 内容 SHA-256 前 16 位：同一张图无论传几次都得到同一个地址，天然去重省存储
const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

async function sha256hex(buf) {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function checkImage(file) {
  const ext = ALLOWED[file.type];
  if (!ext) return { error: '仅支持 JPG / PNG / GIF / WebP / AVIF 图片' };
  if (file.size > MAX_SIZE) return { error: '图片不能超过 10MB' };
  return { ext };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.BUCKET) return json({ error: '未绑定 R2 存储桶（BUCKET）' }, 500);

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') return json({ error: '未收到文件' }, 400);

  const checked = checkImage(file);
  if (checked.error) return json({ error: checked.error }, 400);

  const buf = await file.arrayBuffer();
  const hash = (await sha256hex(buf)).slice(0, 16);
  const key = `images/${hash}.${checked.ext}`;
  await env.BUCKET.put(key, buf, {
    httpMetadata: { contentType: file.type, cacheControl: 'public, max-age=31536000, immutable' },
  });

  // 原图另存私有前缀，与展示图同名配对（删除/清理时按前缀替换即可找到）
  let origSaved = false;
  const orig = form?.get('orig');
  if (orig && typeof orig !== 'string' && /^image\//.test(orig.type)) {
    const oCheck = checkImage(orig);
    if (!oCheck.error) {
      const oBuf = await orig.arrayBuffer();
      const oHash = (await sha256hex(oBuf)).slice(0, 16);
      if (oHash !== hash) {
        await env.BUCKET.put(`orig/${hash}.${oCheck.ext}`, oBuf, {
          httpMetadata: { contentType: orig.type },
        });
        origSaved = true;
      }
    }
  }

  // 缩略图另存公开前缀（与展示图同名同扩展名，卡片/网格加载小图省流量）
  const thumb = form?.get('thumb');
  if (thumb && typeof thumb !== 'string' && /^image\//.test(thumb.type)) {
    const tCheck = checkImage(thumb);
    if (!tCheck.error) {
      // 扩展名跟随展示图，保证 thumb/<hash>.<ext> 与 images/<hash>.<ext> 名称可互推
      await env.BUCKET.put(`thumb/${hash}.${checked.ext}`, await thumb.arrayBuffer(), {
        httpMetadata: { contentType: thumb.type, cacheControl: 'public, max-age=31536000, immutable' },
      });
    }
  }

  return json({ url: `/api/img/${key}`, key, orig_saved: origSaved });
}
