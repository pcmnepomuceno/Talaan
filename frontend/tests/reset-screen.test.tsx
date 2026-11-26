// @vitest-environment jsdom
// The token here is fake; assertions about it are still reduced to booleans so no failure message prints it.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { metadata } from "../src/app/reset/page";
import { ResetForm } from "../src/app/reset/reset-form";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const TOKEN = "fake-reset-token";
const PATH = "/api/v1/auth/reset-password";
const DEAD = "This reset link is invalid or has expired. Ask for a new one.";
const OPEN_AGAIN = "Open your reset link again to set a new password. If it no longer works, ask for a new one.";
const json = (status: number, body?: unknown, headers?: Record<string, string>) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers });

let answer: () => Response;
const posts = () => vi.mocked(globalThis.fetch).mock.calls;
const sentToken = (call = 0) => JSON.parse(String(posts()[call][1]?.body)).token === TOKEN;
const page = () => document.body.textContent ?? "";

beforeEach(() => {
  router.replace.mockClear();
  window.history.replaceState(null, "", `/reset#${TOKEN}`);
  answer = () => new Response(null, { status: 204 });
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => answer());
});
afterEach(() => vi.restoreAllMocks());

const newBox = () => screen.getByLabelText("New password") as HTMLInputElement;
const confirmBox = () => screen.getByLabelText("Confirm password") as HTMLInputElement;
async function submit(password = "N3w!Passw0rd", confirm = password) {
  if (password) await userEvent.type(newBox(), password);
  if (confirm) await userEvent.type(confirmBox(), confirm);
  await userEvent.click(screen.getByRole("button", { name: "Set new password" }));
}

describe("reset form", () => {
  it("sets a no-referrer policy and its title", () => {
    expect(metadata.title).toBe("Reset password");
    expect(metadata.referrer).toBe("no-referrer");
  });

  it("reads the token from the fragment, strips it and posts it in the body only", async () => {
    render(<ResetForm />);
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/reset");
    await submit();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login?reset=1"));
    expect(posts()).toHaveLength(1);
    expect(String(posts()[0][0])).toBe(PATH);
    expect(posts()[0][1]?.method).toBe("POST");
    expect(sentToken()).toBe(true);
    expect(JSON.parse(String(posts()[0][1]?.body)).new_password).toBe("N3w!Passw0rd");
    expect(page().includes(TOKEN)).toBe(false);
  });

  it("keeps the token when the effect runs twice (StrictMode)", async () => {
    render(
      <StrictMode>
        <ResetForm />
      </StrictMode>,
    );
    expect(screen.queryByText(DEAD)).toBeNull();
    await submit();
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(sentToken()).toBe(true);
  });

  it("takes a second link pasted into the same tab", async () => {
    window.history.replaceState(null, "", "/reset#fake-old-token");
    render(<ResetForm />);
    window.location.hash = TOKEN;
    await waitFor(() => expect(window.location.hash).toBe(""));
    await submit();
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(sentToken()).toBe(true);
  });

  it("does not take the Skip to content fragment for a token", async () => {
    render(<ResetForm />);
    window.location.hash = "content";
    await new Promise((r) => setTimeout(r, 20)); // jsdom fires hashchange asynchronously
    await submit();
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(sentToken()).toBe(true);
  });

  it("without a token asks to open the link again, not that the link is dead", () => {
    window.history.replaceState(null, "", "/reset");
    render(<ResetForm />);
    expect(screen.getByRole("alert").textContent).toContain(OPEN_AGAIN);
    expect(page().includes(DEAD)).toBe(false);
    expect(screen.queryByLabelText("New password")).toBeNull();
    expect(screen.getByRole("link", { name: "Back to log in" })).toBeTruthy();
  });

  it("with a token (StrictMode) shows the form and neither message", () => {
    render(
      <StrictMode>
        <ResetForm />
      </StrictMode>,
    );
    expect(screen.getByLabelText("New password")).toBeTruthy();
    expect(page().includes(OPEN_AGAIN)).toBe(false);
    expect(page().includes(DEAD)).toBe(false);
  });

  it("a reload after the fragment was stripped asks to open the link again", () => {
    const first = render(<ResetForm />);
    expect(window.location.hash).toBe("");
    first.unmount();
    render(<ResetForm />); // the URL is /reset now, as after a reload
    expect(screen.getByRole("alert").textContent).toContain(OPEN_AGAIN);
    expect(page().includes(DEAD)).toBe(false);
  });

  it("empty fields and a mismatch are inline errors and nothing is sent", async () => {
    render(<ResetForm />);
    expect(document.querySelector("form")!.noValidate).toBe(true);
    await submit("", "");
    expect(screen.getByText("Enter a new password.")).toBeTruthy();
    expect(screen.getByText("Confirm your new password.")).toBeTruthy();
    expect(document.activeElement).toBe(newBox());
    await submit("N3w!Passw0rd", "N3w!Passw0rx");
    expect(screen.getByText("Passwords do not match.")).toBeTruthy();
    expect(document.activeElement).toBe(confirmBox());
    expect(posts()).toHaveLength(0);
  });

  it("shows the server's password rule on the field and keeps the token for another try", async () => {
    answer = () =>
      json(422, { detail: [{ loc: ["body", "new_password"], msg: "Value error, Password must be at least 8 characters long.", input: null }] });
    render(<ResetForm />);
    await submit("weak");
    expect(await screen.findByText("Password must be at least 8 characters long.")).toBeTruthy();
    expect(newBox().getAttribute("aria-invalid")).toBe("true");
    expect(page().includes(TOKEN)).toBe(false);
    answer = () => new Response(null, { status: 204 });
    await userEvent.clear(newBox());
    await userEvent.clear(confirmBox());
    await submit();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login?reset=1"));
    expect(sentToken(1)).toBe(true);
  });

  it("a 400 replaces the form with the generic error", async () => {
    answer = () => json(400, { detail: "Invalid or expired reset link." });
    render(<ResetForm />);
    await submit();
    expect((await screen.findByRole("alert")).textContent).toContain(DEAD);
    expect(page().includes(OPEN_AGAIN)).toBe(false);
    expect(screen.queryByLabelText("New password")).toBeNull();
    expect(page().includes(TOKEN)).toBe(false);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it.each([
    [429, { "Retry-After": "120" }, "Too many attempts. Try again in about 2 minutes."],
    [503, undefined, "Talaan isn't responding right now. Try again in a moment."],
  ])("a %i is a banner and the form stays", async (status, headers, message) => {
    answer = () => json(status, { detail: "x" }, headers);
    render(<ResetForm />);
    await submit();
    expect((await screen.findByRole("alert")).textContent).toContain(message);
    expect(newBox()).toBeTruthy();
    expect(page().includes(TOKEN)).toBe(false);
  });
});
