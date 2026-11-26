// Admin invite calls (A1). The invite code is only ever in the createInvite response: callers keep it
// in component state and nowhere else (no cache.ts, no web storage, no URL).
import { request } from "./http";
import type { InviteStatus } from "./types";

// Field names match the API (app/auth/admin_invites.py). Never an email or a hash.
export type Invite = {
  id: number;
  status: InviteStatus;
  note: string | null;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  used_by_account_name: string | null; // null with used_at set: the account was deleted
};

export type CreatedInvite = { id: number; code: string; note: string | null; expires_at: string };

export type CreateInviteInput = { note?: string | null; expires_in_days: 7 | 14 | 30; password: string };

// A 404 means "not an admin" (the screen shows Page not found). A 403 is returned as an ApiError so the
// form can tell a wrong password (detail "Incorrect password.") from the Origin check; 401 still redirects.
export const listInvites = async () => (await request<{ items: Invite[] }>("/api/v1/admin/invites")).items;

export const createInvite = (input: CreateInviteInput) =>
  request<CreatedInvite>("/api/v1/admin/invites", { method: "POST", body: input });

export const revokeInvite = (id: number) => request(`/api/v1/admin/invites/${id}`, { method: "DELETE" });

// Like the invite code, the reset token is only ever in this response: component state and nowhere else.
export type CreatedPasswordReset = { token: string; expires_at: string };

export const createPasswordReset = (input: { email: string; admin_password: string }) =>
  request<CreatedPasswordReset>("/api/v1/admin/password-resets", { method: "POST", body: input });
