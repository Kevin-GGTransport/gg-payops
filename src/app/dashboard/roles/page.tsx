import type { Metadata } from "next";
import Link from "next/link";

import { ModalShell } from "@/components/modal-shell";
import { PageHeader } from "@/components/page-header";
import { LedgerPanel } from "@/components/ledger";
import {
  FormError,
  FormGrid,
  SubmitButton,
  TextField
} from "@/components/form-fields";
import { FlashToast } from "@/components/flash-toast";
import { requirePermission, getUserPermissions } from "@/lib/permissions";
import { firstValue, formField, type SearchParams } from "@/lib/search-params";
import { listRoles, getRoleById } from "@/lib/queries/roles";
import { saveRole } from "./actions";
import { RolesTable } from "./roles-table";
import { PermissionMatrix } from "./permission-matrix";

export const metadata: Metadata = { title: "角色权限 · G&G PayOps" };

const ERROR_MESSAGES: Record<string, string> = {
  missing_name: "请填写角色名称。",
  missing_code: "请填写角色代码。",
  bad_code: "角色代码限 2–31 位大写字母 / 数字 / 下划线，以字母开头。",
  dup_code: "这个角色代码已存在。",
  no_permissions: "自定义角色至少勾选一项权限。",
  system_locked: "系统预置角色不可删除、权限集合不可修改。",
  role_in_use: "仍有账号使用该角色，先在「账号管理」中移除再删除。"
};

export default async function RolesPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requirePermission("role.read");
  const canWrite = (await getUserPermissions()).has("role.write");
  const sp = await searchParams;

  const editId = (firstValue(sp.edit) ?? "").trim();
  const errorCode = firstValue(sp.error);
  const isNew = firstValue(sp.new) === "1" && canWrite;
  const savedFlash = firstValue(sp.saved);
  const savedMessage =
    savedFlash === "saved"
      ? "角色已保存"
      : savedFlash === "deleted"
        ? "角色已删除"
        : undefined;

  const [roles, editing] = await Promise.all([
    listRoles(),
    editId ? getRoleById(editId) : Promise.resolve(null)
  ]);

  // Failed-save refills: name/code plus the matrix checkboxes (perm_<code>)
  const refillPerms = new Set(
    Object.keys(sp)
      .filter(key => key.startsWith("perm_"))
      .map(key => key.slice("perm_".length))
  );
  const values = {
    name: formField(sp, "name", editing?.name),
    code: formField(sp, "code")
  };

  return (
    <>
      <PageHeader
        title="角色权限"
        description="角色就是权限模版：预置 管理员 / 财务 / 工资审核 / 司机 / 查看者，可另建自定义角色勾选任意权限组合；账号在「账号管理」里挂角色。改动对已登录账号即时生效。"
        actions={
          canWrite ? (
            <Link className="button button-quiet" href="/dashboard/roles?new=1">
              新建角色
            </Link>
          ) : undefined
        }
      />
      {savedMessage && <FlashToast message={savedMessage} param="saved" />}

      <section aria-label="角色名单">
        <LedgerPanel label={<>权限模版<b>{roles.length} 个角色</b></>}>
          <RolesTable roles={roles} canWrite={canWrite} />
        </LedgerPanel>
      </section>

      <ModalShell
        open={canWrite && (isNew || Boolean(editing) || Boolean(errorCode))}
        closeHref="/dashboard/roles"
        title={editing ? `编辑角色 · ${editing.name}` : "新建角色"}
      >
        <form action={saveRole} aria-label="角色表单">
          <input type="hidden" name="id" value={editing?.id ?? ""} />
          <FormError message={errorCode ? ERROR_MESSAGES[errorCode] : undefined} />
          <FormGrid>
            <TextField
              label="角色名称"
              name="name"
              required
              placeholder="如 夜班调度"
              defaultValue={values.name}
              maxLength={80}
            />
            {!editing && (
              <TextField
                label="角色代码"
                name="code"
                required
                placeholder="如 NIGHT_DISPATCH"
                defaultValue={values.code}
                maxLength={31}
              />
            )}
          </FormGrid>
          {editing && (
            <p className="mt-2 mb-3 text-xs text-muted-foreground">
              代码 <span className="mono">{editing.code}</span>
              {editing.is_system ? " · 系统预置" : " · 自定义"}
              {editing.user_count > 0 && ` · ${editing.user_count} 个账号在用`}
            </p>
          )}
          <div className="mt-4">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              权限集合{editing?.is_system ? "（系统预置，只读）" : ""}
            </p>
            <PermissionMatrix
              defaultCodes={refillPerms.size > 0 ? refillPerms : (editing?.permissions ?? [])}
              locked={Boolean(editing?.is_system)}
            />
          </div>
          <SubmitButton>{editing ? "保存修改" : "创建角色"}</SubmitButton>
        </form>
      </ModalShell>
    </>
  );
}
