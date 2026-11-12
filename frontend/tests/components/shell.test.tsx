// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AppBar, BarAction } from "../../src/components/app-bar";
import { MainNav } from "../../src/components/main-nav";

let path = "/applications";
vi.mock("next/navigation", () => ({ usePathname: () => path }));

const current = () => screen.getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "page");

it("nav has exactly Applications, Interviews and Account, labelled", () => {
  render(<MainNav />);
  const nav = screen.getByRole("navigation", { name: "Main" });
  expect(within(within(nav).getByRole("list")).getAllByRole("link").map((l) => l.textContent)).toEqual(["Applications", "Interviews", "Account"]);
});

const LOGO = "Talaan, go to applications";

it("main bar logo and wordmark are one link to the applications list", () => {
  render(<AppBar />);
  const link = within(screen.getByRole("banner")).getByRole("link", { name: LOGO });
  expect(link.getAttribute("href")).toBe("/applications");
  expect(link.textContent).toBe("Talaan");
});

it("side nav logo links to the applications list", () => {
  render(<MainNav />);
  const link = within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: LOGO });
  expect(link.getAttribute("href")).toBe("/applications");
});

it("inner bar has no logo link", () => {
  render(<AppBar title="Account" backHref="/applications" />);
  expect(screen.queryByRole("link", { name: LOGO })).toBeNull();
});

it.each([
  ["/applications", "Applications"],
  ["/applications/3", "Applications"],
  ["/interviews", "Interviews"],
  ["/account", "Account"],
])("marks %s active", (p, label) => {
  path = p;
  render(<MainNav />);
  expect(current().map((l) => l.textContent)).toEqual([label]);
});

it("the Interviews link goes to /interviews", () => {
  render(<MainNav />);
  expect(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Interviews" }).getAttribute("href")).toBe("/interviews");
});

it("no active item elsewhere", () => {
  path = "/login";
  render(<MainNav />);
  expect(current()).toEqual([]);
});

it("main bar: wordmark, no back link", () => {
  render(<AppBar />);
  expect(screen.getByRole("banner").textContent).toContain("Talaan");
  expect(screen.queryByRole("link", { name: "Back" })).toBeNull();
});

it("inner bar: back, title, actions", () => {
  render(
    <AppBar
      title="Application detail"
      backHref="/applications"
      actions={
        <>
          <BarAction href="/applications/1/edit">Edit</BarAction>
          <BarAction onClick={() => {}}>Delete</BarAction>
        </>
      }
    />,
  );
  expect(screen.getByRole("link", { name: "Back" }).getAttribute("href")).toBe("/applications");
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Application detail");
  expect(screen.getByRole("link", { name: "Edit" }).getAttribute("href")).toBe("/applications/1/edit");
  expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
});
