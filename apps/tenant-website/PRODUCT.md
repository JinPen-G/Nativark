# Tenant Rental Website

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Consumers browse a tenant's rental catalog, choose dates and fulfillment, make a reservation, and manage their own orders and account. The same website serves tenants operating one, two, or several categories.

## Product Purpose

Make useful equipment easy to discover and rent without requiring ownership. A successful interface helps a visitor understand the item, availability, dates, fulfillment and costs, then complete the existing reservation flow confidently.

## Operating Context

The existing React/Vite application is `apps/tenant-website`, separate from the platform marketing website. Demo tenants use `?tenant=single`, `double`, or `multiple`; existing remote tenants use the established tenant resolution and client APIs. The current redesign is reviewed through local demo data, not real customer or payment services.

## Capabilities and Constraints

- Preserve one data model, shared components and category-count-based layouts.
- Preserve tenant identity, brand configuration, localization, light/dark preferences, search conditions, authentication and original booking/order/account contracts.
- Demo reservations are local browser records, not merchant submissions, inventory reservations, payments or business receipts.
- Prices, deposits, inventory, eligibility and final results remain owned by the existing service contracts; the redesign must not introduce another calculation or authorization path.
- This task authorizes a complete visual and layout redesign and local frontend preview, but no new backend integration, live-service validation, installation, publication or deployment.

## Brand Commitments

Tenant branding stays configurable. Rental OS assets are used for demo tenants; they must not replace a real tenant's brand. The user requests a minimal, luxurious, comfortable experience with humane motion, and delegates design choices. Existing product content and facts remain authoritative.

## Evidence on Hand

Local product and lifestyle images are in `public/assets`; demo branding is in `public/brand`, with original brand resources in the repository. The catalog contains explicitly illustrative products, stores and testimonials. No new customer testimonials, performance metrics, service promises or live acceptance evidence may be invented.

## Product Principles

- Help browsing feel spacious without hiding transaction-critical information.
- Use progressive disclosure for detail, never for risks or missing facts.
- Keep consumer workflows distinct from merchant administration.
- Preserve keyboard access, responsive behavior and reduced-motion alternatives.
