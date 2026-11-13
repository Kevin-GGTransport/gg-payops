import type { Metadata } from "next";
import Link from "next/link";
import { ModalShell } from "@/components/modal-shell";
import { PageHeader } from "@/components/page-header";
import { LedgerPanel } from "@/components/ledger";
import {
  CheckboxField,
  FormError,
  FormGrid,
  NumberField,
  SubmitButton,
  TextField
} from "@/components/form-fields";
import { requireUser } from "@/lib/auth";
import { firstValue, formField, type SearchParams } from "@/lib/search-params";
import { getOperationTypeById, listOperationTypes } from "@/lib/queries/operations";
import { saveOperation } from "./actions";
import { OperationsTable } from "./operations-table";

export const metadata: Metadata = { title: "操作类型 · G&G PayOps" };

const ERROR_MESSAGES: Record<string, string> = {
  missing_code: "请填写操作代码。",
  bad_code: "代码限 1–16 位大写字母 / 数字 / 连字符（中文请放在名称里）。",
  missing_label: "请填写名称。",
  missing_operation: "该操作类型不存在，请刷新后重试。",
  bad_sort: "排序必须是大于等于 0 的整数。",
  dup_code: "这个操作代码已存在。",
  op_in_use: "已有行程使用该操作，代码不可改、不可删；可改为停用。",
  system_locked: "系统内置操作（EMPTY / BOBTAIL）的代码与状态不可改动，名称和说明可修改。"
};

export default async function OperationsPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireUser();
  const sp = await searchParams;

  const editId = (firstValue(sp.edit) ?? "").trim();
  const errorCode = firstValue(sp.error);
  const isNew = firstValue(sp.new) === "1";

  const [operations, editing] = await Promise.all([
    listOperationTypes(),
    editId ? getOperationTypeById(editId) : Promise.resolve(null)
  ]);

  const values = {
    code: formField(sp, "code", editing?.code),
    label: formField(sp, "label", editing?.label),
    description: formField(sp, "description", editing?.description),
    sort: formField(sp, "sort_order", editing ? String(editing.sort_order) : "100")
  };

  return (
    <>
      <PageHeader
        title="操作类型"
        description="行程操作的可管理字典：录入下拉、行程筛选与徽章都读这里；带柜操作可勾选必填 Load#。"
        actions={<Link className="button button-quiet" href="/dashboard/operations?new=1">新增操作</Link>}
      />

      <section aria-label="操作类型名单">
        <LedgerPanel>
          <OperationsTable
            operations={operations}
            empty="还没有操作类型，点右上角新增。"
          />
        </LedgerPanel>
      </section>

      <ModalShell
        open={isNew || Boolean(editing) || Boolean(errorCode)}
        closeHref="/dashboard/operations"
        title={editing ? `编辑 ${editing.code}` : "新增操作类型"}
      >
        <form action={saveOperation} aria-label="操作类型登记卡">
          <input type="hidden" name="id" value={editing?.id ?? ""} />
          <FormError message={errorCode ? ERROR_MESSAGES[errorCode] : undefined} />
          <FormGrid>
            {/* System rows keep their code (wage calc / Load# lock depend on it) */}
            <TextField
              label="代码"
              name="code"
              required
              placeholder="如 PU"
              defaultValue={values.code}
              maxLength={16}
              {...(editing?.is_system ? { disabled: true } : {})}
            />
            <TextField label="名称" name="label" required placeholder="如 PICK UP" defaultValue={values.label} maxLength={60} />
            <TextField label="说明" name="description" placeholder="如 提货 / 提柜" defaultValue={values.description} maxLength={120} />
            <NumberField label="排序（小的靠前）" name="sort_order" min={0} step={1} defaultValue={values.sort} />
            <CheckboxField
              label="需填 Load#"
              name="requires_load"
              hint="带柜操作必填柜号（勾上后该操作的行程必须填 Load#）"
              defaultChecked={editing?.requires_load ?? false}
            />
          </FormGrid>
          {editing?.is_system && (
            <p className="px-4 text-xs text-muted-foreground">
              系统内置操作的代码与状态不可改动（EMPTY 锁 Load#、BOBTAIL 参与工资乘数），名称与说明可修改。
            </p>
          )}
          <SubmitButton>{editing ? "保存修改" : "登记操作"}</SubmitButton>
        </form>
      </ModalShell>
    </>
  );
}
