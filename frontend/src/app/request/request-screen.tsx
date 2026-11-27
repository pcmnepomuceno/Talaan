"use client";

import { useEffect, useRef, useState } from "react";
import { Banner } from "@/components/banner";
import { Button, TextAction } from "@/components/button";
import { Textarea, TextField } from "@/components/fields";
import { LedgerSheet } from "@/components/ledger";
import { Wordmark } from "@/components/logo";
import { SkipLink } from "@/components/skip-link";
import { useToast } from "@/components/toast";
import { WakingUp } from "@/components/waking-up";
import { ApiError, errorMessage } from "@/lib/http";
import { createInviteRequest, inviteRequestStatus, type RequestState } from "@/lib/invite-requests";

const CONTACT_MAX = 200;
const NOTE_MAX = 1000;
const wrap = "[overflow-wrap:anywhere]";
const FALLBACK = "Something went wrong. Try again.";

export function RequestScreen() {
  // null: the fragment is not read yet. "": there was none (the form). The token lives only here.
  const [token, setToken] = useState<string | null>(null);

  // Read the token, then strip it so it stays out of the address bar and history. Only a non-empty
  // fragment counts: StrictMode runs this twice, and the second run sees the stripped URL.
  useEffect(() => {
    const read = () => {
      const hash = window.location.hash.slice(1);
      // "content" is the Skip to content link on this page, not a token.
      if (!hash || hash === "content") return setToken((t) => t ?? "");
      setToken(hash);
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    };
    read();
    // A saved link pasted into this tab only changes the fragment: no reload.
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  return (
    <>
      <SkipLink />
      <header className="bg-bar-bg pt-[env(safe-area-inset-top)] text-bar-text">
        <div className="mx-auto max-w-[440px] px-4 py-6">
          <Wordmark variant="on-ink" size={40} />
        </div>
      </header>
      <main id="content" tabIndex={-1} className="mx-auto flex max-w-[440px] flex-col gap-5 px-4 pt-6 pb-12 outline-none">
        <h1 className="text-page-title text-text-primary">Request an invite</h1>
        {token === "" && <RequestForm />}
        {/* key: a second link in the same tab starts a fresh check. */}
        {token && <StatusView key={token} token={token} onNewRequest={() => setToken("")} />}
        <p className="flex flex-wrap justify-center gap-4">
          <TextAction href="/login">Back to log in</TextAction>
          <TextAction href="/privacy">Privacy</TextAction>
        </p>
      </main>
    </>
  );
}

// A secret to keep: the status link, or the invite code. Selectable, with a Copy button.
function CopyBlock({ value, label, done, failed }: { value: string; label: string; done: string; failed: string }) {
  const toast = useToast();
  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(value);
      toast.success(done);
    } catch {
      toast.error(failed);
    }
  }
  return (
    <LedgerSheet>
      <li className="flex flex-col items-start gap-3 p-4">
        <p className={`max-w-full select-all text-body-medium tabular-nums text-text-primary ${wrap}`}>{value}</p>
        <Button variant="secondary" onClick={copy}>
          {label}
        </Button>
      </li>
    </LedgerSheet>
  );
}

type Errors = { contact?: string; note?: string };

