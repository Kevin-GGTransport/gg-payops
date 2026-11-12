# 公共表格组件 RosterTable（TanStack + shadcn 全套）设计

日期：2026-11-12 · 状态：已获用户批准（含底座选型：TanStack Table v8 全套）

## 背景

全站 6 处 roster 表各自手写 `<table className="roster">`（行程/司机/车辆/位置/工资钻取/录入表），
仅录入表有列宽调整（自研实现，拖动逐帧 setState 整表重渲染）。CLAUDE.md 技术栈规定 UI 基于
shadcn/ui（含 TanStack React Table v8、Radix）；用户明确要求表格统一为 shadcn 官方 Data Table 模式。

## 方案

### 公共件 `src/components/roster-table.tsx`（client）

- `useRosterTable({ data, columns, storageKey })`：TanStack 实例，
  `columnResizeMode: "onEnd"`（拖动只记增量、松手落 state，拖动零重渲染），
  `columnSizing` 按 storageKey 持久化 localStorage（挂载后 useEffect 回填，避免 SSR 不匹配），
  双击列柄删除该列 sizing 键恢复默认宽度
- `<RosterTable table={table} empty={…}>` 表壳：shadcn `ui/table.tsx` 原语渲染 thead
  （`flexRender` 表头 + Radix `Separator` 拖柄，拖动中 deltaOffset 平移指示）与 tbody；
  `children` 传入则替换自动行渲染（录入表表单网格用）；空数据渲染 empty（colSpan=列数）
- 列用标准 `ColumnDef`：复选框/操作等非数据列为 display column（`enableResizing: false`），
  `meta: { cellClass? }` 承接 `hidden lg:table-cell` 等响应式/对齐类；`size` 默认宽、`minSize` 最小宽
- 样式沿用 `.roster` 台账语义类 + 现有 `.col-resizer` 交互语言

### 页面架构：服务端查数 + 客户端表格

每页拆两文件：`page.tsx`（server，查库传 rows）+ 同目录 `*-table.tsx`（"use client"，
持有 ColumnDef 与 cell 渲染——Link/表单/server action 引用/badge 均可在 client 用）。

### 各表迁移范围

trips / drivers / trucks / locations / payroll 钻取明细全部改用；工资矩阵表保持（特殊矩阵行）。
录入表：**columns-only 实例**（只用 columnSizing 机制与同一拖柄），tbody 仍为手写 EntryRow
表单网格（非受控输入/组内拖拽/粘性跟随不动），删除自研列宽代码。

### 显式行为变更

列表页由 auto 列宽改为 **table-fixed + 显式默认列宽**（可调列宽前提），初值按现内容择定。

### 不做（YAGNI）

TanStack 排序/筛选/分页不启用（行程页筛选分页保持服务端 URL 驱动）。

## 验证

type-check/lint + Playwright：五页渲染与行内操作回归、列宽拖动→刷新保持→双击重置、
录入表回归；拖动期间无逐帧 React 提交抽查。
