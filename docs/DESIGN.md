# Talaan Design System v2.1 (Design.md)

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
- **Navigation**: exactly two destinations, `Applications` and `Account`.
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
- Never combine a border and a shadow on the same element.
- Minimum touch target: 44 x 44px.

---

## 6. Components
All values below are token names. Every component must work in light and dark mode through tokens alone.

### 6.1 Buttons
Height 48px, radius `radius-sm`, label Body Medium. Focus: 2px `color-focus-ring` with 2px offset.

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

Input, select and textarea borders always use `color-border-input` (3:1 against the surface), never `color-border-subtle`. Field label: Caption Bold, above the field. Required fields show "Required" in `color-text-muted` at the right of the label row. A prefix such as the peso sign and a suffix such as "/ month" sit inside the field on one line and never wrap.

### 6.3 Segmented control (Work mode: On-site, Hybrid, Remote)
Track height 44, bg `color-surface-subtle`, 1px `color-border-subtle`, radius `radius-sm`, padding 4. Selected segment: bg `color-primary`, text `color-text-inverse`, radius 2. Unselected: no fill, text `color-text-secondary`.

### 6.4 Status stamp and filter tabs
- **Status stamp**: height 28, padding 4 x 10, radius `radius-xs`, Stamp type, sentence case label, uses the status tokens (text, bg, 1px border). It is a flat rectangle, never a pill, and has no dot or icon. Interview outcome stamps use the same component.
- **Filter tab**: height 36, padding 6 x 14, radius `radius-sm`, Stamp type, label only (a status name or "All"), horizontally scrollable. Active: bg `color-primary`, text `color-text-inverse`. Inactive: bg `color-surface-card`, text `color-text-secondary`, 1px `color-border-subtle`.

### 6.5 Ledger sheet and application row
The applications list is one ledger sheet: a single container (bg `color-surface-card`, 1px `color-border-subtle`, radius `radius-sm`, no shadow) holding rows separated by 1px `color-border-subtle` rules. Rows are not separate cards. Each row is at least 44px tall, tappable as a whole, padding 16:
1. Line 1: job title (Row Title, `color-text-primary`) and the status stamp at the right.
2. Line 2: company name (Caption, `color-text-secondary`).
3. Line 3: work mode and salary on the left (Caption Bold for salary, format `Hybrid · ₱85,000 / month`) and date applied on the right (Caption, `color-text-muted`, format `Oct 14, 2026`). When status is Saved and there is no date, show "Not applied yet".
On desktop the selected row has bg `color-primary-tint` (no accent stripe).

### 6.6 Interview entries
Interviews on the detail screen use the same ledger sheet, one row per interview in date order, separated by rules. Each row: date and time in PHT (Row Title, for example `Oct 24, 2026, 2:00 PM PHT`) and the outcome stamp (Pending, Good or Bad, always shown); below it the mode with an icon (On-site, Online, Async), the interviewer name only when present (Caption, `color-text-secondary`), and notes (Caption, `color-text-muted`). No "Next" or "Upcoming" labels, no interview titles, no stage names.

### 6.7 Navigation
- **Top app bar**: height 56, padding 0 16, bg `color-bar-bg`, text and icons `color-bar-text`, no border. Main screens show the logo mark and the wordmark "Talaan". Inner screens show a back arrow, the screen title (Bar Title) and, where needed, text buttons "Edit" and "Delete" on the right. No bell, no avatar, no user icon, no kebab menu, and no decorative page title such as "Ledger". Titles are sentence case.
- **Bottom navigation (mobile)**: height 64, bg `color-surface-card`, top border 1px `color-border-subtle`, two items: `Applications`, `Account`. Active: icon and label `color-primary` on a `color-primary-tint` pill. Inactive: `color-text-secondary`.
- **Floating add button**: 56 x 56, `radius-fab`, bg `color-primary`, outline plus icon (`color-text-inverse`), shadow token, 16px from the right edge and 16px above the bottom nav. Accessible label "Add application". The list has bottom padding of at least 88px so the button never covers a row.

### 6.8 Bottom sheet and dialog
Scrim `color-overlay`. Mobile sheet radius `radius-sheet` on the top corners; desktop dialog radius `radius-sheet`, centered, max width 440. bg `color-surface-card`, padding 24 20 32, shadow token. Contents: icon badge (40px square, radius `radius-sm`, bg `color-error-bg`), title (Section Title), message (Caption, `color-text-muted`), then full-width buttons: Destructive (48) above Secondary "Cancel" (48). Focus is trapped inside; Escape closes.

### 6.9 Toast
Height 48, padding 12 x 16, radius `radius-sm`, shadow token. Success: `color-success-bg` / `color-success-border` / `color-success-text`. Error: `color-error-bg` / `color-error-border` / `color-error-text`. Auto-dismiss after 4 seconds; errors stay until dismissed.

### 6.10 Banner (inline)
Radius `radius-sm`, padding 16, 1px border. Error banner uses the three error tokens, a leading outline icon, a bold one-line title and one line of text.

