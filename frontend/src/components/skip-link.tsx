// First focusable element on a page; the page's <main id="content"> is the target.
export function SkipLink() {
  return (
    <a
      href="#content"
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-sm focus:bg-surface-card focus:px-4 focus:py-3 focus:text-text-primary"
    >
      Skip to content
    </a>
  );
}
