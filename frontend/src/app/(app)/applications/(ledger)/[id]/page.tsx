import type { Metadata } from "next";
import { ApplicationDetail } from "./detail";

export const metadata: Metadata = { title: "Application detail" };

export default function Page() {
  return <ApplicationDetail />;
}
