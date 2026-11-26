"use client";

import * as React from "react";
import { GripVerticalIcon } from "lucide-react";
import { type ColumnDef } from "@tanstack/react-table";

/**
 * Lead column of a roster sheet whose rows drag-reorder: a narrow
 * non-resizable slot for the grip handle cell.
 */
export const DRAG_HANDLE_COLUMN: ColumnDef<unknown, unknown> = {
  id: "handle",
  header: "",
  size: 28,
  enableResizing: false,
  meta: { headerClass: "px-1" }
};

/** Live drag source shared across useRosterDrag instances; null = idle */
export type RosterDragState<
  RowId extends string | number,
  GroupKey extends string | number
> = { rowId: RowId; groupKey: GroupKey } | null;

/** Insertion point while an armed drag hovers the sheet */
export type RosterDropAt<RowId extends string | number> =
  | { id: RowId; before: boolean }
  | null;

/**
 * Native HTML5 drag-to-reorder mechanics for roster sheets - interaction
 * only; what a committed drop MEANS stays with the owner (onMove). The
 * pattern: a grip press "arms" one row (text selection keeps working
 * everywhere else) and only that row is draggable; hovering a sibling row
 * marks an insertion point via a half-height hit test (the drop-before /
 * drop-after edge lines live in globals.css); a drop inside the same group
 * fires onMove, anything else just ends the drag.
 *
 * Owners with side-by-side sheets (the entry form's driver groups) lift
 * `dragging` to their common parent so foreign groups render no-drop; a
 * single-sheet owner keeps the state right next to the hook.
 */
export function useRosterDrag<
  RowId extends string | number,
  GroupKey extends string | number
>(opts: {
  /** Resolve a row's drop group; source and target must resolve equal to drop */
  groupOf: (id: RowId) => GroupKey;
  /** Commit a drop: move row `fromId` before/after `toId` (owner splices / persists) */
  onMove: (fromId: RowId, toId: RowId, before: boolean) => void;
  /** Lifted live drag source (see above) */
  dragging: RosterDragState<RowId, GroupKey>;
  onDraggingChange: (state: RosterDragState<RowId, GroupKey>) => void;
}) {
  // Grip pressed but drag not confirmed yet; only that row turns draggable
  const [armedRow, setArmedRow] = React.useState<RowId | null>(null);
  const [dropAt, setDropAt] = React.useState<RosterDropAt<RowId>>(null);
  const { groupOf, onMove, dragging, onDraggingChange } = opts;

  const armDrag = React.useCallback((id: RowId, armed: boolean) => {
    setArmedRow(armed ? id : null);
  }, []);

  const endDrag = React.useCallback(() => {
    setArmedRow(null);
    setDropAt(null);
    onDraggingChange(null);
  }, [onDraggingChange]);

  const dragStart = React.useCallback(
    (event: React.DragEvent<HTMLTableRowElement>, id: RowId) => {
      event.dataTransfer.effectAllowed = "move";
      // Firefox only fires dragover when the drag carries some payload
      event.dataTransfer.setData("text/plain", String(id));
      onDraggingChange({ rowId: id, groupKey: groupOf(id) });
    },
    [groupOf, onDraggingChange]
  );

  const dragOver = React.useCallback(
    (event: React.DragEvent<HTMLTableRowElement>, id: RowId) => {
      // Same-group reorder only: compare against the group the drag STARTED
      // in (recorded at dragstart), not this instance's own groupOf - a
      // constant groupOf (one group per sheet) would otherwise always pass
      if (!dragging || dragging.groupKey !== groupOf(id)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const rect = event.currentTarget.getBoundingClientRect();
      const before = event.clientY < rect.top + rect.height / 2;
      setDropAt(current =>
        current?.id === id && current.before === before ? current : { id, before }
      );
    },
    [groupOf, dragging]
  );

  const drop = React.useCallback(
    (event: React.DragEvent<HTMLTableRowElement>) => {
      event.preventDefault();
      if (dragging && dropAt) onMove(dragging.rowId, dropAt.id, dropAt.before);
      endDrag();
    },
    [dragging, dropAt, onMove, endDrag]
  );

  const dragLeave = React.useCallback((event: React.DragEvent<HTMLTableSectionElement>) => {
    // Drag left the sheet entirely (moving between our own rows doesn't)
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDropAt(null);
    }
  }, []);

  return { armedRow, dropAt, armDrag, dragStart, dragOver, drop, endDrag, dragLeave };
}

/**
 * The grip cell of a draggable roster row: pointer-down arms the whole-row
 * drag (see useRosterDrag), pointer release anywhere disarms it. Inert on
 * its own - the owner still decides whether the row is draggable.
 */
export function DragHandleCell<RowId extends string | number>({
  id,
  label,
  onArmDrag
}: {
  /** Stable row id (never the positional index) */
  id: RowId;
  /** Accessible action name, e.g. 拖拽调整行程顺序 */
  label: string;
  onArmDrag: (id: RowId, armed: boolean) => void;
}) {
  return (
    <td className="ctr px-1">
      <span
        className="drag-handle"
        aria-label={label}
        onPointerDown={() => onArmDrag(id, true)}
        onPointerUp={() => onArmDrag(id, false)}
        onPointerCancel={() => onArmDrag(id, false)}
      >
        <GripVerticalIcon className="size-3.5" />
      </span>
    </td>
  );
}
