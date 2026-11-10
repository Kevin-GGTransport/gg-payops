"use client";

import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { submitFormClean } from "@/lib/form";

export type FilterOption = { value: string; label: string };

type FilterSelectProps = {
  /** 表单字段名：多选以重复参数提交，单选以单参数提交 */
  name: string;
  options: FilterOption[];
  /** 多选模式（默认单选；单选时 options 需自带空值项作为「全部」） */
  multiple?: boolean;
  /** 当前选中值（由页面从 URL 参数算好传入，用于回显） */
  selected: string[];
  placeholder?: string;
  triggerClassName?: string;
  "aria-label"?: string;
};

function summary(options: FilterOption[], selected: string[], placeholder: string, multiple: boolean) {
  if (selected.length === 0) return placeholder;
  if (!multiple) return options.find(o => o.value === selected[0])?.label ?? selected[0];
  const labels = selected.map(v => options.find(o => o.value === v)?.label ?? v);
  return labels.length <= 2 ? labels.join("、") : `已选 ${labels.length} 项`;
}

/**
 * 筛选下拉：Popover + 复选/单选列表，提交所在 GET 表单。
 * 多选勾选不提交，点「应用」一并提交；单选点选即提交并收起。
 */
export function FilterSelect({
  name,
  options,
  multiple = false,
  selected,
  placeholder = "全部",
  triggerClassName = "filter-select filter-trigger",
  ...rest
}: FilterSelectProps) {
  const [open, setOpen] = useState(false);
  const selectedSet = new Set(selected);
  const submit = (el: HTMLElement) => {
    const form = el.closest("form");
    if (form) submitFormClean(form);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className={triggerClassName} {...rest}>
          <span className={`truncate ${selected.length === 0 ? "text-muted-foreground" : ""}`}>
            {summary(options, selected, placeholder, multiple)}
          </span>
          <ChevronDown className="trigger-caret" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      {/* 不用 Portal：面板必须留在 form DOM 内，勾选值才能随表单提交 */}
      <Popover.Content align="start" sideOffset={4} className="filter-pop">
        <div className="filter-pop-list">
          {multiple ? (
            options.map(opt => (
              <label key={opt.value} className="filter-pop-item">
                <input
                  type="checkbox"
                  className="row-check"
                  name={name}
                  value={opt.value}
                  defaultChecked={selectedSet.has(opt.value)}
                />
                <span className="filter-pop-label">{opt.label}</span>
                {selectedSet.has(opt.value) && <Check className="tick" aria-hidden="true" />}
              </label>
            ))
          ) : (
            options.map(opt => (
              <label key={opt.value} className="filter-pop-item">
                <input
                  type="radio"
                  className="row-check"
                  name={name}
                  value={opt.value}
                  defaultChecked={selected[0] === opt.value}
                  onChange={event => {
                    submit(event.currentTarget);
                    setOpen(false);
                  }}
                />
                <span className="filter-pop-label">{opt.label}</span>
                {selected[0] === opt.value && <Check className="tick" aria-hidden="true" />}
              </label>
            ))
          )}
        </div>
        {multiple && (
          <div className="filter-pop-foot">
            <button
              type="button"
              className="linklike"
              onClick={event => {
                const list = event.currentTarget.closest(".filter-pop");
                for (const box of list?.querySelectorAll<HTMLInputElement>('input[name="' + name + '"]:checked') ?? []) {
                  box.checked = false;
                }
                submit(event.currentTarget);
                setOpen(false);
              }}
            >
              清空
            </button>
            <button
              type="button"
              className="linklike"
              onClick={event => {
                submit(event.currentTarget);
                setOpen(false);
              }}
            >
              应用
            </button>
          </div>
        )}
      </Popover.Content>
    </Popover.Root>
  );
}
