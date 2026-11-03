"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Banner } from "@/components/banner";
import { Button } from "@/components/button";
import { PasswordField, TextField } from "@/components/fields";
import { Wordmark } from "@/components/logo";
import { SegmentedControl } from "@/components/segmented-control";
import { SkipLink } from "@/components/skip-link";
import { getMe, login, signup } from "@/lib/auth";
import { ApiError, errorMessage, safeNext } from "@/lib/http";

type Mode = "login" | "signup";
const modes = [
  { value: "login", label: "Log in" },
  { value: "signup", label: "Create account" },
] as const;

// DESIGN 8.1 (field order per DECISIONS 2026-11-02).
const fields: Record<Mode, { name: string; message: string }[]> = {
  login: [
    { name: "email", message: "Enter your email." },
    { name: "password", message: "Enter your password." },
  ],
  signup: [
    { name: "invite_code", message: "Enter your invite code." },
    { name: "account_name", message: "Enter your account name." },
    { name: "email", message: "Enter your email." },
    { name: "password", message: "Enter a password." },
  ],
};

const SIGNUP_FIELDS = ["invite_code", "account_name", "email", "password"];

export function LoginForm({
  expired = false,
  deleted = false,
  next,
}: {
  expired?: boolean;
  deleted?: boolean;
  next?: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(
    deleted ? "Your account has been deleted." : expired ? "Your session expired. Log in again." : null,
  );
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Email survives a mode switch. The password is controlled only so a failed attempt can clear it
  // alone; a mode switch (form remount by key) clears it too.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const form = useRef<HTMLFormElement>(null);
  // A ref, not state: two Enter presses in one tick both see the same stale `busy` state.
  const submitting = useRef(false);

  // Already logged in (or logged in in another tab): skip the form. A 401 is the normal case here.
  useEffect(() => {
    let live = true;
    getMe({ redirectOn401: false }).then(
      () => live && router.replace(safeNext(next)),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [router, next]);

  // Focus the first invalid field after the error state has rendered; for a form-level error
  // (wrong password) focus the password field so the user can retype at once.
  useEffect(() => {
    if (!attempt) return;
    const el =
      form.current?.querySelector<HTMLElement>('[aria-invalid="true"]') ??
      (formError ? form.current?.querySelector<HTMLElement>('input[name="password"]') : null);
    el?.focus();
  }, [attempt, formError]);

  function fail(nextErrors: Record<string, string>, nextForm: string | null) {
    setErrors(nextErrors);
    setFormError(nextForm);
    setPassword("");
    setAttempt((n) => n + 1);
  }

  function handleError(err: unknown, m: Mode) {
    const common = errorMessage(err);
    if (common || !(err instanceof ApiError)) return fail({}, common ?? "Something went wrong. Try again.");
    const known = m === "login" ? ["email", "password"] : SIGNUP_FIELDS;
    const mapped: Record<string, string> = {};
    if (err.status === 422) {
      for (const [k, v] of Object.entries(err.fieldErrors)) if (known.includes(k)) mapped[k] = v;
      if (Object.keys(mapped).length) return fail(mapped, null);
    }
    if (m === "login" && err.status === 401) return fail({}, "Invalid email or password.");
    if (m === "signup" && err.status === 400) {
      if (err.detail === "Email already exists.") return fail({ email: "Email already exists." }, null);
      return fail({ invite_code: "Invalid or expired invite code." }, null);
    }
    return fail({}, "Something went wrong. Try again.");
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting.current) return;
    const data = new FormData(e.currentTarget);
    const missing: Record<string, string> = {};
    for (const f of fields[mode]) {
      const value = f.name === "password" ? password : String(data.get(f.name) ?? "");
      if (!value.trim()) missing[f.name] = f.message;
    }
    if (Object.keys(missing).length) {
      setErrors(missing);
      setFormError(null);
      setAttempt((n) => n + 1);
      return;
    }

    submitting.current = true;
    setBusy(true);
    setErrors({});
    setFormError(null);
    setNotice(null);
    const mail = email.trim();
    const pass = password; // only these locals hold the password; gone when the handler returns
    try {
      if (mode === "signup") {
        await signup({
          invite_code: String(data.get("invite_code") ?? "").trim(),
          account_name: String(data.get("account_name") ?? "").trim(),
          email: mail,
          password: pass,
        });
        // Signup does not log the user in.
        try {
          await login(mail, pass);
        } catch {
          setMode("login");
          setPassword("");
          setNotice("Account created. Log in to continue.");
          submitting.current = false;
          setBusy(false);
          return;
        }
      } else {
        await login(mail, pass);
      }
    } catch (err) {
      handleError(err, mode);
      submitting.current = false;
      setBusy(false);
      return;
    }
    // Success: stay busy while the navigation happens so the form cannot be submitted again.
    router.replace(safeNext(next));
    router.refresh();
  }

  const err = (n: string) => errors[n];
  const label = mode === "login" ? (busy ? "Logging in…" : "Log in") : busy ? "Creating account…" : "Create account";
  return (
    <>
      <SkipLink />
      <header className="bg-bar-bg pt-[env(safe-area-inset-top)] text-bar-text">
        {/* Same max-w and px-4 as <main> below, so logo, tagline and fields share one left edge. */}
        <div className="mx-auto flex h-[200px] max-w-[440px] flex-col px-4 justify-end gap-3 pb-8">
          <Wordmark variant="on-ink" size={40} />
          <p className="text-body">Track every application in one place.</p>
        </div>
      </header>
      <main id="content" tabIndex={-1} className="mx-auto max-w-[440px] px-4 pt-6 pb-12 outline-none">
        <h1 className="sr-only">{mode === "login" ? "Log in" : "Create account"}</h1>
        <SegmentedControl
          label="Account"
          hideLabel
          options={modes}
          value={mode}
          onChange={(m) => {
            if (busy) return;
            setMode(m);
            setErrors({});
            setFormError(null);
            setNotice(null);
            setPassword("");
            setAttempt(0);
          }}
        />
        {notice && (
          <p
            role="status"
            className="mt-6 rounded-sm border border-border-subtle bg-surface-subtle p-4 text-body text-text-secondary"
          >
            {notice}
          </p>
        )}
        <form
          key={mode}
          ref={form}
          noValidate
          aria-busy={busy || undefined}
          onSubmit={onSubmit}
          className="mt-6 flex flex-col gap-5"
        >
          {formError && <Banner title={formError} />}
          {mode === "signup" && (
            <>
              <TextField
                label="Invite code"
                name="invite_code"
                required
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                helper="Paste the code you were given; dashes are optional"
                error={err("invite_code")}
              />
              <TextField label="Account name" name="account_name" required autoComplete="username" error={err("account_name")} />
            </>
          )}
          <TextField
            label="Email"
            name="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={err("email")}
          />
          <PasswordField
            label="Password"
            name="password"
            required
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={err("password")}
          />
          {mode === "signup" && <p className="text-body text-text-secondary">Access is by invitation for now.</p>}
          <Button type="submit" className="w-full" disabled={busy}>
            {label}
          </Button>
        </form>
      </main>
    </>
  );
}
