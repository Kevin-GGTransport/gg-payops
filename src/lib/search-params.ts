export type SearchParams = Record<string, string | string[] | undefined>;

/** searchParams 中同名参数可能为数组，统一取第一个 */
export function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/** 读取同名参数的全部取值（多选筛选，如 ?driver=a&driver=b） */
export function allValues(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.map(v => v.trim()).filter(Boolean);
  const trimmed = value?.trim();
  return trimmed ? [trimmed] : [];
}

/** 读取 ?f_xxx= 表单回填值，失败重定向时保留用户输入 */
export function formField(
  sp: SearchParams,
  key: string,
  fallback: string | null | undefined = ""
) {
  return ((firstValue(sp[`f_${key}`]) ?? fallback ?? "") as string);
}

/** Append a success flash flag (e.g. saved=1) to a redirect path's query */
export function withFlash(path: string, query: string, flag: string, value = "1") {
  const params = new URLSearchParams(query);
  params.set(flag, value);
  return `${path}?${params.toString()}`;
}

/**
 * The shared CRUD-page URL params: which row is being edited, the last error
 * code, whether the "new" modal should open, and the saved-flash message
 * (callers map flash values to their own Chinese copy, e.g. { "1": "…已保存" }).
 */
export function parseCrudParams(sp: SearchParams, savedMessages: Record<string, string>) {
  const savedFlash = firstValue(sp.saved);
  return {
    editId: (firstValue(sp.edit) ?? "").trim(),
    errorCode: firstValue(sp.error),
    isNew: firstValue(sp.new) === "1",
    savedMessage: savedFlash !== undefined ? savedMessages[savedFlash] : undefined
  };
}

/** Collect ids riding under a URL prefix (e.g. role_<id>=1 checkbox refills) */
export function collectPrefixedIds(sp: SearchParams, prefix: string): Set<string> {
  return new Set(
    Object.keys(sp)
      .filter(key => key.startsWith(prefix))
      .map(key => key.slice(prefix.length))
  );
}

/** Strict YYYY-MM-DD from a URL param, undefined when absent/invalid */
export function dateParam(value: string | string[] | undefined): string | undefined {
  const v = (firstValue(value) ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v).toString() !== "Invalid Date" ? v : undefined;
}
