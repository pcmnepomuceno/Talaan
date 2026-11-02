import type { Metadata } from "next";
import { AppBar } from "@/components/app-bar";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata: Metadata = { title: "Account" };

export default function AccountPage() {
  return (
    <>
      <AppBar />
      <main id="content" tabIndex={-1} className="mx-auto max-w-[640px] px-4 pt-6 pb-24 outline-none md:pb-8 xl:max-w-[1120px] xl:pt-8">
        <h1 className="text-section-title text-text-primary">Account</h1>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <span className="text-body text-text-secondary">Theme</span>
          <ThemeToggle />
        </div>
      </main>
    </>
  );
}
