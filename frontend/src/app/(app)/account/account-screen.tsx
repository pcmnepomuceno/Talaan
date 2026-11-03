"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AppBar } from "@/components/app-bar";
import { Button } from "@/components/button";
import { Dialog } from "@/components/dialog";
import { PasswordField, TextField } from "@/components/fields";
import { Banner } from "@/components/banner";
import { LedgerSkeleton } from "@/components/ledger";
import { LoadError } from "@/components/load-error";
import { ThemeToggle } from "@/components/theme-toggle";
import { deleteAccount, getMe, logout, type User } from "@/lib/auth";
import { ApiError, errorMessage } from "@/lib/http";

const sheet = "overflow-hidden rounded-sm border border-border-subtle bg-surface-card divide-y divide-border-subtle";

export function AccountScreen() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // A 401 here redirects to /login?expired=1 inside the wrapper and never settles.
  useEffect(() => {
    let live = true;
    getMe().then(
      (u) => live && setUser(u),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [attempt]);
  const load = () => {
    setFailed(false);
    setAttempt((n) => n + 1);
  };

  async function onLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError(null);
    try {
      await logout();
    } catch (err) {
      setLogoutError(errorMessage(err) ?? "Couldn't log out. Try again.");
      setLoggingOut(false);
      return;
    }
    // replace (not push) so Back cannot return to a private page; refresh drops cached RSC payloads.
    router.replace("/login");
    router.refresh();
  }

  return (
    <>
      <AppBar />
      <main id="content" tabIndex={-1} className="max-w-2xl px-4 pt-6 pb-24 outline-none md:pb-8 xl:pt-8">
        <h1 className="text-section-title text-text-primary">Account</h1>

        <section aria-labelledby="profile" className="mt-6 flex flex-col gap-3">
          <h2 id="profile" className="sr-only">
            Profile
          </h2>
          {user ? (
            <dl className={sheet}>
              <Row label="Account name">{user.account_name}</Row>
              <Row label="Email">{user.email}</Row>
            </dl>
          ) : failed ? (
            <LoadError title="Couldn't load your account." onRetry={load} />
          ) : (
            <LedgerSkeleton rows={1} label="Loading your account" />
          )}
        </section>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <span className="text-body text-text-secondary">Theme</span>
          <ThemeToggle />
        </div>

        <section aria-labelledby="session" className="mt-8 flex flex-col items-start gap-3">
          <h2 id="session" className="sr-only">
            Session
          </h2>
          {logoutError && <Banner title={logoutError} />}
          <Button variant="secondary" onClick={onLogout} disabled={loggingOut}>
            {loggingOut ? "Logging out…" : "Log out"}
          </Button>
        </section>

        <section aria-labelledby="danger" className="mt-8 flex flex-col items-start gap-3 border-t border-border-subtle pt-6">
          <h2 id="danger" className="text-body-medium text-text-primary">
            Delete account
          </h2>
          <p className="text-body text-text-secondary">
            Permanently deletes your account and everything in it. This cannot be undone.
          </p>
          <Button variant="destructive" onClick={() => setDeleting(true)} disabled={!user}>
            Delete account
          </Button>
        </section>
      </main>
      {user && <DeleteAccountDialog email={user.email} open={deleting} onClose={() => setDeleting(false)} />}
    </>
  );
}

function Row({ label, children }: { label: string; children: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 px-4 py-3">
      <dt className="text-body text-text-secondary">{label}</dt>
      {/* Plain text child: React escapes it, so odd characters in a name or email cannot inject HTML. */}
      <dd className="min-w-0 text-right text-body font-semibold text-text-primary [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

// Two steps in one dialog. The destructive call is only reachable on step 2, and only with the
// typed email matching and a password present. Every error keeps the dialog open.
function DeleteAccountDialog({ email, open, onClose }: { email: string; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [typed, setTyped] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [banner, setBanner] = useState<string | null>(null);
  const submitting = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);

  const matches = typed.trim().toLowerCase() === email.toLowerCase();
  const canDelete = matches && password !== "" && !busy;

  // Step change: the focused Continue button is gone, so move focus to the new title.
  useEffect(() => {
    if (step === 2) heading.current?.focus();
  }, [step]);

  function close() {
    if (busy) return;
    onClose();
    setStep(1);
    setTyped("");
    setPassword("");
    setPasswordError(undefined);
    setBanner(null);
  }

  async function onDelete(e: React.FormEvent) {
    e.preventDefault();
    if (submitting.current || !canDelete) return;
    submitting.current = true;
    setBusy(true);
    setPasswordError(undefined);
    setBanner(null);
    try {
      await deleteAccount(password);
    } catch (err) {
      submitting.current = false;
      setBusy(false);
      // Only the exact detail means a wrong password; any other 403 is the Origin check (banner).
      const wrongPassword =
        err instanceof ApiError && (err.status === 422 || (err.status === 403 && err.detail === "Incorrect password."));
      if (wrongPassword) {
        setPasswordError("Incorrect password.");
        setPassword("");
        // Wait for the re-enabled field to render before focusing it.
        setTimeout(() => passwordInput.current?.focus(), 0);
      } else {
        setBanner(errorMessage(err) ?? "Something went wrong. Try again.");
      }
      return;
    }
    // Stay busy: the dialog must not be usable while the page navigates away.
    router.replace("/login?deleted=1");
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      busy={busy}
      headingRef={heading}
      title={step === 1 ? "Delete your account?" : "Type your email to confirm"}
    >
      {step === 1 ? (
        <>
          <p className="mt-3 text-body text-text-secondary">This permanently deletes:</p>
          <ul className="mt-2 list-disc pl-5 text-body text-text-primary">
            <li>your account</li>
            <li>all applications</li>
            <li>all interviews</li>
            <li>all sign-in sessions</li>
          </ul>
          <p className="mt-3 text-body-medium text-text-primary">This cannot be undone.</p>
          <div className="mt-6 flex flex-col gap-3">
            <Button variant="destructive" className="w-full" onClick={() => setStep(2)}>
              Continue
            </Button>
            <Button variant="secondary" className="w-full" onClick={close} data-autofocus>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <form noValidate onSubmit={onDelete} aria-busy={busy || undefined} className="mt-4 flex flex-col gap-5">
          <p className="text-body text-text-secondary [overflow-wrap:anywhere]">
            To delete your account for good, type <strong className="font-semibold text-text-primary">{email}</strong> and enter
            your password.
          </p>
          {banner && <Banner title={banner} />}
          <TextField
            label="Your email"
            name="confirm_email"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={typed}
            disabled={busy}
            onChange={(e) => setTyped(e.target.value)}
          />
          <PasswordField
            ref={passwordInput}
            label="Password"
            name="password"
            autoComplete="current-password"
            value={password}
            disabled={busy}
            error={passwordError}
            onChange={(e) => {
              setPassword(e.target.value);
              setPasswordError(undefined);
            }}
          />
          <div className="flex flex-col gap-3">
            <Button type="submit" variant="destructive" className="w-full" disabled={!canDelete}>
              {busy ? "Deleting…" : "Delete my account permanently"}
            </Button>
            <Button variant="secondary" className="w-full" onClick={close} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
