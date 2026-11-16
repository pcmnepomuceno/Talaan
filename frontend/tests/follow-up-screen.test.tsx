// @vitest-environment jsdom
// The follow-up view of the Applications screen (F10 C4, DESIGN.md 6.4, 6.5, 6.5d, 6.11, amendment A4).
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApplicationsScreen } from "../src/app/(app)/applications/(ledger)/screen";
import { ToastProvider } from "../src/components/toast";
import { clearCaches } from "../src/lib/cache";
import type { FollowUp } from "../src/lib/types";
import { type Fake, installFake, json, makeApp } from "./helpers/fake-api";

let search = "";
let params: { id?: string } = {};
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  useParams: () => params,
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/applications",
}));

let fake: Fake;
let rows: { id: number; follow_up: FollowUp }[];
beforeEach(() => {
  clearCaches();
  search = "status=follow_up";
  params = {};
  replace.mockClear();
});
afterEach(() => vi.restoreAllMocks());

const fu = (idle_days: number, last_activity: FollowUp["last_activity"] = "applied"): FollowUp => ({ idle_days, last_activity });
// The fake server for ?follow_up=true: the rows given (flat, as the API sends them), paged by offset.
const install = (list: typeof rows) => {
  rows = list;
  fake = installFake({ apps: [makeApp(1), makeApp(2)], interviews: [] });
  fake.on(
    "GET",
    /follow_up=true/,
    () => {
      const q = new URL(fake.calls.at(-1)!.path, "http://x").searchParams;
      const offset = Number(q.get("offset"));
      const items = rows.slice(offset, offset + 50).map((r) => ({ ...makeApp(r.id), ...r.follow_up }));
      return json(200, { items, total: rows.length, limit: 50, offset });
    },
    false,
  );
};
const ui = () => (
  <ToastProvider>
    <ApplicationsScreen>{null}</ApplicationsScreen>
  </ToastProvider>
);
const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: 100 - i, follow_up: fu(30 - (i % 20)) }));
const links = () => within(screen.getByRole("list", { name: "Applications" })).getAllByRole("link");
const region = () => screen.getAllByRole("status")[0];
// The visible line; the same words also sit in the status region (sr-only, a div).
const countLine = (t: string) => screen.findByText(t, { selector: "p" });

it("?status=follow_up asks the API for follow_up=true and shows the select on Needs follow-up", async () => {
  install(many(2));
  render(ui());
  await countLine("2 applications need a follow-up");
  expect(fake.calls[0].path).toBe("/applications?limit=50&offset=0&follow_up=true");
  expect((screen.getByRole("combobox", { name: "Status" }) as HTMLSelectElement).value).toBe("follow_up");
});

it("the count line is singular for one row and plural for several", async () => {
  install(many(1));
  const r = render(ui());
  await countLine("1 application needs a follow-up");
  r.unmount();
  clearCaches();
  install(many(4));
  render(ui());
  await countLine("4 applications need a follow-up");
});

it("rows say how long they have been quiet, in place of the date", async () => {
  install([
    { id: 5, follow_up: fu(12) },
    { id: 4, follow_up: fu(9, "interview") },
    { id: 3, follow_up: fu(1) },
    { id: 2, follow_up: fu(1, "interview") },
  ]);
  render(ui());
  await countLine("4 applications need a follow-up");
  const texts = links().map((l) => l.textContent ?? "");
  expect(texts[0]).toContain("Applied 12 days ago");
  expect(texts[1]).toContain("Last interview 9 days ago");
  expect(texts[2]).toContain("Applied 1 day ago");
  expect(texts[3]).toContain("Last interview 1 day ago");
  expect(texts.join(" ")).not.toContain("Oct 14, 2026");
  const note = screen.getByText("Applied 12 days ago");
  expect(note.className).toContain("text-text-muted");
  expect(note.className).toContain("tabular-nums");
});

