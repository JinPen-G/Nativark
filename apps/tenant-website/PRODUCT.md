# Tenant Rental Website

2026-11-10 整合说明：下述浏览器记录属于源改版阶段；合入 main 后的当前验证及未验边界见预约网站开发记录，不作为本次浏览器或真实业务验收。

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Consumers browse a tenant's rental catalog, choose dates and fulfillment, make a reservation, and manage their own orders and account. The same website serves tenants operating one, two, or several categories.

## Product Purpose

The homepage introduces the tenant's rental offer through brand imagery, categories, popular selections and campaign announcements. Visitors quickly choose category, rental times, city and pickup store, then submit a query to the separate product-list page. Only that results page scopes availability and prices to the selected conditions; homepage recommendations are curated discovery, not a live-stock grid. Daily rent leads price display. The accepted photographic hero and rental finder stay intact; below them, small category links, up to six compact recommendations and text-only campaign rows reduce repeated imagery and scrolling.

## Operating Context

The existing React/Vite application is `apps/tenant-website`, separate from the platform marketing website. Demo tenants use `?tenant=single`, `double`, or `multiple`; existing remote tenants use the established tenant resolution and client APIs. The current redesign is checked using local demo data, real Playwright demo interactions and route screenshots, plus offline component/SSR and favicon checks. The preceding stage passed 24 interaction checks, a 74-route/50-full-page-screenshot browser matrix, a separate 320px English guide check, the build, 216 offline renders and 9 favicon checks. This polish passed 17 targeted browser checks and produced 8 fresh screenshots across 320/390/768/1440px; after two review corrections, 5 further focused checks passed for tablet category navigation and empty-result recovery preserving conditions. No API requests or runtime exceptions were observed in the checked demo flows, and the fresh screenshots had no overflow, broken images or runtime errors. The earlier full matrix was not rerun for this polish; after the final two corrections, the build, 216 offline renders and 9 favicon checks passed again. Independent review confirmed both scored corrections resolved within the reviewed polish scope. These checks do not validate real customer services, inventory reservation, payments or production acceptance.

The current icon-motion refinement is a narrow extension of that accepted visual system. It passed 27 targeted real Chromium checks for interruption/rest, Escape focus recovery, reduced motion, stable labels and button bounds, 320/390/768/1440px, English and dark theme. Nine fresh route captures plus four support/midframes are in `.impeccable/review/icons-*.png`; checked demo flows had no API requests, runtime exceptions, horizontal overflow or broken images. Independent source-and-frame review of all 13 images found no material fixes and recommended shipping; browser evidence comes from the separate Chromium run. The build passed with an approximately 523kB initial JavaScript chunk warning, which alone does not establish a performance failure; 216 static renders and 9 favicon checks passed again as offline checks. Earlier 74/50 and 17/8/5 browser records were not rerun. Physical touch devices, real services and production acceptance remain unverified.

## Capabilities and Constraints

- Preserve one data model, shared components and category-count-based layouts.
- Preserve tenant identity, brand configuration, localization, light/dark preferences, search conditions, authentication and original booking/order/account contracts. Navigation carries one tenant identity key and preserves fragments. Clearing search or changing category retains rental dates and store context; booking back-links and related items retain the currently edited date/quantity/fulfillment selection, revalidating it for the destination product. This is navigation intent, not service authorization.
- Demo reservations are local browser records, not merchant submissions, inventory reservations, payments or business receipts.
- All member sections and full login/registration forms have preview layouts. Demo account pages make no account API requests; address save, SMS and login remain disabled. Empty coupons and notifications are not fabricated. Real tenants retain existing session/account contracts.
- Orders present original Core facts and missing values, schedules, locations, cost and actual payment state. Preserve the existing payment idempotency flow.
- About presents concise rental principles and configured pickup locations, showing only supplied address and opening-hour facts and linking to store-scoped rental browsing. The guide pairs a local contents index with detailed rental steps.
- Catalogue condition editing is one continuous neutral surface; cancel restores the current query draft. Empty-result recovery clears only the chosen restriction and avoids a duplicate all-products action when already browsing all products.
- Help supports FAQ search. Agreements and policies use supplied tenant content, valid external links or an explicit missing state; localized 404/error pages offer real recovery actions.
- Prices, deposits, inventory, eligibility and final results remain owned by the existing service contracts; the redesign must not introduce another calculation or authorization path.
- This task authorizes a complete visual and layout redesign and local frontend preview, but no new backend integration, live-service validation, installation, publication or deployment.

## Brand Commitments

Tenant branding stays configurable. Demo tenants use the supplied pure-black SVG and corresponding pure-white SVG, never the old blue PNG. Tab icons use the exact standalone mark from that SVG in black/white according to theme; a real tenant’s custom compact logo remains authoritative. The user explicitly rejected the editorial layout and stock-result-first concepts; the new home follows spacious, minimal, fashionable international rental-company presentation. Marketing copy is calm, concrete and human: name the plan, product, outing or collection arrangement. The user rejected generic “good things” and lifestyle slogans, including 好物相伴 and 好物随行. Demo hero text, including English, follows tenant configuration; real tenant copy stays configuration-owned. Existing rental functions remain authoritative. Local demo cities and campaigns are illustrative; missing real city metadata is not guessed from an address.

## Evidence on Hand

Local product and lifestyle images are in `public/assets`; demo branding is in `public/brand`, with original brand resources in the repository. The catalog contains explicitly illustrative products, stores and testimonials. No new customer testimonials, performance metrics, service promises or live acceptance evidence may be invented. Curated references and exact retrieval limitations are recorded in `.impeccable/reference-notes.md`: URBANMOVE’s 2024 CSS Winner record, the primary Grover studio case and Dance’s current content. They inform presentation and copy, without claiming that exact live motion was verified.

## Product Principles

- Help browsing feel spacious without hiding transaction-critical information; use compact discovery below the hero instead of repeated oversized product imagery.
- Use progressive disclosure for detail, never for risks or missing facts.
- Keep consumer workflows distinct from merchant administration.
- Semantic icon motion follows the nearest existing control on hover, keyboard focus or pointer press, without idle playback or added focus stops. Real menu/disclosure state owns its glyph; reduced motion retains the correct static state. The established Lucide drawings, 1.75 stroke, display metrics and control labels stay intact. Static separators and ratings, plus loading status behavior, retain their existing roles. Existing auth, Core facts and data/service contracts remain authoritative.
- Preserve keyboard access, responsive behavior and reduced-motion alternatives. Reveal selected horizontal navigation items within their own rail after selection, language or viewport changes; keyboard tab changes do not jump the page. At tablet widths, category navigation sits above the complete results grid. Mobile business fields use 16px text and toolbar controls provide 44px targets.
