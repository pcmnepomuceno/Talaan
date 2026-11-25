// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PrivacyPage, { metadata } from "../src/app/privacy/page";

const DISCLOSURE =
  "Reads this page's link, title and job details when you open Talaan, and sends the link to your Talaan account to check for duplicates. Nothing is saved until you press Save.";

describe("privacy page", () => {
  it("names who runs Talaan, how to reach them and when it was last updated", () => {
    render(<PrivacyPage />);
    expect(metadata.title).toBe("Privacy");
    expect(screen.getByRole("heading", { level: 1, name: "Privacy" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "pcmnepomuceno@gmail.com" }).getAttribute("href")).toBe(
      "mailto:pcmnepomuceno@gmail.com",
    );
    expect(document.body.textContent).toContain("Prince Czedrick Nepomuceno");
    expect(screen.getByText("Last updated 25 November 2026")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to Talaan" }).getAttribute("href")).toBe("/");
  });

  it("repeats the popup disclosure and says how the extension signs in", () => {
    render(<PrivacyPage />);
    expect(screen.getByText(DISCLOSURE)).toBeTruthy();
    expect(document.body.textContent).toContain(
      "It signs in with your existing Talaan session cookie and stores nothing of its own.",
    );
  });
});
