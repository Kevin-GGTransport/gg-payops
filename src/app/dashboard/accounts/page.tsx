import type { Metadata } from "next";
import Link from "next/link";

import { ModalShell } from "@/components/modal-shell";
import { PageHeader } from "@/components/page-header";
import { LedgerPanel } from "@/components/ledger";
import { FlashToast } from "@/components/flash-toast";
import {
  CheckboxField,
  FormError,
  FormGrid,
  SubmitButton,
  TextField
} from "@/components/form-fields";
import { ComboboxField } from "@/components/combobox-field";
import { ToolbarSearch, ToolbarTabs } from "@/components/crud-toolbar";
import { requirePermission, getUserPermissions } from "@/lib/permissions";
import { collectPrefixedIds, firstValue, formField, parseCrudParams, type SearchParams } from "@/lib/search-params";
import {
  listAccounts,
  getAccountById,
  roleOptions,
  activeDriversForLinking
} from "@/lib/queries/accounts";
import {
  createAccount,
  updateAccount,
  resetAccountPassword
} from "./actions";
import { AccountsTable } from "./accounts-table";

export const metadata: Metadata = { title: "账号管理 · G&G PayOps" };

const ERROR_MESSAGES: Record<string, string> = {
  missing_email: "请填写账号（邮箱或用户名）。",
  missing_name: "请填写姓名。",
  missing_password: "请填写初始密码。",
  short_password: "密码至少 8 位。",
  dup_account: "该账号已被使用。",
  no_roles: "请至少选择一个角色。",
  bad_roles: "所选角色无效，请刷新后重试。",
  driver_linked: "该司机已关联其他账号。",
  self_deactivate: "不能停用自己的账号。",
  self_demote: "不能移除自己的管理员角色，否则将失去账号管理权限。",
  missing_account: "该账号不存在，请刷新后重试。"
};

type StatusFilter = "all" | "active" | "inactive";

