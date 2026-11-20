import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { ModalShell } from "@/components/modal-shell";
import { PageHeader } from "@/components/page-header";
import { LedgerPanel } from "@/components/ledger";
import { WageRuleStateBadge } from "@/components/badges";
import { ConfirmButton } from "@/components/confirm-button";
import { Button } from "@/components/ui/button";
import { FormError, FormGrid, SubmitButton, TextField } from "@/components/form-fields";
import { FlashToast } from "@/components/flash-toast";
import { requirePermission, getUserPermissions } from "@/lib/permissions";
import { firstValue, formField, type SearchParams } from "@/lib/search-params";
import { activeDriverOptions } from "@/lib/queries/drivers";
import { activeOperationOptions } from "@/lib/queries/operations";
import { activeLocationOptions } from "@/lib/queries/locations";
import { wageRuleVersionsList, wageRuleVersionDetail } from "@/lib/queries/wage-rules";
import { createVersion, deleteVersion } from "./actions";
import { WageRulesTable } from "./wage-rules-table";
import { RulesEditor } from "./rules-editor";

export const metadata: Metadata = { title: "工资规则 · G&G PayOps" };

const ERROR_MESSAGES: Record<string, string> = {
  missing_name: "请填写版本名。",
  bad_multiplier: "乘数必须大于 0。",
  bad_overage: "超档递增额必须 ≥ 0。",
  bad_subsidy_rate: "燃油补助费率必须 ≥ 0。",
  no_tiers: "至少需要一个里程档位。",
  tiers_not_from_1: "首个档位必须从 1 英里开始。",
  tiers_not_50_step: "首档之后档位必须是 50 的倍数且递增（50、100、150…）。",
  bad_tier_miles: "档位起算里程必须是 ≥ 1 的整数。",
  bad_tier_amount: "档位金额必须 ≥ 0。",
  bad_price_unit: "价格规则的计价类型无效。",
  bad_price_driver: "价格规则的适用司机无效。",
  bad_price_location: "价格规则的起点/终点无效。",
  bad_price_side: "价格规则的起点/终点无效。",
  bad_price_amount: "价格规则金额必须 ≥ 0。",
  locked: "该版本生效中，不可删除；请先把其他版本设为生效。",
  bad_source: "复制源版本不存在。"
};

export default async function WageRulesPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requirePermission("wage_rule.read");
  const sp = await searchParams;
  // Read-only for accounts without wage_rule.write (actions re-check anyway)
  const canWrite = (await getUserPermissions()).has("wage_rule.write");
  const viewId = (firstValue(sp.v) ?? "").trim();
  const errorCode = firstValue(sp.error);
  const isNew = firstValue(sp.new) === "1";
  const fromId = (firstValue(sp.from) ?? "").trim();
  const savedFlash = firstValue(sp.saved);
  const savedMessage =
    savedFlash === "1"
      ? "已保存；生效中版本的改动即刻计入新录入的行程。"
      : savedFlash === "activated"
        ? "已切换生效；新录入的行程即按此版本计价。"
        : savedFlash === "deleted"
          ? "版本已删除。"
          : undefined;

  const [versions, drivers, operations, locations] = await Promise.all([
    wageRuleVersionsList(),
    activeDriverOptions(),
    activeOperationOptions(),
    activeLocationOptions()
  ]);
  // Default open: the ACTIVE version (list puts it first), else newest
  const openId = viewId || versions[0]?.id || "";
  const detail = openId ? await wageRuleVersionDetail(openId) : null;

  // Copy source: the ACTIVE version - new versions start as its preset
  const createSourceId = fromId || versions.find(v => v.status === "ACTIVE")?.id || "";
  const errorMessage = errorCode
    ? ERROR_MESSAGES[errorCode] ?? "操作出错，请检查后重试。"
    : undefined;
  const isActive = detail ? detail.status === "ACTIVE" : false;
  const canDelete = detail ? !isActive : false;

  return (
    <>
      <PageHeader
        title="工资规则"
        description="定价就一张规则表：适用司机 × 起点 → 终点 × 操作 × 类型（按趟/按往返/按天）× 司机价 × 车主价。任一时刻只有一个版本生效，切换后新录入的行程即按新版本计价；无命中的行程按里程档兜底。"
        actions={
          canWrite && createSourceId ? (
            <Link
              className="button button-dark"
              href={`/dashboard/wage-rules?new=1&from=${createSourceId}`}
            >
              <PlusIcon className="size-4" aria-hidden /> 新建版本
            </Link>
          ) : undefined
        }
      />

      {errorMessage && !isNew && <FormError message={errorMessage} />}
      {savedMessage && !isNew && !errorMessage && <FlashToast message={savedMessage} param="saved" />}

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
                    建于 {detail.created_on}
                  </span>
                  <WageRuleStateBadge
                    effective={isActive}
                    label={isActive ? "生效中" : "未生效"}
                  />
                </div>
                <div className="flex shrink-0 items-center gap-2 tracking-normal">
                  {canWrite && canDelete && (
                    <form action={deleteVersion} className="contents">
                      <input type="hidden" name="id" value={detail.id} />
                      <ConfirmButton
                        className="button button-quiet button-danger h-7! px-2.5! text-xs"
                        title="删除该未生效版本？"
                        message="此操作不可撤销。"
                        danger
                      >
                        删除
                      </ConfirmButton>
                    </form>
                  )}
                  {canWrite && (
                    <Button type="submit" form="wage-rules-edit" className="h-7! px-3! text-xs">
                      保存规则
                    </Button>
                  )}
                </div>
              </>
            }
          >
            <fieldset disabled={!canWrite} className="border-0 p-0">
              <RulesEditor
                version={detail}
                drivers={drivers}
                operations={operations}
                locations={locations}
              />
            </fieldset>
          </LedgerPanel>
        </section>
      )}

      <section aria-label="版本列表">
        <LedgerPanel label={<b className="text-[15px] font-bold tracking-normal">版本列表（手动切换生效）</b>}>
          <WageRulesTable versions={versions} selectedId={detail?.id} canActivate={canWrite} />
        </LedgerPanel>
      </section>

      <ModalShell
        open={canWrite && isNew && Boolean(createSourceId)}
        closeHref="/dashboard/wage-rules"
        title="新建版本"
      >
        <form action={createVersion} aria-label="新建版本">
          <input type="hidden" name="source_id" value={createSourceId} />
          <div className="grid gap-4 px-5 py-4">
            <FormError message={errorMessage} />
            <p className="text-xs text-muted-foreground">
              复制当前生效版本的规则（价格规则与里程档），创建后为未生效草稿，可随意修改；调好后到版本列表「设为生效」。
            </p>
            <FormGrid>
              <TextField
                label="版本名"
                name="name"
                required
                defaultValue={formField(sp, "name", "CA Local 新版")}
                maxLength={120}
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
