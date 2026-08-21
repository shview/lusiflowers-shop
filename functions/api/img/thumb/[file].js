// GET /api/img/thumb/<file>  从 R2 读取缩略图并返回（公开只读）
// 路径固定为 thumb/<file>，与上传接口写入的 key 一致；无缩略图时前端回退展示大图
export async function onRequestGet(context) {
  const { params, env } = context;
  const file = decodeURIComponent(params.file || '');

  if (!/^[A-Za-z0-9._-]+$/.test(file) || file.includes('..')) {
    return new Response('Not found', { status: 404 });
  }

  const obj = await env.BUCKET.get(`thumb/${file}`);
  if (!obj) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('ETag', obj.httpEtag);
  return new Response(obj.body, { headers });
}
