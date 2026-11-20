import { requireUser } from "@/lib/auth";
import { getUserPermissions, getUserRoleNames } from "@/lib/permissions";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // Fresh from the DB on every request: role edits apply without re-login
  // (JWT roles are a sign-in snapshot and only kept for compatibility)
  const [permissions, roleNames] = await Promise.all([
    getUserPermissions(),
    getUserRoleNames()
  ]);

  return (
    <SidebarProvider>
      <AppSidebar
        displayName={user.displayName}
        roleNames={roleNames}
        permissions={[...permissions]}
      />
      <SidebarInset className="h-svh overflow-hidden">
        {/* Mobile-only slim bar: opens the sheet. Desktop has no top bar (old ledger layout). */}
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-background px-4 md:hidden">
          <SidebarTrigger className="-ml-1" />
          <span className="font-mono text-xs tracking-[0.22em] text-muted-foreground">
            GG·PAYOPS
          </span>
        </header>
        <div className="main flex-1 min-h-0">{children}</div>
      </SidebarInset>
      <Toaster />
    </SidebarProvider>
  );
}
