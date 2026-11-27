"use client";

import { useEffect, useRef, useState } from "react";
import { Banner } from "@/components/banner";
import { Button, TextAction } from "@/components/button";
import { DeleteConfirm } from "@/components/dialog";
import { EmptyState } from "@/components/empty-state";
import { PasswordField } from "@/components/fields";
import { LedgerSheet, LedgerSkeleton } from "@/components/ledger";
import { LoadError } from "@/components/load-error";
import { useToast } from "@/components/toast";
import {
  approveInviteRequest,
  deleteInviteRequest,
  type InviteRequest,
  listInviteRequests,
  rejectInviteRequest,
} from "@/lib/admin";
import { formatDateTimePHT } from "@/lib/format";
import { ApiError, errorMessage } from "@/lib/http";

const wrap = "[overflow-wrap:anywhere]";
const STATUS = { pending: "Pending", approved: "Approved", rejected: "Rejected" };
const FALLBACK = "Something went wrong. Try again.";

// The admin gate's plain "Not Found" (no longer an admin). "Request not found." is a missing row.
const isGate = (e: unknown) => e instanceof ApiError && e.status === 404 && e.detail === "Not Found";
const detailOr = (e: unknown, fallback: string) =>
  e instanceof ApiError && (e.status === 404 || e.status === 409) ? e.detail : (errorMessage(e) ?? fallback);

