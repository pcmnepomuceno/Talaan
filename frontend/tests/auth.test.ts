// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { deleteAccount, getMe, login, logout, signup } from "../src/lib/auth";

const replaceMock = vi.fn();
function reply(status: number, body?: unknown) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () => new Response(body === undefined ? null : JSON.stringify(body), { status }));
}
beforeEach(() => {
  replaceMock.mockClear();
  vi.stubGlobal("location", { pathname: "/account", search: "", replace: replaceMock });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function lastCall(f: ReturnType<typeof reply>) {
  const [path, init] = f.mock.calls.at(-1)!;
  return { path, method: init?.method, body: init?.body };
}

it("login posts email and password", async () => {
  const f = reply(200, { detail: "Logged in" });
  await login("a@example.ph", "Secret1!");
  expect(lastCall(f)).toEqual({
    path: "/api/v1/login",
    method: "POST",
    body: JSON.stringify({ email: "a@example.ph", password: "Secret1!" }),
  });
});

it("signup posts all four fields", async () => {
  const input = { invite_code: "TLN-AAAA-BBBB-CCCC", account_name: "Ana", email: "a@example.ph", password: "Secret1!" };
  const f = reply(200, { id: 1, email: "a@example.ph", account_name: "Ana" });
  await signup(input);
  expect(lastCall(f)).toEqual({ path: "/api/v1/signup", method: "POST", body: JSON.stringify(input) });
});

it("logout posts to /logout", async () => {
  const f = reply(204);
  await logout();
  expect(lastCall(f)).toMatchObject({ path: "/api/v1/logout", method: "POST" });
});

it("getMe reads /me", async () => {
  const f = reply(200, { id: 1, email: "a@example.ph", account_name: "Ana" });
  expect((await getMe()).account_name).toBe("Ana");
  expect(lastCall(f)).toMatchObject({ path: "/api/v1/me", method: "GET" });
});

it("deleteAccount posts only the password", async () => {
  const f = reply(204);
  await deleteAccount("Secret1!");
  expect(lastCall(f)).toEqual({ path: "/api/v1/account/delete", method: "POST", body: '{"password":"Secret1!"}' });
});

it("login, signup and logout throw on 401 instead of redirecting", async () => {
  reply(401, { detail: "Invalid email or password." });
  for (const call of [() => login("a@example.ph", "x"), () => signup({ invite_code: "x", account_name: "a", email: "a@example.ph", password: "x" }), () => logout()]) {
    await expect(call()).rejects.toMatchObject({ status: 401 });
  }
  expect(replaceMock).not.toHaveBeenCalled();
});

it("getMe redirects on 401 by default and throws when opted out", async () => {
  reply(401, { detail: "Not authenticated" });
  await expect(getMe({ redirectOn401: false })).rejects.toMatchObject({ status: 401 });
  expect(replaceMock).not.toHaveBeenCalled();
  void getMe();
  await vi.waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/login?expired=1&next=%2Faccount"));
});

it("deleteAccount: 403 throws, 401 redirects", async () => {
  reply(403, { detail: "Incorrect password." });
  await expect(deleteAccount("x")).rejects.toMatchObject({ status: 403 });
  expect(replaceMock).not.toHaveBeenCalled();
  reply(401, { detail: "Not authenticated" });
  void deleteAccount("x");
  await vi.waitFor(() => expect(replaceMock).toHaveBeenCalled());
});

it("never touches web storage", async () => {
  const set = vi.spyOn(Storage.prototype, "setItem");
  reply(200, { detail: "Logged in" });
  await login("a@example.ph", "Secret1!");
  expect(set).not.toHaveBeenCalled();
});
