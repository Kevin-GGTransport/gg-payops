import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { LedgerPanel } from "@/components/ledger";
import { requireUser } from "@/lib/auth";
import { firstValue, type SearchParams } from "@/lib/search-params";
import { money, todayIso } from "@/lib/format";
import { wageRuleVersionsList, wageRuleVersionDetail } from "@/lib/queries/wage-rules";
import { WageRulesTable } from "./wage-rules-table";

export const metadata: Metadata = { title: "工资规则 · G&G PayOps" };

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
  const today = todayIso();

  const [versions, detail] = await Promise.all([
    wageRuleVersionsList(),
    viewId ? wageRuleVersionDetail(viewId) : Promise.resolve(null)
  ]);

  const ownerMultiplier = detail ? Number(detail.owner_multiplier) : 1;

  return (
    <>
      <PageHeader
        title="工资规则"
        description="版本化的工资计算规则：里程档位、车主与 BOBTAIL 乘数、特例邮编对；已生效版本只读，改价发新版本。"
      />

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
                  BASE 端点腿按位置基准金额计价（位置管理页维护），不落档位。
                </p>
              </div>
            </div>
          </LedgerPanel>
        </section>
      )}
    </>
  );
}
