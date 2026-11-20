import type { Metadata } from "next";
import Link from "next/link";
import { ShieldX } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { signOutAction } from "@/app/actions";

export const metadata: Metadata = { title: "无权访问 · G&G PayOps" };

// Login-only gate: never requirePermission here, or a missing permission
// would redirect into itself forever.
export default async function ForbiddenPage() {
  await requireUser();

  return (
    <>
      <PageHeader title="无权访问" description="你的账号没有访问该页面的权限。" />
      <section aria-label="无权访问提示">
        <div className="panel">
          <div className="flex flex-col items-center gap-4 px-6 py-14 text-center">
            <ShieldX aria-hidden="true" className="size-10 text-route" />
            <div className="space-y-1.5">
              <p className="m-0 text-[15px] font-semibold">需要管理员开通权限</p>
              <p className="m-0 text-[13px] text-muted-foreground">
                如确需访问此页面，请联系管理员在「账号管理」中调整你的角色。
              </p>
            </div>
            <div className="mt-2 flex items-center gap-2.5">
              <Link className="button" href="/dashboard">
                返回工作台
              </Link>
              <form action={signOutAction}>
                <button type="submit" className="button button-quiet">
                  退出登录
                </button>
              </form>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
