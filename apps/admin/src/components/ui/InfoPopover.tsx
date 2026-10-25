/** On-demand help using the original free UIArc Popover; no business actions or state. */
import { useId, type ReactNode } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "@/registry/components/popover/popover";

export function InfoPopover({ title, children, content }: { title: string; children: ReactNode; content: ReactNode }) {
  const titleId = useId();
  return <Popover>
    <PopoverTrigger asChild>{children}</PopoverTrigger>
    <PopoverContent align="start" aria-labelledby={titleId} className="rental-info-popover">
      <h2 id={titleId}>{title}</h2>
      <div className="page-note">{content}</div>
    </PopoverContent>
  </Popover>;
}
