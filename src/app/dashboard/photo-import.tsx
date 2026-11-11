"use client";

import * as React from "react";
import { ImageIcon, LoaderIcon, UploadIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ComboboxField } from "@/components/combobox-field";
import type { LocationOption } from "@/components/location-picker";
import { DRIVER_TYPE_LABELS, type DriverType } from "@/lib/labels";
import type { OcrSheet } from "@/lib/vision-ocr";

type DriverOption = {
  id: string;
  driver_code: string;
  full_name: string;
  driver_type: DriverType;
};

/** One photo's converted rows, ready to be dropped into the entry table */
export type PhotoApply = {
  driverId: string;
  rows: Array<{ date: string; load_no: string; from: string; to: string; operation: string; notes: string }>;
};

type PhotoState = {
  id: number;
  filename: string;
  previewUrl: string | null;
  status: "recognizing" | "done" | "failed";
  sheet?: OcrSheet;
  error?: string;
  /** Locally picked driver when the sheet's truck number matches no driver */
  pickedDriverId?: string;
};

type PhotoImportProps = {
  drivers: DriverOption[];
  locations: LocationOption[];
  /** Dialog open state lives in the entry form */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Drop the converted rows into the entry table below */
  onApply: (apply: PhotoApply) => void;
};

/**
 * Match a sheet endpoint against the location library: nature code first
 * (HW / MCE1...), then the zip inside a known address, else free text.
 */
function endpointValue(code: string, zip: string, locations: LocationOption[]): string {
  const normalized = code.trim();
  const byCode = locations.find(l => l.code.toUpperCase() === normalized.toUpperCase());
  if (byCode) return `loc:${byCode.id}`;
  if (/^\d{5}$/.test(zip)) {
    const byZip = locations.find(l => new RegExp(`\\b${zip}\\b`).test(l.address ?? ""));
    if (byZip) return `loc:${byZip.id}`;
    return `txt:${zip}`;
  }
  return normalized ? `txt:${normalized}` : "";
}

/**
 * Match the sheet's truck number to a driver: some archive records store the
 * truck number as the code, others typed it into the name field - check both.
 */
function matchDriver(code: string, drivers: DriverOption[]): DriverOption | null {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return null;
  return (
    drivers.find(d => d.driver_code.toUpperCase() === normalized) ??
    drivers.find(d => d.full_name.trim().toUpperCase() === normalized) ??
    null
  );
}

/** Split a nature like "HW - MCE1" into its two endpoint codes */
function natureEnds(nature: string): [string, string] {
  const parts = nature.split(/[-–—~→>]+/).map(s => s.trim()).filter(Boolean);
  return [parts[0] ?? "", parts[1] ?? ""];
}

const ERROR_MESSAGES: Record<string, string> = {
  missing_api_key: "未配置 OPENAI_API_KEY，无法识别。",
  upstream_error: "识别服务返回错误，可重试。",
  recognize_failed: "这张照片没能识别，可重试或手动录入。",
  no_files: "没有选择照片。",
  too_many_files: "一次最多 21 张照片。",
  file_too_large: "有照片超过 10MB。",
  unauthorized: "登录已过期，请重新登录。"
};

async function recognize(files: File[]) {
  const body = new FormData();
  for (const file of files) body.append("files", file);
  const res = await fetch("/api/trip-photos", { method: "POST", body });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? "recognize_failed");
  }
  return (await res.json()) as {
    results: Array<{ filename: string; ok: true; data: OcrSheet } | { filename: string; ok: false; error: string }>;
  };
}

/**
 * Photo batch-import dialog: pick PU/DEL record photos, recognize them
 * server-side, review per-sheet results, then drop the rows into the entry
 * table. All state lives here and survives closing the dialog; the hidden
 * file input is rendered outside the dialog so its FileList (the retry
 * source) is not destroyed with the dialog content. Photos never persist -
 * only their preview object URLs, revoked on unmount.
 */
