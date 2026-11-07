# Roles and permissions

Selected after inspecting https://uiarc.dev/components/blocks/roles-permissions on 2026-11-08.

`original.css` and `classes.json` come from the user-supplied
`D:/工作文件/uiarc-pro-archive/preview/src/components/roles-permissions`.
The CSS is the preserved public rendering stylesheet; SHA-256:
`957ccbb4ff8156b4d35b6780510f0cadf55ba7b155dd7edede1e6746243b7fe6`.

The archive's compiled preview has fixed demo roles and simulated saves.
`../PermissionMatrix.tsx` supplies real read-only role comparisons and a form-controlled,
searchable permission editor. It preserves the original matrix spacing and grouped
rows through the supplied CSS. Theme/responsive integration is in
`../TenantAccess.module.css`; the original stylesheet remains unchanged.
Existing role APIs own saving, fixed-role rules and authorization. This integration
is not protected authored Pro TSX and does not claim full source parity.