function RequestForm() {
  const [contact, setContact] = useState("");
  const [note, setNote] = useState("");
  const [website, setWebsite] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const submitting = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (attempt) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [attempt]);
  useEffect(() => {
    if (link) heading.current?.focus();
  }, [link]);

  function fail(next: Errors, message: string | null = null) {
    setErrors(next);
    setBanner(message);
    setAttempt((n) => n + 1);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    const who = contact.trim();
    const why = note.trim();
    const bad: Errors = {};
    // Code points, like the API: maxLength would count an emoji twice.
    if (!who) bad.contact = "Enter how to reach you.";
    else if ([...who].length > CONTACT_MAX) bad.contact = "Contact must be 200 characters or fewer.";
    if (!why) bad.note = "Tell us why you want access.";
    else if ([...why].length > NOTE_MAX) bad.note = "Keep it to 1000 characters or fewer.";
    if (bad.contact || bad.note) return fail(bad);

    submitting.current = true;
    setBusy(true);
    setErrors({});
    setBanner(null);
    try {
      const { token } = await createInviteRequest({ contact: who, note: why, website });
      setLink(`${window.location.origin}/request#${token}`);
    } catch (err) {
      submitting.current = false;
      const api = err instanceof ApiError ? err : null;
      if (api?.status === 409) return fail({}, api.detail);
      const fields = api?.status === 422 ? api.fieldErrors : {};
      if (fields.contact || fields.note) return fail({ contact: fields.contact, note: fields.note });
      fail({}, errorMessage(err) ?? FALLBACK);
    } finally {
      setBusy(false);
    }
  }

  if (link)
    return (
      <>
        <h2 ref={heading} tabIndex={-1} className="text-section-title text-text-primary outline-none">
          Save this link
        </h2>
        <p className="text-body text-text-secondary">
          It is the only way to see the answer, because Talaan sends no email. Anyone who has this link can see your
          invite code, so keep it private.
        </p>
        <CopyBlock value={link} label="Copy link" done="Link copied." failed="Couldn't copy the link. Select it and copy it yourself." />
      </>
    );

  return (
    <form ref={form} noValidate aria-busy={busy || undefined} onSubmit={onSubmit} className="flex flex-col gap-5">
      {banner && <Banner title={banner} />}
      <TextField
        label="Contact"
        name="contact"
        required
        autoComplete="off"
        helper="An email, phone number or handle where you can be reached"
        value={contact}
        error={errors.contact}
        onChange={(e) => setContact(e.target.value)}
      />
      <Textarea
        label="Why you want access"
        name="note"
        required
        value={note}
        error={errors.note}
        onChange={(e) => setNote(e.target.value)}
      />
      {/* Honeypot: off screen, hidden from assistive tech and the tab order. Only a bot fills it. */}
      <div aria-hidden="true" className="absolute top-0 -left-[9999px]">
        <input name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Sending…" : "Send request"}
      </Button>
      <WakingUp pending={busy} />
    </form>
  );
}

type View = { result?: RequestState; invalid?: boolean; error?: string };

function StatusView({ token, onNewRequest }: { token: string; onNewRequest: () => void }) {
  const [view, setView] = useState<View>({});
  const [busy, setBusy] = useState(false);
  const checking = useRef(false);
  const started = useRef(false);

  // No "live" flag: the code is returned once, so the answer to the one call must never be dropped.
  async function check() {
    if (checking.current) return;
    checking.current = true;
    setBusy(true);
    try {
      setView({ result: await inviteRequestStatus(token) });
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) setView({ invalid: true });
      else setView({ error: errorMessage(err) ?? FALLBACK });
    } finally {
      checking.current = false;
      setBusy(false);
    }
  }

  // Once per token (the parent keys this by token): StrictMode runs effects twice, and a second
  // call would answer "shown" over the code.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const state = view.result?.state;
  const again = (
    <Button variant="secondary" onClick={check} disabled={busy}>
      {busy ? "Checking…" : "Check again"}
    </Button>
  );
  const newRequest = <TextAction onClick={onNewRequest}>Request an invite</TextAction>;
  // The one live region: it holds the message only, never the code.
  const message = view.error || view.invalid
    ? ""
    : state === undefined
      ? "Checking your request…"
      : {
          pending: "Still waiting.",
          rejected: "Not approved right now.",
          approved: "Shown once. Copy it now, then create your account.",
          shown: "The code was already shown.",
          expired: "This code has expired. Request a new one.",
        }[state];

  return (
    <div className="flex flex-col items-start gap-4">
      <p role="status" className="text-body text-text-primary">
        {message}
      </p>
      {!view.result && !view.invalid && !view.error && <WakingUp pending />}
      {view.error && (
        <>
          <Banner title={view.error} />
          {again}
        </>
      )}
      {view.invalid && (
        <>
          <Banner title="Invalid or expired request link." />
          {newRequest}
        </>
      )}
      {state === "pending" && again}
      {state === "approved" && view.result?.code && (
        <>
          <div className="w-full">
            <CopyBlock value={view.result.code} label="Copy code" done="Code copied." failed="Couldn't copy the code. Select it and copy it yourself." />
          </div>
          <TextAction href="/login">Create your account</TextAction>
        </>
      )}
      {state === "shown" && (
        <p className="text-body text-text-primary">If you didn&apos;t save it, ask the person who runs Talaan for a new code.</p>
      )}
      {state === "expired" && newRequest}
    </div>
  );
}