export function PhotoImport({ drivers, locations, open, onOpenChange, onApply }: PhotoImportProps) {
  const [photos, setPhotos] = React.useState<PhotoState[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [fatalError, setFatalError] = React.useState<string | null>(null);
  const nextId = React.useRef(1);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Revoke preview URLs on unmount
  React.useEffect(
    () => () => {
      for (const photo of photos) {
        if (photo.previewUrl) URL.revokeObjectURL(photo.previewUrl);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  async function addFiles(files: File[]) {
    const images = files.filter(f => f.type.startsWith("image/"));
    if (images.length === 0) return;
    setFatalError(null);
    setBusy(true);
    const added: PhotoState[] = images.map(file => ({
      id: nextId.current++,
      filename: file.name,
      previewUrl: URL.createObjectURL(file),
      status: "recognizing"
    }));
    setPhotos(current => [...current, ...added]);
    try {
      const { results } = await recognize(images);
      setPhotos(current =>
        current.map(photo => {
          if (photo.status !== "recognizing") return photo;
          const result = results.find(r => r.filename === photo.filename);
          if (!result) return { ...photo, status: "failed", error: "recognize_failed" };
          return result.ok
            ? { ...photo, status: "done", sheet: result.data }
            : { ...photo, status: "failed", error: result.error };
        })
      );
    } catch (error) {
      // Whole request failed (bad key / too many files / network)
      setFatalError(error instanceof Error ? error.message : "recognize_failed");
      setPhotos(current =>
        current.map(photo => (photo.status === "recognizing" ? { ...photo, status: "failed", error: "recognize_failed" } : photo))
      );
    } finally {
      setBusy(false);
    }
  }

  async function retry(photo: PhotoState) {
    // Re-upload the original file kept in the hidden input's FileList
    const input = inputRef.current;
    const all = input?.files;
    if (!input || !all) return;
    const file = Array.from(all).find(f => f.name === photo.filename);
    if (!file) {
      setPhotos(current => current.map(p => (p.id === photo.id ? { ...p, error: "recognize_failed" } : p)));
      return;
    }
    setPhotos(current => current.map(p => (p.id === photo.id ? { ...p, status: "recognizing", error: undefined } : p)));
    setBusy(true);
    try {
      const { results } = await recognize([file]);
      const result = results[0];
      setPhotos(current =>
        current.map(p =>
          p.id === photo.id
            ? result && result.ok
              ? { ...p, status: "done", sheet: result.data }
              : { ...p, status: "failed", error: result && !result.ok ? result.error : "recognize_failed" }
            : p
        )
      );
    } catch (error) {
      setPhotos(current =>
        current.map(p =>
          p.id === photo.id
            ? { ...p, status: "failed", error: error instanceof Error ? error.message : "recognize_failed" }
            : p
        )
      );
    } finally {
      setBusy(false);
    }
  }

  function removePhoto(photo: PhotoState) {
    if (photo.previewUrl) URL.revokeObjectURL(photo.previewUrl);
    setPhotos(current => current.filter(p => p.id !== photo.id));
  }

  function applySheet(photo: PhotoState) {
    const sheet = photo.sheet;
    if (!sheet) return;
    const matched = matchDriver(sheet.driver_code, drivers);
    const driverId = photo.pickedDriverId || matched?.id || "";
    if (!driverId) return;
    const rows = sheet.rows.map(row => {
      const [fromCode, toCode] = natureEnds(row.nature);
      return {
        date: row.date,
        load_no: row.load_no,
        from: endpointValue(fromCode, row.from_zip, locations),
        to: endpointValue(toCode, row.to_zip, locations),
        operation: row.operation,
        notes: row.note
      };
    });
    onApply({ driverId, rows });
    removePhoto(photo);
  }

  const doneCount = photos.filter(p => p.status === "done").length;
  const failedCount = photos.filter(p => p.status === "failed").length;

  return (
    <>
      {/* Outside the dialog: keeps the picked FileList alive across dialog
          close/reopen (single retry source) */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={e => {
          if (e.target.files?.length) addFiles(Array.from(e.target.files));
        }}
      />
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl" data-photo-panel>
          <DialogHeader>
            <DialogTitle>照片识别导入</DialogTitle>
            <p className="text-xs font-normal text-muted-foreground">
              拍照的「海柜提卸货记录」单据，一次最多 21 张 · 识别后逐张填入录入表
            </p>
          </DialogHeader>
          <div className="grid gap-3 px-5 py-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" className="h-8" disabled={busy} onClick={() => inputRef.current?.click()}>
                <UploadIcon className="size-4" />
                {busy ? "识别中…" : "选择照片（可多选）"}
              </Button>
              <span className="text-xs text-muted-foreground">
                {photos.length > 0
                  ? `共 ${photos.length} 张 · 已识别 ${doneCount}${failedCount ? ` · 失败 ${failedCount}` : ""}`
                  : "照片不会保存，仅用于识别"}
              </span>
            </div>

            {fatalError && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
                {ERROR_MESSAGES[fatalError] ?? "识别失败，请重试。"}
              </p>
            )}

            {photos.length > 0 ? (
              <ul className="grid max-h-[62vh] gap-2 overflow-y-auto pr-1">
                {photos.map(photo => (
                  <PhotoCard
                    key={photo.id}
                    photo={photo}
                    drivers={drivers}
                    busy={busy}
                    onRetry={() => retry(photo)}
                    onRemove={() => removePhoto(photo)}
                    onPickDriver={driverId =>
                      setPhotos(current => current.map(p => (p.id === photo.id ? { ...p, pickedDriverId: driverId } : p)))
                    }
                    onApply={() => applySheet(photo)}
                  />
                ))}
              </ul>
            ) : (
              !fatalError && (
                <p className="rounded-md border border-dashed border-line px-3 py-8 text-center text-[13px] text-muted-foreground">
                  尚未上传照片，点击上方按钮选择单据照片
                </p>
              )
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PhotoCard({
  photo,
  drivers,
  busy,
  onRetry,
  onRemove,
  onPickDriver,
  onApply
}: {
  photo: PhotoState;
  drivers: DriverOption[];
  busy: boolean;
  onRetry: () => void;
  onRemove: () => void;
  onPickDriver: (driverId: string) => void;
  onApply: () => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const matched = photo.sheet ? matchDriver(photo.sheet.driver_code, drivers) : null;
  const driverId = photo.pickedDriverId || matched?.id || "";
  const dates = photo.sheet?.rows.map(r => r.date) ?? [];
  const range = dates.length > 0 ? `${dates[0]} ~ ${dates[dates.length - 1]}` : "";

  return (
    <li className="flex flex-col gap-2.5 rounded-md border border-line bg-muted/30 p-3">
      <div className="flex items-start gap-3">
        <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded border border-line bg-background">
          {photo.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo.previewUrl} alt={photo.filename} className="size-full object-cover" />
          ) : (
            <ImageIcon className="size-6 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1 grid gap-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-medium">{photo.filename}</span>
            <span className="ml-auto flex items-center gap-1.5">
              {photo.status === "recognizing" && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <LoaderIcon className="size-3.5 animate-spin" /> 识别中…
                </span>
              )}
              {photo.status === "done" && (
                <span className="text-xs text-emerald-600">
                  {photo.sheet?.rows.length ?? 0} 行{range && ` · ${range}`}
                </span>
              )}
              {photo.status === "failed" && (
                <button type="button" className="linklike danger text-xs" disabled={busy} onClick={onRetry}>
                  重试
                </button>
              )}
              <button type="button" className="linklike text-xs" onClick={onRemove} aria-label="移除这张照片">
                <XIcon className="size-3.5" />
              </button>
            </span>
          </div>

          {photo.status === "done" && photo.sheet && (
            <>
              <div className="text-xs text-muted-foreground">
                识别司机：<span className="text-foreground">{photo.sheet.driver_name || "—"}</span> · 车号{" "}
                <span className="font-mono text-foreground">{photo.sheet.driver_code || "—"}</span>
                {matched ? (
                  <span className="ml-1 text-emerald-600">✓ 已匹配 {matched.driver_code} {matched.full_name}</span>
                ) : (
                  <span className="ml-1 text-amber-600">车号未匹配到司机，请手选：</span>
                )}
              </div>
              {!matched && (
                <ComboboxField
                  name={`photo_driver_${photo.id}`}
                  defaultValue={driverId}
                  placeholder="选择司机"
                  searchPlaceholder="搜索车号或姓名"
                  mono
                  className="max-w-64"
                  triggerClassName="h-8"
                  onValueChange={onPickDriver}
                  options={drivers.map(d => ({
                    value: d.id,
                    label: d.driver_code,
                    description: `${d.full_name}（${DRIVER_TYPE_LABELS[d.driver_type]}）`,
                    group: DRIVER_TYPE_LABELS[d.driver_type]
                  }))}
                />
              )}
              <div className="flex items-center gap-2">
                <button type="button" className="linklike text-xs" onClick={() => setExpanded(v => !v)}>
                  {expanded ? "收起明细 ▴" : `查看 ${photo.sheet.rows.length} 行明细 ▾`}
                </button>
                <Button
                  type="button"
                  className="ml-auto h-7 px-3 text-xs"
                  disabled={!driverId}
                  onClick={onApply}
                >
                  填入下方录入表
                </Button>
              </div>
              {expanded && (
                <div className="table-wrap max-h-64 overflow-y-auto rounded border border-line bg-background">
                  <table className="roster">
                    <thead>
                      <tr>
                        <th>日期</th><th>柜号</th><th>Nature</th><th>From Zip</th><th>To Zip</th><th>操作</th><th>备注</th>
                      </tr>
                    </thead>
                    <tbody>
                      {photo.sheet.rows.map((row, i) => (
                        <tr key={i}>
                          <td className="mono">{row.date}</td>
                          <td className="mono">{row.load_no || "—"}</td>
                          <td className="mono">{row.nature || "—"}</td>
                          <td className="mono">{row.from_zip || "—"}</td>
                          <td className="mono">{row.to_zip || "—"}</td>
                          <td>{row.operation}</td>
                          <td>{row.note || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {photo.status === "failed" && (
            <p className="text-xs text-muted-foreground">{ERROR_MESSAGES[photo.error ?? ""] ?? "识别失败。"}</p>
          )}
        </div>
      </div>
    </li>
  );
}
