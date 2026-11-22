"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { createApplication, lookupJobUrl, updateApplication } from "../lib/api";
import {
  type Errors,
  type FieldName,
  FIELD_ORDER,
  LIMITS,
  capFor,
  cleanSalaryInput,
  isDirty,
  isLookupable,
  mapServerErrors,
  validate,
} from "../lib/application-form";
import { ApiError, errorMessage } from "../lib/http";
import {
  EMPTY_FORM,
  type FormValues,
  fromFormValues,
  type LookupMatch,
  toApplicationInput,
  toFormValues,
  toPatchBody,
} from "../lib/mappers";
import { type Application, STATUSES, WORK_MODES } from "../lib/types";
import { useLeaveGuard } from "../lib/use-leave-guard";
import { AppBar } from "./app-bar";
import { Banner } from "./banner";
import { Button } from "./button";
import { Dialog } from "./dialog";
import { Select, TextField, Textarea } from "./fields";
import { NotFoundState } from "./not-found-state";
import { SegmentedControl } from "./segmented-control";
import { stampLabel } from "./status-stamp";
import { useToast } from "./toast";

const LOOKUP_WAIT_MS = 500;

// The "already saved" check for the job posting URL. Runs only when the trimmed value differs from the
// stored one (an untouched edit never asks) and is a valid address; on blur at once, else 500 ms after
// the last keystroke. `seq` and the AbortController drop an answer that is no longer the latest ask. The
// answer is kept with the URL it was for, so typing hides the note at once and nothing is set while
// the value is unchanged. Every failure is silent, and nothing here touches errors or saving.
function useDuplicateNote(raw: string, stored: string, ownId: number | undefined) {
  const url = raw.trim();
  const enabled = url !== stored.trim() && isLookupable(url);
  const [result, setResult] = useState<{ url: string; match: LookupMatch | null } | null>(null);
  const seq = useRef(0);
  const ctl = useRef<AbortController | null>(null);
  const asked = useRef<string | null>(null);

  const ask = useCallback(
    (u: string) => {
      if (asked.current === u) return;
      asked.current = u;
      ctl.current?.abort();
      const c = new AbortController();
      ctl.current = c;
      const n = ++seq.current;
      lookupJobUrl(u, ownId ?? null, c.signal).then(
        (m) => {
          if (n === seq.current) setResult({ url: u, match: m && m.id !== ownId ? m : null });
        },
        () => {
          if (n === seq.current) asked.current = null; // silent; a later blur or keystroke may ask again
        },
      );
    },
    [ownId],
  );

  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => ask(url), LOOKUP_WAIT_MS);
    return () => clearTimeout(t);
  }, [enabled, url, ask]);
  useEffect(
    () => () => {
      seq.current++;
      ctl.current?.abort();
    },
    [],
  );

  return { match: enabled && result?.url === url ? result.match : null, onBlur: () => enabled && ask(url) };
}

