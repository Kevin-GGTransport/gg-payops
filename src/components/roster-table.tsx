"use client";
/* eslint-disable react-hooks/incompatible-library -- TanStack owns this component's reactivity; React Compiler opts out */

import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnSizingState,
  type Updater,
  type RowData,
  type Table as TanstackTable
} from "@tanstack/react-table";

import { cn } from "@/lib/utils";
import { Table, TableBody, TableHeader, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { LedgerEmpty } from "@/components/ledger";

// Per-column presentation hints the shell understands
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Classes applied to the header cell (alignment, responsive visibility) */
    headerClass?: string;
    /** Classes applied to every body cell of the column */
    cellClass?: string;
  }
}

/**
 * TanStack instance wired the shadcn data-table way: column sizing commits on
 * drag release ("onEnd" - zero re-renders while dragging, the handle itself
 * tracks the cursor via deltaOffset), persisted per storageKey; a stored size
 * is dropped on double-click so the column falls back to its default.
 */
export function useRosterTable<TData>(options: {
  data: TData[];
  columns: ColumnDef<TData, unknown>[];
  storageKey: string;
}): TanstackTable<TData> {
  const { data, columns, storageKey } = options;
  const [columnSizing, setColumnSizing] = React.useState<ColumnSizingState>({});

  // Restore after mount: server render keeps defaults, so no hydration mismatch
  React.useEffect(() => {
    try {
      const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "");
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
        setColumnSizing(parsed as ColumnSizingState);
      }
    } catch {
      // Missing / corrupted value -> defaults
    }
  }, [storageKey]);

  // Stable handler identity: churn here feeds TanStack's internal state sync
  // loop on hot components (the entry sheet re-renders on every pay report)
  const persistSizing = React.useCallback(
    (updater: Updater<ColumnSizingState>) => {
      setColumnSizing(prev => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        if (next === prev) return prev;
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          // Storage unavailable -> widths stay session-only
        }
        return next;
      });
    },
    [storageKey]
  );

  return useReactTable({
    data,
    columns,
    state: { columnSizing },
    onColumnSizingChange: persistSizing,
    columnResizeMode: "onEnd",
    getCoreRowModel: getCoreRowModel(),
    defaultColumn: { minSize: 48 }
  });
}

/** Human label of a header column (string headers only), for the drag handle */
function headerLabel(headerText: unknown, fallback: string) {
  return typeof headerText === "string" ? headerText : fallback;
}

/**
 * Roster table shell on shadcn Table primitives: ledger thead with per-column
 * resize handles (Radix Separator), body from the table's row model - or the
 * caller's own tbody markup via children (the entry form's grid). Empty data
 * renders one full-width empty row.
 */
export function RosterTable<TData>({
  table,
  empty,
  className,
  rowClassName,
  children
}: {
  table: TanstackTable<TData>;
  /** Empty-state copy when there are no rows (ignored with children) */
  empty?: React.ReactNode;
  className?: string;
  /** Extra classes per row (e.g. row-off for inactive records) */
  rowClassName?: (row: TData) => string | undefined;
  /** Hand-rendered tbody(s): replaces the automatic row rendering */
  children?: React.ReactNode;
}) {
  const rows = table.getRowModel().rows;
  const columns = table.getVisibleLeafColumns();
  const sizing = table.getState().columnSizingInfo;

  return (
    <Table className={cn("roster table-fixed", className)}>
      <colgroup>
        {columns.map(column => (
          <col key={column.id} style={{ width: column.getSize() }} />
        ))}
      </colgroup>
      <TableHeader>
        {table.getHeaderGroups().map(headerGroup => (
          <tr key={headerGroup.id}>
            {headerGroup.headers.map(header => {
              const meta = header.column.columnDef.meta;
              const label = headerLabel(header.column.columnDef.header, header.column.id);
              return (
                <TableHead
                  key={header.id}
                  className={cn("col-th", meta?.headerClass)}
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                  {header.column.getCanResize() && (
                    <Separator
                      decorative={false}
                      orientation="vertical"
                      aria-label={`调整「${label}」列宽`}
                      // bg-transparent cancels the Separator primitive's gray
                      // fill; .col-resizer's ::after draws the route-blue hint
                      // on hover/active only
                      className="col-resizer bg-transparent"
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      onDoubleClick={() =>
                        // Drop the stored size -> the column falls back to its default
                        table.setColumnSizing(prev => {
                          const next = { ...prev };
                          delete next[header.column.id];
                          return next;
                        })
                      }
                      style={{
                        transform:
                          sizing.isResizingColumn === header.column.id
                            ? `translateX(${sizing.deltaOffset ?? 0}px)`
                            : undefined
                      }}
                    />
                  )}
                </TableHead>
              );
            })}
          </tr>
        ))}
      </TableHeader>
      {children ?? (
        <TableBody>
          {rows.length === 0 && empty !== undefined && <LedgerEmpty colSpan={columns.length}>{empty}</LedgerEmpty>}
          {rows.map(row => (
            <TableRow
              key={row.id}
              className={rowClassName ? rowClassName(row.original) : undefined}
            >
              {row.getVisibleCells().map(cell => (
                <TableCell
                  key={cell.id}
                  className={cell.column.columnDef.meta?.cellClass}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      )}
    </Table>
  );
}
