-- WorkspaceMember.roleId previously referenced Role(id) alone. Keep the existing
-- nullable role semantics, but make a member's tenant and role tenant inseparable.
ALTER TABLE `workspace_members` DROP FOREIGN KEY `workspace_members_roleId_fkey`;

CREATE UNIQUE INDEX `roles_tenant_id_key` ON `Role`(`tenantId`, `id`);
DROP INDEX `workspace_members_role_idx` ON `workspace_members`;
CREATE INDEX `workspace_members_role_idx` ON `workspace_members`(`tenantId`, `roleId`);

ALTER TABLE `workspace_members`
  ADD CONSTRAINT `workspace_members_tenantId_roleId_fkey`
  FOREIGN KEY (`tenantId`, `roleId`) REFERENCES `Role`(`tenantId`, `id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
