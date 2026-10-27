# docs/design: Stitch visual references

These PNGs came from Google Stitch. They are visual references ONLY. `docs/DESIGN.md` is the source of truth: if a screenshot and DESIGN.md disagree, DESIGN.md wins. Never build from Stitch's `code.html`; build from the tokens.

| File | Use | Ignore |
|---|---|---|
| light-login.png, dark-login.png | Whole screen | Stitch's logo rendering; use the SVGs in `frontend/` |
| light-list.png, dark-list.png | Ledger sheet, stamps, tabs, nav pill, add button | The mark in the app bar looks like a menu icon at this size; use the real logo component |
| light-detail.png, dark-detail.png | Whole screen | none |
| light-edit.png, dark-edit.png | Field order and layout | Light input borders look too pale; use `color-border-input` as DESIGN.md says |
| desktop-applications.png | Side nav, two panes, selected row, pane headers | Top bar "Talaan Ledger" and its avatar; heading font looks monospace (use IBM Plex Sans) |
| sheet-delete.png | The bottom sheet only | The whole dimmed background (invented department, location, compensation range, 2024 date) |
| form-add-interview.png | The five fields and their order | The dark bar with avatar and kebab menu, the title "New Entry Form", the "Acme Systems / Round 2" card, and the "No outcome yet" text (outcome defaults to Pending) |

Dark mode screens show the dark token values in use. Light is the default reference.