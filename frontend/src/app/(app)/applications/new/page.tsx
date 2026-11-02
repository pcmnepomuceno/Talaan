import type { Metadata } from "next";
import { AppBar } from "@/components/app-bar";

export const metadata: Metadata = { title: "Add application", robots: { index: false } };

export default function Page() {
  return (
    <>
      <AppBar title="Add application" backHref="/applications" />
      <main id="content" tabIndex={-1} className="mx-auto max-w-[640px] px-4 pt-6 pb-24 outline-none md:pb-6">
        <h1 className="hidden text-section-title xl:block">Add application</h1>
        <p className="text-body text-text-secondary">Coming in the forms milestone.</p>
      </main>
    </>
  );
}