### 6.11 Empty state
Centered, padding 48 24, 48px outline icon (Material Symbol "description") in `color-text-muted`, title Section Title, one plain sentence in Caption `color-text-muted` (no exclamation marks), one 44px primary button. Example: "No applications yet. Add the first job you applied to." with a button "Add application".

### 6.12 Loading skeleton
Rows keep their ledger sheet and rules; each row shows three bars. Base `color-border-subtle`, highlight `color-surface-subtle`. Gentle opacity pulse 0.6 to 1.0 over 1.8s. Radius 4.

---

## 7. Layout and Responsive Behavior

| Breakpoint | Width | Layout |
|---|---|---|
| Mobile | under 768 | Single column, 16px gutter, bottom navigation, floating add button |
| Tablet | 768 to 1279 | Single column list centered, max content width 640, left side navigation rail (80px, icons with labels beneath) replaces bottom nav |
| Desktop | 1280 and up | Left side navigation (240px) with `Applications` and `Account`. Applications screen is two panes: the ledger sheet (400px) and detail (fills the rest, max width 720). Selecting a row fills the detail pane; there is no separate detail page. |

- The add and edit form opens as a centered dialog (max width 560) on tablet and desktop, and as a full screen on mobile.
- Content max width on any screen is 1120.
- The floating add button becomes a primary "Add application" button in the list header on desktop.
- Desktop has no top bar. The 240px side navigation is solid `color-bar-bg` with the logo mark and wordmark at the top and two items (`Applications` active on a `color-primary-tint` pill, `Account`). The list pane header shows the title "Applications" and the "Add application" button. The detail pane header shows "Edit" and "Delete" text buttons. The selected row has a `color-primary-tint` fill with no accent stripe.

---

## 8. Screens (reference list)
1. **Sign up / Log in**: an ink-blue band at the top (`color-bar-bg`, about 200px tall) with the logo mark, the wordmark "Talaan" and one plain line, "Track every application in one place." Below it on paper, a two-option segmented control (Log in, Create account). Sign up fields: Account name, Email, Password (with show/hide), Invite code, plus the plain line "Access is by invitation for now." Log in fields: Email, Password.
   - Failed login message: "Incorrect email or password."
   - Failed sign up message (one banner only, no field-specific message): "We could not create the account. Check the invite code and email, then try again."
2. **Applications list**: app bar, status filter tabs (All plus each status, label only), the ledger sheet of application rows, floating add button, empty state, loading skeletons.
3. **Application detail**: a full page (not an overlay) with a back arrow in the app bar; header block (job title, company, status stamp), Key details (monthly gross salary, work mode, date applied, website link), Notes, Interviews as ledger rows in date order with an "Add interview" action, Edit and Delete as text buttons in the app bar. Delete opens the confirmation sheet.
4. **Add / edit application form**: fields Company (required), Job title (required), Status, Date applied (helper "Optional while status is Saved"), Monthly gross salary (PHP) with `₱` prefix and `/ month` suffix and neutral helper "Enter the amount before tax", Work mode (segmented control), Company website, Notes. Buttons: Primary "Save application" and a separate Secondary "Cancel".
5. **Add interview form** (full screen on mobile, dialog on tablet and desktop; title "Add interview"): fields in this order: Date and time (Required, shown in PHT), Mode (segmented: On-site, Online, Async), Interviewer (Optional), Outcome (select: Pending, Good, Bad; default Pending), Notes (Optional). Buttons: Primary "Save interview" and Secondary "Cancel". No application summary card, no round number.
6. **Delete confirmation**: a bottom sheet (mobile) or dialog (desktop) over the dimmed detail screen: 40px square icon badge with a trash outline icon on `color-error-bg`, title "Delete this application?", message "[Company], [Job title], and its interviews will be removed. This cannot be undone.", then Destructive "Delete application" above Secondary "Cancel".

---

## 9. Formatting and Localization
- **Currency**: `₱85,000 / month` (monthly gross, Philippine peso).
- **Dates**: `Oct 14, 2026`. **Times**: 12-hour with `PHT`, for example `2:00 PM PHT`.
- **Sample data**: only fictional Philippine companies: Pinagsama Tech, Bayanihan Digital, Kalayaan Logistics, Mayon Software Labs, Kape Digital, Haraya Solutions. Never real companies or real websites. Use `example.ph` for emails. The same application must use the same data on every screen.
- **Icons**: Material Symbols Outlined, 24px (20px inside fields), weight 400, never filled except the active nav icon.
- **Language**: English, plain and neutral.

---

## 10. Accessibility
- Text contrast at least 4.5:1, and 3:1 for input borders, icons and focus rings, in both themes.
- Every interactive element is keyboard reachable with a visible focus ring.
- Status is never conveyed by color alone.
- Respect `prefers-reduced-motion`: no skeleton pulse, no press scale or transitions longer than 100ms.
- Respect `prefers-color-scheme` by default, with a manual override in Account.
- Do not disable page zoom.

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
- Don't add navigation beyond `Applications` and `Account`.
- Don't use any font size below 14px.
- Don't invent fields, features or colors that are not in this document.
- Don't use the orange stamp color for anything except the logo margin line and the Interviewing status.
- Don't show an error color for a neutral hint.