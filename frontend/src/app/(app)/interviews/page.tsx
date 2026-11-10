import type { Metadata } from "next";
import { Suspense } from "react";
import { AgendaScreen } from "./agenda-screen";

export const metadata: Metadata = { title: "Interviews" };

// useSearchParams (the Upcoming / Past tab) needs a Suspense boundary for prerendering.
export default function InterviewsPage() {
  return (
    <Suspense>
      <AgendaScreen />
    </Suspense>
  );
}
