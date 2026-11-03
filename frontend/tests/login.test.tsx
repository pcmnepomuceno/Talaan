// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "../src/app/login/login-form";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const json = (status: number, body?: unknown, headers?: Record<string, string>) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
type Handler = () => Response | Promise<Response>;
const ME = "/api/v1/me";
const LOGIN = "/api/v1/login";
const SIGNUP = "/api/v1/signup";

let handlers: Record<string, Handler>;
function calls(path: string) {
  return vi.mocked(globalThis.fetch).mock.calls.filter(([p]) => p === path);
}
function deferred() {
  let resolve!: (r: Response) => void;
  const promise = new Promise<Response>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  router.replace.mockClear();
  router.refresh.mockClear();
  handlers = { [ME]: () => json(401, { detail: "Not authenticated" }) };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const h = handlers[String(input)];
    if (!h) throw new Error(`unexpected fetch ${String(input)}`);
    return h();
  });
});
afterEach(() => vi.restoreAllMocks());

async function fillLogin(email = "a@example.ph", password = "Secret1!") {
  await userEvent.type(screen.getByLabelText("Email"), email);
  await userEvent.type(screen.getByLabelText("Password"), password);
}
const submitLogin = () => userEvent.click(screen.getByRole("button", { name: /^Log in|Logging in/ }));

describe("shell", () => {
  it("empty log in shows inline errors, marks fields invalid, focuses the first, never posts", async () => {
    render(<LoginForm />);
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(screen.getByText("Enter your email.")).toBeTruthy();
    expect(screen.getByText("Enter your password.")).toBeTruthy();
    const email = screen.getByLabelText("Email");
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(email);
    expect(calls(LOGIN)).toHaveLength(0);
  });

  it("Create account fields are in order: invite code, account name, email, password", async () => {
    render(<LoginForm />);
    await userEvent.click(screen.getByRole("radio", { name: "Create account" }));
    const labels = [...document.querySelectorAll("form label")].map((l) => l.textContent);
    expect(labels.filter((t) => !/Required|Show|Hide/.test(t ?? ""))).toEqual([
      "Invite code",
      "Account name",
      "Email",
      "Password",
    ]);
    expect(screen.getByText("Access is by invitation for now.")).toBeTruthy();
  });

  it("log in autocomplete: email is the username, current password", () => {
    render(<LoginForm />);
    expect(screen.getByLabelText("Email").getAttribute("autocomplete")).toBe("username");
    expect(screen.getByLabelText("Password").getAttribute("autocomplete")).toBe("current-password");
  });

  it("switching mode clears errors", async () => {
    render(<LoginForm />);
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));
    await userEvent.click(screen.getByRole("radio", { name: "Create account" }));
    expect(screen.queryByText("Enter your email.")).toBeNull();
  });

  it("band and form column share max width and gutter (same left edge)", () => {
    render(<LoginForm />);
    const band = document.querySelector("header > div")!;
    const form = document.querySelector("main")!;
    for (const c of ["max-w-[440px]", "px-4", "mx-auto"]) {
      expect(band.className).toContain(c);
      expect(form.className).toContain(c);
    }
  });

  it("switching mode keeps the email and clears the password", async () => {
    render(<LoginForm />);
    await fillLogin("a@example.ph", "Secret1!");
    await userEvent.click(screen.getByRole("radio", { name: "Create account" }));
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("a@example.ph");
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
    await userEvent.click(screen.getByRole("radio", { name: "Log in" }));
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("a@example.ph");
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
  });
});

