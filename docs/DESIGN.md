# Talaan Design System v2.5 (Design.md)

This file is the single source of truth for Talaan's look. Screens must use these exact token values. Do not substitute a Material 3 palette or any color not listed here. Do not copy the layout, content or branding of any other product.

## 1. Brand & Tone
- **Product**: Talaan, a job application tracker for Filipino job seekers. "Talaan" means a register or list.
- **Concept**: a ledger. The product feels like a well-kept register: warm paper, ruled lines, ink-blue, and one small orange stamp color. Rows sit in a ruled sheet instead of a stack of separate cards.
- **Purpose**: a calm, organized space for tracking applications, interviews and notes in the Philippines.
- **Tone**: calm, trustworthy, utilitarian, low-stress. Plain, neutral wording. No cheerleading copy, no exclamation marks, no motivational lines, no filler words such as "quiet", "seamless" or "effortless".
- **Structural color**: the top app bar is a solid ink-blue band on every screen and the sign in screen opens with a larger ink-blue band. The page is warm paper. This is the color structure; do not add other colored blocks.
- **Accent rule**: the orange stamp color is small and rare. It appears only in the logo's margin line, the Interviewing status, and nothing else.
- **Aesthetic principles**:
  - Zero gamification: no streaks, confetti, badges, scores or urgency prompts.
  - No gradients, glow, glass, illustrations, mascots, accent stripes or decorative bars.
  - One typeface, three weights. Sentence case everywhere. No all-caps labels, no monospace labels, no eyebrow labels, no pill shapes, no status dots.
  - Hairline rules and 1px borders for structure. Shadows only on floating elements.
  - Clear hierarchy, generous breathing room, outlined icons only.
- **Platform**: mobile first (390px wide), then tablet and desktop layouts built from the same components. Light and dark mode are both first-class.

### 1.1 Logo
The mark is a "T" made of ruled lines: a horizontal top rule is the crossbar, a vertical margin line is the stem, and three ruled lines sit to the right of the stem (the last one shorter). Geometry on a 64 x 64 grid: crossbar x 6 to 58, y 10 to 15; margin line x 19 to 24, y 10 to 56; ruled lines at y 27, 37 and 47 from x 31 to 55 (the last to x 45), stroke 3.5, round caps. Colors: on paper, crossbar and lines are `color-primary` and the margin line is `color-stamp`. On the ink-blue app bar, crossbar and lines are `color-bar-text` and the margin line is `color-bar-stamp`. At 16 to 32px use a simplified mark with two ruled lines and stroke 5. The wordmark "Talaan" is set in the typeface at 600 weight next to the mark.

---

## 2. Data and Scope Rules (what screens may show)
Screens may only show data that exists in the product. Never invent fields.

- **Application fields**: company, job title, status, date applied (optional while status is Saved), monthly gross salary in PHP, work mode (On-site, Hybrid, Remote), company website URL, notes.
- **Interview fields**: date and time (shown in PHT), mode (On-site, Online, Async), interviewer (optional), outcome (always present: Pending, Good or Bad; a new interview starts as Pending), notes.
- **Account fields**: account name, email, password, invite code (sign up only).
- **Not in v1, do not design**: notification bell, search field, per-status counts, "total" or "active interviews" summary banners, location or city, industry, interview "stage x of y", meeting links, draft state, profile photos, social login.
- **Navigation**: exactly three destinations, `Applications`, `Interviews` and `Account` (v2.4; `Interviews` is the agenda of 8.8).
- **Filtering**: the list can be filtered by status only (tabs show the status name, no counts).

---

## 3. Color Tokens

Components refer to token names. Never hard-code a hex value in a component.

### 3.1 Core Tokens

| Token | Light | Dark | Usage |
|---|---|---|---|
| `color-primary` | `#1F3A6E` | `#A9C0F5` | Primary buttons, active nav, links, active filter tab, focus ring |
| `color-primary-pressed` | `#142A52` | `#C9D8FA` | Pressed state of primary elements |
| `color-primary-tint` | `#E3E9F5` | `#1B2B4F` | Selected row fill, active nav pill, ghost button pressed fill |
| `color-bg-page` | `#F7F3EA` | `#0E1626` | Screen background (warm paper in light, deep navy in dark) |
| `color-surface-card` | `#FFFDF8` | `#152038` | Ledger sheet, inputs, bottom sheets, dialogs, nav bars |
| `color-surface-subtle` | `#EFE9DB` | `#1C2A47` | Segmented control track, skeleton highlight, disabled fills |
| `color-border-subtle` | `#DDD5C3` | `#28365A` | Sheet borders, row rules, dividers, nav bar borders |
| `color-border-input` | `#857F72` | `#6B7EA6` | Input, select and segmented-control outlines |
| `color-border-strong` | `#5F5A50` | `#9AAAD0` | Input hover border, secondary button hover border |
| `color-text-primary` | `#1A2236` | `#EEF2FA` | Headings, titles, values |
| `color-text-secondary` | `#454D60` | `#C6D0E6` | Company names, unselected tabs, text on `color-surface-subtle` |
| `color-text-muted` | `#5F6677` | `#96A3C0` | Helper text, dates, placeholders (only on page or card surfaces) |
| `color-text-inverse` | `#F7F3EA` | `#0E1626` | Text on solid primary and destructive buttons |
| `color-focus-ring` | `#1F3A6E` | `#A9C0F5` | 2px focus ring with 2px offset on every focusable element |
| `color-bar-bg` | `#1F3A6E` | `#172A52` | Top app bar and the sign in band |
| `color-bar-text` | `#F7F3EA` | `#EEF2FA` | Text and icons on the app bar |
| `color-bar-stamp` | `#F97316` | `#FB923C` | The logo's margin line on the app bar only |
| `color-stamp` | `#C2410C` | `#FB923C` | The logo's margin line on paper only |

