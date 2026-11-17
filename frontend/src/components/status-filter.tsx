"use client";

import { Select } from "./fields";
import { STATUSES, type Status, stampLabel } from "./status-stamp";
import { FOLLOW_UP } from "@/lib/types";

export type Filter = Status | "all" | typeof FOLLOW_UP;

// DESIGN.md 6.4: one native select (the 6.2 component), label "Status", All, the nine statuses, then the "Needs follow-up" view.
// Full width on a phone, capped from 768.
export function StatusFilter({ value, onChange }: { value: Filter; onChange: (value: Filter) => void }) {
  return (
    <Select label="Status" value={value} onChange={(e) => onChange(e.target.value as Filter)} className="md:max-w-xs">
      <option value="all">All</option>
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {stampLabel(s)}
        </option>
      ))}
      <option value={FOLLOW_UP}>Needs follow-up</option>
    </Select>
  );
}