export default async function AccountsPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requirePermission("account.read");
  const canWrite = (await getUserPermissions()).has("account.write");
  const sp = await searchParams;

  const statusParam = firstValue(sp.status);
  const statusFilter: StatusFilter =
    statusParam === "active" || statusParam === "inactive" ? statusParam : "all";
  const q = (firstValue(sp.q) ?? "").trim();
  const resetId = (firstValue(sp.reset) ?? "").trim();
  const { editId, errorCode, isNew, savedMessage } = parseCrudParams(sp, {
    "1": "账号已保存",
    status: "账号状态已更新",
    pwd: "密码已重置"
  });

  const [{ rows, counts }, editing, resetting, roles, drivers] = await Promise.all([
    listAccounts({ q, status: statusFilter }),
    editId ? getAccountById(editId) : Promise.resolve(null),
    resetId ? getAccountById(resetId) : Promise.resolve(null),
    roleOptions(),
    activeDriversForLinking()
  ]);

  const editOpen = canWrite && (isNew || Boolean(editing) || Boolean(errorCode && !resetting));
  const resetOpen = canWrite && Boolean(resetting);
  const filterQuery = new URLSearchParams();
  if (statusFilter !== "all") filterQuery.set("status", statusFilter);
  if (q) filterQuery.set("q", q);
  const modalParams = new URLSearchParams(filterQuery);
  modalParams.set("new", "1");

  // Failed-save refills: identity fields + the role checkboxes (role_<id>)
  const values = {
    email: formField(sp, "email", editing?.email),
    displayName: formField(sp, "display_name", editing?.display_name),
    phone: formField(sp, "phone", editing?.phone)
  };
  const refillRoles = collectPrefixedIds(sp, "role_");
  // Roles are keyed by id in forms; the editing row carries codes - resolve
  const editingRoleIds = new Set(
    roles.filter(r => editing?.roles.some(er => er.code === r.code)).map(r => r.id)
  );

  const tabs = [
    { key: "all", label: "全部", count: counts.total },
    { key: "active", label: "启用", count: counts.active },
    { key: "inactive", label: "停用", count: counts.inactive }
  ] as const;

  return (
    <>
      <PageHeader
        title="账号管理"
        description="创建登录账号并挂上角色（角色＝权限模版）；关联司机档案的账号登录后只看自己的行程与工资单。"
        actions={
          canWrite ? (
            <Link className="button button-quiet" href={`/dashboard/accounts?${modalParams.toString()}`}>
              新增账号
            </Link>
          ) : undefined
        }
      />
      {savedMessage && <FlashToast message={savedMessage} param="saved" />}

      <section aria-label="账号名单">
        <div className="toolbar">
          <ToolbarTabs
            tabs={tabs}
            basePath="/dashboard/accounts"
            paramKey="status"
            activeKey={statusFilter}
            baseParams={filterQuery}
            ariaLabel="按状态筛选"
          />
          <ToolbarSearch
            basePath="/dashboard/accounts"
            query={q}
            placeholder="搜索账号或姓名"
            ariaLabel="搜索账号"
            hiddenFields={statusFilter !== "all" ? { status: statusFilter } : undefined}
          />
        </div>

        <LedgerPanel>
          <AccountsTable
            accounts={rows}
            canWrite={canWrite}
            filterQuery={filterQuery.toString()}
            currentUserId={user.id}
            empty={
              q || statusFilter !== "all"
                ? "没有符合条件的账号。换个筛选条件看看。"
                : "还没有账号。点右上角「新增账号」创建第一个。"
            }
          />
        </LedgerPanel>
      </section>

      <ModalShell
        open={editOpen}
        closeHref={`/dashboard/accounts${filterQuery.toString() ? `?${filterQuery.toString()}` : ""}`}
        title={editing ? `编辑 ${editing.display_name}` : "新增账号"}
      >
        <form action={editing ? updateAccount : createAccount} aria-label="账号表单">
          <input type="hidden" name="id" value={editing?.id ?? ""} />
          <FormError message={errorCode ? ERROR_MESSAGES[errorCode] : undefined} />
          <FormGrid>
            <TextField
              label="账号（邮箱或用户名）"
              name="email"
              required
              placeholder="如 finance@gg.local"
              defaultValue={values.email}
              maxLength={255}
            />
            <TextField label="姓名" name="display_name" required placeholder="中英文均可" defaultValue={values.displayName} maxLength={80} />
            <TextField label="手机号" name="phone" placeholder="+1-209-…" defaultValue={values.phone} maxLength={32} />
            {!editing && (
              <TextField
                label="初始密码"
                name="initial_password"
                type="password"
                required
                placeholder="至少 8 位"
                maxLength={72}
              />
            )}
          </FormGrid>
          <fieldset className="mt-4 border-0 p-0">
            <legend className="mb-2 block text-xs font-medium text-muted-foreground">
              角色（可多选，决定登录后能看什么、改什么）
            </legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {roles.map(role => (
                <CheckboxField
                  key={role.id}
                  label={role.name}
                  name={`role_${role.id}`}
                  defaultChecked={
                    refillRoles.size > 0
                      ? refillRoles.has(role.id)
                      : editingRoleIds.has(role.id)
                  }
                  hint={role.code}
                />
              ))}
            </div>
          </fieldset>
          <div className="mt-4">
            <ComboboxField
              name="linked_driver_id"
              label="关联司机档案（可选）"
              placeholder="选择司机"
              clearable
              searchable
              defaultValue={
                formField(sp, "linked_driver_id", editing?.linked_driver_id ?? "") ?? ""
              }
              options={drivers.map(d => ({
                value: d.id,
                label: d.full_name
              }))}
              labelForValue={
                editing?.linked_driver_id && editing.linked_driver_name
                  ? () => editing.linked_driver_name ?? undefined
                  : undefined
              }
            />
            <p className="mt-2 text-xs text-muted-foreground">
              关联后该账号登录只显示这位司机自己的行程与工资单，并可确认自己的工资单。
            </p>
          </div>
          <SubmitButton>{editing ? "保存修改" : "创建账号"}</SubmitButton>
        </form>
      </ModalShell>

      <ModalShell
        open={resetOpen || Boolean(errorCode && resetting)}
        closeHref={`/dashboard/accounts${filterQuery.toString() ? `?${filterQuery.toString()}` : ""}`}
        title={resetting ? `重置密码 · ${resetting.display_name}` : "重置密码"}
      >
        <form action={resetAccountPassword} aria-label="重置密码">
          <input type="hidden" name="id" value={resetting?.id ?? ""} />
          <FormError
            message={
              errorCode === "short_password" ? ERROR_MESSAGES.short_password : undefined
            }
          />
          <FormGrid>
            <TextField
              label="新密码"
              name="new_password"
              type="password"
              required
              placeholder="至少 8 位"
              maxLength={72}
            />
          </FormGrid>
          <SubmitButton>重置密码</SubmitButton>
        </form>
      </ModalShell>
    </>
  );
}
