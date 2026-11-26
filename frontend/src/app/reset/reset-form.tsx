"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Banner } from "@/components/banner";
import { Button, TextAction } from "@/components/button";
import { PasswordField } from "@/components/fields";
import { Wordmark } from "@/components/logo";
import { SkipLink } from "@/components/skip-link";
import { resetPassword } from "@/lib/auth";
import { ApiError, errorMessage } from "@/lib/http";

const DEAD = "This reset link is invalid or has expired. Ask for a new one.";
// No fragment at all (a reload after it was stripped, or a bare /reset): the link may still work.
const OPEN_AGAIN = "Open your reset link again to set a new password. If it no longer works, ask for a new one.";
type Errors = { password?: string; confirm?: string };

export function ResetForm() {
  const router = useRouter();
  // null: the fragment is not read yet. "": there was none. The token lives only here.
  const [token, setToken] = useState<string | null>(null);
  const [rejected, setRejected] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const submitting = useRef(false);
  const form = useRef<HTMLFormElement>(null);

  // Read the token, then strip it so it stays out of the address bar and history. Only a non-empty
  // fragment counts: StrictMode runs this twice, and the second run sees the stripped URL.
  useEffect(() => {
    const read = () => {
      const hash = window.location.hash.slice(1);
      // "content" is the Skip to content link on this page, not a token.
      if (!hash || hash === "content") return setToken((t) => t ?? "");
      setToken(hash);
      setRejected(false);
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    };
    read();
    // A new link pasted into this tab only changes the fragment: no reload.
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  useEffect(() => {
    if (attempt) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [attempt]);

  function fail(next: Errors, message: string | null = null) {
    setErrors(next);
    setFormError(message);
    setAttempt((n) => n + 1);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting.current || !token) return;
    const missing: Errors = {};
    if (!password) missing.password = "Enter a new password.";
    if (!confirm) missing.confirm = "Confirm your new password.";
    else if (password && confirm !== password) missing.confirm = "Passwords do not match.";
    if (missing.password || missing.confirm) return fail(missing);

    submitting.current = true;
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      await resetPassword(token, password);
    } catch (err) {
      submitting.current = false;
      setBusy(false);
      if (err instanceof ApiError && err.status === 400) return setRejected(true);
      const field = err instanceof ApiError && err.status === 422 ? err.fieldErrors.new_password : undefined;
      if (field) return fail({ password: field });
      return fail({}, errorMessage(err) ?? "Something went wrong. Try again.");
    }
    // Success: stay busy while navigating. replace() drops this page from history.
    router.replace("/login?reset=1");
  }

  return (
    <>
      <SkipLink />
      <header className="bg-bar-bg pt-[env(safe-area-inset-top)] text-bar-text">
        <div className="mx-auto max-w-[440px] px-4 py-6">
          <Wordmark variant="on-ink" size={40} />
        </div>
      </header>
      <main id="content" tabIndex={-1} className="mx-auto flex max-w-[440px] flex-col gap-5 px-4 pt-6 pb-12 outline-none">
        <h1 className="text-page-title text-text-primary">Reset password</h1>
        {token === "" || rejected ? (
          <>
            <Banner title={rejected ? DEAD : OPEN_AGAIN} />
            <p className="text-center">
              <TextAction href="/login">Back to log in</TextAction>
            </p>
          </>
        ) : (
          token && (
            <form ref={form} noValidate aria-busy={busy || undefined} onSubmit={onSubmit} className="flex flex-col gap-5">
              {formError && <Banner title={formError} />}
              <PasswordField
                label="New password"
                name="new_password"
                required
                autoComplete="new-password"
                value={password}
                error={errors.password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <PasswordField
                label="Confirm password"
                name="confirm_password"
                required
                autoComplete="new-password"
                value={confirm}
                error={errors.confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Setting password…" : "Set new password"}
              </Button>
            </form>
          )
        )}
      </main>
    </>
  );
}
