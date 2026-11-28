# Axiom web: interface system

These are the working decisions behind the role dashboards in `apps/web/app/overview`. Read this before adding a panel or a home, and keep new work on these values.

## Direction
- **People:** site-office managers, engineers and approvers checking what is waiting on them. They often use a phone between site visits.
- **Feel:** calm and ledger-like. The numbers have to look trustworthy, the page stays dense without feeling cramped, and nothing is decorative.
- **Focal point:** on every home it is the queue of things waiting on the viewer: work orders to review, finance to approve, advances to settle. The summary figures support the queue and must not compete with it.

## Depth and surfaces
- The pages use borders only. Cards are `#fff` on the `--pale` canvas with a `1px var(--ov-line)` border and a 14px radius.
- A strip nested inside a panel uses a tint (`#f8fafc`) and no second border. Never put a bordered card inside a bordered card.

## Type
- Inter at 14px. Hierarchy comes from weight and colour more than size.
- Panel titles are 15px/650 in ink. Panel descriptions are 12.5px in `--ov-text`.
- KPI labels are 11px/650, uppercase, letter-spacing .06em, muted.
- KPI values are 28px/700 with -0.035em letter-spacing. They drop to 22px inside a panel and on mobile.
- Every count, amount and date uses `font-variant-numeric: tabular-nums`.

## Signature: the tally strip
- `.ov-kpis` is a single ruled card, not a row of separate cards. Each cell draws its rule as a `box-shadow` just outside its top-left corner, and the strip's `overflow: hidden` clips the rules on outer edges, however the grid wraps.
- It has 4 columns on desktop and 2 below 1100px. Below 700px it stays at 2, and an odd last cell spans the full row.

## Queue rows (`.mg-queue`)
- Each row is laid out as icon, then main text, then the end block.
- The end block holds the due date or amount and the action button on one line, so each row stays one row tall.
- On mobile the end block becomes a 2-column grid: text on the left, the button pinned on the right.
- The row hover is `#fafbfd` with a 120ms ease-out transition.
- `.mg-review` gets `scale(.97)` while pressed. Both effects are turned off under `prefers-reduced-motion`.
- A long wait is shown once, as amber text beside the amount, never as a separate flag.

## Colour
- Blue (`--ov-blue`, `#1d4ed8` for links) is the single accent.
- Green, amber and red mean status only.
- In a chart, past periods are drawn in pale blue (`#c9d8f8`) and only the current period gets the accent.

## Spacing
- The base unit is 4px. Panels are padded 22px by 24px, or 18px by 16px below 700px.
- The gap between sections of a page is 20px, or 14px on mobile.

## Charts (`overview/charts.tsx`, `charts.css`)
- Charts are server-rendered HTML and SVG. A native `title` gives the exact figure on hover, key values are printed as text, and the portfolio report's detail table is the table view.
- Columns are at most 44px wide with 4px rounded tops. Stacked segments sit 2px apart. The period in progress has its label in ink.
- A single series uses pale blue for past periods and the accent for the current one.
- Projects get categorical hues in this fixed order: `#257de0`, `#f47230`, `#00b894`, `#f2a600`. They are dealt in project-code order, so a project keeps its colour. Beyond four spenders, all but the top three fold into "Other" (`#cbd5e1`). The palette passed the dataviz validator. Three of the hues are under 3:1 contrast, which is why values are always shown as text.
- Horizontal bar lists use status tones only when the bar is itself a judgement (schedule, first-time approval). Plain amounts use the accent.
- Legends and labels use text inks, never the series colour. A chart with one series has no legend.
- On mobile, column labels switch to short forms (`−3w`, `Now`).

## System layer (`app/system.css`)
- Loaded after styles.css on every page. It holds the tokens (ink steps, surfaces, rules, one accent), 36px buttons with 8px radius and `scale(.97)` press, 40px inset fields with a focus ring, tables with small tracked caps, and one keyboard focus ring.

## Fields and filters
- Every text input, select, date and textarea, in a form or a filter bar, is one control: 40px tall (44px below 700px), 8px radius, `--field-edge` border on the `--field-bg` well, 14px text (16px on phones so iOS does not zoom on focus).
- Hover darkens the edge. Focus turns it the accent with the soft ring. A field the user has left invalid (`:user-invalid` or `aria-invalid`) gets a red edge and a red ring; the message under it is 12px red.
- Selects have no native arrow and draw one 12px chevron. Date fields keep the calendar icon on the right. File pickers are a dashed well with a secondary-style button.
- Checkboxes and radios are 16px in the accent, with the label 8px away. A fieldset is a label-style heading over its controls; a group nested in a panel (invoice rows) is a tint with no border.
- A button in the same row as fields is as tall as the fields. Below 700px, filter controls and an inline form's button take the full width.
- Filter pills are 34px tall, quick-pick chips and overview chips 32px. The count inside a pill is a small even badge.
- Status pills (finance, badge, role) are 22px tall and use the dark status inks on a pale tint: green `#047857`, amber `#b45309`, red `#b91c1c`, blue `#1d4ed8`, slate `#475569`.

## Pages outside the dashboards
- The tally strip is also a system class: `.tally` with `.tally-cell`, `.tally-label`, `.tally-value` and `.tally-note`. The project overview uses it, and the finance home's `.fin-cards` follow the same rules. No dark summary card, no coloured icon tiles.
- A note in a tally cell is coloured only when it is a judgement: amber for work waiting, red for work returned or overdue.
- The finance kind marks (A, S, R) are identity, so they stay neutral.
- An overdue banner is a white card with a red left rule and a secondary button. It never fills with red.
- Plain progress bars (milestones in progress, regional delivery) use the accent. Green is for done.
- Below 700px, two-column page grids stack into one column.

## Money in tables
- A table of amounts names the unit once ("All amounts in NPR") and the cells show the figure only, with Indian grouping and two decimals (`formatAmount`). Single amounts in prose or lists keep `formatMoney` ("NPR 45,000.00").
- Zeros are greyed so the columns that carry money stand out. The row label wraps; figures never do.
- In a tally cell the unit is set small before the figure, so long amounts still fit a phone cell.
- A wide report table (the spend report) is ruled on every side inside its own bordered, scrollable box. Figure columns have a 132px floor, which fits crore-scale amounts like 12,34,56,789.00, and never wrap. A bigger number widens its column, and the table scrolls sideways. The label column wraps up to 280px and stays pinned while the figures scroll. A soft shade on the right edge shows that more columns are off-screen.

