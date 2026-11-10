"use client";

import { useState } from "react";
import { buildIcs, icsFileName } from "../lib/ics";
import { formatDateTimePHT } from "../lib/format";
import type { AgendaInterview } from "../lib/types";
import { Button, TextAction } from "./button";
import { Dialog } from "./dialog";
import { useToast } from "./toast";

// DESIGN.md 6.6. Builds the .ics in the browser (lib/ics.ts: no request) and saves it through a Blob
// and an anchor with the download attribute. The object URL is revoked after a short delay: some
// browsers (Safari) start reading it after click() returns. Pressing twice downloads twice; both
// files carry the same UID, so a calendar treats them as one event. Nothing is offered when the date
// cannot be read.
const REVOKE_MS = 1000;

export function AddToCalendar({ interview, disabled = false }: { interview: AgendaInterview; disabled?: boolean }) {
  const toast = useToast();
  const when = formatDateTimePHT(interview.scheduled_at);
  if (!when) return null;

  function download() {
    const text = buildIcs(interview, { now: new Date(), origin: window.location.origin });
    if (text === null) return;
    const url = URL.createObjectURL(new Blob([text], { type: "text/calendar;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = icsFileName(interview);
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_MS);
    toast.success("Calendar file downloaded.");
  }

  return (
    <TextAction onClick={download} disabled={disabled} aria-label={`Add to calendar, ${interview.company}, ${when}`}>
      Add to calendar
    </TextAction>
  );
}

const steps = "mt-2 list-decimal space-y-1 pl-6 text-body text-text-primary";
const h = "mt-6 text-body-medium text-text-primary";

// DESIGN.md 6.8c. The standard dialog (sheet under 768, centered from 768, scrolls inside, focus
// trapped, Escape closes, focus returns to the trigger). Steps were checked against the vendors' help
// pages (Google Calendar, Apple Calendar on Mac, Outlook on the web, classic Outlook) and reworded.
export function CalendarGuide() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TextAction onClick={() => setOpen(true)}>How to add this to your calendar</TextAction>
      <Dialog open={open} onClose={() => setOpen(false)} title="How to add this to your calendar" focusTitle>
        <p className="mt-3 text-body text-text-primary">
          The file is a one-time copy of the interview. If an interview changes in Talaan, download a new file and delete the old event in your
          calendar first.
        </p>

        <h3 className={h}>Google Calendar</h3>
        <ol className={steps}>
          <li>Select Add to calendar to download the file.</li>
          <li>On a computer, open calendar.google.com. The phone app cannot import files.</li>
          <li>Select the settings gear, then Settings.</li>
          <li>In the left menu, select Import &amp; Export.</li>
          <li>Select Select file from your computer, then choose the downloaded .ics file.</li>
          <li>Choose which calendar receives the event (your main calendar is the default), then select Import.</li>
        </ol>
        <p className="mt-2 text-caption text-text-muted">Once imported, the event syncs to the Google Calendar app on your phone.</p>

        <h3 className={h}>Apple Calendar on a Mac</h3>
        <ol className={steps}>
          <li>Open the Calendar app.</li>
          <li>Drag the downloaded file into the Calendar window, or choose File, then Import, and select the file.</li>
          <li>Choose the calendar that should receive the event, then select OK.</li>
        </ol>

        <h3 className={h}>Outlook on the web</h3>
        <ol className={steps}>
          <li>Open Calendar and select Add calendar.</li>
          <li>Select Upload from file, then Browse, and choose the downloaded file.</li>
          <li>Choose the calendar that should receive the event, then select Import.</li>
        </ol>

        <h3 className={h}>Outlook for Windows (classic)</h3>
        <ol className={steps}>
          <li>Select File, then Open &amp; Export, then Import/Export.</li>
          <li>Choose Import an iCalendar (.ics) or vCalendar file (.vcs), then select Next.</li>
          <li>Select Browse, choose the downloaded file, then select OK.</li>
          <li>Select Open as New.</li>
        </ol>

        <div className="mt-8">
          <Button variant="secondary" className="w-full" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
      </Dialog>
    </>
  );
}
