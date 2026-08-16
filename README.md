# 商品展示网站（Cloudflare Pages + D1 + R2）

零服务器、零持续成本的商品展示站。前台复刻 shop.mhdy.net 的展示版式（导航 / 公告 / 分类标签 / 商品卡片），
带一个完全网页操作的 `/admin` 后台，适合不会命令行的使用者日常维护。

- 前台：`/`（静态页，fetch API 渲染商品）
- 后台：`/admin`（密码登录，商品增删改 / 图片上传 / 分类管理 / 公告与站名编辑）
- 数据：Cloudflare D1（SQLite）
- 图片：Cloudflare R2（后台上传，经 `/api/img/...` 公开访问，长缓存）
- 鉴权：密码存 Cloudflare 环境变量，登录签发 HMAC 签名的 HttpOnly Cookie（12 小时有效）

## 目录结构

```
shop-site/
├── public/              静态资源（Pages 托管）
│   ├── index.html       前台
│   ├── assets/          前台 CSS/JS
│   └── admin/           后台 SPA
├── functions/           Pages Functions（API 层）
│   ├── _lib/auth.js     会话签发与校验
│   └── api/             login / products / categories / settings / upload / img
├── schema.sql           D1 初始化脚本（部署时执行一次）
├── wrangler.toml        Pages 配置（D1/R2 绑定）
└── .dev.vars            本地开发密钥（勿提交，线上用控制台变量）
```

## 本地开发

```bash
npm i -g wrangler        # 或用 npx
npx wrangler d1 execute shop-showcase --local --file=schema.sql
npx wrangler pages dev   # 默认 http://127.0.0.1:8787，读取 .dev.vars
```

`.dev.vars` 内容（本地测试用，自行修改）：

```
ADMIN_PASSWORD=test123456
ADMIN_SESSION_SECRET=local-dev-secret-change-me
```

## 部署到 Cloudflare（约 15 分钟，全部在控制台点击完成）

### 1. 创建 D1 数据库

控制台 → Storage & Databases → D1 → Create database，名称 `shop-showcase`。
创建后进入该库 → Console 标签 → 把 `schema.sql` 的内容粘贴进去 → Execute。

记下库概览页的 **Database ID**，稍后填入 `wrangler.toml`。

### 2. 创建 R2 存储桶

控制台 → R2 → Create bucket，名称 `shop-showcase-images`（保持私有即可，
图片通过 Functions 读取，无需开启公开访问）。

> 首次使用 R2 可能要求先开通（免费，需绑卡但免费层内不扣费：
> 10GB 存储 / 每月 A 类操作 100 万次 / B 类 1000 万次免费）。

### 3. 创建 Pages 项目并上传代码

最简单的方式：把 `shop-site/` 目录推到一个 **私有 GitHub 仓库**，
然后控制台 → Workers & Pages → Create → Pages → Connect to Git，选中该仓库：

- Build command：留空
- Output directory：`public`

也可以不接 Git：Workers & Pages → Create → Pages → Upload assets，直接拖 `public` 目录，
然后在项目 Settings → Functions 里确保 `functions/` 目录随仓库存在（直传方式不带 Functions，
**推荐用 Git 方式**）。

### 4. 绑定 D1 与 R2

Pages 项目 → Settings → Bindings：

- Add → D1 database：Variable name 填 `DB`，选择 `shop-showcase`
- Add → R2 bucket：Variable name 填 `BUCKET`，选择 `shop-showcase-images`

同时把 `wrangler.toml` 中的 `database_id` 替换为第 1 步记下的真实 ID。

### 5. 设置环境变量（后台密码）

Pages 项目 → Settings → Environment variables：

| 名称 | 值 | 说明 |
|---|---|---|
| `ADMIN_PASSWORD` | 自己想一个强密码 | 后台登录密码，随时可改 |
| `ADMIN_SESSION_SECRET` | 一长串随机字符（如 32 位以上随机串） | 会话签名密钥，泄露等于密码泄露 |

改完密码后需点 Deployments → 重新部署一次才会生效。

### 6. 绑定域名

Pages 项目 → Custom domains → Set up a custom domain → 输入你的域名。

- 域名 DNS 在 Cloudflare：自动加记录，零配置
- 域名 DNS 在别处：去域名商把 `www` 或 `@` 的 CNAME 指向 `<项目名>.pages.dev`

### 7. 验证

- 打开 `https://你的域名/` → 应显示默认公告与"推荐"分类
- 打开 `https://你的域名/admin` → 用密码登录 → 新增第一个商品

## 安全说明

- 后台写操作全部要求有效会话 Cookie；密码错误有 300ms 延迟减缓爆破
- 会话 Cookie：HttpOnly + Secure + SameSite=Strict，12 小时过期
- 图片路由做了路径穿越过滤；上传仅收图片 MIME 且限 10MB
- 前台渲染一律用 textContent，无 innerHTML，无 XSS 注入面

## 日常使用

见 [USAGE.md](USAGE.md)（交给使用者的图文操作指南）。