// Shared create/edit form (DESIGN.md section 8, item 4). `application` present = edit.
// - noValidate, our own inline errors; the first invalid field gets focus after a failed submit.
// - Saving never clears a typed value. 422 field errors land on their fields, anything else in a Banner.
// - Edit sends only changed fields; nothing changed = no request, no toast, just back.
// - Cancel and the app-bar back arrow ask "Discard changes?" only when dirty. The browser Back
//   button and the side/bottom nav links are NOT intercepted (client-side navigation gives no hook);
//   a dirty form also registers a beforeunload prompt for reload and tab close.
// - Success: toast, then router.replace to the detail, so Back does not return to the form.
export function ApplicationForm({ application, qs }: { application?: Application; qs: string }) {
  const router = useRouter();
  const toast = useToast();
  const edit = application !== undefined;
  const [initial] = useState<FormValues>(() => (application ? toFormValues(application) : EMPTY_FORM));
  const [values, setValues] = useState<FormValues>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [banner, setBanner] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [gone, setGone] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const submitting = useRef(false);
  const jobRef = useRef<HTMLInputElement>(null);
  const companyRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLSelectElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const modeRef = useRef<HTMLFieldSetElement>(null);
  const salaryRef = useRef<HTMLInputElement>(null);
  const websiteRef = useRef<HTMLInputElement>(null);
  const jobUrlRef = useRef<HTMLInputElement>(null);
  const remarksRef = useRef<HTMLTextAreaElement>(null);

  const backHref = edit ? `/applications/${application.id}${qs}` : `/applications${qs}`;
  const dirty = isDirty(initial, values);

  useLeaveGuard(dirty && !done && !gone);
  const dup = useDuplicateNote(values.job_url, initial.job_url, application?.id);

  const set = <K extends FieldName>(key: K, value: FormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  };

  function focusFirst(errs: Errors) {
    const first = FIELD_ORDER.find((k) => errs[k]);
    if (!first) return;
    const el = {
      job_name: jobRef,
      company: companyRef,
      status: statusRef,
      date_applied: dateRef,
      mode_of_work: modeRef,
      salary: salaryRef,
      contact_website: websiteRef,
      job_url: jobUrlRef,
      remarks: remarksRef,
    }[first].current;
    if (el instanceof HTMLFieldSetElement) el.querySelector<HTMLInputElement>("input")?.focus();
    else el?.focus();
  }

  const leave = () => router.replace(backHref);
  const requestLeave = () => {
    if (busy) return;
    if (dirty) setDiscarding(true);
    else leave();
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    const errs = validate(values, { dateBad: dateRef.current?.validity.badInput ?? false });
    if (Object.values(errs).some(Boolean)) {
      setErrors(errs);
      setBanner([]);
      focusFirst(errs);
      return;
    }
    const input = fromFormValues(values);
    if (edit && Object.keys(toPatchBody(toApplicationInput(application), input)).length === 0) {
      leave();
      return;
    }
    submitting.current = true;
    setBusy(true);
    setErrors({});
    setBanner([]);
    try {
      const savedId = edit
        ? await updateApplication(application.id, toApplicationInput(application), input)
        : await createApplication(input);
      setDone(true); // stays busy: the page is about to be replaced, so no second submit is possible
      toast.success("Application saved.");
      router.replace(`/applications/${savedId}${qs}`);
      return;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404 && edit) {
        setGone(true);
      } else if (err instanceof ApiError && err.status === 422) {
        const { errors: fieldErrs, other } = mapServerErrors(err.fieldErrors);
        setErrors(fieldErrs);
        setBanner(other.length || Object.keys(fieldErrs).length ? other : ["The server rejected some details. Check the form and try again."]);
        focusFirst(fieldErrs);
      } else {
        setBanner([errorMessage(err) ?? "Couldn't save the application. Try again."]);
      }
    }
    submitting.current = false;
    setBusy(false);
  }

  const title = edit ? "Edit application" : "Add application";
  const notSavedStatus = values.status !== "saved"; // applied or later: the server fills in today
  const dateHelper = notSavedStatus ? "Leave blank to use today's date." : "Leave blank if you haven't applied.";

  if (gone) {
    return (
      <>
        <AppBar title={title} backHref={backHref} />
        <main id="content" tabIndex={-1} className="mx-auto max-w-[640px] px-4 pt-6 pb-24 outline-none md:pb-6">
          <NotFoundState qs={qs} />
        </main>
      </>
    );
  }

  return (
    <>
      <AppBar title={title} backHref={backHref} onBack={requestLeave} />
      <main id="content" tabIndex={-1} className="mx-auto max-w-[640px] px-4 pt-6 pb-24 outline-none md:pb-6">
        <h1 className="mb-6 hidden text-section-title xl:block">{title}</h1>
        <form noValidate onSubmit={submit} aria-busy={busy || undefined} className="flex flex-col gap-5">
          {banner.length > 0 && (
            <Banner title={banner[0]}>
              {banner.length > 1 && (
                <ul className="list-disc pl-5">
                  {banner.slice(1).map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              )}
            </Banner>
          )}
          <TextField
            ref={jobRef}
            label="Job title"
            required
            autoComplete="off"
            maxLength={capFor(LIMITS.name)}
            value={values.job_name}
            error={errors.job_name}
            onChange={(e) => set("job_name", e.target.value)}
          />
          <TextField
            ref={companyRef}
            label="Company"
            required
            autoComplete="off"
            maxLength={capFor(LIMITS.name)}
            value={values.company}
            error={errors.company}
            onChange={(e) => set("company", e.target.value)}
          />
          <Select
            ref={statusRef}
            label="Status"
            value={values.status}
            error={errors.status}
            onChange={(e) => set("status", e.target.value as FormValues["status"])}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {stampLabel(s)}
              </option>
            ))}
          </Select>
          <TextField
            ref={dateRef}
            label="Date applied"
            type="date"
            min="0001-01-01"
            max="9999-12-31"
            helper={dateHelper}
            value={values.date_applied}
            error={errors.date_applied}
            onChange={(e) => set("date_applied", e.target.value)}
          />
          <SegmentedControl
            fieldsetRef={modeRef}
            label="Work mode"
            required
            options={WORK_MODES}
            value={values.mode_of_work === "" ? null : values.mode_of_work}
            error={errors.mode_of_work}
            onChange={(m) => set("mode_of_work", m)}
          />
          <TextField
            ref={salaryRef}
            label="Monthly gross salary (PHP)"
            prefix="₱"
            suffix="/ month"
            inputMode="numeric"
            autoComplete="off"
            helper="Enter the amount before tax"
            value={values.salary}
            error={errors.salary}
            onChange={(e) => set("salary", cleanSalaryInput(e.target.value))}
          />
          <TextField
            ref={websiteRef}
            label="Company website"
            type="url"
            autoComplete="off"
            placeholder="https://"
            maxLength={capFor(LIMITS.website)}
            value={values.contact_website}
            error={errors.contact_website}
            onChange={(e) => set("contact_website", e.target.value)}
          />
          <div>
            <TextField
              ref={jobUrlRef}
              label="Job posting URL"
              type="url"
              autoComplete="off"
              placeholder="https://"
              helper="Paste the link to the job posting."
              maxLength={capFor(LIMITS.jobUrl)}
              value={values.job_url}
              error={errors.job_url}
              onChange={(e) => set("job_url", e.target.value)}
              onBlur={dup.onBlur}
            />
            {/* Always mounted: a status region that mounts together with its text is often not announced. */}
            <div role="status" aria-live="polite">
              {dup.match && (
                <p className="mt-2 text-caption text-text-muted">
                  You already saved this posting:{" "}
                  <Link
                    href={`/applications/${dup.match.id}${qs}`}
                    className="inline-flex min-h-11 items-center text-primary underline"
                  >
                    {dup.match.job_name}, {dup.match.company}
                  </Link>
                  .
                </p>
              )}
            </div>
          </div>
          <Textarea
            ref={remarksRef}
            label="Notes"
            rows={5}
            maxLength={capFor(LIMITS.remarks)}
            value={values.remarks}
            error={errors.remarks}
            onChange={(e) => set("remarks", e.target.value)}
          />
          <div className="flex flex-col gap-3 md:flex-row-reverse">
            <Button type="submit" className="md:min-w-48" aria-disabled={busy || undefined}>
              {/* Both labels share one grid cell, so the button never changes size while saving. */}
              <span className="inline-grid">
                <span aria-hidden={busy || undefined} className={`col-start-1 row-start-1 ${busy ? "invisible" : ""}`}>
                  Save application
                </span>
                <span aria-hidden={!busy || undefined} className={`col-start-1 row-start-1 ${busy ? "" : "invisible"}`}>
                  Saving…
                </span>
              </span>
            </Button>
            <Button variant="secondary" onClick={requestLeave} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      </main>
      <Dialog
        open={discarding}
        onClose={() => setDiscarding(false)}
        title="Discard changes?"
        description="Your changes to this application will be lost."
      >
        <div className="mt-6 flex flex-col gap-3">
          <Button variant="destructive" className="w-full" onClick={leave}>
            Discard
          </Button>
          <Button variant="secondary" className="w-full" onClick={() => setDiscarding(false)} data-autofocus>
            Keep editing
          </Button>
        </div>
      </Dialog>
    </>
  );
}
