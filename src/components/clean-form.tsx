"use client";

import type { ComponentProps } from "react";
import { submitFormClean } from "@/lib/form";

/** GET 筛选表单：拦截原生提交（按钮点击 / 回车），统一走剔除空参数的提交 */
export function CleanForm({ onSubmit, ...rest }: ComponentProps<"form">) {
  return (
    <form
      {...rest}
      onSubmit={event => {
        const form = event.currentTarget;
        // submitFormClean 发起的提交：放行
        if (form.dataset.cleanSubmitting === "1") {
          delete form.dataset.cleanSubmitting;
          return;
        }
        event.preventDefault();
        // submit 事件处理中同步 requestSubmit 会被浏览器忽略，推迟到下一个宏任务
        setTimeout(() => submitFormClean(form), 0);
        onSubmit?.(event);
      }}
    />
  );
}