it("empty: title, one plain sentence, Show all back to the full list; no count line", async () => {
  install([]);
  render(ui());
  await screen.findByRole("heading", { name: "Nothing to follow up on right now." });
  expect(screen.getByText("Applications at Applied with no activity for 7 days or more show here.")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Show all" }).getAttribute("href")).toBe("/applications");
  expect(screen.queryByText(/need a follow-up|needs a follow-up/)).toBeNull();
  expect(region().textContent).toBe(""); // left to the visible empty state
  expect(screen.getAllByRole("link", { name: "Add application" })[0].getAttribute("href")).toBe("/applications/new?status=follow_up");
});

it("Load more keeps the count line (the server total) and announces only the rows loaded", async () => {
  install(many(60));
  render(ui());
  await countLine("60 applications need a follow-up");
  expect(links()).toHaveLength(50);
  await userEvent.click(screen.getByRole("button", { name: "Load more" }));
  await waitFor(() => expect(links()).toHaveLength(60));
  expect(fake.calls.at(-1)!.path).toBe("/applications?limit=50&offset=50&follow_up=true");
  expect(await countLine("60 applications need a follow-up")).toBeTruthy();
  expect(region().textContent).toBe("10 more applications loaded");
});

it("row, add and back links keep ?status=follow_up", async () => {
  params = { id: "1" };
  install(many(2));
  render(ui());
  await countLine("2 applications need a follow-up");
  expect(links()[0].getAttribute("href")).toBe("/applications/100?status=follow_up");
  expect(document.querySelector('a[href="/applications?status=follow_up"]')).toBeTruthy(); // back
  expect(document.querySelector('a[href="/applications/new?status=follow_up"]')).toBeTruthy(); // add
});

it("choosing the option moves to ?status=follow_up; the count is then announced once, in the existing status region", async () => {
  search = "";
  install(many(3));
  fake.on("GET", /^\/applications\?limit=50&offset=0$/, () => json(200, { items: [makeApp(1)], total: 1, limit: 50, offset: 0 }), false);
  const r = render(ui());
  await screen.findByRole("list", { name: "Applications" });
  expect(screen.getAllByRole("status")).toHaveLength(2); // the region and the slow-start note: no new live region
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Status" }), "follow_up");
  expect(replace).toHaveBeenCalledWith("/applications?status=follow_up");
  search = "status=follow_up";
  r.rerender(ui());
  await countLine("3 applications need a follow-up");
  expect(region().textContent).toBe("3 applications need a follow-up");
  expect(screen.getAllByRole("status")).toHaveLength(2);
  // A background refetch of the same selection (a cache clear) does not announce it again.
  const before = fake.callsTo("GET", /follow_up=true/).length;
  act(() => clearCaches());
  await waitFor(() => expect(fake.callsTo("GET", /follow_up=true/).length).toBe(before + 1));
  await countLine("3 applications need a follow-up");
  expect(region().textContent).toBe("");
});

it("a normal list has no count line and no follow-up note", async () => {
  search = "status=applied";
  install([]);
  render(ui());
  await screen.findByRole("list", { name: "Applications" });
  expect(screen.queryByText(/need a follow-up|needs a follow-up/)).toBeNull();
  expect(screen.queryByText(/days? ago/)).toBeNull();
  expect(fake.calls[0].path).toBe("/applications?limit=50&offset=0&status=applied");
});

it("wording guard: no exclamation, urgency words or error-like token classes", async () => {
  install([
    { id: 5, follow_up: fu(40) },
    { id: 4, follow_up: fu(9, "interview") },
  ]);
  const { container } = render(ui());
  await countLine("2 applications need a follow-up");
  const main = container.querySelector("main")!;
  expect(main.textContent).not.toMatch(/!|\b(overdue|urgent|late|behind)\b/i);
  for (const el of [await countLine("2 applications need a follow-up"), screen.getByRole("list", { name: "Applications" }), ...screen.getByRole("list", { name: "Applications" }).querySelectorAll("*")]) {
    expect(el.className).not.toMatch(/danger|error|warning|destructive/);
  }
  expect(region().textContent).not.toMatch(/!|\b(overdue|urgent|late|behind)\b/i);
});
