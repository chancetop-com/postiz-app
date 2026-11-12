# Postiz 项目改造交接文档



> **仓库**: [chancetop-com/postiz-app](https://github.com/chancetop-com/postiz-app) (Fork from [gitroomhq/postiz-app](https://github.com/gitroomhq/postiz-app)) **许可证**: AGPL v3（公开） **提交**: `6fdf7cb5` — feat: SSO integration, channel relay, UI improvements, and documentation **日期**: 2026-07-07

---

## 一、改造概览

| 类别 | 改动文件数 | 说明 |
| --- | --- | --- |
| SSO 单点登录 | \~10 | 新增 SSO 认证流程，支持 iframe 嵌入 + postMessage 通信 |
| 认证存储迁移 | \~8 | Cookie → SessionStorage，解决跨域 iframe 第三方 Cookie 被拦截问题 |
| UI / 品牌调整 | \~8 | Logo 替换、暗色默认改为亮色、菜单项隐藏 |
| iframe 嵌入适配 | \~4 | CORS exposedHeaders、Nginx CSP、OAuth 弹窗适配 |
| Channel Relay | 2 | 新增频道 relay 中转页面 |
| 基础架构 | \~5 | 错误处理增强、Docker 配置、代理精简 |
| 文档 | 4 | SSO 迁移计划、社交平台评论 API 调研、SSO 测试工具 |

---

## 二、核心改造：SSO 单点登录

### 2.1 目标

将 Postiz 以 **iframe** 方式嵌入父应用，用户无需二次登录，由父应用签发 SSO token 完成身份认证。

**约束**: 不修改父应用代码，只改 Postiz。

### 2.2 新增文件

```
apps/backend/src/services/auth/sso.service.ts          # SSO token 验证服务
apps/frontend/src/app/(app)/auth/sso/page.tsx           # 外部跳转入口 (/auth/sso?token=XXX)
apps/frontend/src/app/(app)/sso/page.tsx                # iframe 内 SSO 登录页面
apps/frontend/src/app/(app)/sso/layout.tsx              # SSO 页面布局（纯白亮色）
libraries/nestjs-libraries/src/dtos/auth/sso.login.dto.ts       # POST /auth/sso 的 DTO
libraries/nestjs-libraries/src/dtos/auth/sso.create-account.dto.ts  # POST /auth/sso/create-account 的 DTO
```

### 2.3 对父应用的接口契约

#### 接口一：iframe 嵌入入口

```
GET https://<postiz-domain>/sso?auth_code=<SSO_TOKEN>
```

父应用将 Postiz 以 iframe 嵌入，`src` 直接设为上述 URL。

#### 接口二：用户注册（免登录开放接口）

```
POST https://<postiz-domain>/auth/sso/create-account
Content-Type: application/json
{"token": "<SSO_TOKEN>"}
```

首次使用时若用户不存在，Postiz 通过 `postMessage` 通知父应用，父应用调用此接口创建用户后重试。

#### SSO 认证服务器接口规范

Postiz 后端通过环境变量 `SSO_SERVER_URL` 指向认证服务器，向其发起验证：

```
POST {SSO_SERVER_URL}/api/sso/verify
{"auth_code": "<token>"}
​
Response 200:
{"merchant_id": "xxx", "merchant_name": "yyy"}
```

**字段映射**:

- `merchant_id` → Postiz 的 `providerId`（用户唯一标识）
- `merchant_name` → Postiz 的组织名（company name）

### 2.4 测试工具

```
doc/sso-test/mock-sso-server.js  # Mock SSO 服务器（node 运行）
doc/sso-test/index.html           # 前端测试页面（在浏览器打开）
```

预设 token: `token-alice`（Alice Store）、`token-bob`（Bob Agency），任意其他字符串直接用作 `merchant_id`。

---

## 三、认证存储迁移：Cookie → SessionStorage

### 3.1 原因

跨域 iframe 中，浏览器默认阻止第三方 Cookie（Safari 尤其严格），即使设置 `SameSite=None; Secure` 也可能被 ITP 拦截。

### 3.2 修改内容

| 文件 | 改动 |
| --- | --- |
| `apps/frontend/src/components/layout/layout.context.tsx` | `setCookie('auth', ...)` → `sessionStorage.setItem('auth', ...)`，logout 时改为 `sessionStorage.removeItem()` |
| `libraries/helpers/src/utils/custom.fetch.func.ts` | `document.cookie` 读取 → `sessionStorage.getItem()` |
| `apps/frontend/src/components/layout/logout.component.tsx` | 同理改用 sessionStorage |
| `apps/backend/src/api/routes/auth.controller.ts` | 移除所有 `response.cookie('auth', ...)` → 始终通过 `response.header('auth', jwt)` 传递 |
| `apps/backend/src/api/routes/users.controller.ts` | `impersonate` / `change-org` / `logout` 移除 `response.cookie()`，改为 `response.header()` |
| `apps/backend/src/main.ts` | `auth`、`showorg`、`impersonate`、`logout` 始终加入 `exposedHeaders`（不再受 NOT\_SECURED 限制） |

### 3.3 认证流程变化

**之前**: 后端 `res.cookie('auth', jwt)` → 浏览器自动携带 Cookie → 后端 `req.cookies.auth` 读取

**之后**: 后端 `res.header('auth', jwt)` → 前端 `afterRequest` 拦截存入 `sessionStorage` → 每次请求从 `sessionStorage` 读取放入 `auth` header → 后端 `req.headers.auth` 读取

> 后端 middleware 本来就支持 `req.headers.auth`，无需修改。

---

## 四、UI / 品牌调整

### 4.1 Logo 替换

- `apps/frontend/src/components/new-layout/logo.tsx` — 从 SVG 矢量 logo 改为 `<img>` 加载 `/logo-postiz.png`
- `apps/frontend/public/logo-postiz.png` — 新 logo 图片

### 4.2 默认亮色模式

- `apps/frontend/src/components/layout/mode.component.tsx` — 默认值 `'dark'` → `'light'`
- `apps/frontend/src/components/ui/icons/index.tsx` — NoMediaIcon 默认值 `'dark'` → `'light'`

### 4.3 菜单项隐藏

`apps/frontend/src/components/layout/top.menu.tsx` 中以下菜单项添加 `hide: true`：

- Agent
- Plugs
- Integrations
- Settings

### 4.4 预览包装器

`apps/frontend/src/components/preview/preview.wrapper.tsx` — 移除固定宽度限制和 postiz logo，改为直接渲染子内容

---

## 五、iframe 嵌入适配

### 5.1 CORS exposedHeaders

`apps/backend/src/main.ts` — `auth`、`showorg`、`impersonate`、`logout` 从 `NOT_SECURED` 条件分支中移出，始终暴露给前端 JS 读取。

### 5.2 Nginx CSP

`var/docker/nginx.conf`（如使用）需添加 `frame-ancestors` CSP header 允许父域名嵌入。

### 5.3 OAuth 提供者适配

`apps/frontend/src/components/launches/add.provider.component.tsx` — 第三方 OAuth 跳转从 `window.location.href` 改为 `window.open(..., '_blank')`，避免 iframe 内被 OAuth 提供商拒绝加载。

---

## 六、Channel Relay

### 6.1 用途

`apps/frontend/src/app/(app)/channel-relay/page.tsx` — 一个中转页面，接收 URL hash 中的 `auth`、`showorg`、`impersonate` 参数，存入 `sessionStorage` 后跳转到目标页面。

用于 OAuth 回调跳转场景：从弹窗回到 iframe 后确保认证信息正确传递。

---

## 七、基础架构优化

### 7.1 未处理 Promise 保护

`apps/backend/src/main.ts` — 添加全局 `unhandledRejection` 处理器，防止未捕获的异步异常导致进程崩溃。MCP 启动失败也改为非致命错误（不阻止应用启动）。

### 7.2 代理精简

`apps/frontend/src/proxy.ts` — 移除 `authCookie` 检查逻辑（因为不再用 Cookie），简化 logout 处理。

### 7.3 Docker 配置

- `docker/docker-compose.yaml` — 新增加 Docker Compose 配置
- `docker/dynamicconfig/development-sql.yaml` — Temporal 开发模式 SQL 动态配置
- `var/docker/ecosystem.config.cjs` — PM2 进程管理配置

---

## 八、文档

| 文件 | 内容 |
| --- | --- |
| `docs/sso-migration-plan.md` | SSO 迁移详细方案（1148 行），包含架构设计、前端/后端改造清单、postMessage 通信协议、OAuth 适配、检查清单 |
| `docs/handover.md` | 本文档 |
| `doc/social-platform-comments-api.md` | 18 个社交平台评论 API 支持情况调研，含实现优先级建议 |
| `doc/sso-test/` | SSO mock 测试工具（mock 认证服务器 + 前端测试页面） |

---

## 九、环境变量

SSO 相关需在 `.env` 中配置：

```
# SSO 集成
SSO_SERVER_URL=http://your-auth-service:8080     # 认证服务器地址
NEXT_PUBLIC_SSO_PARENT_ORIGINS=https://parent.com # 允许的父应用域名（逗号分隔）
​
# 存储（本地开发）
STORAGE_PROVIDER=local
UPLOAD_DIRECTORY=/path/to/var/uploads
```

---

## 十、部署注意事项

1. **HTTPS 必须**: `exposedHeaders` 方案在 HTTP 下也可用，但若使用 Cookie（secured 模式），则需要 HTTPS
2. **Safari 兼容**: sessionStorage 方案解决了 Safari 第三方 Cookie 拦截问题
3. **SSO Token 安全**: token 建议 5 分钟有效期，防止重放攻击
4. **postMessage origin 验证**: 生产环境必须在 `NEXT_PUBLIC_SSO_PARENT_ORIGINS` 中配置白名单
5. **AGPL v3**: 仓库必须保持公开，需保留 fork 关系链

---

## 十一、K8s 环境部署

### 11.1 职责划分

| 仓库 | 职责 |
| --- | --- |
| **本项目** (`postiz-app`) | 源码 + Docker 镜像构建（`k8s/` 目录） |
| **fbr-env-project** | K8s 部署清单 + 基础设施配置 |

部署清单路径：`fbr-env-project/azure/dev/kube/resource/app/ai/positz/`（独立仓库）

```
positz/
├── 01-postiz-postgres.yml   # PostgreSQL（Postiz + Temporal 各一个实例）
├── 02-postiz-redis.yml      # Redis
├── 03-temporal.yml          # Temporal Server + Elasticsearch + UI + Dynamic Config
└── 04-postiz.yml            # Postiz 主应用（ConfigMap / Deployment / Service / PVC / Ingress）
```

### 11.2 部署架构

```
┌──────────────────────────────────────────────────────────┐
│  AKS (Azure Kubernetes Service)                          │
│  Namespace: dev-ai  /  Node Pool: aiapp                  │
│                                                          │
│  ┌───────────────────┐  ┌──────────────────────────────┐ │
│  │ Ingress (Public)  │  │ Ingress (Internal)           │ │
│  │ postiz.connexup-  │  │ postiz.dev.local             │ │
│  │ dev.net           │  │ temporal.dev.local           │ │
│  │ TLS: fbr-dev-net  │  │                              │ │
│  │ Gateway: nginx-   │  │ Gateway: nginx               │ │
│  │ internal-gateway  │  │                              │ │
│  └────────┬──────────┘  └──────────────┬───────────────┘ │
│           │                            │                  │
│           ▼                            ▼                  │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ postiz Pod (1 replica, Recreate)                   │  │
│  │                                                     │  │
│  │  ┌─── initContainers ────────────────────────────┐ │  │
│  │  │ wait-for-postgres  wait-for-redis  wait-for-  │ │  │
│  │  │                                     temporal   │ │  │
│  │  └───────────────────────────────────────────────┘ │  │
│  │                                                     │  │
│  │  Container :5000 (fbrdevacr.azurecr.io/app/postiz) │  │
│  │  ├─ nginx (反向代理)                               │  │
│  │  │   ├─ /api/*     → backend:3000                  │  │
│  │  │   ├─ /uploads/* → PVC /uploads/                 │  │
│  │  │   └─ /*         → frontend:4200                 │  │
│  │  ├─ backend        :3000  (NestJS)                 │  │
│  │  ├─ frontend       :4200  (Next.js standalone)     │  │
│  │  └─ orchestrator  :3002  (Temporal Worker)         │  │
│  │                                                     │  │
│  │  Resources: 300m~2000m CPU / 1Gi~3Gi Mem            │  │
│  │  PVC: postiz-uploads-pvc (10Gi) → /uploads         │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌──────────────┐  ┌──────────┐  ┌────────────────────┐ │
│  │ postiz-      │  │ postiz-  │  │ Temporal (1 repl.) │ │
│  │ postgres:5432│  │ redis:   │  │  :7233             │ │
│  │ PVC 10Gi     │  │ 6379     │  │                     │ │
│  └──────────────┘  └──────────┘  │ ├─ temporal-       │ │
│                                   │ │  postgres:5432   │ │
│  ┌──────────────────────────────┐ │ │  PVC 5Gi         │ │
│  │ temporal-postgres:5432       │ │ ├─ temporal-       │ │
│  │ PVC 5Gi                      │ │ │  elasticsearch   │ │
│  └──────────────────────────────┘ │ │  :9200           │ │
│                                   │ │  PVC 10Gi        │ │
│  ┌──────────────────────────────┐ │ ├─ temporal-ui     │ │
│  │ temporal-elasticsearch:9200  │ │ │  :8080           │ │
│  │ PVC 10Gi                     │ │ └──────────────────┘ │
│  └──────────────────────────────┘ │                      │
│  ┌──────────────────────────────┐ │                      │
│  │ temporal-ui:8080             │ │                      │
│  └──────────────────────────────┘ │                      │
└──────────────────────────────────────────────────────────┘
```

**总 Pod 数**: 7 个（postiz + postiz-postgres + temporal-postgres + postiz-redis + temporal + temporal-elasticsearch + temporal-ui）

### 11.3 部署清单详情

#### ConfigMap (`postiz-config`)

```
data:
  FRONTEND_URL: "https://postiz.connexup-dev.net"
  NEXT_PUBLIC_BACKEND_URL: "https://postiz.connexup-dev.net/api"
  BACKEND_INTERNAL_URL: "http://localhost:3000"
  IS_GENERAL: "true"
  STORAGE_PROVIDER: "local"
  UPLOAD_DIRECTORY: "/uploads"
  NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY: "/uploads"
  TEMPORAL_ADDRESS: "temporal:7233"
  DATABASE_URL: "postgresql://postiz:<password>@postiz-postgres:5432/postiz"
  REDIS_URL: "redis://postiz-redis:6379"
  SSO_SERVER_URL: "http://auth-service.dev.svc.cluster.local/auth/code/redeem"
```

敏感信息（数据库密码）通过 `postiz-secret` Secret 注入。

#### Ingress

| 入口 | 域名 | TLS | Gateway |
| --- | --- | --- | --- |
| Public | `postiz.connexup-dev.net` | ✅ `fbr-dev-net-tls` | `nginx-internal-gateway` (Azure AppGw) |
| Internal | `postiz.dev.local` | ❌ | `nginx` |

Ingress 配置：`proxy-body-size: 500m` / `proxy-read-timeout: 300s` / `proxy-send-timeout: 300s`

#### 健康检查

| 探针 | 路径 | 端口 | 初始延迟 | 间隔 | 失败阈值 |
| --- | --- | --- | --- | --- | --- |
| readinessProbe | `/api` | 5000 | 30s | 15s | 10 |
| livenessProbe | `/api` | 5000 | 60s | 30s | 5 |

#### 资源限制

| 容器 | CPU Request | CPU Limit | Memory Request | Memory Limit |
| --- | --- | --- | --- | --- |
| postiz | 300m | 2000m | 1Gi | 3Gi |
| postiz-postgres | 100m | 500m | 256Mi | 512Mi |
| postiz-redis | 50m | 200m | 64Mi | 128Mi |
| temporal | 100m | 500m | 256Mi | 512Mi |
| temporal-postgres | 100m | 500m | 256Mi | 512Mi |
| temporal-elasticsearch | 100m | 500m | 512Mi | 768Mi |
| temporal-ui | 50m | 200m | 64Mi | 128Mi |

#### 持久化存储

| PVC | 大小 | 挂载到 | 挂载路径 |
| --- | --- | --- | --- |
| `postiz-uploads-pvc` | 10Gi | postiz | `/uploads` |
| `postiz-postgres-pvc` | 10Gi | postiz-postgres | `/var/lib/postgresql/data` |
| `temporal-postgres-pvc` | 5Gi | temporal-postgres | `/var/lib/postgresql/data` |
| `temporal-elasticsearch-pvc` | 10Gi | temporal-elasticsearch | `/usr/share/elasticsearch/data` |

### 11.4 构建部署流程

**本项目负责**：构建 Docker 镜像并推送到 ACR

```
cd k8s
./build-postiz.sh
```

脚本步骤：

1. 从父目录复制源码到 `k8s/`
2. `az acr build` 在 ACR 云端执行多阶段 Docker 构建
3. 推送镜像 → `fbrdevacr.azurecr.io/app/postiz:<git-hash>` + `:latest`
4. 自动执行 `kubectl set image deployment/postiz postiz=<image> -n dev-ai` 滚动更新

**fbr-env-project 负责**：K8s 资源清单的创建和维护（`04-postiz.yml` 等），通过 GitOps / kubectl apply 同步到集群。

### 11.5 Docker 镜像结构

```
Container (node:22.20-bookworm-slim)
├── /app/
│   ├── apps/backend/dist/      # NestJS 编译产物
│   ├── apps/frontend/          # Next.js standalone build
│   ├── apps/orchestrator/dist/ # Temporal Worker 编译产物
│   ├── node_modules/           # 运行时依赖
│   └── package.json
├── /uploads/                   # 媒体文件挂载点 (chown www)
├── /etc/nginx/sites-enabled/   # Nginx 配置
└── /var/docker/ecosystem.config.cjs
```

启动命令: `nginx && pm2-runtime /var/docker/ecosystem.config.cjs`
