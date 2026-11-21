// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Component, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminScreen } from "../src/app/(app)/admin/admin-screen";
import { ToastProvider } from "../src/components/toast";

// notFound() throws during render; a test boundary stands in for Next's not-found boundary.
const NOT_FOUND = "NEXT_HTTP_ERROR_FALLBACK;404";
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  },
}));
class Boundary extends Component<{ children: ReactNode }, { gone: boolean }> {
  state = { gone: false };
  static getDerivedStateFromError(e: Error) {
    if (e.message !== NOT_FOUND) throw e;
    return { gone: true };
  }
  render() {
    return this.state.gone ? <p>Page not found.</p> : this.props.children;
  }
}
const mount = () =>
  render(
    <Boundary>
      <ToastProvider>
        <AdminScreen />
      </ToastProvider>
    </Boundary>,
  );

const json = (status: number, body?: unknown, headers?: Record<string, string>) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
type Handler = () => Response | Promise<Response>;
const LIST = "GET /api/v1/admin/invites";
const CREATE = "POST /api/v1/admin/invites";
const revokePath = (id: number) => `DELETE /api/v1/admin/invites/${id}`;
const CODE = "TLN-TEST-AAAA-BBBB"; // fake; the real API never returns this value
const CODE2 = "TLN-TEST-CCCC-DDDD";

const invite = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 1,
  status: "unused",
  note: "Friend one",
  created_at: "2026-11-20T18:00:00+00:00", // 02:00 on Nov 21 in Manila
  expires_at: "2026-12-04T18:00:00+00:00",
  used_at: null,
  used_by_account_name: null,
  ...over,
});

let handlers: Record<string, Handler>;
const calls = (key: string) =>
  vi.mocked(globalThis.fetch).mock.calls.filter(([p, init]) => `${init?.method ?? "GET"} ${String(p)}` === key);
function deferred() {
  let resolve!: (r: Response) => void;
  const promise = new Promise<Response>((r) => (resolve = r));
  return { promise, resolve };
}
const locationReplace = vi.fn();
const setClipboard = (value: unknown) => Object.defineProperty(navigator, "clipboard", { value, configurable: true });

beforeEach(() => {
  locationReplace.mockClear();
  vi.stubGlobal("location", { pathname: "/admin", search: "", replace: locationReplace });
  handlers = { [LIST]: () => json(200, { items: [] }) };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const h = handlers[`${init?.method ?? "GET"} ${String(input)}`];
    if (!h) throw new Error(`unexpected fetch ${init?.method ?? "GET"} ${String(input)}`);
    return h();
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setClipboard(undefined);
});

const noteBox = () => screen.getByLabelText("Note") as HTMLInputElement;
const passwordBox = () => screen.getByLabelText("Your password") as HTMLInputElement;
const daysBox = () => screen.getByLabelText("Expires in") as HTMLSelectElement;
const createButton = () => screen.getByRole("button", { name: /Create code|Creating/ }) as HTMLButtonElement;
const polite = () => document.querySelector('p[aria-live="polite"].sr-only')!;
const banner = () => document.querySelector("main [role=alert]");
const dialog = () => document.querySelector("dialog")!;

const waitForBanner = () => waitFor(() => banner()!).then(() => banner()!);

async function loaded() {
  mount();
  await screen.findByRole("heading", { name: "Create invite" });
}
async function submit(password = "Secret1!") {
  await userEvent.type(passwordBox(), password);
  await userEvent.click(createButton());
}

