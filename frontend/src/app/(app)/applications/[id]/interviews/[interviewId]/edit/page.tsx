import type { Metadata } from "next";
import { parseStatus } from "@/lib/api";
import { EditInterviewScreen } from "./edit-screen";

export const metadata: Metadata = { title: "Edit interview", robots: { index: false } };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; interviewId: string }>;
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const { id, interviewId } = await params;
  const raw = (await searchParams).status;
  const status = parseStatus(typeof raw === "string" ? raw : undefined);
  return <EditInterviewScreen id={id} interviewId={interviewId} qs={status ? `?status=${status}` : ""} />;
}