### 3.2 Status Tokens
Rule: a status is always a text label inside a flat rectangular stamp, never by color alone. Labels are sentence case ("Interviewing", not "INTERVIEWING").

| Status | Light text | Light bg | Light border | Dark text | Dark bg | Dark border |
|---|---|---|---|---|---|---|
| Saved | `#454D60` | `#EFE9DB` | `#DDD5C3` | `#C6D0E6` | `#1C2A47` | `#34456B` |
| Applied | `#1F3A6E` | `#E3E9F5` | `#B7C5E3` | `#A9C0F5` | `#1B2B4F` | `#34508F` |
| Screening | `#0E5F73` | `#E1F0F4` | `#A8D3DE` | `#7DD3E8` | `#0F2F3A` | `#1F6477` |
| Interviewing | `#9A3412` | `#FFEDD5` | `#FDBA74` | `#FDBA74` | `#3A1D0C` | `#9A4A18` |
| Offered | `#166534` | `#E6F4EA` | `#A7D7B4` | `#86EFAC` | `#0F2E1B` | `#1F6B3A` |
| Accepted | `#14532D` | `#CFEBD7` | `#7FC495` | `#6EE7A0` | `#0A3D22` | `#1E7A44` |
| Rejected | `#991B1B` | `#FBE6E4` | `#F0B0AB` | `#FCA5A5` | `#3B1214` | `#8F2A2E` |
| Withdrawn | `#57534E` | `#EDEAE4` | `#D6D0C4` | `#C9C2B4` | `#26231F` | `#4A453D` |
| Ghosted | `#854D0E` | `#F8EBCB` | `#E3C57E` | `#FCD34D` | `#35280A` | `#8A6A12` |

Interview outcome stamps reuse these colors: Pending uses Saved, Good uses Offered, Bad uses Rejected. The labels are exactly "Pending", "Good" and "Bad".

All text and background pairs above were checked at 4.5:1 or better.

### 3.3 Feedback Tokens

| Token | Light | Dark | Usage |
|---|---|---|---|
| `color-error-text` | `#B91C1C` | `#FCA5A5` | Inline validation text, error banner text |
| `color-error-bg` | `#FBE6E4` | `#3B1214` | Error banner fill, error input fill |
| `color-error-border` | `#F0B0AB` | `#8F2A2E` | Error input and banner border |
| `color-destructive` | `#B91C1C` | `#F87171` | Destructive button fill |
| `color-destructive-pressed` | `#991B1B` | `#FCA5A5` | Destructive button pressed |
| `color-success-text` | `#166534` | `#86EFAC` | Success toast text |
| `color-success-bg` | `#E6F4EA` | `#0F2E1B` | Success toast fill |
| `color-success-border` | `#A7D7B4` | `#1F6B3A` | Success toast border |
| `color-overlay` | `rgba(14, 22, 38, 0.60)` | `rgba(0, 0, 0, 0.60)` | Scrim behind sheets and dialogs |

Neutral hints (for example "Enter the amount before tax") use `color-text-muted`, never an error color.

---

## 4. Typography

- **Typeface**: `"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`. One family, weights 400, 500 and 600 only.
- **Numbers**: tabular figures (`font-feature-settings: "tnum" 1`) for salary, dates and times.
- **Case**: sentence case everywhere. No uppercase transforms.
- **Minimum size**: `14px` everywhere, including stamps, dates and helper text.

| Level | Size / line height | Weight | Tracking | Usage |
|---|---|---|---|---|
| Page Title | 24 / 32 | 600 | -0.01em | Auth titles, desktop pane titles |
| Bar Title | 18 / 24 | 600 | 0 | Text in the app bar |
| Section Title | 18 / 26 | 600 | 0 | Block titles, dialog titles |
| Body | 16 / 24 | 400 | 0 | Form values, notes |
| Body Medium | 16 / 24 | 500 | 0 | Button labels, input values, segment options |
| Row Title | 16 / 22 | 600 | 0 | Job title in rows |
| Caption | 14 / 20 | 400 | 0 | Helper text, dates, company in rows |
| Caption Bold | 14 / 20 | 600 | 0 | Field labels, salary in rows |
| Stamp | 14 / 18 | 500 | 0.01em | Status stamps, filter tabs |

---

## 5. Spacing, Shape and Elevation

