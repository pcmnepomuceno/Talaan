import type { Metadata } from "next";
import { ResetForm } from "./reset-form";

// no-referrer: the link carries a secret (in the fragment, which is never sent, but stay strict).
export const metadata: Metadata = { title: "Reset password", referrer: "no-referrer" };

export default function ResetPage() {
  return <ResetForm />;
}
