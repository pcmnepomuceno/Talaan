// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountScreen } from "../src/app/(app)/account/account-screen";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/account" }));

const json = (status: number, body?: unknown, headers?: Record<string, string>) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
type Handler = () => Response | Promise<Response>;
const ME = "/api/v1/me";
const DELETE = "/api/v1/account/delete";
const LOGOUT = "/api/v1/logout";
const user = { id: 1, email: "ana@example.ph", account_name: "Ana Cruz" };

let handlers: Record<string, Handler>;
const calls = (path: string) => vi.mocked(globalThis.fetch).mock.calls.filter(([p]) => p === path);
function deferred() {
  let resolve!: (r: Response) => void;
  const promise = new Promise<Response>((r) => (resolve = r));
  return { promise, resolve };
}
const locationReplace = vi.fn();

beforeEach(() => {
  router.replace.mockClear();
  router.refresh.mockClear();
  locationReplace.mockClear();
  vi.stubGlobal("location", { pathname: "/account", search: "", replace: locationReplace });
  handlers = { [ME]: () => json(200, user) };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const h = handlers[String(input)];
    if (!h) throw new Error(`unexpected fetch ${String(input)}`);
    return h();
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const dialog = () => document.querySelector("dialog")!;
const dialogOpen = () => dialog().hasAttribute("open");

async function openStep1() {
  render(<AccountScreen />);
  await screen.findByText("ana@example.ph");
  await userEvent.click(screen.getByRole("button", { name: "Delete account" }));
}
async function openStep2() {
  await openStep1();
  await userEvent.click(within(dialog()).getByRole("button", { name: "Continue" }));
}
const del = () => within(dialog()).getByRole("button", { name: /Delete my account permanently|Deleting/ }) as HTMLButtonElement;
const emailBox = () => within(dialog()).getByLabelText("Your email");
const passwordBox = () => within(dialog()).getByLabelText("Password");

describe("profile", () => {
  it("shows the account name and email, and keeps the theme toggle", async () => {
    render(<AccountScreen />);
    expect(await screen.findByText("Ana Cruz")).toBeTruthy();
    expect(screen.getByText("ana@example.ph")).toBeTruthy();
    expect(screen.getAllByText("Theme").length).toBeGreaterThan(0);
  });

  it("renders markup in a name as text", async () => {
    handlers[ME] = () => json(200, { ...user, account_name: "<b>Eve</b><img src=x onerror=alert(1)>" });
    render(<AccountScreen />);
    expect(await screen.findByText("<b>Eve</b><img src=x onerror=alert(1)>")).toBeTruthy();
    expect(document.querySelector("main b, main img")).toBeNull();
  });

  it("a failed load shows an error with Retry", async () => {
    handlers[ME] = () => json(503, { detail: "Service temporarily unavailable." });
    render(<AccountScreen />);
    expect(await screen.findByText("Couldn't load your account.")).toBeTruthy();
    handlers[ME] = () => json(200, user);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("ana@example.ph")).toBeTruthy();
  });

  it("a 200 that is not JSON (wrong BACKEND_URL, proxy page) shows the load error, not an endless skeleton", async () => {
    handlers[ME] = () => new Response("<html>not the API</html>", { status: 200, headers: { "Content-Type": "text/html" } });
    render(<AccountScreen />);
    expect(await screen.findByText("Couldn't load your account.")).toBeTruthy();
    expect(screen.queryByText("Loading your account")).toBeNull();
    handlers[ME] = () => json(200, user);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("ana@example.ph")).toBeTruthy();
  });

  it("a 401 on load sends the user to login with expired and next", async () => {
    handlers[ME] = () => json(401, { detail: "Session expired" });
    render(<AccountScreen />);
    await waitFor(() => expect(locationReplace).toHaveBeenCalledWith("/login?expired=1&next=%2Faccount"));
  });
});

