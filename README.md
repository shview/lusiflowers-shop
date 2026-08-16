# 商品展示站（Cloudflare Pages 全托管）

一个零服务器、零持续成本的纯展示型商品网站。前台为发卡站式版式（导航 / 公告 / 分类 / 商品卡片），
带一个完全网页操作的可视化后台，适合不会命令行的人日常维护。不涉及支付与订单。

## 功能一览

**前台**

- 商品卡片网格、分类标签（带数量角标）、即时搜索、价格/上架时间正反排序
- 商品详情弹窗：主图 + 描述图片自动轮播（箭头/圆点/键盘），点击全屏放大（灯箱）
- 商品描述支持 Markdown 图文（安全渲染器，白名单标签）
- 缺货状态：自动排到末尾、图片蒙灰加角标
- 公告弹窗（首次访问或内容更新自动弹出一次）
- 亮暗色主题：跟随系统自动切换 + 手动三档开关
- 联系浮窗：右下角客服按钮 + 二维码/文案/跳转链接
- 商品浏览量统计（打开详情即计数）
- SEO/OG 分享卡片（可选，服务端注入站名/公告/首图）
- 整站访问密码（可选）：固定或按 1/6/24/72 小时自动轮换的动态访问码

**后台 `/admin`**（密码登录，HttpOnly Cookie 会话）

- 商品增删改、复制、隐藏/显示、缺货标记、浏览量展示
- 拖拽排序（全局顺序感知，筛选分类后拖拽不错乱）、上移/下移
- 分类筛选查看类内排序；分类管理
- 图片上传：主图/描述图/图标/二维码均支持按钮选择、拖拽、粘贴
- Markdown 描述编辑器：工具栏 + 富文本粘贴自动转 MD + 实时预览 + 批量多图
- 站点设置：站名、主页标题、网站图标、公告、水印/压图/OG/访问密码/联系浮窗开关
- 数据导出 JSON

**图片管线**

- 上传即把站名水印烧进像素（可选，默认开），原图另存私有前缀不对外
- 文件名 = 内容 SHA-256 前 16 位：同图同 URL，天然去重省存储
- 可选自动压图（>1500px 等比缩到 1500px）
- 删除商品联动清理展示图与原图（共享图保护，不误删他用图）

## 技术架构

```
Cloudflare Pages（静态托管 + Pages Functions）
├── public/            前台静态页 + 后台 SPA
├── functions/         API 层（鉴权/商品/分类/设置/上传/导出/访问码）
├── Cloudflare D1      商品/分类/设置（SQLite，自带 30 天时间旅行回档）
└── Cloudflare R2      图片存储（images/ 公开前缀 + orig/ 私有前缀）
```

无构建步骤、无外部依赖，全站免费额度内运行。

## 快速部署（复用指南）

### 1. 准备资源（约 5 分钟，控制台点击）

1. **D1 数据库**：控制台 → Storage & Databases → D1 → Create（名字随意，如 `shop`）
   → 进入库 → Console 标签 → 粘贴执行 `schema.sql` 全部内容
2. **R2 桶**：控制台 → R2 → Create bucket（保持私有即可，图片经 Functions 读取）
3. **Pages 项目**：Fork 本仓库 → Workers & Pages → Create → Pages → Connect to Git
   选择你的 fork，构建命令留空，输出目录 `public`

### 2. 配置 wrangler.toml

把仓库根目录 `wrangler.toml` 中的 `database_id`（D1 库概览页可复制）和 `bucket_name`
换成你自己刚创建的值，提交推送。

### 3. 设置环境变量

Pages 项目 → Settings → Environment variables（Production）：

| 变量 | 说明 |
|---|---|
| `ADMIN_PASSWORD` | 后台登录密码，自定强密码 |
| `ADMIN_SESSION_SECRET` | 会话签名密钥，随机长字符串（如 32 位以上） |

改完重新部署一次生效。

### 4. 绑定域名（可选）

Pages 项目 → Custom domains → 添加你的域名；DNS 在 Cloudflare 则零配置，
在其他注册商把子域 CNAME 指向 `<项目名>.pages.dev`，裸域用注册商的转发跳到子域。

### 5. 开始使用

打开 `https://<项目名>.pages.dev/admin`，用 `ADMIN_PASSWORD` 登录，
去「站点设置」改站名/图标/公告，然后新增第一个商品。日常操作见 [USAGE.md](USAGE.md)。

## 本地开发

```bash
npx wrangler d1 execute shop-showcase --local --file=schema.sql
npx wrangler pages dev
```

在项目根目录创建 `.dev.vars`（勿提交）：

```
ADMIN_PASSWORD=改成你自己的本地密码
ADMIN_SESSION_SECRET=本地随机字符串
```

## 安全模型（渗透测试通过）

- 后台写接口全部要求 HMAC 签名的 HttpOnly Cookie；伪造/篡改/路径变体/方法覆盖均无效
- 管理密码与密钥只存于 Cloudflare 环境变量，仓库不含任何凭据
- 描述渲染先整体转义再生成白名单标签，无 XSS 注入面；SQL 全参数化
- 整站访问密码：8 位访问码（43 亿组合）+ 失败 800ms 延迟 + 改口令即全体失效
- 开启访问密码时 OG 标签不输出，防抓取器绕过锁屏
- 图片路由防路径穿越；上传仅收图片 MIME 且限 10MB

## 备份

- **D1 自带 Time Travel**：过去 30 天任意时间点可在控制台一键回档（免费、已内置）
- 后台「站点设置 → 数据备份」可随时导出全部数据为 JSON
- R2 图片高持久存储；可开启对象版本控制防误删

## 目录结构

```
public/               前台与后台静态资源（Pages 托管根目录）
├── index.html        前台
├── favicon.svg       默认网站图标（可在后台上传替换）
├── assets/           前台 CSS/JS（md.js 为共享 Markdown 渲染器）
├── admin/            后台 SPA
└── _headers          缓存策略（HTML 每次校验，资源短缓存）
functions/            Pages Functions API
├── _lib/             鉴权 / 自动迁移 / 访问码
├── api/              各接口
└── index.js          首页 SEO/OG 注入
schema.sql            D1 初始化脚本
wrangler.toml         D1/R2 绑定配置（部署前换成自己的资源）
```

## License

MIT — 见 [LICENSE](LICENSE)