export function RequestsSection({ onApproved, onGone }: { onApproved: () => void; onGone: () => void }) {
  const toast = useToast();
  const [items, setItems] = useState<InviteRequest[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // The one open approve form, and its password. Neither the password nor the code leaves component state.
  const [approving, setApproving] = useState<number | null>(null);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [banner, setBanner] = useState<string | null>(null);
  const [made, setMade] = useState<{ requestId: number; code: string } | null>(null);
  const [deleting, setDeleting] = useState<InviteRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [focusReq, setFocusReq] = useState(0);
  const sending = useRef(false);
  const passwordInput = useRef<HTMLInputElement>(null);
  const copyButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let live = true;
    listInviteRequests().then(
      (rows) => {
        if (!live) return;
        setItems(rows);
        setLoadFailed(false);
      },
      (err) => {
        if (!live) return;
        if (isGate(err)) onGone();
        else setLoadFailed(true);
      },
    );
    return () => {
      live = false;
    };
    // onGone is a new function on every parent render; only a reload should refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);
  const refresh = () => setAttempt((n) => n + 1);

  useEffect(() => {
    if (approving !== null) passwordInput.current?.focus();
  }, [approving, focusReq]);
  useEffect(() => {
    if (made) copyButton.current?.focus();
  }, [made]);

  function openApprove(id: number | null) {
    if (sending.current) return;
    setApproving(id);
    setPassword("");
    setPasswordError(undefined);
    setBanner(null);
  }

  // One request at a time across approve, reject and delete.
  async function run(action: () => Promise<void>) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      await action();
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  async function onApprove(e: React.FormEvent, id: number) {
    e.preventDefault();
    if (!password) {
      setPasswordError("Enter your password.");
      setFocusReq((n) => n + 1);
      return;
    }
    await run(async () => {
      setBanner(null);
      setPasswordError(undefined);
      setMade(null);
      try {
        const { code } = await approveInviteRequest(id, password);
        setMade({ requestId: id, code });
        setApproving(null);
        setPassword("");
        refresh();
        onApproved();
      } catch (err) {
        if (isGate(err)) return onGone();
        const api = err instanceof ApiError ? err : null;
        setPassword("");
        const wrong =
          api?.status === 403 && api.detail === "Incorrect password."
            ? api.detail
            : api?.status === 422
              ? api.fieldErrors.password
              : undefined;
        if (wrong) {
          setPasswordError(wrong);
          setFocusReq((n) => n + 1);
          return;
        }
        // 409: already decided, or the unused-invite cap. 404: deleted meanwhile.
        setBanner(detailOr(err, FALLBACK));
        if (api?.status === 409 || api?.status === 404) {
          setApproving(null);
          refresh();
        }
      }
    });
  }

  const onReject = (id: number) =>
    run(async () => {
      setBanner(null);
      try {
        await rejectInviteRequest(id);
        toast.success("Request rejected.");
      } catch (err) {
        if (isGate(err)) return onGone();
        toast.error(detailOr(err, "Couldn't reject the request. Try again."));
      }
      heading.current?.focus();
      refresh();
    });

  const onDelete = () =>
    run(async () => {
      if (!deleting) return;
      const { id } = deleting;
      try {
        await deleteInviteRequest(id);
        toast.success("Request deleted.");
      } catch (err) {
        if (isGate(err)) return onGone();
        if (!(err instanceof ApiError && err.status === 404)) {
          toast.error(errorMessage(err) ?? "Couldn't delete the request. Try again.");
          return; // the dialog stays open
        }
        toast.success("Request deleted."); // already gone
      }
      setMade((m) => (m?.requestId === id ? null : m));
      setDeleting(null);
      heading.current?.focus();
      refresh();
    });

  async function onCopy() {
    if (!made) return;
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(made.code);
      toast.success("Code copied.");
    } catch {
      toast.error("Couldn't copy the code. Select it and copy it yourself.");
    }
  }

  return (
    <section aria-labelledby="requests" className="mt-8 flex flex-col gap-4">
      <h2 ref={heading} id="requests" tabIndex={-1} className="text-section-title text-text-primary outline-none">
        Requests
      </h2>
      <p aria-live="polite" className="sr-only">
        {made ? "Request approved. The code is shown once, with the request." : ""}
      </p>
      {banner && <Banner title={banner} />}
      {loadFailed && (
        <LoadError
          title="Couldn't load the requests."
          onRetry={() => {
            setLoadFailed(false);
            refresh();
          }}
        />
      )}
      {items === null ? (
        !loadFailed && <LedgerSkeleton rows={1} label="Loading requests" />
      ) : items.length === 0 ? (
        <EmptyState title="No requests." message="Invite requests show here." />
      ) : (
        <LedgerSheet>
          {items.map((r) => (
            <li key={r.id} className="flex flex-col gap-1 p-4">
              {/* Plain text children: React escapes them. */}
              <p className={`text-row-title text-text-primary ${wrap}`}>{r.contact}</p>
              <p className={`whitespace-pre-line text-body text-text-secondary ${wrap}`}>{r.note}</p>
              <p className="text-caption tabular-nums text-text-muted">
                {`${STATUS[r.status]} · Requested ${formatDateTimePHT(r.created_at) ?? "date unavailable"}`}
              </p>
              <div className="-mx-2 flex flex-wrap">
                {r.status === "pending" && (
                  <>
                    <TextAction onClick={() => openApprove(r.id)} disabled={busy} aria-label={`Approve request from ${r.contact}`}>
                      Approve
                    </TextAction>
                    <TextAction onClick={() => onReject(r.id)} disabled={busy} aria-label={`Reject request from ${r.contact}`}>
                      Reject
                    </TextAction>
                  </>
                )}
                <TextAction onClick={() => setDeleting(r)} disabled={busy} tone="danger" aria-label={`Delete request from ${r.contact}`}>
                  Delete
                </TextAction>
              </div>
              {approving === r.id && r.status === "pending" && (
                <form noValidate onSubmit={(e) => onApprove(e, r.id)} aria-busy={busy || undefined} className="flex flex-col gap-3">
                  <PasswordField
                    ref={passwordInput}
                    label="Your password"
                    name="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    error={passwordError}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setPasswordError(undefined);
                    }}
                  />
                  <div className="flex flex-wrap gap-3">
                    <Button type="submit" disabled={busy}>
                      {busy ? "Approving…" : "Approve request"}
                    </Button>
                    <Button variant="secondary" onClick={() => openApprove(null)} disabled={busy}>
                      Cancel
                    </Button>
                  </div>
                </form>
              )}
              {made?.requestId === r.id && (
                <div className="flex flex-col items-start gap-3 pt-2">
                  <p className="max-w-full select-all text-row-title whitespace-nowrap tabular-nums text-text-primary">{made.code}</p>
                  <p className="text-caption text-text-muted">
                    Your backup copy, shown once. They can also see it once at their status link.
                  </p>
                  <Button ref={copyButton} variant="secondary" onClick={onCopy}>
                    Copy code
                  </Button>
                </div>
              )}
            </li>
          ))}
        </LedgerSheet>
      )}
      <DeleteConfirm
        open={deleting !== null}
        onCancel={() => setDeleting(null)}
        onConfirm={onDelete}
        title="Delete this request?"
        message="Deleting an approved request does not revoke its invite. Revoke it under Invites."
        confirmLabel="Delete request"
        busy={busy}
      />
    </section>
  );
}
