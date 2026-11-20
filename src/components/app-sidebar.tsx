"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  Calculator,
  ChevronRight,
  LayoutDashboard,
  LogOut,
  MapPin,
  ScrollText,
  Shapes,
  ShieldCheck,
  Truck,
  UserRound,
  Users
} from "lucide-react";
import { signOutAction } from "@/app/actions";
import { ChangePasswordButton } from "@/components/change-password-dialog";
import type { PermissionCode } from "@/lib/permission-catalog";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger
} from "@/components/ui/sidebar";

type MenuLeaf = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Required permission (enforced server-side; hidden here as convenience) */
  permission?: PermissionCode;
};

type MenuGroup = {
  label: string;
  items: MenuLeaf[];
};

/** Top-level workbench: the trip-entry home, reachable in one click */
const WORKBENCH: MenuLeaf = {
  href: "/dashboard",
  label: "工作台",
  icon: LayoutDashboard,
  permission: "trip.write"
};

const GROUPS: MenuGroup[] = [
  {
    label: "工资结算",
    items: [
      { href: "/dashboard/payroll", label: "工资单", icon: Calculator, permission: "payroll.read" },
      { href: "/dashboard/trips", label: "行程管理", icon: ScrollText, permission: "trip.read" },
      { href: "/dashboard/stats", label: "数据统计", icon: BarChart3, permission: "report.read" }
    ]
  },
  {
    label: "基础数据",
    items: [
      { href: "/dashboard/wage-rules", label: "工资规则", icon: BookOpen, permission: "wage_rule.read" },
      { href: "/dashboard/drivers", label: "司机管理", icon: UserRound, permission: "driver.read" },
      { href: "/dashboard/trucks", label: "车辆管理", icon: Truck, permission: "truck.read" },
      { href: "/dashboard/locations", label: "位置管理", icon: MapPin, permission: "location.read" },
      { href: "/dashboard/operations", label: "操作类型", icon: Shapes, permission: "operation.read" }
    ]
  },
  {
    label: "系统",
    items: [
      { href: "/dashboard/accounts", label: "账号管理", icon: Users, permission: "account.read" },
      { href: "/dashboard/roles", label: "角色权限", icon: ShieldCheck, permission: "role.read" }
    ]
  }
];

function useIsActive() {
  const pathname = usePathname();
  // Workbench is exact-match so nested routes keep their own group highlighted
  return (href: string) =>
    href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);
}

export function AppSidebar({
  displayName,
  roleNames = [],
  permissions = []
}: {
  displayName: string;
  /** Live role names from the DB (the JWT snapshot went stale on role edits) */
  roleNames?: string[];
  /** Live permission codes; nav items outside this set stay hidden */
  permissions?: string[];
}) {
  const isActive = useIsActive();
  const allowed = (item: MenuLeaf) =>
    !item.permission || permissions.includes(item.permission);
  const showWorkbench = allowed(WORKBENCH);
  const groups = GROUPS.map(group => ({
    ...group,
    items: group.items.filter(allowed)
  })).filter(group => group.items.length > 0);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-2 pt-4">
        {/* pl-2 aligns the mark with menu icons (group p-2 + button p-2);
            icon mode stacks mark + trigger vertically in the 56px rail */}
        <div className="flex flex-wrap items-center gap-2.5 border-b border-white/15 pb-4 pl-2 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:pl-0">
          <span
            aria-hidden="true"
            className="grid size-10 shrink-0 place-items-center rounded-[3px] border border-amber/70 font-mono text-[13px] font-bold text-amber-200"
          >
            G&amp;G
          </span>
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <p className="m-0 truncate text-[15px] font-bold tracking-tight text-white">
              G&amp;G PayOps
            </p>
            <p className="m-0 mt-0.5 text-[10px] tracking-[0.22em] text-slate-400">
              运输结算中心
            </p>
          </div>
          {/* Desktop collapse control next to the brand (mobile uses the top bar) */}
          <SidebarTrigger className="hidden size-8 text-slate-400 hover:bg-white/10 hover:text-white md:inline-flex" />
        </div>
      </SidebarHeader>
      <SidebarContent>
        {showWorkbench ? (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(WORKBENCH.href)}
                    tooltip="工作台"
                    className="text-[15px] font-semibold"
                  >
                    <Link href={WORKBENCH.href}>
                      <WORKBENCH.icon />
                      <span>{WORKBENCH.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
        {groups.map(group => {
          return (
            <Collapsible
              key={group.label}
              defaultOpen
              className="group/collapsible"
            >
              <SidebarGroup>
                <SidebarGroupLabel
                  asChild
                  className="px-2 text-[15px] font-semibold text-slate-100 hover:text-white"
                >
                  <CollapsibleTrigger>
                    {group.label}
                    {/* Rotation driven by [data-state] CSS in globals (see 舱单书脊 section);
                        transition here animates it both ways */}
                    <ChevronRight className="ml-auto size-4 text-slate-500 transition-transform duration-200" />
                  </CollapsibleTrigger>
                </SidebarGroupLabel>
                <CollapsibleContent className="overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up">
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {group.items.map(item => (
                        <SidebarMenuItem key={item.href}>
                          <SidebarMenuButton
                            asChild
                            isActive={isActive(item.href)}
                            tooltip={item.label}
                            className="pl-9 text-[13px]"
                          >
                            <Link href={item.href}>
                              <item.icon />
                              <span>{item.label}</span>
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </CollapsibleContent>
              </SidebarGroup>
            </Collapsible>
          );
        })}
      </SidebarContent>
      <SidebarFooter className="px-2 pb-4">
        <div className="border-t border-white/15 px-1 pt-3.5">
          <div className="group-data-[collapsible=icon]:hidden">
            <p className="m-0 text-[13px] font-semibold text-white">
              {displayName}
            </p>
            <p className="m-0 mt-0.5 text-[11px] text-slate-400">
              {roleNames.join(" / ") || "未分配角色"}
            </p>
          </div>
          <ChangePasswordButton />
          <form action={signOutAction} className="mt-2.5">
            <Button
              variant="ghost"
              size="sm"
              aria-label="退出登录"
              className="h-9 w-full justify-start rounded-[3px] px-2 text-[13px] text-slate-300 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 hover:bg-white/10 hover:text-white"
            >
              <LogOut />
              <span className="group-data-[collapsible=icon]:hidden">退出登录</span>
            </Button>
          </form>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
