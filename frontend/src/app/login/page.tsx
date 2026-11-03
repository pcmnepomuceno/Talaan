import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Log in" };

type Query = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// searchParams (not useSearchParams) keeps the page free of a Suspense boundary at build time.
export default async function Page({ searchParams }: { searchParams: Promise<Query> }) {
  const q = await searchParams;
  return <LoginForm expired={first(q.expired) === "1"} deleted={first(q.deleted) === "1"} next={first(q.next)} />;
}