### 5.1 Spacing (8px grid)
`space-1` 4, `space-2` 8, `space-3` 12, `space-4` 16 (screen gutter, row padding), `space-5` 20, `space-6` 24 (section gap), `space-8` 32, `space-12` 48.

### 5.2 Radius
`radius-xs` 2 (status stamps), `radius-sm` 4 (buttons, inputs, selects, segmented control, filter tabs, ledger sheet, banners, toasts), `radius-sheet` 12 (top corners of bottom sheets and dialog corners), `radius-fab` 16 (floating add button). No fully rounded pill shapes anywhere.

### 5.3 Elevation and borders (one rule)
- The ledger sheet, inputs, selects, stamps, banners and nav bars use a 1px border and no shadow.
- Only three things have a shadow: the floating add button, bottom sheets and dialogs, and toasts. Shadow token: `0 4px 12px rgba(14, 22, 38, 0.14)`.
- Never combine a border and a shadow on the same element. One exception: toasts keep their 1px border (tinted fills need it against the page) and also carry the shadow.
- Minimum touch target: 44 x 44px.

---

## 6. Components
All values below are token names. Every component must work in light and dark mode through tokens alone.

### 6.1 Buttons
Height 48px, radius `radius-sm`, label Body Medium. Focus: 2px `color-focus-ring` with 2px offset. Hover uses the Pressed colors.

| Variant | Default | Pressed | Disabled |
|---|---|---|---|
| Primary | bg `color-primary`, text `color-text-inverse` | bg `color-primary-pressed` | bg `color-surface-subtle`, text `color-text-muted` |
| Secondary | bg `color-surface-card`, text `color-text-primary`, 1px `color-border-input` | bg `color-surface-subtle` | text `color-text-muted`, border `color-border-subtle` |
| Ghost | no fill, text `color-primary` | bg `color-primary-tint` | text `color-text-muted` |
| Destructive | bg `color-destructive`, text `color-text-inverse` | bg `color-destructive-pressed` | bg `color-error-bg`, text `color-error-border` |

### 6.2 Text field and select
Height 48, padding 12 x 16, radius `radius-sm`, text 16px, bg `color-surface-card`.

| State | Border | Other |
|---|---|---|
| Default | 1px `color-border-input` | Placeholder `color-text-muted` |
| Hover | 1px `color-border-strong` | |
| Focus | 2px `color-primary` | Helper stays `color-text-muted` |
| Disabled | 1px `color-border-subtle` | bg `color-surface-subtle`, text `color-text-muted` |
| Error | 1.5px `color-error-text` | bg `color-error-bg`, message below in `color-error-text` with a leading icon |

Input, select and textarea borders always use `color-border-input` (3:1 against the surface), never `color-border-subtle`. Every form uses `noValidate` and shows its own inline errors; there are no native browser validation popups. Field label: Caption Bold, above the field. Required fields show "Required" in `color-text-muted` at the right of the label row. A prefix such as the peso sign and a suffix such as "/ month" sit inside the field on one line and never wrap.

### 6.3 Segmented control (Work mode: On-site, Hybrid, Remote)
Track height 44, bg `color-surface-subtle`, 1px `color-border-subtle`, radius `radius-sm`, padding 4. Selected segment: bg `color-primary`, text `color-text-inverse`, radius 2. Unselected: no fill, text `color-text-secondary`. Each segment has a 44px-tall hit area around the 36px visible segment, with 4px horizontal padding inside the label. Segments are equal width when the control is full width, and sized to their labels when it is compact (the theme toggle).

### 6.4 Status stamp and status filter
- **Status stamp**: height 28, padding 4 x 10, radius `radius-xs`, Stamp type, sentence case label, uses the status tokens (text, bg, 1px border). It is a flat rectangle, never a pill, and has no dot or icon. Interview outcome stamps use the same component.
- **Status filter** (v2.3, replaces the filter tabs): one native select from 6.2 (48px, same tokens and states), label "Status", options "All" then the nine statuses in enum order (Saved first), label only, no counts. Default All. Full width under 768; from 768 it is at most 320px wide.

### 6.5 Ledger sheet and application row
The applications list is one ledger sheet: a single container (bg `color-surface-card`, 1px `color-border-subtle`, radius `radius-sm`, no shadow) holding rows separated by 1px `color-border-subtle` rules. Rows are not separate cards. Each row is at least 44px tall, tappable as a whole, padding 16:
1. Line 1: job title (Row Title, `color-text-primary`) and the status stamp at the right.
2. Line 2: company name (Caption, `color-text-secondary`).
3. Line 3: work mode and salary on the left (Caption Bold for salary, format `Hybrid · ₱85,000 / month`) and date applied on the right (Caption, `color-text-muted`, format `Oct 14, 2026`). When status is Saved and there is no date, show "Not applied yet".
On desktop the selected row has bg `color-primary-tint` (no accent stripe).

### 6.5b Detail rows
The detail screen's key details are ruled rows in one ledger sheet: label in Body `color-text-secondary` on the left, value in Body at weight 600 `color-text-primary` on the right with tabular numbers. A row whose value is missing (no salary, no website, no date) is omitted, never shown as a zero or a dash.

