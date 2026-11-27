import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/logo";
import { SkipLink } from "@/components/skip-link";

export const metadata: Metadata = { title: "Privacy" };

// Every statement here describes what the code does today. Change the code, change this page and its date.
const EMAIL = "pcmnepomuceno@gmail.com";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 flex flex-col gap-3">
      <h2 className="text-section-title text-text-primary">{title}</h2>
      {children}
    </section>
  );
}

function List({ children }: { children: React.ReactNode }) {
  return <ul className="flex list-disc flex-col gap-2 pl-5">{children}</ul>;
}

export default function PrivacyPage() {
  return (
    <>
      <SkipLink />
      <header className="bg-bar-bg pt-[env(safe-area-inset-top)] text-bar-text">
        <div className="mx-auto max-w-[640px] px-4 py-6">
          <Wordmark variant="on-ink" size={40} />
        </div>
      </header>
      <main
        id="content"
        tabIndex={-1}
        className="mx-auto max-w-[640px] break-words px-4 pt-6 pb-12 text-body text-text-secondary outline-none"
      >
        <h1 className="text-page-title text-text-primary">Privacy</h1>
        <p className="mt-2">Last updated 27 November 2026</p>

        <Section title="Who runs Talaan and how to reach me">
          <p>
            Talaan is a job application tracker, open by invitation only. Prince Czedrick Nepomuceno, a private
            individual in the Philippines, runs it and is responsible for your data.
          </p>
          <p className="flex flex-wrap items-center gap-x-1">
            Contact:
            <a href={`mailto:${EMAIL}`} className="inline-flex min-h-11 items-center text-primary underline">
              {EMAIL}
            </a>
          </p>
        </Section>

        <Section title="What the site stores">
          <List>
            <li>
              Your account: email address, account name and a bcrypt hash of your password. I do not verify email
              addresses.
            </li>
            <li>
              Your applications: company, job title, job posting link (and a hash of it, to spot duplicates), company
              website, contact email, status, salary, work mode, remarks, date applied, and when each was created and
              last updated.
            </li>
            <li>
              Your interviews: interviewer, date and time, mode, outcome, remarks, and when each was created and last
              updated.
            </li>
            <li>
              Sign-in sessions: a hash of the session token, which account it belongs to, and when it was created and
              expires.
            </li>
            <li>
              Invite codes: a hash of the code, a note I write about it, when it was created, expires and was used, and
              which account used it.
            </li>
            <li>
              Password reset links: a hash of the link&apos;s token, which account it is for and which admin made it,
              and when it was created, expires and was used.
            </li>
            <li>
              Attempt limits: records of attempts to sign up, log in, delete an account, create an invite, create a
              password reset link, reset a password, request an invite or check a request. A record has a time and one
              of these: the IP address in plain text (an IPv6 address is cut to its /64 network), a one-way hash of the
              email address, or the account number.
            </li>
            <li>
              Invite requests: how you asked to be reached, why you want access, the status, a hash of your status link&apos;s token, when you asked, when it was decided and when the code was shown, which invite was made, and the invite code until it is shown to you or the cleanup removes it after it expires or is revoked.
            </li>
          </List>
          <p>
            If you request an invite, I see your request on my admin page. Talaan sends no email, so you check the answer with your status link.
          </p>
          <p>
            Apart from the rate-limit records already described on this page, nothing is stored about visitors who do not submit.
          </p>
        </Section>

        <Section title="What the extension reads and when">
          <p>The extension popup says:</p>
          <p>
            Reads this page&apos;s link, title and job details when you open Talaan, and sends the link to your Talaan
            account to check for duplicates. Nothing is saved until you press Save.
          </p>
          <List>
            <li>
              It reads only the tab you are on, as soon as you open it from the toolbar. It never changes the page.
            </li>
            <li>
              It reads the page link and title, the page&apos;s sharing title and its structured data (JSON-LD), of
              which it uses only the job details. On Indeed and LinkedIn job pages it also reads the company link text,
              and on LinkedIn the work mode labels.
            </li>
            <li>
              When you open it, it checks that you are signed in. If you are, it sends the posting link to check for
              duplicates, and may send it again when you leave the link field. The application is sent only when you
              press Save.
            </li>
            <li>It talks only to https://talaan-phi.vercel.app.</li>
            <li>It signs in with your existing Talaan session cookie and stores nothing of its own.</li>
            <li>It has no analytics and runs no code from elsewhere.</li>
          </List>
        </Section>

        <Section title="Where your data goes">
          <List>
            <li>Vercel hosts the website and passes requests, with your IP address, to my server.</li>
            <li>Render runs my server, in Singapore.</li>
            <li>Neon hosts my database, in Singapore.</li>
            <li>GitHub Actions runs the scheduled cleanup against the database.</li>
            <li>Google Forms hosts the feedback form linked from Account.</li>
          </List>
          <p>
            The feedback form is a Google Form. I don&apos;t ask for personal details in it, and it collects no email
            address automatically. Whatever you type in the box is stored by Google and seen by me. Add a contact only
            if you want a reply, and never put passwords or other secrets in it. Responses stay in Google Forms until I
            delete them. The form is anonymous, so I can&apos;t tell which response is yours; if you want something
            removed, email me what you wrote and roughly when.
          </p>
          <p>
            As the operator I have access to the database and can see what is stored. I only look at it to run or fix
            the service.
          </p>
          <p>
            I can create a password reset link for any account. I only do this when the account&apos;s owner asks me
            to. Using a link changes the password and signs the account out of every device. I cannot see your
            password. An unused link has no effect on your account.
          </p>
          <p>
            My server keeps a standard access log (request method, path, status and connecting address) and logs
            warnings and errors. An error report can include values you submitted, such as your email or entries. Vercel
            and Render also keep their own request logs as part of their service, for as long as they decide.
          </p>
        </Section>

        <Section title="What I don't do">
          <List>
            <li>No analytics or trackers.</li>
            <li>No ads, and no sharing with advertisers.</li>
            <li>I do not sell your data.</li>
            <li>I do not send email.</li>
            <li>I send nothing to AI providers.</li>
          </List>
        </Section>

        <Section title="Cookies and browser storage">
          <p>
            Talaan sets one cookie, to keep you signed in. It lasts 30 days, scripts on the page cannot read it, and it
            is sent only over HTTPS.
          </p>
          <p>
            If you choose the light or dark theme, your browser remembers that choice in its local storage. I use no
            other cookies or browser storage.
          </p>
        </Section>

        <Section title="How long I keep it and how to delete it">
          <List>
            <li>
              Applications and interviews stay until you delete them or your account. Logging out ends that session.
            </li>
            <li>
              To delete your account, go to Account and choose Delete account. This permanently removes your account,
              applications, interviews, sessions and password reset links, and the attempt limit records for your email
              address and your account deletion attempts.
            </li>
            <li>
              What stays: the invite code record, still marked as used, with my note but no longer linked to your
              account; and attempt limit records not removed above, such as those with an IP address, until the cleanup.
              Entries in server and host logs also remain until they are discarded.
            </li>
            <li>
              A cleanup scheduled to run daily deletes attempt limit records older than 7 days, expired sessions, and
              used or expired password reset links created more than 7 days ago.
            </li>
            <li>
              The same cleanup deletes invite requests created more than 30 days ago. A request whose code has not been shown and has not expired is kept until the code expires; if its invite is revoked, the next cleanup removes the code.
            </li>
            <li>
              I make no backups of my own. My database host keeps restore history as part of its service,
              so deleted data can stay there until it ages out.
            </li>
          </List>
        </Section>

        <Section title="Data requests">
          <p>
            To ask what I hold about you, or to have it corrected or deleted, email the address above. I answer within
            30 days.
          </p>
        </Section>

        <Section title="Security basics">
          <List>
            <li>The site is served over HTTPS.</li>
            <li>Passwords are stored as bcrypt hashes.</li>
            <li>Session tokens and invite codes are stored only as hashes.</li>
          </List>
        </Section>

        <Section title="Changes">
          <p>If this changes, I update this page and the date at the top.</p>
        </Section>

        <div className="mt-8">
          {/* A plain Link: TextAction has an onClick, which a server component cannot pass. */}
          <Link href="/" className="inline-flex min-h-11 items-center text-body-medium text-primary">
            Back to Talaan
          </Link>
        </div>
      </main>
    </>
  );
}
