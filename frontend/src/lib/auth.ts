// Auth calls against the real API. Nothing here (or anywhere in F4) writes tokens or user data to
// localStorage/sessionStorage: the session is an HttpOnly cookie the browser manages.
import { resetCaches } from "./cache";
import { request } from "./http";

export type User = { id: number; email: string; account_name: string };

export type SignupInput = { invite_code: string; account_name: string; email: string; password: string };

// 401 on these is an answer ("wrong password", "no session"), not an expired session.
// Login, logout and account deletion also reset the in-memory applications caches (resetCaches), so a
// second user in the same tab never sees the first user's rows.
export const login = async (email: string, password: string) => {
  const r = await request<{ detail: string }>("/api/v1/login", { method: "POST", body: { email, password }, redirectOn401: false });
  resetCaches();
  return r;
};

export const signup = (input: SignupInput) =>
  request<User>("/api/v1/signup", { method: "POST", body: input, redirectOn401: false });

export const logout = async () => {
  resetCaches();
  await request("/api/v1/logout", { method: "POST", redirectOn401: false });
};

export const getMe = (opts: { redirectOn401?: boolean } = {}) => request<User>("/api/v1/me", opts);

// 403 = wrong password or the Origin check (never 401), so the default 401 redirect stays on for a truly dead session.
export const deleteAccount = async (password: string) => {
  await request("/api/v1/account/delete", { method: "POST", body: { password } });
  resetCaches();
};
