import { Button } from "./button";

// Shown for an application that does not exist or is not the caller's (the API answers 404 for both).
// `qs` is the list filter ("?status=applied" or ""), kept on the way back.
export function NotFoundState({ qs = "" }: { qs?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <h2 className="text-section-title text-text-primary">Application not found.</h2>
      <p className="text-caption text-text-muted">It may have been deleted.</p>
      <Button variant="secondary" href={`/applications${qs}`}>
        Back to applications
      </Button>
    </div>
  );
}
