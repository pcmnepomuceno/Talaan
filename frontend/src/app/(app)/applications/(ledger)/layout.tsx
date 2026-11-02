import { Suspense } from "react";
import { ApplicationsScreen } from "./screen";

// useSearchParams needs a Suspense boundary for prerendering.
export default function LedgerLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <ApplicationsScreen>{children}</ApplicationsScreen>
    </Suspense>
  );
}
