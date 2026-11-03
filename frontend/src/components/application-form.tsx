"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { createApplication, updateApplication } from "../lib/api";
import {
  type Errors,
  type FieldName,
  FIELD_ORDER,
  LIMITS,
  capFor,
  cleanSalaryInput,
  isDirty,
  mapServerErrors,
  validate,
} from "../lib/application-form";
import { ApiError, errorMessage, isLeavingForLogin } from "../lib/http";
import {
  EMPTY_FORM,
  type FormValues,
  fromFormValues,
  toApplicationInput,
  toFormValues,
  toPatchBody,
} from "../lib/mappers";
import { type Application, STATUSES, WORK_MODES } from "../lib/types";
import { AppBar } from "./app-bar";
import { Banner } from "./banner";
import { Button } from "./button";
import { Dialog } from "./dialog";
import { Select, TextField, Textarea } from "./fields";
import { NotFoundState } from "./not-found-state";
import { SegmentedControl } from "./segmented-control";
import { stampLabel } from "./status-stamp";
import { useToast } from "./toast";

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
  const remarksRef = useRef<HTMLTextAreaElement>(null);

  const backHref = edit ? `/applications/${application.id}${qs}` : `/applications${qs}`;
  const dirty = isDirty(initial, values);

  // Reload and tab close only; registered while there is something to lose, removed on save and unmount.
  useEffect(() => {
    if (!dirty || done) return;
    const warn = (e: BeforeUnloadEvent) => {
      if (isLeavingForLogin()) return; // a 401 redirect: prompting could strand the form on "Saving…"
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, done]);

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
  const saved = values.status !== "saved";
  const dateHelper = saved ? "Leave blank to use today's date." : "Leave blank if you haven't applied.";

  if (gone) {
    return (
      <>
        <AppBar title={title} backHref="/applications" />
        <main id="content" tabIndex={-1} className="mx-auto max-w-[640px] px-4 pt-6 pb-24 outline-none md:pb-6">
          <NotFoundState />
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
