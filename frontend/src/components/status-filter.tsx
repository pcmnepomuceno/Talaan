"use client";

import { useState } from "react";
import { Select } from "./fields";
import { STATUSES, type Status, stampLabel } from "./status-stamp";
import { FOLLOW_UP } from "@/lib/types";

export type Filter = Status | "all" | typeof FOLLOW_UP;

// DESIGN.md 6.4: one native select (the 6.2 component), label "Status", All, the nine statuses, then the "Needs follow-up" view.
// Full width on a phone, capped from 768.
export function StatusFilter({ value, onChange }: { value: Filter; onChange: (value: Filter) => void }) {
  // The select holds its own choice; the URL follows it (one router.replace per change). A URL change to a value this
  // control asked for since the URL last settled is one of our own replaces landing: ignored, unless it is the latest
  // (settled). Any other value (load, Back, a ?status= link) is outside and wins.
  const [chosen, setChosen] = useState(value);
  const [url, setUrl] = useState(value);
  const [asked, setAsked] = useState<Filter[]>([]);
  if (url !== value) {
    setUrl(value);
    if (value === asked.at(-1) || !asked.includes(value)) {
      setChosen(value);
      setAsked([]);
    }
  }
  const choose = (v: Filter) => {
    setChosen(v);
    // Back on the URL's own value: no URL change will come to settle the list, so clear it now.
    setAsked((a) => (v === url ? [] : [...a, v]));
    onChange(v);
  };
  return (
    <Select label="Status" value={chosen} onChange={(e) => choose(e.target.value as Filter)} className="md:max-w-xs">
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
