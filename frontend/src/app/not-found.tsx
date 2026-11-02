import type { Metadata } from "next";
import { Button } from "@/components/button";
import { EmptyState } from "@/components/empty-state";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="mx-auto max-w-[440px] px-4 py-16">
      <EmptyState
        title="Page not found."
        message="The page does not exist or was moved."
        action={<Button href="/applications">Back to applications</Button>}
      />
    </main>
  );
}
