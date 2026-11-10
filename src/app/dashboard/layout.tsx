import { requireUser } from "@/lib/auth";
import { signOutAction } from "@/app/actions";
import { RailNav } from "@/components/rail-nav";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="dashboard">
      <aside className="rail">
        <div className="rail-brand">
          <span className="rail-mark" aria-hidden="true">G&amp;G</span>
          <div>
            <h1>G&amp;G PayOps</h1>
            <p>运输结算中心</p>
          </div>
        </div>
        <RailNav />
        <div className="user-box">
          <div className="user-name">{user.displayName}</div>
          <div className="user-roles">{user.roles.join(" / ") || "未分配角色"}</div>
          <form action={signOutAction}>
            <button className="ghost" type="submit">退出登录</button>
          </form>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
