"use client";

import { useState } from "react";
import { Banner } from "@/components/banner";
import { DeleteConfirm } from "@/components/dialog";
import { EmptyState } from "@/components/empty-state";
import { ApplicationRow, DetailRows, InterviewRow, LedgerSheet, LedgerSkeleton } from "@/components/ledger";
import { useToast } from "@/components/toast";
import { sortInterviewsByDate } from "@/lib/interviews";
import { type Application, INTERVIEW_MODES, type Interview, WORK_MODES } from "@/lib/types";
import { Button } from "@/components/button";
import { PasswordField, Select, Textarea, TextField } from "@/components/fields";
import { type Filter, FilterTabs } from "@/components/filter-tabs";
import { Icon, iconNames } from "@/components/icon";
import { SegmentedControl } from "@/components/segmented-control";
import { OUTCOMES, STATUSES, StatusStamp, stampLabel } from "@/components/status-stamp";

const variants = ["primary", "secondary", "ghost", "destructive"] as const;
const modes = WORK_MODES;
const interviewModes = INTERVIEW_MODES;

const base = {
  contact_email: null,
  remarks: null,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
} as const;
// Fictional data (DESIGN.md section 9), same five rows as light-list.png.
const apps: Application[] = [
  { ...base, id: 1, company: "Pinagsama Tech", job_name: "Senior Frontend Engineer", status: "interviewing", mode_of_work: "hybrid", salary: 85000, date_applied: "2026-10-14", contact_website: "https://pinagsamatech.example.ph", remarks: "Referral from a former teammate. Technical round next week." },
  { ...base, id: 2, company: "Bayanihan Digital", job_name: "Product Designer", status: "offered", mode_of_work: "remote", salary: 95000, date_applied: "2026-09-28", contact_website: null },
  { ...base, id: 3, company: "Mayon Software Labs", job_name: "Full Stack Developer", status: "applied", mode_of_work: "on_site", salary: 65000, date_applied: "2026-10-19", contact_website: null },
  { ...base, id: 4, company: "Kape Digital", job_name: "Backend Engineer", status: "screening", mode_of_work: "hybrid", salary: 78000, date_applied: "2026-10-12", contact_website: null },
  { ...base, id: 5, company: "Kalayaan Logistics", job_name: "UI/UX Researcher", status: "saved", mode_of_work: "remote", salary: 50000, date_applied: null, contact_website: null },
];
const edgeApps: Application[] = [
  { ...base, id: 6, company: "Haraya Solutions Philippines Incorporated Regional Operations", job_name: "Principal Infrastructure and Reliability Engineering Lead (Platform)", status: "withdrawn", mode_of_work: "on_site", salary: null, date_applied: "2026-10-02", contact_website: null },
];
const interviews: Interview[] = [
  { id: 2, job_application_id: 1, interviewer: "Mark Rivera", scheduled_at: "2026-10-24T06:00:00Z", mode: "online", outcome: "pending", remarks: null, created_at: "", updated_at: "" },
  { id: 1, job_application_id: 1, interviewer: "Ana Santos", scheduled_at: "2026-10-18T02:00:00Z", mode: "online", outcome: "good", remarks: "Background check and portfolio walkthrough.", created_at: "", updated_at: "" },
  { id: 3, job_application_id: 1, interviewer: null, scheduled_at: "2026-10-26T01:30:00+00:00", mode: "async", outcome: "bad", remarks: null, created_at: "", updated_at: "" },
];

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
  const [selected, setSelected] = useState(1);
  const [deleting, setDeleting] = useState(false);
  const toast = useToast();
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

      <Block title="Ledger sheet (select a row)">
        <LedgerSheet label="Applications">
          {apps.map((a) => (
            <ApplicationRow key={a.id} application={a} selected={a.id === selected} onSelect={() => setSelected(a.id)} />
          ))}
        </LedgerSheet>
        <LedgerSheet label="Long text, no salary">
          {edgeApps.map((a) => (
            <ApplicationRow key={a.id} application={a} href="/design" />
          ))}
        </LedgerSheet>
      </Block>

      <Block title="Detail rows">
        <DetailRows application={apps[0]} />
        <DetailRows application={{ ...apps[4], salary: null }} />
      </Block>

      <Block title="Interview rows (sorted by date)">
        <LedgerSheet label="Interviews">
          {sortInterviewsByDate(interviews).map((i) => (
            <InterviewRow key={i.id} interview={i} />
          ))}
        </LedgerSheet>
      </Block>

      <Block title="Delete dialog and toasts">
        <div className="flex flex-wrap gap-3">
          <Button variant="destructive" onClick={() => setDeleting(true)}>
            Delete application
          </Button>
          <Button variant="secondary" onClick={() => toast.success("Application saved")}>
            Show success toast
          </Button>
          <Button variant="secondary" onClick={() => toast.error("Could not save the application")}>
            Show error toast
          </Button>
        </div>
        <DeleteConfirm
          open={deleting}
          onCancel={() => setDeleting(false)}
          onConfirm={() => {
            setDeleting(false);
            toast.success("Application deleted");
          }}
          title="Delete this application?"
          message="Pinagsama Tech, Senior Frontend Engineer, and its interviews will be removed. This cannot be undone."
          confirmLabel="Delete application"
        />
      </Block>

      <Block title="Empty state">
        <EmptyState
          title="No applications yet"
          message="Add the first job you applied to."
          action={
            <Button>
              <Icon name="add" />
              Add application
            </Button>
          }
        />
      </Block>

      <Block title="Loading skeleton">
        <LedgerSkeleton />
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
