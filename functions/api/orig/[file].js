// GET /api/orig/<file>  下载原图（私有前缀，仅管理员；middleware 已拦截未登录请求）
export async function onRequestGet(context) {
  const { params, env } = context;
  const file = decodeURIComponent(params.file || '');

  if (!/^[A-Za-z0-9._-]+$/.test(file) || file.includes('..')) {
    return new Response('Not found', { status: 404 });
  }

  const obj = await env.BUCKET.get('orig/' + file);
  if (!obj) return new Response('原图不存在', { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('Content-Disposition', 'attachment; filename="' + file + '"');
  headers.set('Cache-Control', 'no-store');
  return new Response(obj.body, { headers });
}
