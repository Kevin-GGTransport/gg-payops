"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/dashboard", label: "录入行程", exact: true },
  { href: "/dashboard/drivers", label: "司机管理", exact: false },
  { href: "/dashboard/locations", label: "位置管理", exact: false },
  { href: "/dashboard/trips", label: "行程管理", exact: false },
  { href: "/dashboard/payroll", label: "工资管理", exact: false }
] as const;

export function RailNav() {
  const pathname = usePathname();

  return (
    <nav className="nav" aria-label="主导航">
      {items.map(item => {
        const active = item.exact
          ? pathname === item.href
          : pathname.startsWith(item.href);
        return (
          <Link
            key={item.label}
            href={item.href}
            {...(active ? { "aria-current": "page" as const } : {})}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
