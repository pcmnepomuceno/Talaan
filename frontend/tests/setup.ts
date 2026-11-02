import { afterEach } from "vitest";

// RTL only auto-cleans with test globals on; this project keeps them off.
afterEach(async () => {
  if (typeof document === "undefined") return;
  const { cleanup } = await import("@testing-library/react");
  cleanup();
});

// jsdom has no <dialog> methods. This stub emulates only: the `open` attribute, the `close` event,
// and Escape (cancelable `cancel` on the last-opened dialog, then close). It does NOT emulate the
// top layer, `:modal`, inert background, focus trapping or initial focus; those are checked in Chrome.
if (typeof HTMLDialogElement !== "undefined" && !HTMLDialogElement.prototype.showModal) {
  const stack: HTMLDialogElement[] = [];
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
    stack.push(this);
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    const i = stack.indexOf(this);
    if (i !== -1) stack.splice(i, 1);
    this.dispatchEvent(new Event("close"));
  };
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const top = stack[stack.length - 1];
    if (top && top.dispatchEvent(new Event("cancel", { cancelable: true }))) top.close();
  });
}
