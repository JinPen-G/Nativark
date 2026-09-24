# Design QA — Staff mini-program orders

final result: blocked

## Target and evidence

- Source visual truth: `D:\工作文件\rental-OS\apps\设计图\ChatGPT Image 2026年9月23日 11_19_34.png` (orders list) and `D:\工作文件\rental-OS\apps\设计图\ChatGPT Image 2026年9月23日 11_19_41 (1).png` (order detail).
- Supplemental order-detail reference supplied in chat: `C:\Users\Penn\AppData\Local\Temp\codex-clipboard-c298da24-bb0e-4336-8cc7-862e7dc4a7dd.png` (790 × 1700 px).
- Implementation screenshot after this change: unavailable. The previously supplied orders screenshot predates this change and cannot verify the updated render.
- Intended device viewport: approximately 393 × 852 CSS px; the supplied order-detail reference is approximately 2× density. The design-board images are 1448 × 1086 px and include phone frames, so their embedded screens are not treated as 1:1 captures.
- State: orders list with the “全部” tab and range/create toolbar; order detail with customer, lease, items, fees, and existing status actions.

## Comparison and findings

- Focused-region comparison: the order-detail design is the second phone from the left in the deep-page board (`ChatGPT Image 2026年9月23日 11_19_41 (1).png`, approximately x=390–700, y=175–900). A diagnostic side-by-side was assembled at `C:\Users\Penn\AppData\Local\Temp\codex-order-detail-comparison.png` from that target crop (296 × 718 px) and the older implementation screenshot (790 × 1700 px). Because viewport scale and order status differ, this is for locating structural gaps only, not acceptance.
- [P1, pre-fix] The detail page did not follow the design's hierarchy: contact action was below the customer data instead of in the card heading; company/address details were absent; allocation data was detached from its equipment line; the equipment image and quantity hierarchy were too small; pricing was reduced to deposit/paid total; and available order actions scrolled with content instead of staying in the bottom action area.
- This pass changes that structure: contact sits in the customer-card heading; authorized customer profiles can populate company and region; equipment allocations/SNs are grouped under their order line with larger imagery and right-aligned quantities; fee rows show rental, deposit, optional service/discount, and payable total; existing permitted status actions are pinned above the safe area. Customer-profile lookup is permission-gated and failure does not block order detail. Existing action handlers remain in place.
- The previously supplied implementation screenshot is an older, cancelled-order state, so it cannot verify the current code or the reference board's active “待发货” state. A post-change render is still required.
- Latest button/scan comparison: source board `D:\工作文件\rental-OS\apps\设计图\ChatGPT Image 2026年9月23日 11_19_42 (3).png` (1448 × 1086 px) shows the scan-entry CTA spanning the content column. The pre-fix screen supplied as `C:\Users\Penn\AppData\Local\Temp\codex-clipboard-3e9611b5-40e9-472b-baa1-07ae43119196.png` (936 × 1328 px) visibly showed a much narrower CTA. The companion `codex-clipboard-5f1420be-d57e-43bc-a2cf-e8aa219bdc85.png` (840 × 474 px) shows compact tappable profile rows. These are pre-fix screenshots and have different crops/densities from the design board.
- [P1, pre-fix] Several tappable rows had page-level height overrides below their original shared hit-area sizes: profile menu 82rpx vs shared cell 104rpx, workbench todo 78rpx vs shared todo 88rpx, and order customer row 84rpx vs shared cell 104rpx. These compact overrides were removed to restore the original shared heights; standard `.btn`/`.btn--cta` heights (88rpx/96rpx) and scan CTA height (148rpx) were retained.
- [P1, pre-fix] Scan CTA rendered at roughly half the intended content width despite its existing `width: 100%` rule. It is now a block-level view with an explicit full-width box, button accessibility role/label, the same `onStartScan` handler, and a disabled visual state guarded by the existing handler.
- Post-fix screenshot is not yet available, so restored hit-area sizing and full-width CTA remain unverified in the WeChat renderer.

## Required fidelity surfaces

- Fonts and typography: semantic typography and design hierarchy were adjusted in source; rendered weights, wrapping, and truncation cannot be verified without a post-change capture.
- Spacing and layout rhythm: detail cards use 32rpx page gutters, larger card/line rhythm, and a bottom safe-area action region; final rendered alignment is unverified.
- Colors and visual tokens: existing semantic colors were retained; rendered color fidelity is unverified.
- Image quality and asset fidelity: existing item-group cover source is retained and the display region enlarged; actual loaded-image crop/quality is unverified.
- Copy and content: factual customer and order values are used; optional customer company/region are fetched only when permitted; no placeholder business data is fabricated.
- Data-contract limitation: `SharedCustomerProfile` exposes `corporateName` and `region`, but no street-address field. The page can reproduce the design's company/region rows, but cannot display a full street address unless the customer/order contract supplies one; none was invented.

## Comparison history

- Earlier implementation pass: updated list toolbar spacing and card gutters; refined detail heading, card padding, row rhythm, and total divider. This was insufficient to match the detail composition.
- Structural detail pass: moved contact action into the customer heading; added permission-gated company/region; grouped assigned resources with equipment lines; expanded equipment rows; added itemized fee fields; pinned currently allowed order actions. Verification: `npm run build:staff-miniprogram` passed (25 pages), and `node --test tests/staff-miniprogram-static.test.cjs` passed (18/18). These checks validate compilation/static contracts, not visual fidelity.
- Button/scan pass: removed compact row-height overrides from profile, workbench, and order customer tap rows; changed scan CTA from a native button to a full-width block view while preserving its tap handler and disabled guard. Rebuilt successfully (25 pages); static suite passed 18/18. The attached implementation screenshots predate these changes, so there is no post-fix visual evidence yet.

## Blocker

The WeChat Developer Tools MCP listener on port 5881 and the API on port 3000 were absent on the 2026-09-24 recheck. MySQL on port 3306 is running, but the configured target is the shared `rental_os` database; the read-only migration-status guard refused that target, and no migration or database write was attempted. Source inspection confirms the scan Tab is an action-entry page and the CTA routes to a separate camera page; the CTA source style is full-width at 148rpx, while shared buttons/rows retain 88/96/104rpx tap heights. This is source evidence only, not a rendered visual check. The available order screenshots predate the latest edits, so visual QA remains blocked until a post-fix capture is available at the reference viewport; the order-detail comparison also needs the same active-order state.
