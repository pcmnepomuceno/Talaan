"use client";

import { notFound } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AppBar } from "@/components/app-bar";
import { Banner } from "@/components/banner";
import { Button, TextAction } from "@/components/button";
import { DeleteConfirm } from "@/components/dialog";
import { EmptyState } from "@/components/empty-state";
import { PasswordField, Select, TextField } from "@/components/fields";
import { LedgerSheet, LedgerSkeleton } from "@/components/ledger";
import { LoadError } from "@/components/load-error";
import { StatusStamp } from "@/components/status-stamp";
import { useToast } from "@/components/toast";
import { WakingUp } from "@/components/waking-up";
import { type CreatedInvite, type Invite, createInvite, listInvites, revokeInvite } from "@/lib/admin";
import { formatDate } from "@/lib/format";
import { ApiError, errorMessage } from "@/lib/http";

const NOTE_MAX = 200;
const NOTE_TYPING_CAP = 400;
const DAYS = [7, 14, 30] as const;
const DEFAULT_DAYS = "14";
const ANNOUNCEMENT = "Code created. It is shown once, below the form.";
const COPY_FAILED = "Couldn't copy the code. Select it and copy it yourself.";
const wrap = "[overflow-wrap:anywhere]";

type Field = "note" | "expires" | "password";
const inviteName = (i: Invite) => (i.note ? i.note : `invite ${i.id}`);

