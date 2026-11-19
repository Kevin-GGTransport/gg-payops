
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

## 开发规范

### React / 交互

1. **受控输入稳定性**：输入过程中（focus 期间）禁止改写用户正在敲的文本——格式化/规范化只在 blur 后做。任何「敲到一半值被替换、光标跳到末尾」都是 bug，不是风格问题。
2. **派生优先于 effect**：能从 props/state 在 render 中派生的值，禁止用 effect 链同步上报（React 文档 "You Might Not Need an Effect"）。effect 只留给真正副作用：fetch、订阅、DOM API。多行/多级联动优先把状态所有权上移到共同父级，一次 render 自上而下算完；后加联动时回头重架构，不在子组件里打 effect 补丁。
3. **列表渲染性能**：表格行用 `React.memo`、组级回调用 `useCallback`、key 用稳定槽位 id（绝不用数组下标）；TanStack 的 columns 定义与空 data 必须是模块级常量或 useMemo（列身份抖动 = CPU 风暴）。
4. **组件基于 shadcn/ui 组合**，不自创平行结构；下拉 = Popover + Command，表格 = TanStack + ui/table。

### TypeScript

1. `strict: true` 全开；禁用 `any`（显式与隐式），确需逃逸用 `unknown` + 类型收窄。
2. **类型即契约**：跨文件/跨端边界（server ↔ client、server action 参数）必须显式类型；外部输入（API、表单）用 Zod 校验，解析通过后才进入业务类型，不做 `as` 强转信任。
3. 优先可辨识联合（discriminated union）表达状态（如 `"loading" | "auto" | "failed"`），不堆布尔标志；非空断言 `!` 仅在能写清局部不变量时使用并注释。
4. 纯类型导入用 `import type`（isolatedModules 下必需）；类型名 PascalCase，不带 `I` 前缀。
5. 代码注释一律英文，UI 文案与错误消息一律中文。

### 交互验证清单（改动涉及交互/state 流/草稿时必跑）

- **逐键输入**：验证输入类交互必须逐字符键入（等价 `pressSequentially`），禁用 `fill()` 一次性灌值——一次性字符串永远不会触发「中途可解析/可提交的前缀」这类 bug。
- **完整往返**：动了保存/恢复/草稿/快照的任何一侧，必须跑「保存 → 刷新 → 恢复 → 再编辑」全链。
- **渲染传播**：改 state 流后确认联动更新是单帧完成，不是逐行/逐级联动的波（可用 rAF 逐帧采样 DOM 值验证）。
- **组合语义**：功能交集（草稿 × 接续 × 重算这类跨模块组合）必须一起验证，单块各自绿不算通过。
- 收尾：`pnpm type-check && pnpm lint`。

## 技术栈

### 运行时 & 框架
- **Next.js 16**（App Router），Node.js 运行时（非 Edge）
- **Node.js** ≥ 18
- **TypeScript** `strict: true`，target ES2022，JSX `react-jsx`
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

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
