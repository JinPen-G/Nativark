# Motiq data-motion integration

Source: [Streaming Data Rows](https://motiq.dev/components/streaming-data-rows),
[public registry](https://motiq.dev/r/streaming-data-rows.json), [primitives](https://motiq.dev/r/primitives.json).
Snapshot acquired 2026-10-16. MIT, copyright 2026 Mahammad Rustamov; full notice in [LICENSE](LICENSE).
Original files are reserved unchanged apart from LF/final-newline normalization under `vendor/`.

| Source | Normalized SHA-256 |
| --- | --- |
| streaming-data-rows.tsx | a9f93db655f00d19857ec40dcd8c6e3a251e8ca285c5f184ca0f521534eb7ee0 |
| motion.ts | b26e675fd9515670d431609ad426150f83085cb83f81f4c32a3654090c03221c |
| utils.ts | 7d5fc9c5737217953b38831c9a237e7d1cb6df536e405dbf686dcd9a7d1f9c3b |

## Actual consumers and differences

The source component is presentation-only, not a server-paged grid. The existing
Tablecn adapter remains responsible for rendering, sort menus, visibility and selection.
`DataTableMotion.tsx` ports Motiq row enter/exit/position transitions, the 1400ms
single-fade change wash and numeric direction glyph, and the coalesced 1600ms announcer.
`runtime/use-animated-number.ts` is the verbatim extracted upstream numeric hook
(700ms cubic ease-out, interruption resumes at the current presentation value).
The status pill initially used upstream ToneGlyph shapes; the owner's later visual
review replaced its appearance with Tablecn outline badges and domain-specific icons,
with optional subtle semantic tint (see the Tablecn README). Original Motiq sources
remain unchanged. Status text/content still fades on actual fingerprint changes using the upstream
row opacity duration/easing. This is a Tablecn composition, not the unmodified full Motiq component.

Tailwind utilities are ported to CSS Modules. Semantic colors, type sizes, locale and
business labels come from the platform. No fictional demo status machine, currency
format, synthetic updates, demo interval, local sort, network feed or alternate table shell
is imported. Only the extracted numeric hook is a runtime import from this package;
the full reserved catalog/helper files are not bundled.

## Data and selection contract

- `DataTable animated` is opt-in; orders and the shared business-table adapter enable it.
  The adapter tracks only explicit scalar `dataIndex` facts; render-only columns are not guessed.
- Stable order IDs retain row/cell identity. Page/filter/scope changes reset motion history;
  sorting retains matching row identity for repositioning, but resets change announcements.
- Explicit column `meta.motion.value` fingerprints facts. Locale switches, selection and
  the reminder clock do not count as data edits. Hidden columns remain available.
- First loading uses skeleton rows. Same-query background refresh keeps rows visible;
  only blocking loads or placeholder rows use the existing table overlay. No simulated feed.
- Currency display continues using the business formatter. Animated intermediate numbers
  are visual only; the exact current amount remains screen-reader-readable. A currency change
  resets the numeric context; missing/non-finite amounts are not animated as zero.
- UIArc remains the sole checkbox motion owner. Reduced-motion disables row translation,
  numeric interpolation, highlight and skeleton/refresh pulsing. There is no second click sound.
- `dataTableSelectionColumn`, `DataTableSelectionSummary` and `useDataTableSelection` are shared
  template APIs. Controlled ID state retains selection across server pages, filters and sorting.
  The header selects/deselects **this page only**. Off-page counts come from the ID map, not
  TanStack's current-page selected row model. No unqueried “select all results” is implied.
- Selection is in-memory for this mounted page, not a saved view or authorization grant.
  Identity/tenant/workspace changes clear it. Blocking loads/error/placeholder rows cannot be newly
  selected; clearing an existing selection remains possible. No batch mutation is invented.

Validation uses the existing order-list offline test, type/static checks and ai-offline build.
These do not prove animation appearance, real-browser focus or real-API behavior.
The owner verifies the original orders page; no fixture page/browser/login is created.
