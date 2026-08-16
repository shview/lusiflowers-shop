// GET /api/img/images/xxx.png  从 R2 读取图片并返回（公开只读）
// 路径固定为 images/<file>，与上传接口写入的 key 一致
export async function onRequestGet(context) {
  const { params, env } = context;
  const file = decodeURIComponent(params.file || '');

  if (!file || file.includes('..') || file.includes('/')) {
    return new Response('Not found', { status: 404 });
  }

  const key = `images/${file}`;
  const obj = await env.BUCKET.get(key);
  if (!obj) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('ETag', obj.httpEtag);
  return new Response(obj.body, { headers });
}
