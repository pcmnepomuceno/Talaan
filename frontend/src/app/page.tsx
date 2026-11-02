import { redirect } from "next/navigation";

// ponytail: F4 sends signed-out visitors to /login instead.
export default function Home() {
  redirect("/applications");
}
