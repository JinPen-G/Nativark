import { useEffect, useState } from "react";

/** Conditional overlay owners must clear their target after exit, not before it. */
export function useModalDismissal(open: boolean, onClosed: () => void) {
  const [closing, setClosing] = useState(false);
  useEffect(() => { if (!open) setClosing(false); }, [open]);
  return {
    visible: open && !closing,
    dismiss: () => setClosing(true),
    afterClose: () => { if (closing) onClosed(); },
  };
}
