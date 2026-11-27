// @vitest-environment jsdom
// The token and code here are fake; assertions on them are still booleans so no failure message prints them.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { metadata } from "../src/app/request/page";
import { RequestScreen } from "../src/app/request/request-screen";
import { ToastProvider } from "../src/components/toast";

const TOKEN = "fake-status-token";
const CODE = "TLN-TEST-AAAA-BBBB";
const CREATE = "/api/v1/invite-requests";
const STATUS = "/api/v1/invite-requests/status";
const json = (status: number, body?: unknown, headers?: Record<string, string>) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers });

let answer: (path: string) => Response | Promise<Response>;
const posts = (path: string) => vi.mocked(globalThis.fetch).mock.calls.filter(([p]) => String(p) === path);
const sent = (path: string, call = 0) => JSON.parse(String(posts(path)[call][1]?.body));
const page = () => document.body.textContent ?? "";
// Our banner, not the toast region (also role="alert", outside main).
const banner = () => waitFor(() => document.querySelector("main [role=alert]")!.textContent);
const setClipboard = (value: unknown) => Object.defineProperty(navigator, "clipboard", { value, configurable: true });

const mount = (strict = false) => {
  const tree = (
    <ToastProvider>
      <RequestScreen />
    </ToastProvider>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
};

beforeEach(() => {
  window.history.replaceState(null, "", "/request");
  window.localStorage.clear();
  window.sessionStorage.clear();
  answer = (path) => (path === CREATE ? json(201, { token: TOKEN }) : json(200, { state: "pending" }));
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => answer(String(input)));
});
afterEach(() => {
  vi.restoreAllMocks();
  setClipboard(undefined);
});

const contact = () => screen.getByLabelText("Contact") as HTMLInputElement;
const note = () => screen.getByLabelText("Why you want access") as HTMLTextAreaElement;
const honeypot = () => document.querySelector<HTMLInputElement>('input[name="website"]')!;
const sendButton = () => screen.getByRole("button", { name: /Send request|Sending/ }) as HTMLButtonElement;
async function submit(who = "ana@example.ph", why = "From the meetup") {
  if (who) await userEvent.type(contact(), who);
  if (why) await userEvent.type(note(), why);
  await userEvent.click(sendButton());
}
const noTrace = () => {
  const stored = JSON.stringify([{ ...window.localStorage }, { ...window.sessionStorage }]);
  return !stored.includes(TOKEN) && !stored.includes(CODE) && !window.location.href.includes(TOKEN);
};

describe("request page", () => {
  it("sets a no-referrer policy and its title", () => {
    expect(metadata.title).toBe("Request an invite");
    expect(metadata.referrer).toBe("no-referrer");
  });
});

describe("request form", () => {
  it("has no native validation and a honeypot nobody can see or tab to", () => {
    mount();
    expect(document.querySelector("form")!.noValidate).toBe(true);
    const trap = honeypot();
    expect(trap.tabIndex).toBe(-1);
    expect(trap.getAttribute("autocomplete")).toBe("off");
    const wrapper = trap.parentElement!;
    expect(wrapper.getAttribute("aria-hidden")).toBe("true");
    expect(wrapper.className.includes("absolute") && wrapper.className.includes("-left-[9999px]")).toBe(true);
  });

  it("empty and blank fields are inline errors and nothing is sent", async () => {
    mount();
    await submit("   ", "");
    expect(screen.getByText("Enter how to reach you.")).toBeTruthy();
    expect(screen.getByText("Tell us why you want access.")).toBeTruthy();
    expect(document.activeElement).toBe(contact());
    expect(posts(CREATE)).toHaveLength(0);
  });

  it("too-long fields are inline errors, counted in code points", async () => {
    mount();
    fireEvent.change(contact(), { target: { value: "\u{1F600}".repeat(201) } });
    fireEvent.change(note(), { target: { value: "n".repeat(1001) } });
    await userEvent.click(sendButton());
    expect(screen.getByText("Contact must be 200 characters or fewer.")).toBeTruthy();
    expect(screen.getByText("Keep it to 1000 characters or fewer.")).toBeTruthy();
    expect(posts(CREATE)).toHaveLength(0);
    fireEvent.change(contact(), { target: { value: "\u{1F600}".repeat(200) } });
    fireEvent.change(note(), { target: { value: "n".repeat(1000) } });
    await userEvent.click(sendButton());
    await waitFor(() => expect(posts(CREATE)).toHaveLength(1));
  });

  it("sends contact, note and the honeypot as website, then shows the private link once", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mount();
    fireEvent.change(honeypot(), { target: { value: "bot" } });
    await submit("  ana@example.ph  ");
    expect(await screen.findByRole("heading", { name: "Save this link" })).toBeTruthy();
    expect(sent(CREATE)).toEqual({ contact: "ana@example.ph", note: "From the meetup", website: "bot" });
    const link = document.querySelector("p.select-all")!;
    expect(link.textContent === `${window.location.origin}/request#${TOKEN}`).toBe(true);
    expect(screen.queryByLabelText("Contact")).toBeNull();
    setClipboard({ writeText });
    await userEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(await screen.findByText("Link copied.")).toBeTruthy();
    expect(writeText.mock.calls[0][0] === `${window.location.origin}/request#${TOKEN}`).toBe(true);
    expect(noTrace()).toBe(true);
  });

  it("a double submit sends one request", async () => {
    answer = () => new Promise<Response>(() => {});
    mount();
    await userEvent.type(contact(), "a");
    await userEvent.type(note(), "b");
    const form = document.querySelector("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(posts(CREATE)).toHaveLength(1);
    expect(sendButton().disabled).toBe(true);
  });

  it.each([
    [json(409, { detail: "Requests are closed right now." }), "Requests are closed right now."],
    [json(429, { detail: "x" }, { "Retry-After": "120" }), "Too many attempts. Try again in about 2 minutes."],
    [json(503, { detail: "x" }), "Talaan isn't responding right now. Try again in a moment."],
  ])("shows a failed send as a banner and keeps the fields", async (response, message) => {
    answer = () => response;
    mount();
    await submit();
    expect(await banner()).toContain(message);
    expect([contact().value, note().value]).toEqual(["ana@example.ph", "From the meetup"]);
    expect(sendButton().disabled).toBe(false);
  });

  it("a 422 lands on its field", async () => {
    answer = () => json(422, { detail: [{ loc: ["body", "contact"], msg: "Value error, Must not contain null characters." }] });
    mount();
    await submit();
    expect(await screen.findByText("Must not contain null characters.")).toBeTruthy();
    expect(contact().getAttribute("aria-invalid")).toBe("true");
  });

  it("does not take the Skip to content fragment for a token", async () => {
    window.history.replaceState(null, "", "/request#content");
    mount();
    expect(contact()).toBeTruthy();
    expect(posts(STATUS)).toHaveLength(0);
  });
});

