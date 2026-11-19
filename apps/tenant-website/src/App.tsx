import { RentalWebsite } from "@rental-os/rental-core/clients/website-ui";
import { websiteHost } from "./website-host";

export function App() {
  return <RentalWebsite host={websiteHost} />;
}
