import Link from "next/link";

/**
 * Server-rendered list toolbar pieces shared by the CRUD pages: the counted
 * filter tabs and the keyword search form. Zero client JS - both are plain
 * links and a GET form.
 */

export type ToolbarTab = {
  key: string;
  label: string;
  count?: number;
  /** URL value for the filter param; defaults to the key as-is */
  paramValue?: string;
};

export function ToolbarTabs({
  tabs,
  basePath,
  paramKey,
  activeKey,
  baseParams,
  ariaLabel
}: {
  tabs: readonly ToolbarTab[];
  basePath: string;
  paramKey: string;
  activeKey: string;
  /** Surviving filters (e.g. the search query) kept on every tab link */
  baseParams?: URLSearchParams;
  ariaLabel: string;
}) {
  return (
    <nav className="tabs" aria-label={ariaLabel}>
      {tabs.map(tab => {
        const params = new URLSearchParams(baseParams);
        if (tab.key === "all") params.delete(paramKey);
        else params.set(paramKey, tab.paramValue ?? tab.key);
        const active = activeKey === tab.key;
        return (
          <Link
            key={tab.key}
            href={`${basePath}${params.toString() ? `?${params.toString()}` : ""}`}
            {...(active ? { "aria-current": "page" as const } : {})}
          >
            {tab.label}
            {tab.count !== undefined && <b>{tab.count}</b>}
          </Link>
        );
      })}
    </nav>
  );
}

export function ToolbarSearch({
  basePath,
  query,
  placeholder,
  ariaLabel,
  hiddenFields
}: {
  basePath: string;
  query: string;
  placeholder: string;
  ariaLabel: string;
  /** Current filter values kept on submit (e.g. the active tab) */
  hiddenFields?: Record<string, string>;
}) {
  return (
    <form className="search" action={basePath} method="get">
      {Object.entries(hiddenFields ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <input type="search" name="q" defaultValue={query} placeholder={placeholder} aria-label={ariaLabel} />
      <button type="submit">搜索</button>
    </form>
  );
}
