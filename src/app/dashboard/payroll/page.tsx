import { redirect } from "next/navigation";
import { firstValue, type SearchParams } from "@/lib/search-params";

/**
 * Payroll merged into the trips page (period rollup view). Old links keep
 * working; the export route under this segment stays where it is.
 */
export default async function PayrollRedirectPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const period = firstValue(sp.period);
  redirect(`/dashboard/trips?view=period${period ? `&period=${period}` : ""}`);
}
