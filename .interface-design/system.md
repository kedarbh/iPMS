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