describe("log out", () => {
  it("logs out, then replaces to /login and refreshes", async () => {
    handlers[LOGOUT] = () => json(204);
    render(<AccountScreen />);
    await screen.findByText("ana@example.ph");
    await userEvent.click(screen.getByRole("button", { name: "Log out" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
    expect(router.refresh).toHaveBeenCalled();
    expect(calls(LOGOUT)).toHaveLength(1);
  });

  it("a failed logout stays put with a message", async () => {
    handlers[LOGOUT] = () => json(503, { detail: "x" });
    render(<AccountScreen />);
    await screen.findByText("ana@example.ph");
    await userEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Talaan isn't responding");
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe("delete account dialog", () => {
  it("step 1 lists what is deleted and says it cannot be undone; nothing is sent", async () => {
    await openStep1();
    expect(dialogOpen()).toBe(true);
    const d = within(dialog());
    expect(d.getByRole("heading", { name: "Delete your account?" })).toBeTruthy();
    expect(d.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "your account",
      "all applications",
      "all interviews",
      "all sign-in sessions",
    ]);
    expect(d.getByText("This cannot be undone.")).toBeTruthy();
    expect(d.getByRole("button", { name: "Continue" })).toBeTruthy();
    expect(d.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(calls(DELETE)).toHaveLength(0);
  });

  it("Continue moves focus to the step 2 heading", async () => {
    await openStep2();
    const h = within(dialog()).getByRole("heading", { name: "Type your email to confirm" });
    expect(document.activeElement).toBe(h);
  });

  it("the destructive button needs a matching email (trimmed, any case) and a password", async () => {
    await openStep2();
    expect(del().disabled).toBe(true);
    await userEvent.type(passwordBox(), "Secret1!");
    expect(del().disabled).toBe(true);
    await userEvent.type(emailBox(), "other@example.ph");
    expect(del().disabled).toBe(true);
    await userEvent.clear(emailBox());
    await userEvent.type(emailBox(), "  ANA@Example.PH ");
    expect(del().disabled).toBe(false);
    await userEvent.clear(passwordBox());
    expect(del().disabled).toBe(true);
    expect(calls(DELETE)).toHaveLength(0);
  });

  async function fillStep2() {
    await userEvent.type(emailBox(), "ana@example.ph");
    await userEvent.type(passwordBox(), "Secret1!");
  }

  it("204 replaces to /login?deleted=1", async () => {
    handlers[DELETE] = () => json(204);
    await openStep2();
    await fillStep2();
    await userEvent.click(del());
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login?deleted=1"));
    expect(calls(DELETE)[0][1]?.body).toBe(JSON.stringify({ password: "Secret1!" }));
  });

  it("403 shows Incorrect password. on the field, keeps the dialog open, clears the password", async () => {
    handlers[DELETE] = () => json(403, { detail: "Incorrect password." });
    await openStep2();
    await fillStep2();
    await userEvent.click(del());
    expect(await within(dialog()).findByText("Incorrect password.")).toBeTruthy();
    expect(passwordBox().getAttribute("aria-invalid")).toBe("true");
    expect((passwordBox() as HTMLInputElement).value).toBe("");
    expect(dialogOpen()).toBe(true);
    expect(router.replace).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(passwordBox()));
  });

  it("a 403 that is not a wrong password (Origin check) shows a banner and keeps the password", async () => {
    handlers[DELETE] = () => json(403, { detail: "Cross-site request blocked." });
    await openStep2();
    await fillStep2();
    await userEvent.click(del());
    expect((await within(dialog()).findByRole("alert")).textContent).toContain(
      "This request was blocked. Reload the page and try again.",
    );
    expect(within(dialog()).queryByText("Incorrect password.")).toBeNull();
    expect(passwordBox().getAttribute("aria-invalid")).toBeNull();
    expect((passwordBox() as HTMLInputElement).value).toBe("Secret1!");
    expect(dialogOpen()).toBe(true);
  });

  it("429 shows the wait time in the dialog", async () => {
    handlers[DELETE] = () => json(429, { detail: "Too many attempts. Try again later." }, { "Retry-After": "120" });
    await openStep2();
    await fillStep2();
    await userEvent.click(del());
    expect((await within(dialog()).findByRole("alert")).textContent).toContain("Try again in about 2 minutes.");
    expect(dialogOpen()).toBe(true);
    expect((passwordBox() as HTMLInputElement).value).toBe("Secret1!");
  });

  it("422 on the password is a password error and clears the field", async () => {
    handlers[DELETE] = () => json(422, { detail: [{ loc: ["body", "password"], msg: "Field required" }] });
    await openStep2();
    await fillStep2();
    await userEvent.click(del());
    expect(await within(dialog()).findByText("Incorrect password.")).toBeTruthy();
    expect((passwordBox() as HTMLInputElement).value).toBe("");
  });

  it("401 sends the user to the session-expired flow", async () => {
    handlers[DELETE] = () => json(401, { detail: "Not authenticated" });
    await openStep2();
    await fillStep2();
    await userEvent.click(del());
    await waitFor(() => expect(locationReplace).toHaveBeenCalledWith("/login?expired=1&next=%2Faccount"));
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("busy: buttons disabled, Escape ignored, a second submit sends nothing", async () => {
    const d = deferred();
    handlers[DELETE] = () => d.promise;
    await openStep2();
    await fillStep2();
    await userEvent.click(del());
    expect(del().disabled).toBe(true);
    expect((within(dialog()).getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect(dialogOpen()).toBe(true);
    await userEvent.type(emailBox(), "{Enter}");
    expect(calls(DELETE)).toHaveLength(1);
    d.resolve(json(403, { detail: "Incorrect password." }));
    await within(dialog()).findByText("Incorrect password.");
    expect(del().disabled).toBe(true); // password cleared
  });

  it("Cancel and Escape close it and the next open starts again at step 1 with empty fields", async () => {
    await openStep2();
    await userEvent.type(emailBox(), "ana@example.ph");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(dialogOpen()).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Delete account" }));
    expect(within(dialog()).getByRole("heading", { name: "Delete your account?" })).toBeTruthy();
    await userEvent.click(within(dialog()).getByRole("button", { name: "Continue" }));
    expect((emailBox() as HTMLInputElement).value).toBe("");
    await userEvent.keyboard("{Escape}");
    expect(dialogOpen()).toBe(false);
  });

  it("the email in the prompt is plain text", async () => {
    handlers[ME] = () => json(200, { ...user, email: "<i>x</i>@example.ph" });
    render(<AccountScreen />);
    await screen.findAllByText("<i>x</i>@example.ph");
    await userEvent.click(screen.getByRole("button", { name: "Delete account" }));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Continue" }));
    expect(dialog().querySelector("i")).toBeNull();
  });
});
