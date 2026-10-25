# Tablecn shared admin-table integration

The authoritative platform reuse contract is [Admin UI spec, section 7](../../docs/公共技术资料/界面规范/管理后台-界面规范.md#7-表格与业务数据边界).
Read its source/composition map, final presentation decisions, shared APIs and new-page
checklist before integrating another business list. This README preserves technical provenance.

Current shared presentation:
Compatible Table/AnimatedTable consumers share DataTable, list tools and pagination.
The order list explicitly uses a soft badge for its primary lifecycle status. Allocation progress is a
muted icon/text `DataTableNote`; pending fee decisions and allocation issues use
warning icon/text, without badge fill, border or padding. Original predicates,
placement and timing notice predicates remain unchanged.
Explicit `variant="soft"` badges use a 24px shared height, 8% semantic fill,
same-tone text/icons, no outline and a tokenized small corner cap. `menuIcons`
adds existing action glyphs, without changing callbacks or permissions.
`compactHeader` uses the shared 36px height and neutral `surface-muted` background,
including pinned headers. The shared Table bridge enables it; raw DataTable retains
its 40px non-compact default. Source files and Motiq/portal motion remain unchanged.
The linked platform spec defines the current contract; older source details below are provenance.

Money hierarchy is opt-in: `DataTableMoney` splits only the canonical business
formatted string, retaining exact currency, sign order, grouping and cents. Numeric
figures/signs use the shared 16px/600 typography token; currency uses the 12px/400
secondary-text role. `meta.motion.renderNumber` gives the visible numeric morph the
same renderer as its static cell, instead of styling only its screen-reader copy.
Other numeric columns retain the original string output. The original numeric hook,
currency-context reset, change detection and reduced-motion/paused behavior remain;
missing order amounts display a dash, never an invented zero or payment status.

The order-only row composition uses deterministic name-initial marks and company
relation icons. The owner rejected the initial repeated category tiles and ordinary
member labels; these are removed. The item cell now shows one historical item name
and its own count, with an adjacent remaining-line count disclosure. Expansion uses
TanStack's stable row-ID state, survives column/clock/refresh updates and clears on
identity/workspace scope changes. Single-item orders have no disclosure. Remaining
names/counts stay available with keyboard-accessible expanded/controls semantics.
Order IDs use body weight; full dates and secondary times share the
same leading slot as statuses, amounts and actions. These are platform-owned data
summaries, not additional upstream components. No fake logos/photos, current-profile
joins or per-row catalogue queries are introduced: order lines currently expose no
image metadata. Identity size, icon size, corner cap and decorative series-derived
colors come from the shared admin token layer. Durations display at most two nonzero
units, keeping full minute precision in title/aria-label; warning labels remain
directly visible and unchanged. No fee/grace threshold changes or forced row-height
clipping. Original sort keys,
permissions, monetary formatting, selection and all vendor motion remain intact.

- Upstream: https://github.com/sadmann7/tablecn ; demo: https://www.tablecn.com/
- Pinned source: `ab52bf307da4d6ed006e686ebaf5db3be9391033`, the final parent of upstream's TanStack v9 migration. This integration deliberately uses its compatible TanStack v8.21.3 contract, not a mixture of v8 and v9 files.
- License: MIT, copyright 2024 Sadman Sakib; full notice in [LICENSE.md](LICENSE.md).
- `vendor/` reserves original Tablecn files with LF line endings and a final newline. They are reference/source provenance, not a second admin application or an unreviewed catalog bundle.
- Actual consumers: `apps/admin/src/components/ui/data-table/` through the shared `@/components/ui` entry. As authorized on 2026-10-24, the legacy `Table`/`AnimatedTable` entry bridges business columns into the same renderer as `RentalOrdersPage`, including tenant/platform lists, drawers and previews. `DataTableToolbar` owns refresh/sort/view controls, and all paged consumers use the existing shared `Pagination`; geometry/colors remain shared admin tokens, not per-page copies. Original field renderers, row IDs, callbacks and read/write boundaries remain page-owned.
- Refresh is supplied by the owning query or `TableRefreshProvider`; purely local snapshots/forms explicitly disable it. Complete datasets sort before local pagination; remote pages retain server order unless an actual sorter callback is provided and are never sliced twice. Unsupported selection/filter/tree/custom-renderer contracts still have an explicit Ant compatibility fallback. This is source integration, not a claim of live acceptance on every route.
- List layout uses the shared frameless `ListSection`, not an enclosing Card. Keep section titles/actions; send per-table filters through `ListSection.controls` or `Table.toolbar` so the shared `DataTableToolbar` aligns them with refresh/sort/columns at the same filter-height token. Notes use `toolbarNote`, nested expanded tables do not inherit the parent filters, and narrow layouts wrap naturally. The table's own border remains; actual form cards remain intact. See UI spec v2.36.
- UI spec v2.37 refines that rule: keep titles only when they distinguish real sections, not when they repeat a single list's page name or pagination count. Page descriptions are optional. Do not add persistent implementation/tutorial banners; necessary operational scope, warnings and unavailable-feature notices remain. A remote-order explanation belongs on the disabled sort control, not an extra text row on every list.

## Integration differences

The adapter ports Tablecn's semantic table rendering, column-header sort/hide menu, searchable View popover and multi-sort list into CSS Modules because this admin does not install Tailwind/shadcn globally. It uses the same TanStack headless engine, Radix menus/popovers, cmdk field search and dnd-kit sorting interactions. Platform UIArc buttons, localization, configurable radii and neutral light/dark tokens remain in control. The later-approved motion composition uses [Motiq source](../ui-motiq/README.md); no synthetic data feed or replacement application/backend is introduced. Upstream source is preserved separately; this is an attributed integration, not byte-for-byte rendering of the entire demo site.

The table has its own fine border and first/last column inset. No outer search/table card is added. Secondary quote, security, resource and location details remain available through View; the fixed identity/actions columns cannot be hidden. Long item collections use native disclosure instead of forcing every row to its full height. On narrow screens pinning is released and the table scrolls horizontally.

Radius roles are independent: the frame, loading overlay and floating panels use
`--rental-ui-radius-container`; actions/menu items use `--rental-ui-radius-button`;
search and select fields use `--rental-ui-radius-input`. Do not use the legacy
button-derived `--rental-ui-radius-sm` for container clipping: the approved 999px
button preset must not turn the table or popovers into ovals. Regression coverage
compares independent container/input values before and after that button preset.

Status presentation follows the pinned `components/ui/badge.tsx` outline Badge
and `app/components/tasks-table-columns.tsx` examples: compact pill, fine neutral
border, and a meaningful Lucide icon beside the label. Both source files and the
example icon mapping in `app/lib/utils.ts` are reserved under `vendor/`.
Their demo factories/types are reference only and are never imported or installed.
The rental domain supplies distinct icons for confirmation, handover, renting,
inspection, settlement, closure, cancellation and no-show; allocation progress
uses layers/list/lock icons. No fictional Priority field is added.
The restored 12% semantic background and 38% matching border are explicitly approved host extensions;
text remains foreground-colored rather than a full colored Motiq status pill.
Existing Motiq cell-change fade/emphasis and the 32px leading slot remain separate
from the Tablecn badge's 20px geometry.

Row actions follow the pinned task columns' Ellipsis/ghost trigger pattern.
`DataTableRowActions` combines a permission/status-selected primary action with an
always-available three-dot menu. Text actions retain the original UIArc Button
motion; the 32px zero-padding ghost Ellipsis trigger and Radix portal menu use
the pinned Tablecn geometry and shared table-menu styles. There is no hover-expanding action dock.
Both controls sit together with the shared 8px gap, without an auto margin pushing
them to opposite ends of the column. Order numbers and the menu open details;
rows without a primary action keep a document icon plus visible details text.
Menu entries are text-only, exclude details and the visible primary action;
an empty menu disables/grays its native trigger. Its separate CSS port follows
the upstream 160px menu, padding, shadow/ring and 100ms directional fade/95% zoom,
not the header menu's 150ms motion or UIArc's gliding highlight. Platform theme,
configurable radii and reduced-motion integration remain explicit host adaptations.
The order-specific adapter filters shortcuts and deep-links
to existing detail operations. Deep-link handling only scrolls/focuses an entry;
it never clicks it, acquires a lock or bypasses cancellation/settlement checks.

Sorting is ordered, multi-column and server-side: `sort=startAt.asc,endAt.desc`. The API validates up to eight unique allowlisted keys and applies stable ordering before LIMIT/OFFSET, while retaining tenant/workspace/location/own WHERE predicates. Reset returns to the existing createdAt/id descending order. It never sorts only the loaded page. Column visibility is local page state, not a claim of persisted/shared saved views.

The View popover now follows the pinned `data-table-view-options`, `command`,
`input-group` and `popover` sources, rather than the older generic menu adapter:
176px width, default center alignment, inset 32px search group, 4px command/group
padding, 16px checkmarks, 288px no-scrollbar list and the original 100ms directional
fade/95% zoom. Theme, configurable radii, locale, stable column IDs for search and
viewport collision constraints are explicit host adaptations. The new Command
and InputGroup source references are retained verbatim under `vendor/components/ui`;
no Tailwind application, extra dependency or vendor rewrite is introduced.
Existing sort-field popovers are outside this specific View correction.

Refresh preserves rows and height with an in-table loading overlay and inert old
body. There is no extra progress rail or visible loading-text row above the table.
Initial loading retains cell skeletons, failures retain the existing inline retry,
and reduced motion stops spinner rotation without hiding loading state.

## Search height and time presentation

The pinned source toolbar and input use `h-8` (32px). Platform geometry is defined by shared tokens: 36px regular/filter, 32px compact, 40px large. DataTableToolbar maps its controls to the filter role so search, select, refresh, sort and column controls align. Form fields retain their grid width; direct list selects use the shared select width. Source dimensions are provenance, not a second platform density scale.

Planned pickup and return have separate labelled columns, full dates and hours/minutes. Effective renewal end is used and the original end remains visible. Reminders are display-only: overdue pickup is not a no-show decision, and overdue return is not a fee calculation. Closed/cancelled/no-show/inspection/settlement records do not receive live lateness warnings. Partially returned orders warn only when picked-up resources remain. Carrier shipments are excluded from pickup/return lateness labels because the list alone lacks handoff evidence; saved carrier due times can still be displayed.

## Validation boundary

Shared selection APIs now supply the original multi-select interaction: a checkbox column,
page-only header selection, selected-row styling and clearable summary. The controlled ID
map preserves choices across server pages and reports off-page selections explicitly.
Tenant/workspace/user changes clear the map; no new batch API or implicit all-results selection.

`tests/rental-order-list-presentation.test.cjs` checks time/renewal/closed/carrier cases, allowlisted SQL, ordered multi-sort before pagination with scoped fake repository dependencies, headless visibility/manual sorting and semantic SSR. It neither opens a browser nor connects to a real database. Type checks and the explicit Vite ai-offline mode supplement these checks; neither establishes visual/runtime acceptance. The owner verifies the original orders page. No separate demo page, login, deployment or automatic commit is part of this change.