describe("status link", () => {
  beforeEach(() => window.history.replaceState(null, "", `/request#${TOKEN}`));

  it("reads the token once, strips it and checks exactly once under StrictMode", async () => {
    mount(true);
    expect(await screen.findByText("Still waiting.")).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    expect(posts(STATUS)).toHaveLength(1);
    expect(sent(STATUS).token === TOKEN).toBe(true);
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/request");
    expect(page().includes(TOKEN)).toBe(false);
    expect(noTrace()).toBe(true);
  });

  it("Check again asks once more while pending", async () => {
    mount();
    await screen.findByText("Still waiting.");
    answer = () => json(200, { state: "rejected" });
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Not approved right now.")).toBeTruthy();
    expect(posts(STATUS)).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();
  });

  it("approved shows the code once, with copy and the way to sign up", async () => {
    answer = () => json(200, { state: "approved", code: CODE });
    const writeText = vi.fn().mockResolvedValue(undefined);
    mount(true);
    expect(await screen.findByText("Shown once. Copy it now, then create your account.")).toBeTruthy();
    expect(document.querySelector("p.select-all")!.textContent === CODE).toBe(true);
    expect(screen.getByRole("link", { name: "Create your account" }).getAttribute("href")).toBe("/login");
    // A screen reader must not read the code out on its own: it is in no live region.
    const live = [...document.querySelectorAll('[role="status"], [role="alert"], [aria-live]')];
    expect(live.some((el) => el.textContent?.includes(CODE))).toBe(false);
    setClipboard({ writeText });
    await userEvent.click(screen.getByRole("button", { name: "Copy code" }));
    expect(await screen.findByText("Code copied.")).toBeTruthy();
    expect(writeText.mock.calls[0][0] === CODE).toBe(true);
    expect(posts(STATUS)).toHaveLength(1);
    expect(noTrace()).toBe(true);
  });

  it("shown says the code was already shown and what to do if it was not saved", async () => {
    answer = () => json(200, { state: "shown" });
    mount();
    expect(await screen.findByText("The code was already shown.")).toBeTruthy();
    expect(screen.getByText("If you didn't save it, ask the person who runs Talaan for a new code.")).toBeTruthy();
  });

  it.each([
    ["expired", json(200, { state: "expired" }), "This code has expired. Request a new one."],
    ["invalid", json(400, { detail: "Invalid or expired request link." }), "Invalid or expired request link."],
  ])("%s offers the form again", async (_, response, message) => {
    answer = () => response;
    mount();
    expect(await screen.findByText(message)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Request an invite" }));
    expect(contact()).toBeTruthy();
  });

  it("a rate limit is a banner and Check again retries", async () => {
    answer = () => json(429, { detail: "x" }, { "Retry-After": "60" });
    mount();
    expect(await banner()).toContain("Too many attempts. Try again in about 1 minute.");
    answer = () => json(200, { state: "pending" });
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Still waiting.")).toBeTruthy();
  });

  it("takes a second link pasted into the same tab", async () => {
    mount();
    await screen.findByText("Still waiting.");
    window.location.hash = "fake-second-token";
    await waitFor(() => expect(posts(STATUS)).toHaveLength(2));
    expect(sent(STATUS, 1).token === "fake-second-token").toBe(true);
    expect(window.location.hash).toBe("");
  });
});