export function AdminScreen() {
  const toast = useToast();
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [gone, setGone] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // Form state. The password and the code live only here: never in a cache, storage or the URL.
  const [note, setNote] = useState("");
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const [focusReq, setFocusReq] = useState<{ n: number; field: Field } | null>(null);
  const submitting = useRef(false);
  const noteInput = useRef<HTMLInputElement>(null);
  const daysInput = useRef<HTMLSelectElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const copyButton = useRef<HTMLButtonElement>(null);

  const [revoking, setRevoking] = useState<Invite | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const revokeSending = useRef(false);

  // A 401 redirects inside `request` and never settles. A 404 means the caller is not an admin.
  useEffect(() => {
    let live = true;
    listInvites().then(
      (items) => {
        if (!live) return;
        setInvites(items);
        setLoadFailed(false);
      },
      (err) => {
        if (!live) return;
        if (err instanceof ApiError && err.status === 404) setGone(true);
        else setLoadFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [attempt]);
  const refresh = () => setAttempt((n) => n + 1);
  const retry = () => {
    setLoadFailed(false);
    refresh();
  };

  // Focus after the commit that re-enables things, not on a timer.
  useEffect(() => {
    if (!focusReq) return;
    const target = { note: noteInput, expires: daysInput, password: passwordInput }[focusReq.field];
    target.current?.focus();
  }, [focusReq]);
  useEffect(() => {
    if (created) copyButton.current?.focus();
  }, [created]);

  // Thrown during render so Next shows the root "Page not found." view (an effect or a callback
  // would throw where no boundary catches it).
  if (gone) notFound();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    const trimmed = note.trim();
    const next: Partial<Record<Field, string>> = {};
    if ([...trimmed].length > NOTE_MAX) next.note = "Note must be 200 characters or fewer.";
    if (password === "") next.password = "Enter your password.";
    setBanner(null);
    setErrors(next);
    if (next.note || next.password) {
      setFocusReq((r) => ({ n: (r?.n ?? 0) + 1, field: next.note ? "note" : "password" }));
      return;
    }
    submitting.current = true;
    setPending(true);
    setCreated(null);
    try {
      const made = await createInvite({
        note: trimmed === "" ? null : trimmed,
        expires_in_days: Number(days) as 7 | 14 | 30,
        password,
      });
      setCreated(made);
      setNote("");
      setDays(DEFAULT_DAYS);
      setPassword("");
      refresh();
    } catch (err) {
      const fields = err instanceof ApiError && err.status === 422 ? err.fieldErrors : {};
      const failed: Partial<Record<Field, string>> = {};
      if (fields.note) failed.note = fields.note;
      if (fields.expires_in_days) failed.expires = fields.expires_in_days;
      if (fields.password) failed.password = fields.password;
      if (err instanceof ApiError && err.status === 403 && err.detail === "Incorrect password.") {
        failed.password = "Incorrect password.";
      } else if (Object.keys(failed).length === 0) {
        setBanner(err instanceof ApiError && err.status === 409 ? err.detail : (errorMessage(err) ?? "Something went wrong. Try again."));
      }
      setErrors(failed);
      setPassword("");
      setFocusReq((r) => ({ n: (r?.n ?? 0) + 1, field: failed.note ? "note" : failed.expires ? "expires" : "password" }));
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  async function onCopy() {
    if (!created) return;
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(created.code);
      toast.success("Code copied.");
    } catch {
      toast.error(COPY_FAILED);
    }
  }

  async function onRevoke() {
    if (!revoking || revokeSending.current) return;
    revokeSending.current = true;
    setRevokeBusy(true);
    try {
      await revokeInvite(revoking.id);
      toast.success("Invite revoked.");
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 404) {
        toast.success("Invite revoked."); // already gone
      } else if (status === 409) {
        toast.error("This invite was used, so it cannot be revoked.");
      } else {
        toast.error(errorMessage(err) ?? "Couldn't revoke the invite. Try again.");
        revokeSending.current = false;
        setRevokeBusy(false);
        return; // the dialog stays open
      }
    }
    revokeSending.current = false;
    setRevokeBusy(false);
    setRevoking(null);
    refresh();
  }

  // First load: nothing that gives the feature away (no title, no form) until the API says admin.
  if (invites === null) {
    return (
      <>
        <AppBar />
        <main id="content" tabIndex={-1} className="max-w-2xl px-4 pt-6 pb-24 outline-none md:pb-8 xl:pt-8">
          {loadFailed ? (
            <LoadError title="Couldn't load this page." onRetry={retry} />
          ) : (
            <>
              <LedgerSkeleton rows={3} label="Loading" />
              <WakingUp pending />
            </>
          )}
        </main>
      </>
    );
  }

  return (
    <>
      <AppBar title="Admin" backHref="/account" />
      <main id="content" tabIndex={-1} className="max-w-2xl px-4 pt-6 pb-24 outline-none md:pb-8 xl:pt-8">
        <h1 className="mb-6 hidden text-section-title text-text-primary xl:block">Admin</h1>
        <p aria-live="polite" className="sr-only">
          {created ? ANNOUNCEMENT : ""}
        </p>

        <section aria-labelledby="create" className="flex flex-col gap-4">
          <h2 id="create" className="text-section-title text-text-primary">
            Create invite
          </h2>
          <form noValidate onSubmit={onSubmit} aria-busy={pending || undefined} className="flex flex-col gap-5">
            {banner && <Banner title={banner} />}
            <TextField
              ref={noteInput}
              label="Note"
              name="note"
              autoComplete="off"
              maxLength={NOTE_TYPING_CAP}
              value={note}
              error={errors.note}
              onChange={(e) => {
                setNote(e.target.value);
                setErrors((x) => ({ ...x, note: undefined }));
              }}
            />
            <Select
              ref={daysInput}
              label="Expires in"
              name="expires_in_days"
              value={days}
              error={errors.expires}
              onChange={(e) => {
                setDays(e.target.value);
                setErrors((x) => ({ ...x, expires: undefined }));
              }}
            >
              {DAYS.map((d) => (
                <option key={d} value={String(d)}>
                  {d} days
                </option>
              ))}
            </Select>
            <PasswordField
              ref={passwordInput}
              label="Your password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              error={errors.password}
              onChange={(e) => {
                setPassword(e.target.value);
                setErrors((x) => ({ ...x, password: undefined }));
              }}
            />
            <Button type="submit" disabled={pending} className="w-full sm:w-auto sm:self-start">
              {pending ? "Creating…" : "Create code"}
            </Button>
          </form>
        </section>

        {created && (
          <section aria-labelledby="new-code" className="mt-8 flex flex-col gap-4">
            <h2 id="new-code" className="text-section-title text-text-primary">
              New code, shown once
            </h2>
            <LedgerSheet>
              <li className="flex flex-col items-start gap-3 p-4">
                <p className="max-w-full select-all text-row-title whitespace-nowrap tabular-nums text-text-primary">{created.code}</p>
                <p className="text-caption text-text-muted">This code cannot be shown again.</p>
                <Button ref={copyButton} variant="secondary" onClick={onCopy}>
                  Copy code
                </Button>
              </li>
            </LedgerSheet>
          </section>
        )}

        <section aria-labelledby="invites" className="mt-8 flex flex-col gap-4">
          <h2 id="invites" className="text-section-title text-text-primary">
            Invites
          </h2>
          {loadFailed && <LoadError title="Couldn't refresh the invites. Showing the last loaded list." onRetry={retry} />}
          {invites.length === 0 ? (
            <EmptyState title="No invites yet." message="Codes you create show here." />
          ) : (
            <LedgerSheet>
              {invites.map((i) => (
                <InviteRow key={i.id} invite={i} onRevoke={() => setRevoking(i)} />
              ))}
            </LedgerSheet>
          )}
        </section>
      </main>
      <DeleteConfirm
        open={revoking !== null}
        onCancel={() => setRevoking(null)}
        onConfirm={onRevoke}
        title="Revoke this invite?"
        message={`The code for ${revoking ? inviteName(revoking) : ""} will stop working. This cannot be undone.`}
        confirmLabel="Revoke invite"
        busy={revokeBusy}
      />
    </>
  );
}

function InviteRow({ invite: i, onRevoke }: { invite: Invite; onRevoke: () => void }) {
  const created = formatDate(i.created_at) ?? "date unavailable";
  const expires = formatDate(i.expires_at) ?? "date unavailable";
  const usedOn = i.used_at ? (formatDate(i.used_at) ?? "date unavailable") : null;
  return (
    <li className="flex flex-col gap-1 p-4">
      <div className="flex items-start justify-between gap-3">
        {/* Plain text child: React escapes it; pre-line keeps typed line breaks, anywhere wraps long runs. */}
        <p className={`min-w-0 whitespace-pre-line text-row-title ${wrap} ${i.note ? "text-text-primary" : "text-text-muted"}`}>
          {i.note ?? "No note"}
        </p>
        <StatusStamp value={i.status} />
      </div>
      <p className="text-caption tabular-nums text-text-muted">
        {`Created ${created} · ${i.status === "expired" ? "Expired" : "Expires"} ${expires}`}
      </p>
      {usedOn && (
        <p className={`text-caption tabular-nums text-text-muted ${wrap}`}>
          {`Used on ${usedOn} by ${i.used_by_account_name ?? "(deleted)"}`}
        </p>
      )}
      {i.status === "unused" && (
        <div className="-mx-2 -mb-2 flex">
          <TextAction onClick={onRevoke} tone="danger" aria-label={i.note ? `Revoke invite, ${i.note}` : `Revoke invite ${i.id}`}>
            Revoke
          </TextAction>
        </div>
      )}
    </li>
  );
}