describe("load", () => {
  it("a 404 takes the not-found path: no admin UI, no form", async () => {
    handlers[LIST] = () => json(404, { detail: "Not Found" });
    mount();
    expect(await screen.findByText("Page not found.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Create invite" })).toBeNull();
    expect(screen.queryByLabelText("Your password")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Admin" })).toBeNull();
  });

  it("the first load shows only a skeleton labelled Loading", async () => {
    const d = deferred();
    handlers[LIST] = () => d.promise;
    mount();
    expect(screen.getByText("Loading")).toBeTruthy();
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByLabelText("Note")).toBeNull();
    await act(async () => d.resolve(json(200, { items: [] })));
    expect(await screen.findByRole("heading", { name: "Create invite" })).toBeTruthy();
    expect(screen.queryByText("Loading")).toBeNull();
  });

  it("a 401 sends the user to login", async () => {
    handlers[LIST] = () => json(401, { detail: "Session expired" });
    mount();
    await waitFor(() => expect(locationReplace).toHaveBeenCalledWith("/login?expired=1&next=%2Fadmin"));
  });

  it("another failure shows Couldn't load this page. with Retry", async () => {
    handlers[LIST] = () => json(503, { detail: "x" });
    mount();
    expect(await screen.findByText("Couldn't load this page.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Create invite" })).toBeNull();
    handlers[LIST] = () => json(200, { items: [] });
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: "Create invite" })).toBeTruthy();
  });

  it("an empty list shows the empty state and no button besides the form's", async () => {
    await loaded();
    expect(screen.getByText("No invites yet.")).toBeTruthy();
    expect(screen.getByText("Codes you create show here.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Revoke/ })).toBeNull();
  });

  it("a failed refresh keeps the rows and shows a banner with Retry", async () => {
    handlers[LIST] = () => json(200, { items: [invite()] });
    await loaded();
    await screen.findByText("Friend one");
    handlers[LIST] = () => json(500, { detail: "x" });
    handlers[revokePath(1)] = () => json(204);
    await userEvent.click(screen.getByRole("button", { name: "Revoke invite, Friend one" }));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Revoke invite" }));
    expect(await screen.findByText("Couldn't refresh the invites. Showing the last loaded list.")).toBeTruthy();
    expect(screen.getByText("Friend one")).toBeTruthy();
    handlers[LIST] = () => json(200, { items: [] });
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No invites yet.")).toBeTruthy();
    expect(screen.queryByText("Couldn't refresh the invites. Showing the last loaded list.")).toBeNull();
  });
});