describe("notices and the /me probe", () => {
  it("shows the expired and deleted notices", () => {
    const { unmount } = render(<LoginForm expired />);
    expect(screen.getByRole("status").textContent).toBe("Your session expired. Log in again.");
    unmount();
    render(<LoginForm deleted />);
    expect(screen.getByRole("status").textContent).toBe("Your account has been deleted.");
  });

  it("an existing session skips the form: /me 200 replaces to next, else /applications", async () => {
    handlers[ME] = () => json(200, { id: 1, email: "a@example.ph", account_name: "Ana" });
    const { unmount } = render(<LoginForm next="/applications/3?status=saved" />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/applications/3?status=saved"));
    unmount();
    router.replace.mockClear();
    render(<LoginForm next="//evil.com" />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/applications"));
  });

  it("/me 200 with a non-JSON body is not treated as logged in", async () => {
    handlers[ME] = () => new Response("<html>not the API</html>", { status: 200, headers: { "Content-Type": "text/html" } });
    render(<LoginForm />);
    await waitFor(() => expect(calls(ME)).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 10));
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Email")).toBeTruthy();
  });

  it("/me 401 shows the form and navigates nowhere (no loop)", async () => {
    render(<LoginForm expired />);
    await waitFor(() => expect(calls(ME)).toHaveLength(1));
    expect(calls(ME)[0][1]?.method).toBe("GET");
    await new Promise((r) => setTimeout(r, 10));
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Email")).toBeTruthy();
  });
});

describe("log in", () => {
  it("success posts credentials, replaces to a validated next, then refreshes", async () => {
    handlers[LOGIN] = () => json(200, { detail: "Logged in" });
    render(<LoginForm next="/account" />);
    await fillLogin();
    await submitLogin();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/account"));
    expect(router.refresh).toHaveBeenCalled();
    expect(calls(LOGIN)[0][1]?.body).toBe(JSON.stringify({ email: "a@example.ph", password: "Secret1!" }));
  });

  it.each(["https://evil.com", "//evil.com", "/\\evil.com", undefined])("bad next %j goes to /applications", async (n) => {
    handlers[LOGIN] = () => json(200, { detail: "Logged in" });
    render(<LoginForm next={n} />);
    await fillLogin();
    await submitLogin();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/applications"));
  });

  it("401 is one form-level error, not per field; clears only the password", async () => {
    handlers[LOGIN] = () => json(401, { detail: "Invalid email or password." });
    render(<LoginForm />);
    await fillLogin();
    await submitLogin();
    expect((await screen.findByRole("alert")).textContent).toContain("Invalid email or password.");
    expect(document.querySelector('[aria-invalid="true"]')).toBeNull();
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("a@example.ph");
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
    expect(document.activeElement).toBe(screen.getByLabelText("Password"));
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("429 says how many minutes, rounded up", async () => {
    handlers[LOGIN] = () => json(429, { detail: "Too many attempts. Try again later." }, { "Retry-After": "601" });
    render(<LoginForm />);
    await fillLogin();
    await submitLogin();
    expect((await screen.findByRole("alert")).textContent).toContain("Too many attempts. Try again in about 11 minutes.");
  });

  it("503 and a network error give a retryable message, and the form can be resubmitted", async () => {
    handlers[LOGIN] = () => json(503, { detail: "Service temporarily unavailable." });
    render(<LoginForm />);
    await fillLogin();
    await submitLogin();
    expect((await screen.findByRole("alert")).textContent).toContain("Talaan isn't responding right now");
    handlers[LOGIN] = () => {
      throw new TypeError("Failed to fetch");
    };
    await userEvent.type(screen.getByLabelText("Password"), "Secret1!");
    await submitLogin();
    await waitFor(() => expect(calls(LOGIN)).toHaveLength(2));
    expect((await screen.findByRole("alert")).textContent).toContain("Talaan isn't responding right now");
    expect((screen.getByRole("button", { name: "Log in" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("403 (Origin check) is a blocked-request banner, never wrong credentials", async () => {
    handlers[LOGIN] = () => json(403, { detail: "Cross-site request blocked." });
    render(<LoginForm />);
    await fillLogin();
    await submitLogin();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("This request was blocked. Reload the page and try again.");
    expect(alert.textContent).not.toContain("Invalid email or password.");
  });

  it("422 maps to the field", async () => {
    handlers[LOGIN] = () => json(422, { detail: [{ loc: ["body", "email"], msg: "value is not a valid email address" }] });
    render(<LoginForm />);
    await fillLogin("nope");
    await submitLogin();
    expect(await screen.findByText("value is not a valid email address")).toBeTruthy();
    expect(screen.getByLabelText("Email").getAttribute("aria-invalid")).toBe("true");
  });

  it("busy: disabled, labelled, and a double click or double Enter sends one request", async () => {
    const d = deferred();
    handlers[LOGIN] = () => d.promise;
    render(<LoginForm />);
    await fillLogin();
    await userEvent.dblClick(screen.getByRole("button", { name: "Log in" }));
    const busyButton = screen.getByRole("button", { name: "Logging in…" }) as HTMLButtonElement;
    expect(busyButton.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText("Email"), "{Enter}{Enter}");
    expect(calls(LOGIN)).toHaveLength(1);
    d.resolve(json(401, { detail: "Invalid email or password." }));
    await screen.findByRole("alert");
    expect((screen.getByRole("button", { name: "Log in" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("create account", () => {
  async function openSignup() {
    render(<LoginForm />);
    await userEvent.click(screen.getByRole("radio", { name: "Create account" }));
  }
  async function fillSignup() {
    await userEvent.type(screen.getByLabelText("Invite code"), "tln-abcd-efgh-jkmn");
    await userEvent.type(screen.getByLabelText("Account name"), "Ana");
    await userEvent.type(screen.getByLabelText("Email"), "a@example.ph");
    await userEvent.type(screen.getByLabelText("Password"), "Secret1!");
  }
  const submitSignup = () => userEvent.click(screen.getByRole("button", { name: /^Create account$|Creating account/ }));
  const user = { id: 1, email: "a@example.ph", account_name: "Ana" };

  it("invite input attributes, hint and autocomplete values", async () => {
    await openSignup();
    const invite = screen.getByLabelText("Invite code");
    expect(invite.getAttribute("spellcheck")).toBe("false");
    expect(invite.getAttribute("autocapitalize")).toBe("characters");
    expect(invite.getAttribute("autocomplete")).toBe("off");
    expect(screen.getByText("Paste the code you were given; dashes are optional")).toBeTruthy();
    // Password managers save the "username" field as the login; that must be the email, not the name.
    expect(screen.getByLabelText("Account name").getAttribute("autocomplete")).toBe("nickname");
    expect(screen.getByLabelText("Email").getAttribute("autocomplete")).toBe("username");
    expect(screen.getByLabelText("Password").getAttribute("autocomplete")).toBe("new-password");
  });

  it("signs up, then logs in with the same credentials, then navigates", async () => {
    handlers[SIGNUP] = () => json(200, user);
    handlers[LOGIN] = () => json(200, { detail: "Logged in" });
    await openSignup();
    await fillSignup();
    await submitSignup();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/applications"));
    expect(router.refresh).toHaveBeenCalled();
    expect(JSON.parse(String(calls(SIGNUP)[0][1]?.body))).toEqual({
      invite_code: "tln-abcd-efgh-jkmn",
      account_name: "Ana",
      email: "a@example.ph",
      password: "Secret1!",
    });
    expect(JSON.parse(String(calls(LOGIN)[0][1]?.body))).toEqual({ email: "a@example.ph", password: "Secret1!" });
  });

  it("if the login after signup fails, falls back to Log in with a notice and the email kept", async () => {
    handlers[SIGNUP] = () => json(200, user);
    handlers[LOGIN] = () => json(503, { detail: "Service temporarily unavailable." });
    await openSignup();
    await fillSignup();
    await submitSignup();
    expect((await screen.findByRole("status")).textContent).toBe("Account created. Log in to continue.");
    expect((screen.getByRole("radio", { name: "Log in" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("a@example.ph");
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("invalid invite (400) lands on the invite field", async () => {
    handlers[SIGNUP] = () => json(400, { detail: "Invalid or expired invite code." });
    await openSignup();
    await fillSignup();
    await submitSignup();
    expect(await screen.findByText("Invalid or expired invite code.")).toBeTruthy();
    expect(screen.getByLabelText("Invite code").getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(screen.getByLabelText("Invite code"));
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Account name") as HTMLInputElement).value).toBe("Ana");
    expect(calls(LOGIN)).toHaveLength(0);
  });

  it("email exists (400) lands on the email field", async () => {
    handlers[SIGNUP] = () => json(400, { detail: "Email already exists." });
    await openSignup();
    await fillSignup();
    await submitSignup();
    expect(await screen.findByText("Email already exists.")).toBeTruthy();
    expect(screen.getByLabelText("Email").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Invite code").getAttribute("aria-invalid")).toBeNull();
  });

  it("any other 400 is a generic banner, never an invite-code error", async () => {
    handlers[SIGNUP] = () => json(400, { detail: "Something new the backend says." });
    await openSignup();
    await fillSignup();
    await submitSignup();
    expect((await screen.findByRole("alert")).textContent).toContain("Something went wrong. Try again.");
    expect(screen.queryByText("Invalid or expired invite code.")).toBeNull();
    expect(document.querySelector('[aria-invalid="true"]')).toBeNull();
  });

  it("422 maps each message to its field, including the 72-byte password rule", async () => {
    handlers[SIGNUP] = () =>
      json(422, {
        detail: [
          { loc: ["body", "password"], msg: "Value error, Password must be at most 72 bytes long." },
          { loc: ["body", "email"], msg: "value is not a valid email address" },
        ],
      });
    await openSignup();
    await fillSignup();
    await submitSignup();
    expect(await screen.findByText("Password must be at most 72 bytes long.")).toBeTruthy();
    expect(screen.getByText("value is not a valid email address")).toBeTruthy();
    expect(screen.getByLabelText("Password").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Email").getAttribute("aria-invalid")).toBe("true");
  });

  it("429 and 503 are form-level messages", async () => {
    handlers[SIGNUP] = () => json(429, { detail: "Too many attempts. Try again later." }, { "Retry-After": "3000" });
    await openSignup();
    await fillSignup();
    await submitSignup();
    expect((await screen.findByRole("alert")).textContent).toContain("Try again in about 50 minutes.");
    handlers[SIGNUP] = () => json(503, { detail: "Service temporarily unavailable." });
    await userEvent.type(screen.getByLabelText("Password"), "Secret1!");
    await submitSignup();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Talaan isn't responding"));
  });

  it("403 (Origin check) is a blocked-request banner, not a field error", async () => {
    handlers[SIGNUP] = () => json(403, { detail: "Cross-site request blocked." });
    await openSignup();
    await fillSignup();
    await submitSignup();
    expect((await screen.findByRole("alert")).textContent).toContain("This request was blocked. Reload the page and try again.");
    expect(document.querySelector('[aria-invalid="true"]')).toBeNull();
  });

  it("busy state and a double click send one signup", async () => {
    const d = deferred();
    handlers[SIGNUP] = () => d.promise;
    await openSignup();
    await fillSignup();
    await userEvent.dblClick(screen.getByRole("button", { name: "Create account" }));
    expect((screen.getByRole("button", { name: "Creating account…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(calls(SIGNUP)).toHaveLength(1);
    d.resolve(json(400, { detail: "Invalid or expired invite code." }));
    await screen.findByText("Invalid or expired invite code.");
  });
});
