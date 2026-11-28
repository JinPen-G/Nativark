import { ClientError } from "@rental-os/platform-client-contracts";
import { ClientShell, type ClientShellProps } from "./Shell";
export function StaffWeb(props: ClientShellProps) {
  if (props.view.runtime.surface !== "staff-web") throw new ClientError("unavailable");
  return <ClientShell {...props} />;
}
