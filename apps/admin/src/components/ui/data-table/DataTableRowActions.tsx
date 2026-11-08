/** Tablecn row menu + UIArc text action. No business mutations or extra hover dock. */
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Fragment } from "react";
import { FileText, Ellipsis, type LucideIcon } from "lucide-react";
import { Button } from "../Button";
import styles from "./DataTable.module.css";

export interface DataTableRowAction {
  id: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}
export function DataTableRowActions({ primary, actions, details, detailLabel, detailAccessibleLabel = detailLabel, detailsDisabled, menuLabel, menuIcons = false }: {
  primary?: DataTableRowAction;
  actions: DataTableRowAction[];
  details: () => void;
  detailLabel: string;
  detailAccessibleLabel?: string;
  detailsDisabled?: boolean;
  menuLabel: string;
  menuIcons?: boolean;
}) {
  const menuActions = actions.filter(action => action.id !== primary?.id);
  return <span className={styles.rowActions}>
    {primary ? <Button size="small" type="text" className={styles.rowPrimary} disabled={primary.disabled} danger={primary.danger} onClick={primary.onSelect} title={primary.label}>
      <primary.icon size={14} aria-hidden="true" />{primary.label}
    </Button> : <Button size="small" type="text" className={styles.rowPrimary} disabled={detailsDisabled} onClick={details} title={detailAccessibleLabel} aria-label={detailAccessibleLabel}>
      <FileText size={14} aria-hidden="true" />{detailLabel}
    </Button>}
    {menuActions.length > 0 && <Menu.Root>
      <Menu.Trigger type="button" data-slot="dropdown-menu-trigger" className={styles.rowMenuTrigger} aria-label={menuLabel} title={menuLabel} disabled={menuActions.length === 0 || menuActions.every(action => action.disabled)}>
        <Ellipsis size={16} aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal><Menu.Content data-slot="dropdown-menu-content" className={styles.rowMenu} align="end" sideOffset={4} collisionPadding={12} loop>
        {menuActions.map((action, index) => <Fragment key={action.id}>
          {action.danger && index > 0 && <Menu.Separator className={styles.rowMenuSeparator} />}
          <Menu.Item data-slot="dropdown-menu-item" className={styles.rowMenuItem} data-variant={action.danger ? "destructive" : "default"} disabled={action.disabled} onSelect={action.onSelect}>
            {menuIcons && <action.icon className={styles.rowMenuIcon} aria-hidden="true" focusable="false" />}
            {action.label}
          </Menu.Item>
        </Fragment>)}
      </Menu.Content></Menu.Portal>
    </Menu.Root>}
  </span>;
}
