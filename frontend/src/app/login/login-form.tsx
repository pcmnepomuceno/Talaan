"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/button";
import { PasswordField, TextField } from "@/components/fields";
import { Wordmark } from "@/components/logo";
import { SegmentedControl } from "@/components/segmented-control";
import { SkipLink } from "@/components/skip-link";

type Mode = "login" | "signup";
const modes = [
  { value: "login", label: "Log in" },
  { value: "signup", label: "Create account" },
] as const;

// DESIGN 8.1 (field order per DECISIONS 2026-11-02). Not wired in F3: a valid form does nothing.
// F4 replaces the empty submit branch with the API call.
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

export function LoginForm() {
  const [mode, setMode] = useState<Mode>("login");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [attempt, setAttempt] = useState(0);
  const form = useRef<HTMLFormElement>(null);

  // Focus the first invalid field after the error state has rendered.
  useEffect(() => {
    if (attempt) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [attempt]);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const next: Record<string, string> = {};
    for (const f of fields[mode]) if (!String(data.get(f.name) ?? "").trim()) next[f.name] = f.message;
    setErrors(next);
    setAttempt((n) => n + 1);
  }

  const err = (n: string) => errors[n];
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
            setMode(m);
            setErrors({});
            setAttempt(0);
          }}
        />
        <form key={mode} ref={form} noValidate onSubmit={onSubmit} className="mt-6 flex flex-col gap-5">
          {mode === "signup" && (
            <>
              <TextField label="Invite code" name="invite_code" required autoComplete="off" error={err("invite_code")} />
              <TextField label="Account name" name="account_name" required autoComplete="name" error={err("account_name")} />
            </>
          )}
          <TextField label="Email" name="email" type="email" required autoComplete="email" error={err("email")} />
          <PasswordField
            label="Password"
            name="password"
            required
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            error={err("password")}
          />
          {mode === "signup" && <p className="text-body text-text-secondary">Access is by invitation for now.</p>}
          <Button type="submit" className="w-full">
            {mode === "login" ? "Log in" : "Create account"}
          </Button>
        </form>
      </main>
    </>
  );
}
