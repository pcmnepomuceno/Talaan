import { Button } from "./button";

// Shown for an application (or interview) that does not exist or is not the caller's (the API answers
// 404 for both). Defaults are the application copy; `qs` is the list filter ("?status=applied" or ""),
// kept on the way back. Interview screens pass their own title and link.
export function NotFoundState({
  qs = "",
  title = "Application not found.",
  message = "It may have been deleted.",
  href = `/applications${qs}`,
  linkLabel = "Back to applications",
}: {
  qs?: string;
  title?: string;
  message?: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <h2 className="text-section-title text-text-primary">{title}</h2>
      <p className="text-caption text-text-muted">{message}</p>
      <Button variant="secondary" href={href}>
        {linkLabel}
      </Button>
    </div>
  );
}
