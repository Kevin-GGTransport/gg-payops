import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { ModalShell } from "@/components/modal-shell";
import { PageHeader } from "@/components/page-header";
import { LedgerPanel } from "@/components/ledger";
import { WageRuleStateBadge } from "@/components/badges";
import { ConfirmButton } from "@/components/confirm-button";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/date-field";
import { FormError, FormGrid, SubmitButton, TextField } from "@/components/form-fields";
import { requireUser } from "@/lib/auth";
import { firstValue, formField, type SearchParams } from "@/lib/search-params";
import { todayIso } from "@/lib/format";
import { activeDriverOptions } from "@/lib/queries/drivers";
import { activeOperationOptions } from "@/lib/queries/operations";
import {
  amazonWarehouseRows,
  wageRuleVersionsList,
  wageRuleVersionDetail
} from "@/lib/queries/wage-rules";
import { createVersion, deleteVersion } from "./actions";
import { WageRulesTable } from "./wage-rules-table";
import { RulesEditor } from "./rules-editor";
import { WarehouseEditor } from "./warehouse-editor";

export const metadata: Metadata = { title: "工资规则 · G&G PayOps" };

const ERROR_MESSAGES: Record<string, string> = {
  missing_name: "请填写版本名。",
  bad_date: "生效日期无效。",
  past_date: "生效日期不能早于今天（更早的价格已是锁定历史，调价从今天起生效）。",
  dup_date: "这个生效日期已有版本。",
  bad_multiplier: "乘数必须大于 0。",
  bad_overage: "超档递增额必须 ≥ 0。",
  no_tiers: "至少需要一个里程档位。",
  tiers_not_from_1: "首个档位必须从 1 英里开始。",
  tiers_not_50_step: "首档之后档位必须是 50 的倍数且递增（50、100、150…）。",
  bad_tier_miles: "档位起算里程必须是 ≥ 1 的整数。",
  bad_tier_amount: "档位金额必须 ≥ 0。",
  bad_postal: "特例邮编必须是 5 位数字，且两端不能相同。",
  bad_special_amount: "特例单程价必须 ≥ 0。",
  bad_price_unit: "价格规则的计价单位无效。",
  bad_price_driver: "价格规则的适用司机无效。",
  bad_price_class: "价格规则的起点/终点类别无效。",
  bad_price_amount: "价格规则金额必须 ≥ 0。",
  locked: "该版本已生效，不可删除。",
  bad_source: "复制源版本不存在。"
};

