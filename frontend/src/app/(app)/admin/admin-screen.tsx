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
import { type CreatedInvite, type Invite, createInvite, createPasswordReset, listInvites, revokeInvite } from "@/lib/admin";
import { formatDate, formatDateTimePHT } from "@/lib/format";
import { ApiError, errorMessage } from "@/lib/http";

const NOTE_MAX = 200;
const NOTE_TYPING_CAP = 400;
const DAYS = [7, 14, 30] as const;
const DEFAULT_DAYS = "14";
const ANNOUNCEMENT = "Code created. It is shown once, below the form.";
const COPY_FAILED = "Couldn't copy the code. Select it and copy it yourself.";
const wrap = "[overflow-wrap:anywhere]";
const LINK_ANNOUNCEMENT = "Reset link created. It is shown once, below the form.";
const LINK_COPY_FAILED = "Couldn't copy the link. Select it and copy it yourself.";

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
  // After a revoke the row (and its button) may vanish on refresh, so focus lands on the heading once the list settles.
  const invitesHeading = useRef<HTMLHeadingElement>(null);
  const focusAfterLoad = useRef(false);
  const [headingReq, setHeadingReq] = useState(0);

  // A 401 redirects inside `request` and never settles. A 404 means the caller is not an admin.
  const settled = () => {
    if (!focusAfterLoad.current) return;
    focusAfterLoad.current = false;
    setHeadingReq((n) => n + 1);
  };
  useEffect(() => {
    let live = true;
    listInvites().then(
      (items) => {
        if (!live) return;
        setInvites(items);
        setLoadFailed(false);
        settled();
      },
      (err) => {
        if (!live) return;
        if (err instanceof ApiError && err.status === 404) setGone(true);
        else {
          setLoadFailed(true);
          settled();
        }
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
    if (headingReq) invitesHeading.current?.focus();
  }, [headingReq]);
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
      if (err instanceof ApiError && err.status === 404) {
        // The admin gate's 404: no longer an admin. Same as the list and revoke.
        setGone(true);
        return;
      }
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
      if (status === 404 && err instanceof ApiError && err.detail !== "Invite not found.") {
        // The admin gate's plain "Not Found": no longer an admin. Same as the list.
        revokeSending.current = false;
        setGone(true);
        return;
      } else if (status === 404) {
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
    focusAfterLoad.current = true;
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

        <ResetPassword onGone={() => setGone(true)} />

        <section aria-labelledby="invites" className="mt-8 flex flex-col gap-4">
          <h2 ref={invitesHeading} id="invites" tabIndex={-1} className="text-section-title text-text-primary outline-none">
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

type ResetField = "email" | "password";

function ResetPassword({ onGone }: { onGone: () => void }) {
  const toast = useToast();
  // The link holds the token: component state only, like the invite code.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Partial<Record<ResetField, string>>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [made, setMade] = useState<{ link: string; expires_at: string } | null>(null);
  const [focusReq, setFocusReq] = useState<{ n: number; field: ResetField } | null>(null);
  const submitting = useRef(false);
  const emailInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const copyButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (focusReq) (focusReq.field === "email" ? emailInput : passwordInput).current?.focus();
  }, [focusReq]);
  useEffect(() => {
    if (made) copyButton.current?.focus();
  }, [made]);

  function fail(next: Partial<Record<ResetField, string>>, message: string | null = null) {
    setErrors(next);
    setBanner(message);
    setFocusReq((r) => ({ n: (r?.n ?? 0) + 1, field: next.email ? "email" : "password" }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    const address = email.trim();
    const missing: Partial<Record<ResetField, string>> = {};
    if (!address) missing.email = "Enter their email.";
    if (!password) missing.password = "Enter your password.";
    if (missing.email || missing.password) return fail(missing);

    submitting.current = true;
    setPending(true);
    setMade(null);
    setErrors({});
    setBanner(null);
    try {
      const { token, expires_at } = await createPasswordReset({ email: address, admin_password: password });
      setMade({ link: `${window.location.origin}/reset#${token}`, expires_at });
      setEmail("");
      setPassword("");
    } catch (err) {
      const e2 = err instanceof ApiError ? err : null;
      // The admin gate's plain "Not Found": no longer an admin. Another 404 is the unknown email.
      if (e2?.status === 404 && e2.detail === "Not Found") return onGone();
      setPassword("");
      if (e2?.status === 404 || e2?.status === 400) return fail({ email: e2.detail });
      if (e2?.status === 403 && e2.detail === "Incorrect password.") return fail({ password: e2.detail });
      const fields = e2?.status === 422 ? e2.fieldErrors : {};
      if (fields.email || fields.admin_password) return fail({ email: fields.email, password: fields.admin_password });
      fail({}, errorMessage(err) ?? "Something went wrong. Try again.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  async function onCopy() {
    if (!made) return;
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(made.link);
      toast.success("Link copied.");
    } catch {
      toast.error(LINK_COPY_FAILED);
    }
  }

  return (
    <section aria-labelledby="reset" className="mt-8 flex flex-col gap-4">
      <h2 id="reset" className="text-section-title text-text-primary">
        Reset a password
      </h2>
      <p aria-live="polite" className="sr-only">
        {made ? LINK_ANNOUNCEMENT : ""}
      </p>
      <form noValidate onSubmit={onSubmit} aria-busy={pending || undefined} className="flex flex-col gap-5">
        {banner && <Banner title={banner} />}
        <TextField
          ref={emailInput}
          label="Email"
          name="email"
          type="email"
          autoComplete="off"
          required
          value={email}
          error={errors.email}
          onChange={(e) => {
            setEmail(e.target.value);
            setErrors((x) => ({ ...x, email: undefined }));
          }}
        />
        <PasswordField
          ref={passwordInput}
          label="Your password"
          name="admin_password"
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
          {pending ? "Creating…" : "Create reset link"}
        </Button>
      </form>
      {made && (
        <>
          <h3 className="text-body-medium text-text-primary">Reset link, shown once</h3>
          <LedgerSheet>
            <li className="flex flex-col items-start gap-3 p-4">
              <p className={`max-w-full select-all text-body-medium text-text-primary ${wrap}`}>{made.link}</p>
              <p className="text-caption tabular-nums text-text-muted">
                {`Expires ${formatDateTimePHT(made.expires_at) ?? "date unavailable"}`}
              </p>
              <Button ref={copyButton} variant="secondary" onClick={onCopy}>
                Copy link
              </Button>
            </li>
          </LedgerSheet>
        </>
      )}
    </section>
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
