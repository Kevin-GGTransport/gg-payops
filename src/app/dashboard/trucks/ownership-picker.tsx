"use client";

import * as React from "react";
import { BuildingIcon, TruckIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { ComboboxField } from "@/components/combobox-field";
import {
  radioCardBase as cardBase,
  radioCardNameClass as nameClass,
  radioCardDescClass,
  radioCardInputClass as inputClass
} from "@/components/choice-cards";

type OwnerOption = { id: string; full_name: string; phone: string | null };

const descClass = radioCardDescClass;
const cardOn = "border-route bg-route/5 [&_svg]:text-route [&_.name]:text-route";

/**
 * Ownership picker (truck form): company-owned / owner radio cards; the owner
 * combobox only submits while the 车主 card is active.
 */
export function OwnershipPicker({
  owners,
  defaultKind,
  defaultOwnerId
}: {
  owners: OwnerOption[];
  defaultKind: "company" | "owner";
  defaultOwnerId: string;
}) {
  const [kind, setKind] = React.useState<"company" | "owner">(defaultKind);

  return (
    <fieldset className="mx-4 mt-3.5 border-0 p-0">
      <legend className="mb-1.5 float-left text-[13px] text-muted-foreground">归属</legend>
      <div className="grid grid-cols-2 gap-2 max-md:grid-cols-1">
        <label className={cn(cardBase, kind === "company" && cardOn)}>
          <input
            className={inputClass}
            type="radio"
            name="ownership_kind"
            value="company"
            checked={kind === "company"}
            onChange={() => setKind("company")}
          />
          <BuildingIcon className="row-span-2 size-5 text-slate-400" aria-hidden="true" />
          <span className={cn(nameClass, "name")}>公司自有</span>
          <span className={descClass}>车辆登记在公司名下</span>
        </label>
        <label className={cn(cardBase, kind === "owner" && cardOn)}>
          <input
            className={inputClass}
            type="radio"
            name="ownership_kind"
            value="owner"
            checked={kind === "owner"}
            onChange={() => setKind("owner")}
          />
          <TruckIcon className="row-span-2 size-5 text-slate-400" aria-hidden="true" />
          <span className={cn(nameClass, "name")}>车主</span>
          <span className={descClass}>自带车辆承运，归属车主</span>
        </label>
      </div>
      {kind === "owner" && (
        <div className="mt-2.5">
          <ComboboxField
            label="车主"
            name="owner_driver_id"
            defaultValue={defaultOwnerId}
            placeholder="请选择车主"
            searchPlaceholder="搜索姓名"
            clearable={false}
            className="text-xs font-medium text-muted-foreground"
            options={owners.map(o => ({
              value: o.id,
              label: o.full_name,
              description: o.phone ?? undefined
            }))}
          />
        </div>
      )}
    </fieldset>
  );
}
