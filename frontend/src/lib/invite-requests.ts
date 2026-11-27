// Public invite request calls (A3). No session involved. The status token and the code live in
// component state only: never in a cache, web storage or a URL we send.
import { request } from "./http";

export type RequestState = { state: "pending" | "rejected" | "approved" | "shown" | "expired"; code?: string };

// `website` is the honeypot: a person never fills it.
export const createInviteRequest = (input: { contact: string; note: string; website: string }) =>
  request<{ token: string }>("/api/v1/invite-requests", { method: "POST", body: input, redirectOn401: false });

// The token goes in the body, never in a URL. 400 = invalid link.
export const inviteRequestStatus = (token: string) =>
  request<RequestState>("/api/v1/invite-requests/status", { method: "POST", body: { token }, redirectOn401: false });
