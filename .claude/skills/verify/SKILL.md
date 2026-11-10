---
name: verify
description: Run and drive the G&G PayOps dev server to verify changes end-to-end (login → pages → trip CRUD)
---

# Verify G&G PayOps

## Launch

```bash
pnpm dev    # next dev -p 3002
```

**Gotcha:** the user often already has a dev server on 3002 — check `lsof -nP -iTCP:3002 -sTCP:LISTEN` first and reuse it (EADDRINUSE otherwise). Next dev hot-reloads code changes; raw-SQL pages need no restart.

## Drive (Playwright MCP)

1. `http://localhost:3002/sign-in` — login `admin` / `admin123` (shown on the page). Wrong password → `?error=invalid`.
2. `/dashboard` — headcount card should read 在册人员 N (司机 X · 车主 Y).
3. `/dashboard/drivers` — table rows; edit links are `?edit=<id>` (bigint ids).
4. `/dashboard/trips` — 录入行程 dialog: driver/起点/终点 are shadcn Comboboxes (click → option list). Submit → row appears, redirect `?driver=<id>`. Re-submitting identical trip → `error=dup_trip` + alert in dialog.
5. `/dashboard/payroll` — 核算矩阵 per driver per period.
6. 删除 a trip → native confirm() dialog (handle via browser_handle_dialog).
7. 退出登录 → back to /sign-in.

## Notes

- Auth is a custom cookie session (`common.user_sessions.refresh_token_hash`), not NextAuth.
- DB check: `psql "$DATABASE_URL"` — strip `?schema=public` from .env DATABASE_URL first (Prisma-only param, psql rejects it).
- ids are bigint identity everywhere; app code passes them as strings with `::bigint` casts.
