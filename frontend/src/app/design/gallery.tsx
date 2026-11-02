"use client";

import { useState } from "react";
import { Banner } from "@/components/banner";
import { Button } from "@/components/button";
import { PasswordField, Select, Textarea, TextField } from "@/components/fields";
import { type Filter, FilterTabs } from "@/components/filter-tabs";
import { Icon, iconNames } from "@/components/icon";
import { SegmentedControl } from "@/components/segmented-control";
import { OUTCOMES, STATUSES, StatusStamp, stampLabel } from "@/components/status-stamp";

const variants = ["primary", "secondary", "ghost", "destructive"] as const;
const modes = [
  { value: "on_site", label: "On-site" },
  { value: "hybrid", label: "Hybrid" },
  { value: "remote", label: "Remote" },
] as const;
const interviewModes = [
  { value: "on_site", label: "On-site" },
  { value: "online", label: "Online" },
  { value: "async", label: "Async" },
] as const;

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h4 className="text-caption-bold text-text-secondary">{title}</h4>
      {children}
    </div>
  );
}

// Every component in its static states. Hover, pressed and focus show on interaction.
export function Gallery() {
  const [mode, setMode] = useState<(typeof modes)[number]["value"]>("hybrid");
  const [iMode, setIMode] = useState<(typeof interviewModes)[number]["value"]>("online");
  const [filter, setFilter] = useState<Filter>("all");
  return (
    <div className="flex flex-col gap-8">
      <Block title="Icons at 24px and 20px">
        <ul className="flex flex-wrap gap-4 text-text-primary">
          {iconNames.map((n) => (
            <li key={n} className="flex flex-col items-center gap-1">
              <span className="flex items-end gap-2">
                <Icon name={n} />
                <Icon name={n} size={20} />
              </span>
              <span className="text-caption text-text-muted">{n}</span>
            </li>
          ))}
        </ul>
      </Block>

      <Block title="Buttons: default, disabled">
        {variants.map((v) => (
          <div key={v} className="flex flex-wrap gap-3">
            <Button variant={v}>{v[0].toUpperCase() + v.slice(1)}</Button>
            <Button variant={v} disabled>
              Disabled
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap gap-3">
          <Button>
            <Icon name="add" />
            Add application
          </Button>
          <Button variant="ghost" href="/design">
            <Icon name="arrow_back" />
            Link button
          </Button>
          <Button variant="secondary">
            <Icon name="check" />
            Save interview
          </Button>
        </div>
      </Block>

      <Block title="Text fields">
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label="Company" required placeholder="Pinagsama Tech" />
          <TextField label="Job title" required defaultValue="Backend developer" />
          <TextField
            label="Monthly gross salary (PHP)"
            prefix="₱"
            suffix="/ month"
            inputMode="numeric"
            className="tabular-nums"
            defaultValue="85,000"
            helper="Enter the amount before tax"
          />
          <TextField label="Company website" type="url" error="Enter a full URL, such as https://example.ph" />
          <TextField label="Disabled" disabled defaultValue="Kalayaan Logistics" />
          <TextField
            label="A very long label that has to wrap onto a second line on a narrow phone screen"
            defaultValue="Mayon Software Labs, Senior Platform Engineer, Infrastructure and Reliability"
          />
          <PasswordField label="Password" autoComplete="current-password" defaultValue="Correct-h0rse" />
          <PasswordField label="Password (error)" error="Incorrect email or password." />
        </div>
      </Block>

      <Block title="Select and textarea">
        <div className="grid gap-4 md:grid-cols-2">
          <Select label="Outcome" placeholder="Choose an outcome" defaultValue="">
            {OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {stampLabel(o)}
              </option>
            ))}
          </Select>
          <Select label="Status" defaultValue="interviewing">
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {stampLabel(s)}
              </option>
            ))}
          </Select>
          <Select label="Status (error)" placeholder="Choose a status" defaultValue="" error="Choose a status">
            <option value="saved">Saved</option>
          </Select>
          <Select label="Disabled" disabled defaultValue="pending">
            <option value="pending">Pending</option>
          </Select>
          <Textarea label="Notes" helper="Optional" placeholder="Anything to remember" />
          <Textarea label="Notes (error)" error="Keep notes under 2,000 characters" defaultValue="Too long" />
          <Textarea label="Notes (disabled)" disabled defaultValue="Second round with the hiring manager." />
        </div>
      </Block>

      <Block title="Segmented control">
        <SegmentedControl label="Work mode" options={modes} value={mode} onChange={setMode} />
        <SegmentedControl label="Mode" options={interviewModes} value={iMode} onChange={setIMode} />
      </Block>

      <Block title="Status and outcome stamps">
        <div className="flex flex-wrap gap-2">
          {[...STATUSES, ...OUTCOMES].map((s) => (
            <StatusStamp key={s} value={s} />
          ))}
        </div>
      </Block>

      <Block title="Filter tabs">
        <FilterTabs value={filter} onChange={setFilter} />
      </Block>

      <Block title="Banner">
        <Banner title="Could not log in">Incorrect email or password.</Banner>
        <Banner title="Could not create the account">
          We could not create the account. Check the invite code and email, then try again.
        </Banner>
      </Block>
    </div>
  );
}
