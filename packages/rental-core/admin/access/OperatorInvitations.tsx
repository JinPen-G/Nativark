/** Rental 邀请宿主提供真实经营空间和原范围配置，发送与结果恢复由公共表单驱动。 */
import type { BusinessWorkspace } from "@rental-os/rental-core";
import type { SystemRoleRow } from "@rental-os/platform-contracts";
import { OperatorInvitations as PublicOperatorInvitations, type InvitationBusinessAccessProps } from "@rental-os/platform-admin/messaging";
import { useLocale } from "@rental-os/platform-admin/locale";
import { Checkbox, Form, Select } from "@rental-os/platform-admin/ui";

interface Props { open: boolean; onClose: () => void; roles: SystemRoleRow[]; workspaces: BusinessWorkspace[]; }

export function OperatorInvitations({ workspaces, ...props }: Props) {
  const { t } = useLocale();
  return <PublicOperatorInvitations {...props} title="邀请运营用户" revokeTitle="撤回这封运营邀请？" subtitle={t("通过邮件加入租户，接受后启用账号与经营空间权限。")}
    businessAccess={{ requiredMessage: t("请选择至少一个经营空间"),
      render: access => <RentalInvitationAccess {...access} workspaces={workspaces} /> }} />;
}

function RentalInvitationAccess({ workspaces, accesses, onChange, roles, defaultRole, disabled, classNames }:
  InvitationBusinessAccessProps & { workspaces: BusinessWorkspace[] }) {
  const { t } = useLocale();
  function changeAccess(workspaceId: string, enabled: boolean) {
    onChange(enabled ? [...accesses, { workspaceId, roleId: defaultRole, dataScope: "store",
      locationScope: { mode: "all", locationIds: [] }, isActive: true }] : accesses.filter(row => row.workspaceId !== workspaceId));
  }
  return <>
    <h3>{t("经营空间授权")}</h3>
    <p>{t("逐人角色作为租户基础角色；下方空间授权应用于本批邀请。可在账号加入后细化地点权限。")}</p>
    {workspaces.filter(workspace => workspace.status === "active").map(workspace => {
      const access = accesses.find(row => row.workspaceId === workspace.id);
      return <div key={workspace.id} className={classNames.row}>
        <Checkbox disabled={disabled} checked={Boolean(access)} onChange={event => changeAccess(workspace.id, event.target.checked)}>{workspace.name}</Checkbox>
        {access && <Form layout="vertical" className={classNames.fields}>
          <Form.Item label={t("空间角色（操作权限）")} htmlFor={"invitation-role-" + workspace.id}>
            <Select id={"invitation-role-" + workspace.id} disabled={disabled} value={access.roleId}
              options={roles.map(role => ({ value: role.id, label: role.name }))}
              onChange={roleId => onChange(accesses.map(row => row.workspaceId === workspace.id ? { ...row, roleId } : row))} />
          </Form.Item>
          <Form.Item label={t("数据范围")} htmlFor={"invitation-scope-" + workspace.id}>
            <Select id={"invitation-scope-" + workspace.id} disabled={disabled} value={access.dataScope}
              options={[{ value: "store", label: t("当前空间全部数据") }, { value: "own", label: t("仅本人") }]}
              onChange={dataScope => onChange(accesses.map(row => row.workspaceId === workspace.id ? { ...row, dataScope } : row))} />
          </Form.Item>
        </Form>}
      </div>;
    })}
  </>;
}
