
## 常用命令

```bash
pnpm dev              # 开发服务器（Turbopack）
pnpm build            # 生产构建
pnpm lint             # ESLint
pnpm type-check       # tsc --noEmit
pnpm db:migrate       # prisma migrate dev
pnpm db:seed          # 创建/更新 admin 种子账号
pnpm db:studio        # Prisma Studio
```

## 架构要点

- `src/lib/auth.ts`（NextAuth v5，Credentials + JWT，查 users 表）与 `src/auth.config.ts`（edge 安全配置）分离；`src/proxy.ts`（Next 16 中间件）做 `/dashboard/*` 路由保护
- Prisma 固定 ^6.19.0（勿升 v7）；`src/lib/prisma.ts` 为 globalThis 单例；迁移已基线化（`0_init` 对应建库时的两张业务表）
- 数据库：Neon PostgreSQL；已有业务表 `accounting_invoices` / `accounting_invoice_lines`（货运发票主表+明细），骨架阶段未接入页面
- UI：shadcn/ui（neutral）+ Tailwind v4；文案与错误消息一律中文

## 技术栈

### 运行时 & 框架
- **Next.js 16**（App Router），Node.js 运行时（非 Edge）
- **Node.js** ≥ 18
- **TypeScript** `strict: true`，target ES2017，JSX `react-jsx`
- **模块系统**：ESM（`"type": "module"`）

### 前端
- **React 19.2** + React DOM 19.2
- **shadcn/ui**（new-york 风格，neutral 基础色）
- **Tailwind CSS v4**（`@tailwindcss/postcss` + `tw-animate-css`）
- **Radix UI**：avatar、checkbox、collapsible、dialog、dropdown-menu、label、popover、radio-group、scroll-area、select、separator、slot、tabs
- **TanStack React Table v8**（数据表格）
- **echarts 6**（图表/仪表盘可视化）
- **TipTap 2.9**（富文本编辑器）+ **cmdk**（命令面板）
- **React Hook Form v7** + **Zod v4**（表单与校验）
- **class-variance-authority** + **clsx** + **tailwind-merge**（样式工具）
- **lucide-react**（图标库）
- **Geist** + **Noto Sans SC**（字体）

### 后端 & API
- Next.js API Routes（`app/api/` 下约 38 个模块）
- **NextAuth.js v5**（`next-auth@^5.0.0-beta.30`，Credentials Provider，JWT 策略）
- **@auth/prisma-adapter**
- **bcryptjs**（密码哈希）
- 自定义 `proxy.ts` 中间件进行路由保护

### 数据库
- **PostgreSQL**（`prisma`）  
