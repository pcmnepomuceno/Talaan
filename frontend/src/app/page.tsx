import Link from "next/link";
import { Wordmark } from "@/components/logo";

export default function Home() {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 p-4 pt-12">
      <Wordmark variant="on-paper" />
      <p className="text-body text-text-secondary">Job application tracker. Screens are coming.</p>
      <Link href="/design" className="w-fit text-body-medium text-primary underline">
        Design system
      </Link>
    </main>
  );
}
