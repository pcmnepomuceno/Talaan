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
    expect(screen.getByText("Last updated 26 November 2026")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to Talaan" }).getAttribute("href")).toBe("/");
  });

  it("says the operator can see the database", () => {
    render(<PrivacyPage />);
    expect(
      screen.getByText(
        "As the operator I have access to the database and can see what is stored. I only look at it to run or fix the service.",
      ),
    ).toBeTruthy();
  });

  it("names Google Forms and says what the feedback form collects", () => {
    render(<PrivacyPage />);
    expect(
      screen.getByText(
        "The feedback form is a Google Form. I don't ask for personal details in it, and it collects no email address automatically. Whatever you type in the box is stored by Google and seen by me. Add a contact only if you want a reply, and never put passwords or other secrets in it. Responses stay in Google Forms until I delete them. The form is anonymous, so I can't tell which response is yours; if you want something removed, email me what you wrote and roughly when.",
      ),
    ).toBeTruthy();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toContain(
      "Google Forms hosts the feedback form linked from Account.",
    );
  });

  it("repeats the popup disclosure and says how the extension signs in", () => {
    render(<PrivacyPage />);
    expect(screen.getByText(DISCLOSURE)).toBeTruthy();
    expect(document.body.textContent).toContain(
      "It signs in with your existing Talaan session cookie and stores nothing of its own.",
    );
  });
});