### 6.6 Interview entries
Interviews on the detail screen use the same ledger sheet, one row per interview in date order, separated by rules. Each row: date and time in PHT (Row Title, for example `Oct 24, 2026, 2:00 PM PHT`) and the outcome stamp (Pending, Good or Bad, always shown); below it the mode with an icon (On-site, Online, Async), the interviewer name only when present (Caption, `color-text-secondary`), and notes (Caption, `color-text-muted`). Icons: On-site `apartment`, Online `videocam`, Async `schedule`, interviewer `person`. Separator between inline items is `·`. Each row ends with Edit and Delete text actions (44px targets; accessible names include the date, for example "Edit interview, Oct 24, 2026, 2:00 PM PHT"). No "Next" or "Upcoming" labels on these rows (the agenda's Upcoming tab of 8.8 is a tab, not a row label), no interview titles, no stage names.

**Add to calendar (v2.4).** A row whose interview is still ahead (date and time at or after now) shows one more text action, "Add to calendar", before Edit and Delete (44px target, same style; accessible name includes the company and the date, for example "Add to calendar, Pinagsama Tech, Oct 24, 2026, 2:00 PM PHT"). It downloads a one-time `.ics` file built in the browser (one event, start in UTC, end one hour later, no notes) and shows the success toast "Calendar file created." (not "downloaded": the page cannot know a file was saved; iOS Safari opens a preview instead). Past interviews have no such action. Under the interview sheet, when any row has the action, one more text action "How to add this to your calendar" opens the dialog of 6.8c.

### 6.5c Day group header (v2.4)
The agenda (8.8) groups interviews by Philippine calendar day. Each group is a section with a heading (h2, Body Medium 16 / 500, `color-text-secondary`, for example `Tuesday, Nov 10, 2026`) 8px above its own ledger sheet (6.5), with 24px between groups. No fill, no rule, no uppercase, no counts. A row whose date cannot be read goes in a last group headed "Date unavailable". The group day is the PHT day, so 11:30 PM PHT and 12:30 AM PHT the next day are two groups.

### 6.7 Navigation
- **Top app bar**: height 56, padding 0 16, bg `color-bar-bg`, text and icons `color-bar-text`, no border. Main screens show the logo mark and the wordmark "Talaan", together one link to `/applications` (status filter cleared) with the accessible name "Talaan, go to applications", a 44px-tall hit area and the global focus ring. The logo and wordmark in the 240px side navigation are the same link. The ink band on the login screen is not a link. Inner screens show a back arrow, the screen title (Bar Title) and, where needed, text buttons "Edit" and "Delete" on the right. No bell, no avatar, no user icon, no kebab menu, and no decorative page title such as "Ledger". Titles are sentence case.
- **Bottom navigation (mobile)**: height 64, bg `color-surface-card`, top border 1px `color-border-subtle`, three items: `Applications`, `Interviews`, `Account`. Active: icon and label `color-primary` on a `color-primary-tint` pill. Inactive: `color-text-secondary`.
- **Floating add button**: 56 x 56, `radius-fab`, bg `color-primary`, outline plus icon (`color-text-inverse`), shadow token, 16px from the right edge and 16px above the bottom nav. Accessible label "Add application". The list has bottom padding of at least 88px so the button never covers a row.

### 6.8 Bottom sheet and dialog
Scrim `color-overlay`. Mobile sheet radius `radius-sheet` on the top corners; desktop dialog radius `radius-sheet`, centered, max width 440. bg `color-surface-card`, padding 24 20 32, shadow token. Contents: icon badge (40px square, radius `radius-sm`, bg `color-error-bg`), title (Section Title), message (Caption, `color-text-muted`), then full-width buttons: Destructive (48) above Secondary "Cancel" (48). Focus is trapped inside; Escape closes.

### 6.8b Status change dialog
The standard dialog of 6.8 (bottom sheet on mobile, centered dialog from 768), opened by the "Change status" button on the application detail. No icon badge. Title "Change status". Body: a radio group (visually hidden legend "Status") of the nine statuses in enum order, one row per status, each row at least 44px tall and showing the status stamp as its label. The current status is checked and has initial focus. Buttons: Primary "Update status" (48) above Secondary "Cancel" (48). Choosing another status changes only the selection; nothing is sent until "Update status" (arrow keys move the selection, so one tap per status would send a request for every key press).
- Confirming the current status closes the dialog with no request and no toast.
- While the request runs both buttons and Escape are disabled, and a second activation sends nothing.
- Success: the dialog closes, toast "Status updated.", the detail shows the new status and any date the server filled in at once, and focus returns to "Change status". The request sends the status only, never a date.
- Failure: the dialog stays open with an error toast. A 404 closes it and the detail shows "Application not found."

### 6.8c Calendar import dialog (v2.4)
The standard dialog of 6.8 (bottom sheet on mobile, centered dialog from 768, scrolls inside when long), opened by "How to add this to your calendar" (agenda header, and once under the interview sheet on the detail). No icon badge. Title "How to add this to your calendar" (Section Title) takes initial focus, so a long body opens at the top. Body (Body, `color-text-primary`): first one line saying the file is a one-time copy (if an interview changes in Talaan, download a new file and delete the old event in the calendar first), then one block per calendar app: a Body Medium heading (h3) and a short ordered list of steps in plain words (Google Calendar, Apple Calendar on a Mac, Outlook on the web, Outlook for Windows (classic)). Only steps checked against the vendor's help page are listed. One Secondary "Close" (48) at the bottom. Focus is trapped; Escape and Close return focus to the trigger. No emoji, no exclamation marks.

### 6.9 Toast
Height 48, padding 12 x 16, radius `radius-sm`, shadow token. Success: `color-success-bg` / `color-success-border` / `color-success-text`. Error: `color-error-bg` / `color-error-border` / `color-error-text`. Success toasts auto-dismiss after 4 seconds, and the timer pauses while the toast is hovered with a mouse or focused (a touch tap does not pause it); errors stay until dismissed. Every toast has a 44px "Dismiss" button. Toasts appear bottom center, 16px from the edge plus the safe area, above the bottom navigation on mobile. Caps are per kind: at most 3 successes and 3 errors are visible, and a fourth drops the oldest toast of its own kind. Success toasts are announced politely and errors assertively.

### 6.10 Banner (inline)
Radius `radius-sm`, padding 16, 1px border. Error banner uses the three error tokens, a leading outline icon, a one-line title (Body 16 at weight 600) and one line of text.

### 6.11 Empty state
Centered, padding 48 24, 48px outline icon (Material Symbol "description") in `color-text-muted`, title Section Title, one plain sentence in Caption `color-text-muted` (no exclamation marks), one standard 48px primary Button. Example: "No applications yet. Add the first job you applied to." with a button "Add application".

### 6.12 Loading skeleton
Rows keep their ledger sheet and rules; each row shows three bars. Base `color-border-subtle`, highlight `color-surface-subtle`. Gentle opacity pulse 0.6 to 1.0 over 1.8s. Radius 4.

**Slow start note (v2.3).** The free-tier API can take a minute to wake. When a login or sign-up request, or the first list or detail load, is still pending after 3 seconds, one Caption line in `color-text-muted` appears: "Starting up. This can take up to a minute the first time." It sits in a polite live region (present from the start, so the text is announced when it appears) and is removed when the request settles, whether it succeeds or fails. Nothing is shown before 3 seconds.

### 6.13 Month grid (v2.5)
The month view of the Interviews screen (8.8). Existing tokens only: no dots, no counts as badges, no pills, no new colors.
- **Month header**: h2 with the month and year (`November 2026`, Section Title) at the left; at the right the icon buttons "Previous month" and "Next month" (chevrons, 44 x 44, accessible names exactly those) and the text action "Today" (`TextAction`, 44px). At 1900-01 and 2200-12 the matching button is `aria-disabled` (not `disabled`, so a focused button keeps focus) in `color-text-muted`.
- **Grid**: one sheet in the style of 6.5 (bg `color-surface-card`, 1px `color-border-subtle`, radius `radius-sm`, no shadow) holding a header row of seven weekday names (Caption, `color-text-secondary`; `Sun Mon Tue Wed Thu Fri Sat`, Sunday first, each with its full name for assistive tech) and 4, 5 or 6 week rows. Cells are separated by 1px `color-border-subtle` rules. Every cell is one button, at least 44px tall and as wide as its column (about 53px at 390). It shows the day number (Body, tabular numbers: weight 400 for a day without interviews, 600 for a day with interviews and for the selected day). Days of the neighbouring months are shown with `color-text-muted` numbers (`color-text-secondary` on a tinted day, because muted text is only for page and card surfaces) and stay interactive; choosing one moves the view to its month.
- **Day with interviews**: a 600-weight number (a day without interviews is 400) and the fill `color-primary-tint`. The weight is the cue that does not depend on color: the tint alone is only 1.20:1 against the cell in light and 1.16:1 in dark, far under 3:1, so it only reinforces. There is no dot and no count.
- **Today** (the Philippine day): a 1px `color-primary` border inside the cell. A border, not an outline, so it never competes with the focus ring.
- **Selected day**: fill `color-primary` with `color-text-inverse` text (the pair of the selected segment in 6.3). It also carries `aria-selected`, and the heading under the grid names the date, so selection is never color alone. The selected day's number is 600 whether or not it has interviews (the button name still tells them apart).
- **Focus**: the global 2px `color-focus-ring` with 2px offset, drawn inside the sheet for the cells (negative offset) so a neighbour does not clip it.
- **Text lines from 1280**: a cell with interviews also shows up to two lines `2:00 PM · Company` (Caption, tabular numbers, one line each, truncated with an ellipsis) in time order, then `+N more` (Caption, `color-text-muted`) when more than two. Under 1280 a cell shows only the number and the tint. The lines are `aria-hidden`; the button name carries the count.
- **Selected day list**: under the grid an h3 with the full date (`Tuesday, Nov 10, 2026`, Body Medium, `color-text-secondary`, like 6.5c) and the same rows as the agenda (8.8) in one ledger sheet, oldest first, with "Add to calendar" on rows that are still ahead. A day with none shows "No interviews on this day." (Caption, `color-text-muted`). A month with none needs no state of its own: the grid is the state.
- **States**: while the first request runs the grid is shown without markers (`aria-busy`), the list area holds the loading skeleton (6.12) and the slow-start note (6.12) appears on the first load only; on failure with nothing cached the grid stays and the error banner "Couldn't load interviews." with Retry (6.10) sits under it; when cached data is shown and the refresh fails the banner reads "Couldn't refresh the interviews. Showing the last loaded rows."; when the server cut the month at 200 rows a banner says "Showing the first 200 interviews. Some are not shown." (the error banner style, because rows are missing from the view). The grid is never removed while loading, so the focused day keeps focus.
- **Keyboard** (the date-grid pattern): one tab stop, on the selected day (or on the day the arrows last moved to while focus is inside the grid). Arrow keys move one day or one week; Home and End go to the start and end of the week; PageUp and PageDown change the month and keep the day of the month (clamped to the shorter month); Enter and Space select the focused day. Moving past the visible grid changes the month. Focus stays on the day it lands on and never drops to the page.

---

## 7. Layout and Responsive Behavior

| Breakpoint | Width | Layout |
|---|---|---|
| Mobile | under 768 | Single column, 16px gutter, bottom navigation, floating add button |
| Tablet | 768 to 1279 | Single column list centered, max content width 640, left side navigation rail (88px, icons with labels beneath) replaces bottom nav |
| Desktop | 1280 and up | Left side navigation (240px) with `Applications`, `Interviews` and `Account`. Applications screen is two panes: the ledger sheet (400px) and detail (fills the rest, max width 720). Selecting a row fills the detail pane; there is no separate detail page. |

- The Interviews agenda (8.8) is one centered column, max content width 640, at every width, with no detail pane. The Month view (6.13) keeps 640 under 1280 and widens to 960 from 1280 so each cell can carry two text lines; the screen header above it follows the same width. A row opens the application: at 1280 that is the two-pane Applications screen on that application, with `Applications` active in the navigation.
- The add and edit forms (application and interview) are full-screen routes inside the app shell at every width, not dialogs (corrected in v2.3; v2.2 described a centered dialog that was never built).
- Content max width on any screen is 1120.
- The floating add button becomes a primary "Add application" button in the list header on desktop.
- Desktop has no top bar. The 240px side navigation is solid `color-bar-bg` with the logo mark and wordmark at the top and three items (the active one on a `color-primary-tint` pill: `Applications`, `Interviews`, `Account`). The list pane header shows the title "Applications" and the "Add application" button. The detail pane header shows "Edit" and "Delete" text buttons. The selected row has a `color-primary-tint` fill with no accent stripe.

---

## 8. Screens (reference list)
1. **Sign up / Log in**: an ink-blue band at the top (`color-bar-bg`, about 200px tall) with the logo mark, the wordmark "Talaan" and one plain line, "Track every application in one place." Below it on paper, a two-option segmented control (Log in, Create account). Sign up fields: Invite code, Account name, Email, Password (with show/hide), plus the plain line "Access is by invitation for now." Log in fields: Email, Password.
   - Failed login message (one banner above the fields, not tied to a field): "Invalid email or password."
   - Failed sign up messages (amended in F4; the API tells the user which field to fix): invite code field "Invalid or expired invite code."; email field "Email already exists."; any password or format rule from the API on its own field. Too many attempts: banner "Too many attempts. Try again in about N minutes." Server or network trouble: banner "Talaan isn't responding right now. Try again in a moment."
   - Invite code field: hint "Paste the code you were given; dashes are optional", no spellcheck, capital letters on mobile keyboards.
   - Notices under the segmented control: "Your session expired. Log in again." and "Your account has been deleted."
2. **Applications list**: app bar, status filter select (label "Status", All plus each status, label only), the ledger sheet of application rows, floating add button, empty state, loading skeletons. Rows load 50 at a time per status filter; a secondary "Load more" button below the sheet appends the next 50 and disappears when every row is shown. "No applications yet." (filter All, no rows) and "No applications with this status." (a status chosen, no rows) are different states.
3. **Application detail**: a full page (not an overlay) with a back arrow in the app bar; header block (job title and company at the full card width, then below a 1px `color-border-subtle` rule one row with the status stamp on the left and a Secondary "Change status" button on the right, so a long title never loses width to the button; the button opens the status change dialog of 6.8b; the same header is used in the 1280 detail pane), Key details (monthly gross salary, work mode, date applied, website link), Notes, Interviews as ledger rows in date order with an "Add interview" button in the section header (the empty state "No interviews yet." carries the same button), Edit and Delete as text buttons in the app bar. Delete opens the confirmation sheet.
4. **Add / edit application form** (amended in F5): one shared form. Fields in order: Job title (required), Company (required), Status (select of all nine statuses, default Saved on create), Date applied (the browser's native date input; helper "Leave blank to use today's date." for every status except Saved, where it reads "Leave blank if you haven't applied."), Work mode (required segmented control with **nothing selected on create**; edit pre-selects the stored value), Monthly gross salary (PHP) with `₱` prefix, `/ month` suffix, `inputmode="numeric"`, digits only and helper "Enter the amount before tax", Company website, Notes. The contact email is not in the form. Buttons: Primary "Save application" (shows "Saving…" at the same width while the request runs) and a separate Secondary "Cancel".
   - Rules mirror the API: Job title and Company are trimmed, 1 to 200 characters; website is an http(s) address up to 2000 characters; notes up to 5000; salary a whole number from 0 to 2,147,483,647 (empty sends nothing; a pasted "85,000" is accepted, "-5" and "1.5" are rejected). Lengths count code points, so emoji count once; the inputs' own `maxLength` is twice the limit as a typing cap only.
   - Messages: "Enter a job title.", "Enter a company name.", "Choose a work mode.", "Enter a whole number, 0 or more.", "Enter an amount up to 2,147,483,647.", "Enter a full address starting with http:// or https://", "Enter a complete date.", "Job title must be 200 characters or fewer." (same for Company), "Website must be 2,000 characters or fewer.", "Notes must be 5,000 characters or fewer." Errors sit under the field with `aria-invalid` and `aria-describedby`; a failed submit focuses the first invalid field (for the work mode, its first radio). Errors the API reports for a field land on that field; any other failure is a banner above the form ("Talaan isn't responding right now. Try again in a moment." for network, 5xx; the usual "Too many attempts..." for 429). Typed values are never cleared by a failed save.
   - Success: toast "Application saved.", then the app goes to the application's detail (replacing the form in history, keeping the list's `?status=`). Edit sends only the changed fields; with no changes there is no request and no toast.
   - Leaving: Cancel and the app-bar back arrow ask "Discard changes?" (Destructive "Discard" above Secondary "Keep editing", which has initial focus) only when the form has unsaved changes. A dirty form also asks the browser to confirm reload and tab close. Not intercepted (a known limit): the browser Back button and the side or bottom navigation links.
   - Unknown or other-user ids on the edit page show the same "Application not found." view as the detail.
5. **Add / edit interview form** (F6; a full-screen route at every width, not a dialog: `/applications/[id]/interviews/new` and `.../[interviewId]/edit`, inside the app shell; title "Add interview" or "Edit interview"): fields in this order: Date and time (Required; native `datetime-local`; label "Date and time (Philippine time)"; always read and shown as PHT whatever the browser zone is, no zone selector), Mode (segmented: On-site, Online, Async; Required, nothing preselected, error "Choose an interview mode."), Interviewer (Optional, up to 200 characters), Outcome (select: Pending, Good, Bad; default Pending), Notes (Optional, up to 5000). Messages: "Enter the date and time.", "Enter a complete date and time." (a half-typed value), "Enter a valid date and time.", "Enter a year between 1900 and 2200.". Past times are valid. Buttons: Primary "Save interview" (shows "Saving…" in the same width) and Secondary "Cancel". Same behaviors as item 4: inline errors, first invalid field focused, typed values kept on a failed save, "Discard changes?" only when dirty, beforeunload only while dirty, edit sends only changed fields (none = no request, no toast), success toast "Interview saved." then back to the application (replacing the form in history, keeping `?status=`). Saving an interview never changes the application's status. A 404 on save shows "Interview not found." (or "Application not found." when adding) with a link back. No application summary card, no round number.
6. **Delete confirmation**: a bottom sheet (mobile) or dialog (desktop) over the dimmed detail screen: 40px square icon badge with a trash outline icon on `color-error-bg`, title "Delete this application?", message "[Company], [Job title], and its interviews will be removed. This cannot be undone.", then Destructive "Delete application" above Secondary "Cancel". The interview delete uses the same dialog: title "Delete this interview?", message "The [Mode] interview on [date and time PHT] will be removed. This cannot be undone.", Destructive "Delete interview" above Secondary "Cancel". A 404 counts as already deleted; a failure keeps the dialog open with an error toast.
7. **Account**: app bar, then a sheet with two read-only rows (Account name, Email), the theme toggle, a secondary "Log out" button, and a "Delete account" section (short warning plus a Destructive "Delete account" button) below a hairline. Delete opens one dialog in two steps. Step 1, title "Delete your account?": the line "This permanently deletes:" and a plain list (your account, all applications, all interviews, all sign-in sessions), then "This cannot be undone."; Destructive "Continue" above Secondary "Cancel". Step 2, title "Type your email to confirm": a line naming the account email, a field for the typed email (compared trimmed, ignoring case), a Password field, Destructive "Delete my account permanently" (disabled until the email matches and the password is not empty) above Secondary "Cancel". Focus moves to the step title when the step changes. While the request runs both buttons and Escape are disabled. A wrong password shows "Incorrect password." on the password field and the dialog stays open.

8. **Interviews agenda** (v2.4; `/interviews`; the label of the third navigation destination, icon Material `event`, filled when active): the main-screen app bar, then h1 "Interviews" (Section Title) with the text action "How to add this to your calendar" (6.8c) at its right, then a segmented control (6.3, hidden label "View", options Agenda and Month; full width under 768, at most 320 from 768) kept in `?view=month` (Agenda is the default), then, in the Agenda view, a second segmented control (hidden label "Show", options Upcoming and Past, same widths) kept in `?when=past` (Upcoming is the default). Below it the interviews of all the user's applications grouped by Philippine day (6.5c), one ledger sheet per group. Upcoming lists the interviews at or after now, oldest first; Past the earlier ones, newest first. Each row is one link to that application's detail (the whole row, min 44px, padding 16): line 1 date and time in PHT (Row Title) with the outcome stamp at the right; line 2 job title (Body Medium); line 3 company (Caption, `color-text-secondary`); line 4 mode with its icon and the interviewer when present (Caption). Notes are not shown. On Upcoming rows "Add to calendar" (6.6) sits under the link, outside it. Interviews load 50 at a time with a secondary "Load more" button; "N more interviews loaded" is announced politely and focus moves to the first new row.
   - States: skeleton rows (6.12) with "Loading interviews" announced; the slow-start note (6.12) on the first load only; an error banner "Couldn't load interviews." with Retry (when cached rows are shown: "Couldn't refresh the interviews. Showing the last loaded rows."); empty "No upcoming interviews." or "No past interviews." with the line "Interviews are added from an application." and one Secondary "Go to applications" (no primary button, because an interview is added from an application).
   - The agenda has no status, no search and no counts. The Month view is the grid of 6.13 in `?view=month&month=YYYY-MM` with the selected day in `&day=YYYY-MM-DD`; a missing or invalid `month` becomes the current Philippine month and an invalid `day`, or one outside the visible grid, today when today is in the month and the 1st otherwise. Every change of view, month or day replaces the history entry, so Back leaves the screen instead of stepping through months. A month change is announced politely (`November 2026`). The Month view shows interviews only, no application dates, and cannot add or move an interview.

---

## 9. Formatting and Localization
- **Currency**: `₱85,000 / month` (monthly gross, Philippine peso). A missing salary is omitted, never shown as ₱0.
- **Dates**: `Oct 14, 2026`. **Times**: 12-hour with `PHT`, for example `2:00 PM PHT`, always in Philippine time regardless of the device's time zone. A date without a time (such as date applied) is a calendar date and never shifts with the device's time zone.
- **Sample data**: only fictional Philippine companies: Pinagsama Tech, Bayanihan Digital, Kalayaan Logistics, Mayon Software Labs, Kape Digital, Haraya Solutions. Never real companies or real websites. Use `example.ph` for emails. The same application must use the same data on every screen.
- **Icons**: Material Symbols Outlined, 24px (20px inside fields), weight 400, never filled except the active nav icon.
- **Language**: English, plain and neutral.

---

## 10. Accessibility
- Text contrast at least 4.5:1, and 3:1 for input borders, icons and focus rings, in both themes.
- Every interactive element is keyboard reachable with a visible focus ring.
- Status is never conveyed by color alone.
- Respect `prefers-reduced-motion`: no skeleton pulse, no press scale or transitions longer than 100ms.
- The month grid (6.13) is a `grid` with `row`, `columnheader` and `gridcell` roles. Each day button is named with the weekday, date and count, for example `Tuesday, Nov 10, 2026, 2 interviews` or `no interviews`; the selected cell has `aria-selected` and today `aria-current="date"`. Tint, outline and bold carry no meaning that the names do not.
- Respect `prefers-color-scheme` by default, with a manual override in Account.
- Do not disable page zoom.
- The month grid has no motion at all, so `prefers-reduced-motion` needs nothing special there; the skeleton rule above still applies to its list area.

---

## 11. Do's and Don'ts

### Do
- Show every status as a sentence-case text label inside a flat rectangular stamp.
- Keep the list as one ruled ledger sheet, and vary layout between screens instead of repeating identical cards.
- Keep touch targets at least 44 x 44px and text at least 14px.
- Use tabular numbers for currency, dates and times.
- Use real-looking, plain content only: fictional but realistic companies, dates and salaries.
- Keep copy short, neutral and plain.

### Don't
- Don't use emojis anywhere.
- Don't show an avatar, user icon, kebab menu, reference number, folio, record id, location or any text that is not a real field.
- Don't use monospace or serif fonts anywhere.
- Don't use gradients, glow, glass, soft decorative shadows, illustrations, mascots, accent stripes or decorative bars.
- Don't use all-caps text, monospace text, eyebrow labels, pill badges or status dots.
- Don't use progress bars, streaks, badges, scores, fake metrics or gamified counters.
- Don't add navigation beyond `Applications`, `Interviews` and `Account`.
- Don't use any font size below 14px.
- Don't invent fields, features or colors that are not in this document.
- Don't use the orange stamp color for anything except the logo margin line and the Interviewing status.
- Don't show an error color for a neutral hint.