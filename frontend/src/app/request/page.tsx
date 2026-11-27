import type { Metadata } from "next";
import { ToastProvider } from "@/components/toast";
import { RequestScreen } from "./request-screen";

// no-referrer: the status link carries a secret (in the fragment, which is never sent, but stay strict).
export const metadata: Metadata = { title: "Request an invite", referrer: "no-referrer" };

export default function RequestPage() {
  return (
    <ToastProvider>
      <RequestScreen />
    </ToastProvider>
  );
}
