import type { Metadata } from "next";
import { parseId, parseStatus } from "@/lib/api";
import { AppBar } from "@/components/app-bar";
import { NotFoundState } from "@/components/not-found-state";
import { NewInterviewScreen } from "./new-screen";

export const metadata: Metadata = { title: "Add interview", robots: { index: false } };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const { id } = await params;
  const raw = (await searchParams).status;
  const status = parseStatus(typeof raw === "string" ? raw : undefined);
  const qs = status ? `?status=${status}` : "";
  const n = parseId(id);
  if (n === null) {
    return (
      <>
        <AppBar title="Add interview" backHref={`/applications${qs}`} />
        <main id="content" tabIndex={-1} className="mx-auto max-w-[640px] px-4 pt-6 pb-24 outline-none md:pb-6">
          <NotFoundState qs={qs} />
        </main>
      </>
    );
  }
  return <NewInterviewScreen key={n} id={n} qs={qs} />;
}