describe("rows", () => {
  it("renders unused, used, used by a deleted account, and expired rows", async () => {
    handlers[LIST] = () =>
      json(200, {
        items: [
          invite({ id: 4, note: null }),
          invite({ id: 3, status: "used", note: "Friend two", used_at: "2026-11-22T10:00:00+00:00", used_by_account_name: "Ana Cruz" }),
          invite({ id: 2, status: "used", note: "Friend three", used_at: "2026-11-23T10:00:00+00:00", used_by_account_name: null }),
          invite({ id: 1, status: "expired", note: "Old one", expires_at: "2026-11-01T00:00:00+00:00" }),
        ],
      });
    await loaded();
    await screen.findByText("Friend two");
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    const [unused, used, deleted, expired] = rows;
    expect(within(unused).getByText("No note")).toBeTruthy();
    expect(within(unused).getByText("Unused")).toBeTruthy();
    expect(within(unused).getByText("Created Nov 21, 2026 · Expires Dec 5, 2026")).toBeTruthy();
    expect(within(used).getByText("Used")).toBeTruthy();
    expect(within(used).getByText("Used on Nov 22, 2026 by Ana Cruz")).toBeTruthy();
    expect(within(used).queryByRole("button")).toBeNull();
    expect(within(deleted).getByText("Used on Nov 23, 2026 by (deleted)")).toBeTruthy();
    expect(within(expired).getByText("Expired")).toBeTruthy();
    expect(within(expired).getByText("Created Nov 21, 2026 · Expired Nov 1, 2026")).toBeTruthy();
    expect(within(expired).queryByRole("button")).toBeNull();
  });

  it("renders emoji, tabs, long text and markup in a note as text", async () => {
    const long = "x".repeat(300);
    handlers[LIST] = () =>
      json(200, {
        items: [invite({ id: 3, note: "Ate Mia 🎉" }), invite({ id: 2, note: "a\tb" }), invite({ id: 1, note: long }), invite({ id: 5, note: "<b>bold</b><img src=x>" })],
      });
    await loaded();
    expect(await screen.findByText("Ate Mia 🎉")).toBeTruthy();
    expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "a\tb")).toBeTruthy();
    expect(screen.getByText(long).className).toContain("[overflow-wrap:anywhere]");
    expect(screen.getByText("<b>bold</b><img src=x>")).toBeTruthy();
    expect(document.querySelector("main b, main img")).toBeNull();
  });

  it("names the Revoke actions with the note, or with the id when there is none", async () => {
    handlers[LIST] = () => json(200, { items: [invite({ id: 7, note: null }), invite({ id: 6, note: "Friend one" })] });
    await loaded();
    expect(await screen.findByRole("button", { name: "Revoke invite, Friend one" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Revoke invite 7" })).toBeTruthy();
  });
});

describe("create", () => {
  it("sends the form, shows the code once, clears the form and refreshes the list", async () => {
    handlers[CREATE] = () => json(201, { id: 9, code: CODE, note: "Friend one", expires_at: "2026-11-28T00:00:00+00:00" });
    await loaded();
    expect(daysBox().value).toBe("14");
    expect(noteBox().maxLength).toBe(400);
    await userEvent.type(noteBox(), "  Friend one ");
    await userEvent.selectOptions(daysBox(), "7");
    handlers[LIST] = () => json(200, { items: [invite({ id: 9 })] });
    await submit();
    expect(await screen.findByText(CODE)).toBeTruthy();
    expect(calls(CREATE)).toHaveLength(1);
    expect(JSON.parse(String(calls(CREATE)[0][1]?.body))).toEqual({ note: "Friend one", expires_in_days: 7, password: "Secret1!" });
    expect(screen.getByRole("heading", { name: "New code, shown once" })).toBeTruthy();
    expect(screen.getByText("This code cannot be shown again.")).toBeTruthy();
    expect(passwordBox().value).toBe("");
    expect(noteBox().value).toBe("");
    expect(daysBox().value).toBe("14");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Copy code" }));
    await waitFor(() => expect(calls(LIST)).toHaveLength(2));
    expect(await screen.findByText("Friend one")).toBeTruthy();
  });

  it("announces politely without the code, and the code is in no live region", async () => {
    handlers[CREATE] = () => json(201, { id: 9, code: CODE, note: null, expires_at: "2026-11-28T00:00:00+00:00" });
    await loaded();
    expect(polite().textContent).toBe("");
    await submit();
    await screen.findByText(CODE);
    expect(polite().textContent).toBe("Code created. It is shown once, below the form.");
    expect(polite().textContent).not.toContain(CODE);
    for (const live of document.querySelectorAll("[aria-live], [role=status], [role=alert]")) {
      expect(live.textContent).not.toContain(CODE);
    }
  });

  it("the next create clears the old code first, and a remount shows none", async () => {
    handlers[CREATE] = () => json(201, { id: 9, code: CODE, note: null, expires_at: "2026-11-28T00:00:00+00:00" });
    await loaded();
    await submit();
    await screen.findByText(CODE);
    const d = deferred();
    handlers[CREATE] = () => d.promise;
    await submit();
    expect(screen.queryByText(CODE)).toBeNull();
    expect(screen.queryByRole("heading", { name: "New code, shown once" })).toBeNull();
    await act(async () => d.resolve(json(201, { id: 10, code: CODE2, note: null, expires_at: "2026-11-28T00:00:00+00:00" })));
    expect(await screen.findByText(CODE2)).toBeTruthy();
    expect(screen.queryByText(CODE)).toBeNull();
  });

  it("a remount does not show the code", async () => {
    handlers[CREATE] = () => json(201, { id: 9, code: CODE, note: null, expires_at: "2026-11-28T00:00:00+00:00" });
    const first = render(
      <ToastProvider>
        <AdminScreen />
      </ToastProvider>,
    );
    await screen.findByRole("heading", { name: "Create invite" });
    await submit();
    await screen.findByText(CODE);
    first.unmount();
    mount();
    await screen.findByRole("heading", { name: "Create invite" });
    expect(screen.queryByText(CODE)).toBeNull();
  });

  it("a double click sends one request and shows Creating… meanwhile", async () => {
    const d = deferred();
    handlers[CREATE] = () => d.promise;
    await loaded();
    await userEvent.type(passwordBox(), "Secret1!");
    await userEvent.dblClick(createButton());
    expect(calls(CREATE)).toHaveLength(1);
    expect(createButton().textContent).toBe("Creating…");
    expect(createButton().disabled).toBe(true);
    await act(async () => d.resolve(json(201, { id: 9, code: CODE, note: null, expires_at: "2026-11-28T00:00:00+00:00" })));
    await screen.findByText(CODE);
    expect(calls(CREATE)).toHaveLength(1);
  });

  it("a wrong password clears the password, keeps the note and focuses the password", async () => {
    handlers[CREATE] = () => json(403, { detail: "Incorrect password." });
    await loaded();
    await userEvent.type(noteBox(), "Friend one");
    await submit();
    expect(await screen.findByText("Incorrect password.")).toBeTruthy();
    expect(passwordBox().value).toBe("");
    expect(passwordBox().getAttribute("aria-invalid")).toBe("true");
    expect(noteBox().value).toBe("Friend one");
    await waitFor(() => expect(document.activeElement).toBe(passwordBox()));
    expect(screen.queryByRole("heading", { name: "New code, shown once" })).toBeNull();
  });

  it("a 403 that is not a wrong password (Origin check) is a banner", async () => {
    handlers[CREATE] = () => json(403, { detail: "Cross-site request blocked." });
    await loaded();
    await submit();
    expect((await waitForBanner()).textContent).toContain("This request was blocked. Reload the page and try again.");
    expect(screen.queryByText("Incorrect password.")).toBeNull();
    expect(passwordBox().value).toBe("");
  });

  it("a 409 shows the API detail in a banner", async () => {
    const detail = "There are already 50 unused invites. Revoke one or wait for one to expire.";
    handlers[CREATE] = () => json(409, { detail });
    await loaded();
    await userEvent.type(noteBox(), "Keep me");
    await submit();
    expect((await waitForBanner()).textContent).toContain(detail);
    expect(passwordBox().value).toBe("");
    expect(noteBox().value).toBe("Keep me");
    await waitFor(() => expect(document.activeElement).toBe(passwordBox()));
  });

  it("a 429 and a 500 show banners", async () => {
    handlers[CREATE] = () => json(429, { detail: "Too many attempts." }, { "Retry-After": "120" });
    await loaded();
    await submit();
    expect((await waitForBanner()).textContent).toContain("Try again in about 2 minutes.");
    handlers[CREATE] = () => json(500, { detail: "x" });
    await submit();
    await waitFor(() => expect(banner()?.textContent).toContain("Talaan isn't responding"));
  });

  it("a 422 maps to its field and focuses it", async () => {
    handlers[CREATE] = () => json(422, { detail: [{ loc: ["body", "note"], msg: "String should have at most 200 characters" }] });
    await loaded();
    await userEvent.type(noteBox(), "Friend one");
    await submit();
    expect(await screen.findByText("String should have at most 200 characters")).toBeTruthy();
    expect(noteBox().getAttribute("aria-invalid")).toBe("true");
    expect(passwordBox().value).toBe("");
    expect(banner()).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(noteBox()));
  });

  it("an empty password and a too-long note show inline errors and send nothing", async () => {
    await loaded();
    await userEvent.click(createButton());
    expect(await screen.findByText("Enter your password.")).toBeTruthy();
    expect(document.activeElement).toBe(passwordBox());
    fireEvent.change(noteBox(), { target: { value: `${"é".repeat(200)}` } });
    await userEvent.type(passwordBox(), "Secret1!");
    fireEvent.change(noteBox(), { target: { value: `${"🎉".repeat(201)}` } });
    await userEvent.click(createButton());
    expect(await screen.findByText("Note must be 200 characters or fewer.")).toBeTruthy();
    expect(document.activeElement).toBe(noteBox());
    expect(calls(CREATE)).toHaveLength(0);
  });
});

