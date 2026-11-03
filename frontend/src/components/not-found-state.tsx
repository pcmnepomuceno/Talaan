import { Button } from "./button";

// Shown for an application that does not exist or is not the caller's (the API answers 404 for both).
export function NotFoundState({ backHref = "/applications" }: { backHref?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <h2 className="text-section-title text-text-primary">Application not found.</h2>
      <p className="text-caption text-text-muted">It may have been deleted.</p>
      <Button variant="secondary" href={backHref}>
        Back to applications
      </Button>
    </div>
  );
}
