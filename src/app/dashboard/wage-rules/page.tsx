import type { Metadata } from "next";
import Link from "next/link";
import { ModalShell } from "@/components/modal-shell";
import { PageHeader } from "@/components/page-header";
import { LedgerPanel } from "@/components/ledger";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormError, FormGrid, SubmitButton, TextField } from "@/components/form-fields";
import { requireUser } from "@/lib/auth";
import { firstValue, formField, type SearchParams } from "@/lib/search-params";
import { isoPlusDays, money, todayIso } from "@/lib/format";
import { wageRuleVersionsList, wageRuleVersionDetail } from "@/lib/queries/wage-rules";
import { createVersion, deleteVersion } from "./actions";
import { WageRulesTable } from "./wage-rules-table";
import { VersionForm } from "./version-form";

export const metadata: Metadata = { title: "工资规则 · G&G PayOps" };

const ERROR_MESSAGES: Record<string, string> = {
  missing_name: "请填写版本名。",
  bad_date: "生效日期无效。",
  past_date: "生效日期必须晚于今天（已生效版本只读，改价请发新版本）。",
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
  locked: "该版本已生效，不可修改或删除。",
  bad_source: "复制源版本不存在。"
};

/** Band label: 1 – 49, 50 – 99 … 250+（下一档下界 −1；最高档开放） */
function bandLabel(milesFrom: number, nextFrom: number | null) {
  return nextFrom === null ? `${milesFrom}+` : `${milesFrom} – ${nextFrom - 1}`;
}

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
  const editId = (firstValue(sp.edit) ?? "").trim();
  const fromId = (firstValue(sp.from) ?? "").trim();
  const today = todayIso();
  const tomorrow = isoPlusDays(today, 1);

  const [versions, detail, editing] = await Promise.all([
    wageRuleVersionsList(),
    viewId ? wageRuleVersionDetail(viewId) : Promise.resolve(null),
    editId ? wageRuleVersionDetail(editId) : Promise.resolve(null)
  ]);

  // Default copy source: the version governing today (latest effective), else newest
  const createSourceId =
    fromId || versions.find(v => v.effective_from <= today)?.id || versions[0]?.id || "";
  const errorMessage = errorCode
    ? ERROR_MESSAGES[errorCode] ?? "操作出错，请检查后重试。"
    : undefined;
  const editLocked = editing ? editing.effective_from <= today : false;

  const ownerMultiplier = detail ? Number(detail.owner_multiplier) : 1;

  return (
    <>
      <PageHeader
        title="工资规则"
        description="版本化的工资计算规则：里程档位、车主与 BOBTAIL 乘数、特例邮编对；已生效版本只读，改价发新版本。"
        actions={
          createSourceId ? (
            <Link
              className="button button-quiet"
              href={`/dashboard/wage-rules?new=1&from=${createSourceId}`}
            >
              基于当前版创建新版本
            </Link>
          ) : undefined
        }
      />

      {errorMessage && !isNew && !editing && <FormError message={errorMessage} />}

      <section aria-label="版本时间线">
        <LedgerPanel>
          <WageRulesTable versions={versions} today={today} />
        </LedgerPanel>
      </section>

      {detail && (
        <section aria-label="版本详情" className="mt-4">
          <LedgerPanel
            label={
              <span className="flex flex-wrap items-center gap-2">
                <b className="mono">{detail.name}</b>
                <span className="mono text-muted-foreground">生效 {detail.effective_from}</span>
                <span
                  className={`inline-flex items-center rounded-[3px] border px-1.5 py-px text-[11px] font-semibold leading-4 ${
                    detail.effective_from <= today
                      ? "border-audit/30 bg-audit/10 text-audit"
                      : "border-amber-500/40 bg-amber-50 text-amber-800"
                  }`}
                >
                  {detail.effective_from <= today ? "已生效（只读）" : "待生效"}
                </span>
                {detail.effective_from > today && (
                  <Link href={`/dashboard/wage-rules?edit=${detail.id}`}>编辑</Link>
                )}
              </span>
            }
          >
            <div className="grid gap-6 px-4 py-4 md:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  里程档位（司机价；车主 = 司机 × {ownerMultiplier.toFixed(2)}）
                </p>
                <table>
                  <thead>
                    <tr>
                      <th>档位 (mi)</th>
                      <th className="num">司机价</th>
                      <th className="num">车主价</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.tiers.map((tier, i) => {
                      const next = detail.tiers[i + 1]?.miles_from ?? null;
                      const amount = Number(tier.amount);
                      return (
                        <tr key={tier.miles_from}>
                          <td className="mono">{bandLabel(tier.miles_from, next)}</td>
                          <td className="num">{money(amount)}</td>
                          <td className="num">{money(amount * ownerMultiplier)}</td>
                        </tr>
                      );
                    })}
                    <tr>
                      <td className="mono">超档</td>
                      <td className="num" colSpan={2}>
                        最高档后每 50 mi + {money(Number(detail.overage_increment))}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">特例路线（单程固定价，双向同价）</p>
                {detail.special_routes.length === 0 ? (
                  <p className="text-xs text-muted-foreground">无</p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>邮编对</th>
                        <th className="num">单程</th>
                        <th className="num">车主单程</th>
                        <th>备注</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.special_routes.map((route, i) => (
                        <tr key={i}>
                          <td className="mono">
                            {route.from_postal} ↔ {route.to_postal}
                          </td>
                          <td className="num">{money(Number(route.one_way_amount))}</td>
                          <td className="num">
                            {money(Number(route.one_way_amount) * ownerMultiplier)}
                          </td>
                          <td className="text-muted-foreground">{route.note ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="mt-3 text-xs text-muted-foreground">
                  BOBTAIL 乘数 ×{Number(detail.bobtail_multiplier).toFixed(2)}；
                  BASE 端点腿按对端基准金额的 50% 计价（基地往返算一仓，单程即一半；基准金额在位置管理页维护），不落档位。
                </p>
              </div>
            </div>
            {detail.effective_from > today && (
              <form action={deleteVersion} className="flex justify-end px-4 pb-4">
                <input type="hidden" name="id" value={detail.id} />
                <button type="submit" className="linklike danger">删除此待生效版本</button>
              </form>
            )}
          </LedgerPanel>
        </section>
      )}

      <ModalShell
        open={isNew && Boolean(createSourceId)}
        closeHref="/dashboard/wage-rules"
        title="创建新版本"
      >
        <form action={createVersion} aria-label="创建新版本">
          <input type="hidden" name="source_id" value={createSourceId} />
          <div className="grid gap-4 px-5 py-4">
            <FormError message={errorMessage} />
            <p className="text-xs text-muted-foreground">
              复制当前版本的档位、乘数、递增额与特例路线，生效后旧版本自动成为历史。
            </p>
            <FormGrid>
              <TextField
                label="版本名"
                name="name"
                required
                defaultValue={formField(sp, "name", `CA Local ${tomorrow.slice(0, 7).replace("-", "年")} 版`)}
                maxLength={120}
              />
              <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
                生效日期（须晚于今天）
                <Input
                  type="date"
                  name="effective_from"
                  defaultValue={formField(sp, "effective_from", tomorrow)}
                  required
                  aria-label="生效日期"
                  className="h-9 font-mono text-[13px]"
                />
              </label>
            </FormGrid>
          </div>
          <div className="flex justify-end border-t border-line px-5 py-3">
            <SubmitButton>创建版本</SubmitButton>
          </div>
        </form>
      </ModalShell>

      <ModalShell
        open={Boolean(editing) && !editLocked}
        closeHref={`/dashboard/wage-rules?v=${editId}`}
        title={`编辑 ${editing?.name ?? ""}`}
        wide
        footer={
          editing && !editLocked ? (
            <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
              {errorMessage && (
                <p role="alert" className="mr-auto text-[13px] text-destructive">
                  {errorMessage}
                </p>
              )}
              <Button type="submit" form="wage-version-edit">保存版本</Button>
            </div>
          ) : undefined
        }
      >
        {editing && !editLocked && <VersionForm version={editing} />}
      </ModalShell>
    </>
  );
}
