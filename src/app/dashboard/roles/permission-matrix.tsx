import { cn } from "@/lib/utils";
import {
  PERMISSION_LABELS,
  PERMISSION_MODULES,
  type PermissionCode
} from "@/lib/permission-catalog";

/**
 * The role editor's signature element: one row per module, that module's
 * actions laid out as checkboxes (查看 / 编辑 / 司机确认). Purely uncontrolled -
 * the enclosing server-action form reads `perm_<code>` keys. Locked rows
 * (system presets) render disabled checkboxes that submit nothing.
 */
export function PermissionMatrix({
  defaultCodes,
  locked = false
}: {
  defaultCodes: ReadonlySet<string> | readonly string[];
  /** System presets: matrix is display-only, only the name stays editable */
  locked?: boolean;
}) {
  const granted =
    defaultCodes instanceof Set ? defaultCodes : new Set(defaultCodes);

  return (
    <fieldset disabled={locked} className="border-0 p-0">
      <div className="grid gap-px overflow-hidden rounded-md border border-line bg-line">
        {PERMISSION_MODULES.map(mod => (
          <div
            key={mod.module}
            className="grid grid-cols-[7rem_1fr] items-center gap-3 bg-card px-3 py-2"
          >
            <span className="text-xs font-semibold tracking-wide text-muted-foreground">
              {mod.label}
            </span>
            <div className={cn("flex flex-wrap items-center gap-x-5 gap-y-1.5", locked && "opacity-70")}>
              {mod.permissions.map(code => (
                <label
                  key={code}
                  className="inline-flex cursor-pointer items-center gap-1.5 text-[13px]"
                >
                  <input
                    type="checkbox"
                    name={`perm_${code}`}
                    value="1"
                    defaultChecked={granted.has(code as PermissionCode)}
                    className="size-3.5 accent-route"
                  />
                  {PERMISSION_LABELS[code as PermissionCode]}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      {locked && (
        <p className="mt-2 text-xs text-muted-foreground">
          系统预置角色的权限集合不可修改；如需不同搭配请新建自定义角色。
        </p>
      )}
    </fieldset>
  );
}
