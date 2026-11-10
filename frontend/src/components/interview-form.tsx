"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { createInterview, updateInterview } from "../lib/api";
import { LIMITS, capFor, mapServerErrors } from "../lib/application-form";
import { ApiError, errorMessage } from "../lib/http";
import { type Errors, type FieldName, FIELD_ORDER, isDirty, validate } from "../lib/interview-form";
import {
  EMPTY_INTERVIEW_FORM,
  fromInterviewFormValues,
  type InterviewFormValues,
  type InterviewInput,
  MappingError,
  toInterviewFormValues,
  toInterviewInput,
  toInterviewPatchBody,
} from "../lib/mappers";
import { type Interview, INTERVIEW_MODES, OUTCOMES } from "../lib/types";
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

// Shared create/edit form for interviews (DESIGN.md 8.5). `interview` present = edit. Same patterns
// as ApplicationForm: noValidate and inline errors, first invalid field focused, typed values kept on
// a failed save, dirty guard on Cancel and the back arrow, beforeunload only while dirty, success =
// toast + router.replace to the application (Back never returns to the form).
// Time is Philippine time only (lib/pht.ts). Saving never changes the application's status.
export function InterviewForm({ applicationId, interview, qs }: { applicationId: number; interview?: Interview; qs: string }) {
  const router = useRouter();
  const toast = useToast();
  const edit = interview !== undefined;
  const [initial] = useState<InterviewFormValues>(() => (interview ? toInterviewFormValues(interview) : EMPTY_INTERVIEW_FORM));
  // The edit baseline, built once from the server record. A stored time the PHT input cannot show
  // makes the form unusable (it would save a time the user never saw), so it shows an error instead.
  const [base] = useState<InterviewInput | null | "unreadable">(() => {
    if (!interview) return null;
    try {
      return toInterviewInput(interview);
    } catch (e) {
      if (e instanceof MappingError) return "unreadable";
      throw e;
    }
  });
  const [values, setValues] = useState<InterviewFormValues>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [banner, setBanner] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [gone, setGone] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const submitting = useRef(false);
  const timeRef = useRef<HTMLInputElement>(null);
  const modeRef = useRef<HTMLFieldSetElement>(null);
  const interviewerRef = useRef<HTMLInputElement>(null);
  const outcomeRef = useRef<HTMLSelectElement>(null);
  const remarksRef = useRef<HTMLTextAreaElement>(null);

  const backHref = `/applications/${applicationId}${qs}`;
  const dirty = isDirty(initial, values);
  useLeaveGuard(dirty && !done && !gone);

  const set = <K extends FieldName>(key: K, value: InterviewFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  };

  function focusFirst(errs: Errors) {
    const first = FIELD_ORDER.find((k) => errs[k]);
    if (!first) return;
    const el = { scheduled_at: timeRef, mode: modeRef, interviewer: interviewerRef, outcome: outcomeRef, remarks: remarksRef }[first].current;
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
    const errs = validate(values, { timeBad: timeRef.current?.validity.badInput ?? false, initialTime: initial.scheduled_at });
    if (Object.values(errs).some(Boolean)) {
      setErrors(errs);
      setBanner([]);
      focusFirst(errs);
      return;
    }
    let input: InterviewInput;
    try {
      input = fromInterviewFormValues(values);
    } catch (err) {
      if (!(err instanceof MappingError)) throw err;
      setBanner(["Couldn't save the interview. Try again."]); // never a silent no-op
      return;
    }
    // Compare in the same form on both sides (+08:00 to the minute, trimmed): an untouched field is never sent.
    const before = base === "unreadable" ? null : base;
    if (before && Object.keys(toInterviewPatchBody(before, input)).length === 0) {
      leave();
      return;
    }
    submitting.current = true;
    setBusy(true);
    setErrors({});
    setBanner([]);
    try {
      if (interview && before) await updateInterview(applicationId, interview.id, before, input);
      else await createInterview(applicationId, input);
      setDone(true); // stays busy: the page is about to be replaced, so no second submit is possible
      toast.success("Interview saved.");
      router.replace(backHref);
      return;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setGone(true);
      } else if (err instanceof ApiError && err.status === 422) {
        const { errors: fieldErrs, other } = mapServerErrors<FieldName>(err.fieldErrors, FIELD_ORDER);
        setErrors(fieldErrs);
        setBanner(other.length || Object.keys(fieldErrs).length ? other : ["The server rejected some details. Check the form and try again."]);
        focusFirst(fieldErrs);
      } else {
        setBanner([errorMessage(err) ?? "Couldn't save the interview. Try again."]);
      }
    }
    submitting.current = false;
    setBusy(false);
  }

  const title = edit ? "Edit interview" : "Add interview";

  if (base === "unreadable") {
    return (
      <>
        <AppBar title={title} backHref={backHref} />
        <main id="content" tabIndex={-1} className="mx-auto max-w-[640px] px-4 pt-6 pb-24 outline-none md:pb-6">
          <Banner title="Couldn't load this interview.">
            <p>Its saved date and time can&apos;t be read.</p>
            <Button variant="secondary" href={backHref} className="mt-2">
              Back to application
            </Button>
          </Banner>
        </main>
      </>
    );
  }

  if (gone) {
    return (
      <>
        <AppBar title={title} backHref={backHref} />
        <main id="content" tabIndex={-1} className="mx-auto max-w-[640px] px-4 pt-6 pb-24 outline-none md:pb-6">
          {edit ? (
            <NotFoundState
              title="Interview not found."
              message="It may have been deleted."
              href={backHref}
              linkLabel="Back to application"
            />
          ) : (
            <NotFoundState qs={qs} />
          )}
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
            ref={timeRef}
            label="Date and time (Philippine time)"
            type="datetime-local"
            required
            min="1900-01-01T00:00"
            max="2200-12-31T23:59"
            value={values.scheduled_at}
            error={errors.scheduled_at}
            onChange={(e) => set("scheduled_at", e.target.value)}
          />
          <SegmentedControl
            fieldsetRef={modeRef}
            label="Mode"
            required
            options={INTERVIEW_MODES}
            value={values.mode === "" ? null : values.mode}
            error={errors.mode}
            onChange={(m) => set("mode", m)}
          />
          <TextField
            ref={interviewerRef}
            label="Interviewer"
            autoComplete="off"
            maxLength={capFor(LIMITS.name)}
            helper="Optional"
            value={values.interviewer}
            error={errors.interviewer}
            onChange={(e) => set("interviewer", e.target.value)}
          />
          <Select
            ref={outcomeRef}
            label="Outcome"
            value={values.outcome}
            error={errors.outcome}
            onChange={(e) => set("outcome", e.target.value as InterviewFormValues["outcome"])}
          >
            {OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {stampLabel(o)}
              </option>
            ))}
          </Select>
          <Textarea
            ref={remarksRef}
            label="Notes"
            rows={5}
            maxLength={capFor(LIMITS.remarks)}
            helper="Optional"
            value={values.remarks}
            error={errors.remarks}
            onChange={(e) => set("remarks", e.target.value)}
          />
          <div className="flex flex-col gap-3 md:flex-row-reverse">
            <Button type="submit" className="md:min-w-48" aria-disabled={busy || undefined}>
              {/* Both labels share one grid cell, so the button never changes size while saving. */}
              <span className="inline-grid">
                <span aria-hidden={busy || undefined} className={`col-start-1 row-start-1 ${busy ? "invisible" : ""}`}>
                  Save interview
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
        description="Your changes to this interview will be lost."
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
