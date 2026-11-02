import type { Metadata } from "next";
import { AppBar } from "@/components/app-bar";

export const metadata: Metadata = { title: "Edit application", robots: { index: false } };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <AppBar title="Edit application" backHref={`/applications/${encodeURIComponent(id)}`} />
      <main id="content" tabIndex={-1} className="mx-auto max-w-[640px] px-4 pt-6 pb-24 outline-none md:pb-6">
        <h1 className="hidden text-section-title xl:block">Edit application</h1>
        <p className="text-body text-text-secondary">Coming in the forms milestone.</p>
      </main>
    </>
  );
}
