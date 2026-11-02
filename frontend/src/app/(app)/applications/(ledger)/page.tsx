import type { Metadata } from "next";

export const metadata: Metadata = { title: "Applications" };

// Only visible from 1280, where the detail pane sits beside the list.
export default function Page() {
  return <p className="py-12 text-center text-caption text-text-muted">Select an application to see its details.</p>;
}