export default async function WageRulesPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireUser();
  const sp = await searchParams;
  const viewId = (firstValue(sp.v) ?? "").trim();
  const errorCode = firstValue(sp.error);
  const isNew = firstValue(sp.new) === "1";
  const fromId = (firstValue(sp.from) ?? "").trim();
  const saved = firstValue(sp.saved) === "1";
  const today = todayIso();

  const [versions, drivers, operations, warehouses] = await Promise.all([
    wageRuleVersionsList(),
    activeDriverOptions(),
    activeOperationOptions(),
    amazonWarehouseRows()
  ]);
  // Default open: the version governing today (latest effective), else newest —
  // the editor always lands on the rules currently in force
  const openId =
    viewId || versions.find(v => v.effective_from <= today)?.id || versions[0]?.id || "";
  const detail = openId ? await wageRuleVersionDetail(openId) : null;

  // Default copy source: the version governing today (latest effective), else newest
  const createSourceId =
    fromId || versions.find(v => v.effective_from <= today)?.id || versions[0]?.id || "";
  const errorMessage = errorCode
    ? ERROR_MESSAGES[errorCode] ?? "操作出错，请检查后重试。"
    : undefined;
  // Effective before today = locked history; saving clones it into a
  // today-effective version automatically (see saveVersion)
  const locked = detail ? detail.effective_from < today : false;
  const canDelete = detail ? detail.effective_from > today : false;

  return (
    <>
      <PageHeader
        title="工资规则"
        description="工资计算管理：价格规则（按趟/按往返/按天，可指定司机）、里程档位、特例邮编对、仓库标准价。改价保存即从今天生效，历史版本只读留档。"
        actions={
          createSourceId ? (
            <Link
              className="button button-dark"
              href={`/dashboard/wage-rules?new=1&from=${createSourceId}`}
            >
              <PlusIcon className="size-4" aria-hidden /> 预排未来版本
            </Link>
          ) : undefined
        }
      />

      {errorMessage && !isNew && <FormError message={errorMessage} />}
      {saved && !errorMessage && (
        <p className="notice" role="status">已保存；改动自生效日期起计入新录入的行程。</p>
      )}

      {detail && (
        <section aria-label="当前规则" className="mb-4">
          <LedgerPanel
            label={
              <>
                <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 tracking-normal">
                  <b className="mono text-[15px] font-bold tracking-normal text-foreground">
                    {detail.name}
                  </b>
                  <span className="mono text-xs font-medium tracking-normal">
                    生效 {detail.effective_from}
                  </span>
                  <WageRuleStateBadge
                    effective={detail.effective_from <= today}
                    label={locked ? "历史（保存即建今日版）" : detail.effective_from <= today ? "已生效" : "待生效"}
                  />
                </div>
                <div className="flex shrink-0 items-center gap-2 tracking-normal">
                  {canDelete && (
                    <form action={deleteVersion} className="contents">
                      <input type="hidden" name="id" value={detail.id} />
                      <ConfirmButton
                        className="button button-quiet button-danger h-7! px-2.5! text-xs"
                        message="确定删除该待生效版本？此操作不可撤销。"
                      >
                        删除
                      </ConfirmButton>
                    </form>
                  )}
                  <Button type="submit" form="wage-rules-edit" className="h-7! px-3! text-xs">
                    保存规则
                  </Button>
                </div>
              </>
            }
          >
            <RulesEditor
              version={detail}
              drivers={drivers}
              operations={operations}
              locked={locked}
              today={today}
            />
          </LedgerPanel>
        </section>
      )}

      <section aria-label="仓库标准价" className="mb-4">
        <LedgerPanel label={<b className="text-[15px] font-bold tracking-normal">仓库标准价 · Amazon</b>}>
          <WarehouseEditor warehouses={warehouses} />
        </LedgerPanel>
      </section>

      <section aria-label="版本历史">
        <LedgerPanel label={<b className="text-[15px] font-bold tracking-normal">版本历史（只读留档）</b>}>
          <WageRulesTable versions={versions} today={today} selectedId={detail?.id} />
        </LedgerPanel>
      </section>

      <ModalShell
        open={isNew && Boolean(createSourceId)}
        closeHref="/dashboard/wage-rules"
        title="预排未来版本"
      >
        <form action={createVersion} aria-label="预排未来版本">
          <input type="hidden" name="source_id" value={createSourceId} />
          <div className="grid gap-4 px-5 py-4">
            <FormError message={errorMessage} />
            <p className="text-xs text-muted-foreground">
              复制当前生效版本的规则（价格规则、档位、乘数、特例），到指定日期自动接替生效。临时调价直接在上面的编辑器里改并保存即可。
            </p>
            <FormGrid>
              <TextField
                label="版本名"
                name="name"
                required
                defaultValue={formField(sp, "name", `CA Local ${today.slice(0, 7).replace("-", "年")} 版`)}
                maxLength={120}
              />
              <DateField
                label="生效日期（今天或之后）"
                name="effective_from"
                defaultValue={formField(sp, "effective_from", today)}
                required
              />
            </FormGrid>
          </div>
          <div className="flex justify-end border-t border-line px-5 py-3">
            <SubmitButton>创建版本</SubmitButton>
          </div>
        </form>
      </ModalShell>
    </>
  );
}
