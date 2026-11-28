import { ClientError } from "@rental-os/platform-client-contracts";
import { ClientShell, type ClientShellProps } from "./Shell";
export function CustomerWebsite(props: ClientShellProps) {
  if (props.view.runtime.surface !== "customer-web") throw new ClientError("unavailable");
  return <ClientShell {...props} />;
}
