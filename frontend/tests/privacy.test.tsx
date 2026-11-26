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

  it("describes password reset links: what is stored, for how long, and what using one does", () => {
    render(<PrivacyPage />);
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toContain(
      "Password reset links: a hash of the link's token, which account it is for and which admin made it, and when it was created, expires and was used.",
    );
    expect(items).toContain(
      "Attempt limits: records of attempts to sign up, log in, delete an account, create an invite, create a password reset link or reset a password. A record has a time and one of these: the IP address in plain text (an IPv6 address is cut to its /64 network), a one-way hash of the email address, or the account number.",
    );
    expect(items).toContain(
      "A cleanup scheduled to run daily deletes attempt limit records older than 7 days, expired sessions, and used or expired password reset links created more than 7 days ago.",
    );
    expect(items).toContain(
      "To delete your account, go to Account and choose Delete account. This permanently removes your account, applications, interviews, sessions and password reset links, and the attempt limit records for your email address and your account deletion attempts.",
    );
    expect(
      screen.getByText(
        "I can create a password reset link for any account. I only do this when the account's owner asks me to. Using a link changes the password and signs the account out of every device. I cannot see your password. An unused link has no effect on your account.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Last updated 26 November 2026")).toBeTruthy();
  });

  it("repeats the popup disclosure and says how the extension signs in", () => {
    render(<PrivacyPage />);
    expect(screen.getByText(DISCLOSURE)).toBeTruthy();
    expect(document.body.textContent).toContain(
      "It signs in with your existing Talaan session cookie and stores nothing of its own.",
    );
  });
});
