import type { Metadata } from "next";
import { ApplicationForm } from "@/components/application-form";
import { parseStatus } from "@/lib/api";

export const metadata: Metadata = { title: "Add application", robots: { index: false } };

export default async function Page({ searchParams }: { searchParams: Promise<{ status?: string | string[] }> }) {
  // Keep the list filter on the round trip: list -> Add -> Save/Cancel lands on the same filtered list.
  const raw = (await searchParams).status;
  const status = parseStatus(typeof raw === "string" ? raw : undefined);
  return <ApplicationForm qs={status ? `?status=${status}` : ""} />;
}
