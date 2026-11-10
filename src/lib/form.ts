/**
 * 提交 GET 筛选表单，并剔除空值参数：
 * 提交前把值为空的控件临时 disabled（disabled 控件不序列化进 URL），
 * 提交后立即恢复，避免 `?q=&from=&to=` 这类脏参数。
 *
 * 仅用于非 submit 事件上下文（onChange / 按钮 onClick）：同步 requestSubmit 即可。
 * 若在 submit 事件处理中调用（如 CleanForm 拦截原生提交后），
 * 同步 requestSubmit 会被浏览器忽略，需由调用方推迟到 setTimeout。
 * data 标记用于让 CleanForm 的 onSubmit 放行由此发起的提交，避免循环拦截。
 */
export function submitFormClean(form: HTMLFormElement) {
  if (form.dataset.cleanSubmitting === "1") {
    delete form.dataset.cleanSubmitting;
    return;
  }
  form.dataset.cleanSubmitting = "1";
  const disabled: Array<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement> = [];
  for (const el of form.elements) {
    if (
      (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) &&
      el.name && !el.disabled && el.value === "" && el.type !== "checkbox" && el.type !== "radio"
    ) {
      el.disabled = true;
      disabled.push(el);
    }
  }
  form.requestSubmit();
  for (const el of disabled) el.disabled = false;
  delete form.dataset.cleanSubmitting;
}
