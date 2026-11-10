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
