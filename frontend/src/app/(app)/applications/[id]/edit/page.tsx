import type { Metadata } from "next";
import { parseStatus } from "@/lib/api";
import { EditScreen } from "./edit-screen";

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
  return <EditScreen id={id} qs={status ? `?status=${status}` : ""} />;
}
