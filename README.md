# G&G PayOps · 运输结算中心

本地开发项目：Next.js + TypeScript + Prisma + PostgreSQL。

## 首次启动

```bash
pnpm install
cp .env.example .env
pnpm db:setup
pnpm db:migrate
pnpm db:seed
pnpm dev
```

打开：<http://localhost:3002>

## 本地账号

| 角色 | 邮箱 | 密码 |
|---|---|---|
| 超级管理员 | `admin` | `admin123` |
| 财务录入员 | `finance@gg.local` | `Finance123456` |
| 审核人 | `reviewer@gg.local` | `Reviewer123456` |

## 本地数据库

- Host: `localhost`
- Port: `5432`
- Database: `gg_payops`
- User: `gg_payops`
- Password: `gg_payops_dev`

数据目录保存在 `.local/postgres`，不会影响系统 PostgreSQL。

```bash
pnpm db:start   # 启动本地库
pnpm db:stop    # 停止本地库
pnpm db:studio  # 打开 Prisma Studio
```

## 当前完成

1. 本地 PostgreSQL 初始化脚本
2. SQL-first 数据库结构
3. 组织、用户、角色、权限、审计等公共管理表
4. 司机、车辆、地点、路线、计薪参数等运输主数据表
5. 工资周期、工资单、一趟、行程段、Load 分摊等结算表
6. 登录 / 退出 / 会话
7. 工作台显示 Peter 回归样例

## 下一步

1. 基础数据页面
2. 行程录入页面
3. 服务端计薪引擎
4. 异常中心
5. 审核与锁定
