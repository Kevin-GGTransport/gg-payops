import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { FormError } from "@/components/form-fields";
import { requireUser } from "@/lib/auth";
import { todayIso } from "@/lib/format";
import { firstValue, type SearchParams } from "@/lib/search-params";
import { activeDriverOptions } from "@/lib/queries/drivers";
import { activeLocationOptions } from "@/lib/queries/locations";
import { activeTruckOptions } from "@/lib/queries/trucks";
import { TripEntryForm, type RefillGroup } from "./trip-entry-form";

export const metadata: Metadata = { title: "录入行程 · G&G PayOps" };

const ERROR_MESSAGES: Record<string, string> = {
  missing_driver: "请选择司机 / 车主。",
  missing_truck: "请选择车号（车辆需先在车辆管理登记）。",
  bad_truck: "所选车辆无效或已停用，请重新选择车号。",
  no_rows: "请至少录入一段行程。",
  bad_date: "行程日期无效，请检查该行的日期。",
  missing_operation: "请选择操作类型。",
  missing_load: "带柜操作（DEL / LIVE）需填写 Load#。",
  missing_route: "请至少选择起点或终点。",
  bad_miles: "里程必须是不小于 0 的数字。",
  bad_pay: "本趟工资必须是不小于 0 的数字。",
  bad_location: "所选位置无效，请重新选择。",
  dup_trip: "这一天相同操作、相同起终点、相同柜号的行程已存在，请勿重复录入。"
};

export default async function EntryPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireUser();
  const sp = await searchParams;

  const errorCode = firstValue(sp.error);
  const grpParam = Number.parseInt(firstValue(sp.grp) ?? "", 10);
  const grp = Number.isFinite(grpParam) && grpParam >= 1 ? grpParam : undefined;
  const legParam = Number.parseInt(firstValue(sp.leg) ?? "", 10);
  const leg = Number.isFinite(legParam) && legParam >= 1 ? legParam : undefined;
  const saved = Number.parseInt(firstValue(sp.saved) ?? "", 10);
  const savedCount = Number.isFinite(saved) && saved >= 1 ? saved : undefined;
  // Tab to open first (0-based group index; redirect sets it after a
  // single-tab submit or to jump straight at the failing group)
  const tabParam = Number.parseInt(firstValue(sp.tab) ?? "", 10);
  const initialActiveIndex =
    Number.isFinite(tabParam) && tabParam >= 0 ? tabParam : undefined;

  // Refill groups after a failed submit: f_group_count tells how many groups to
  // rebuild; each group restores its driver, default date and its own rows
  const refillCount = Number.parseInt(firstValue(sp.f_group_count) ?? "", 10);
  const refillGroups: RefillGroup[] | undefined =
    Number.isFinite(refillCount) && refillCount >= 1
      ? Array.from({ length: refillCount }, (_, g) => {
          const rowCount = Number.parseInt(firstValue(sp[`f_g_${g}_row_count`]) ?? "", 10);
          const rows =
            Number.isFinite(rowCount) && rowCount >= 1
              ? Array.from({ length: rowCount }, (_, i) => ({
                  trip_date: firstValue(sp[`f_g_${g}_row_${i}_trip_date`]) ?? "",
                  operation: firstValue(sp[`f_g_${g}_row_${i}_operation`]) ?? "",
                  from: firstValue(sp[`f_g_${g}_row_${i}_from_location`]) ?? "",
                  to: firstValue(sp[`f_g_${g}_row_${i}_to_location`]) ?? "",
                  load_no: firstValue(sp[`f_g_${g}_row_${i}_load_no`]) ?? "",
                  miles: firstValue(sp[`f_g_${g}_row_${i}_miles`]) ?? "",
                  pay_amount: firstValue(sp[`f_g_${g}_row_${i}_pay_amount`]) ?? "",
                  notes: firstValue(sp[`f_g_${g}_row_${i}_notes`]) ?? ""
                }))
              : [];
          return {
            driverId: firstValue(sp[`f_g_${g}_driver_id`]) ?? "",
            truckId: firstValue(sp[`f_g_${g}_truck_id`]) ?? "",
            date: firstValue(sp[`f_g_${g}_trip_date`]) ?? "",
            rows
          };
        })
      : undefined;

  const [drivers, trucks, locations] = await Promise.all([
    activeDriverOptions(),
    activeTruckOptions(),
    activeLocationOptions()
  ]);

  const errorMessage = errorCode
    ? errorCode in ERROR_MESSAGES
      ? grp && leg
        ? `第 ${grp} 组第 ${leg} 程：${ERROR_MESSAGES[errorCode]}`
        : grp
          ? `第 ${grp} 组：${ERROR_MESSAGES[errorCode]}`
          : ERROR_MESSAGES[errorCode]
      : "录入出错，请检查后重试。"
    : undefined;

  const driverParam = firstValue(sp.driver) ?? "";
  const preselectedDriver = drivers.some(d => d.id === driverParam) ? driverParam : "";

  return (
    <>
      <PageHeader
        title="录入行程"
        description="一个司机一个标签页：每个标签页单独记入，也可一次记入全部；每行可单独改日期，起点 / 终点可从位置库选择或直接输入地址或邮编。"
      />

      {savedCount !== undefined && (
        <p role="status" className="notice">
          已记入 {savedCount} 段行程。前往 <Link href="/dashboard/trips">行程管理</Link> 查看与核对。
        </p>
      )}
      <FormError message={errorMessage} />

      <TripEntryForm
        drivers={drivers}
        trucks={trucks}
        locations={locations}
        defaultDriverId={preselectedDriver}
        defaultDate={todayIso()}
        refillGroups={refillGroups}
        initialActiveIndex={initialActiveIndex}
      />

      <p className="notice">
        里程由 Google 地图自动测算，工资按定价规则自动计算，均可手动修改。录入完成后可到{" "}
        <Link href="/dashboard/trips">行程管理</Link> 筛选核对，周期工资在 <Link href="/dashboard/payroll">工资管理</Link> 汇总。
      </p>
    </>
  );
}
