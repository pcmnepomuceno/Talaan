// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { LoginForm } from "../src/app/login/login-form";

it("empty log in shows inline errors, marks fields invalid, focuses the first, never calls fetch", async () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  render(<LoginForm />);
  await userEvent.click(screen.getByRole("button", { name: "Log in" }));
  expect(screen.getByText("Enter your email.")).toBeTruthy();
  expect(screen.getByText("Enter your password.")).toBeTruthy();
  const email = screen.getByLabelText("Email");
  expect(email.getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement).toBe(email);
  expect(fetch).not.toHaveBeenCalled();
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

it("switching mode clears errors", async () => {
  render(<LoginForm />);
  await userEvent.click(screen.getByRole("button", { name: "Log in" }));
  await userEvent.click(screen.getByRole("radio", { name: "Create account" }));
  expect(screen.queryByText("Enter your email.")).toBeNull();
});

it("valid log in does nothing (not wired)", async () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  render(<LoginForm />);
  await userEvent.type(screen.getByLabelText("Email"), "a@example.ph");
  await userEvent.type(screen.getByLabelText("Password"), "x");
  await userEvent.click(screen.getByRole("button", { name: "Log in" }));
  expect(document.querySelector('[aria-invalid="true"]')).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
