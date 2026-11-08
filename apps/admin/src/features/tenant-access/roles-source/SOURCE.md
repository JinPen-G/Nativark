# Roles and permissions

Selected after inspecting https://uiarc.dev/components/blocks/roles-permissions on 2026-11-08.

`original.css` and `classes.json` come from the user-supplied
`D:/工作文件/uiarc-pro-archive/preview/src/components/roles-permissions`.
The CSS is the preserved public rendering stylesheet; SHA-256:
`957ccbb4ff8156b4d35b6780510f0cadf55ba7b155dd7edede1e6746243b7fe6`.

The archived `reference-runtime.js` has SHA-256
`b860f6e8c6ba7c38d5d7aeb6142a8ce723e7b92fa94e80b1ec7b1338cc9368e0`.
It contains fixed demo roles and simulated saves. `../PermissionMatrixControls.tsx`
adapts its `G` toggle and `V` group-presence controls to typed React props, keeping
the original check/minus paths, locked response, mixed state, dirty markers, group
ripple and smooth height transition. Imports use the existing UIArc motion tokens
and the application reduced-motion preference. The matrix keyboard movement follows
the archive's row/nearest-column behavior through `../permission-matrix-model.ts`.

`../PermissionMatrix.tsx` supplies actual role/permission data, searchable module and
role selection, difference comparison and a single-role draft. The original role
form remains the only save path: Review opens that form with the proposed permission
set; cancelling retains the draft, a successful save clears it, and changed source
records block stale review. Permission codes absent from the visible search/module
are preserved. Fixed roles expose read-only details. The original simulated save,
demo members and in-memory role deletion/duplication are not connected to business.

Theme/responsive geometry is in `../TenantAccess.module.css`, with column dimensions
in the shared admin tokens. It keeps permission labels and headers visible while
scrolling and shows explicit grant text for a single role. The preserved stylesheet
remains unchanged. This integration is adapted from the public compiled preview,
not protected authored Pro TSX, and does not claim complete original-screen parity.

Fixed owner cells retain the source locked style. Temporarily disabled peer roles
keep their actual checked, unchecked or mixed state, with a separate disabled marker;
the original click guard still prevents a second role from changing an active draft.
