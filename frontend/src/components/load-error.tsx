import { Banner } from "./banner";
import { Button } from "./button";

// A failed fetch: announced banner plus a Retry button (48px tall, so over the 44px minimum).
export function LoadError({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <Banner title={title}>
      <Button variant="secondary" onClick={onRetry} className="mt-2">
        Retry
      </Button>
    </Banner>
  );
}
