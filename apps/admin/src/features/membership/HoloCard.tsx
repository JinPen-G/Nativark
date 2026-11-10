/** Host boundary only: archive motion is unchanged; business content and reduced-motion policy stay in the admin. */
import type { ComponentProps } from "react";
import { HoloCard as ArchiveHoloCard } from "./archive/holo-card/original";
import "./archive/holo-card/original.css";

export function HoloCard(props: ComponentProps<typeof ArchiveHoloCard>) {
  return <div data-member-holo="" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <ArchiveHoloCard {...props} intensity={.7} gyroscope={false} />
  </div>;
}