describe("copy", () => {
  async function created() {
    handlers[CREATE] = () => json(201, { id: 9, code: CODE, note: null, expires_at: "2026-11-28T00:00:00+00:00" });
    await loaded();
    await submit();
    await screen.findByText(CODE);
  }

  it("copies the code and shows a success toast", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    await created();
    await userEvent.click(screen.getByRole("button", { name: "Copy code" }));
    expect(writeText).toHaveBeenCalledWith(CODE);
    expect(await screen.findByText("Code copied.")).toBeTruthy();
  });

  it("without a clipboard API, shows the failure toast and keeps the code", async () => {
    setClipboard(undefined);
    await created();
    await userEvent.click(screen.getByRole("button", { name: "Copy code" }));
    expect(await screen.findByText("Couldn't copy the code. Select it and copy it yourself.")).toBeTruthy();
    expect(screen.getByText(CODE)).toBeTruthy();
  });

  it("a rejected copy shows the failure toast and keeps the code", async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    await created();
    await userEvent.click(screen.getByRole("button", { name: "Copy code" }));
    expect(await screen.findByText("Couldn't copy the code. Select it and copy it yourself.")).toBeTruthy();
    expect(screen.getByText(CODE)).toBeTruthy();
  });
});

describe("revoke", () => {
  const open = async () => {
    handlers[LIST] = () => json(200, { items: [invite({ id: 5 })] });
    await loaded();
    await userEvent.click(await screen.findByRole("button", { name: "Revoke invite, Friend one" }));
  };
  const confirm = () => within(dialog()).getByRole("button", { name: "Revoke invite" }) as HTMLButtonElement;

  it("asks first, and Cancel sends nothing", async () => {
    await open();
    expect(dialog().hasAttribute("open")).toBe(true);
    const d = within(dialog());
    expect(d.getByRole("heading", { name: "Revoke this invite?" })).toBeTruthy();
    expect(d.getByText("The code for Friend one will stop working. This cannot be undone.")).toBeTruthy();
    await userEvent.click(d.getByRole("button", { name: "Cancel" }));
    expect(dialog().hasAttribute("open")).toBe(false);
    expect(calls(revokePath(5))).toHaveLength(0);
  });

  it("names the invite by id when it has no note", async () => {
    handlers[LIST] = () => json(200, { items: [invite({ id: 5, note: null })] });
    await loaded();
    await userEvent.click(await screen.findByRole("button", { name: "Revoke invite 5" }));
    expect(within(dialog()).getByText("The code for invite 5 will stop working. This cannot be undone.")).toBeTruthy();
  });

  it.each([
    ["204", () => json(204)],
    ["404 (already gone)", () => json(404, { detail: "Invite not found." })],
  ])("%s toasts, closes and refreshes", async (_n, reply) => {
    handlers[revokePath(5)] = reply;
    await open();
    handlers[LIST] = () => json(200, { items: [] });
    await userEvent.click(confirm());
    expect(await screen.findByText("Invite revoked.")).toBeTruthy();
    await waitFor(() => expect(dialog().hasAttribute("open")).toBe(false));
    expect(await screen.findByText("No invites yet.")).toBeTruthy();
    expect(calls(LIST)).toHaveLength(2);
  });

  it("409 closes the dialog, toasts that the invite was used and refreshes", async () => {
    handlers[revokePath(5)] = () => json(409, { detail: "This invite has been used and cannot be revoked." });
    await open();
    handlers[LIST] = () => json(200, { items: [invite({ id: 5, status: "used", used_at: "2026-11-22T10:00:00+00:00", used_by_account_name: "Ana Cruz" })] });
    await userEvent.click(confirm());
    expect(await screen.findByText("This invite was used, so it cannot be revoked.")).toBeTruthy();
    await waitFor(() => expect(dialog().hasAttribute("open")).toBe(false));
    expect(await screen.findByText("Used on Nov 22, 2026 by Ana Cruz")).toBeTruthy();
  });

  it("another failure keeps the dialog open with an error toast and does not refresh", async () => {
    handlers[revokePath(5)] = () => json(500, { detail: "x" });
    await open();
    await userEvent.click(confirm());
    expect(await screen.findByText("Talaan isn't responding right now. Try again in a moment.")).toBeTruthy();
    expect(dialog().hasAttribute("open")).toBe(true);
    expect(confirm().disabled).toBe(false);
    expect(calls(LIST)).toHaveLength(1);
  });

  it("while busy the buttons are disabled and a second click sends one request", async () => {
    const d = deferred();
    handlers[revokePath(5)] = () => d.promise;
    await open();
    await userEvent.dblClick(confirm());
    expect(calls(revokePath(5))).toHaveLength(1);
    expect(confirm().disabled).toBe(true);
    await act(async () => d.resolve(json(204)));
    await screen.findByText("Invite revoked.");
  });
});
