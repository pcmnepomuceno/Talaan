import type { Metadata } from "next";
import { AppBar } from "@/components/app-bar";
import { parseStatus } from "@/lib/api";

export const metadata: Metadata = { title: "Edit application", robots: { index: false } };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const { id } = await params;
  // Keep the list filter on the round trip: detail -> Edit -> Back -> Back lands on the same filtered list.
  const raw = (await searchParams).status;
  const status = parseStatus(typeof raw === "string" ? raw : undefined);
  return (
    <>
      <AppBar title="Edit application" backHref={`/applications/${encodeURIComponent(id)}${status ? `?status=${status}` : ""}`} />
      <main id="content" tabIndex={-1} className="mx-auto max-w-[640px] px-4 pt-6 pb-24 outline-none md:pb-6">
        <h1 className="hidden text-section-title xl:block">Edit application</h1>
        <p className="text-body text-text-secondary">Coming in the forms milestone.</p>
      </main>
    </>
  );
}
