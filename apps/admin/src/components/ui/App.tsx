import { App as AntApp } from "antd";
import { useMemo } from "react";
import { useToastStore } from "./ToastStack";
import type { ArgsProps, MessageType } from "antd/es/message/interface";
import { useModalFeedback } from "./ModalProvider";

/** Keep App context; short plain-text messages use the original animated toast stack. */
function useApp() {
  const original = AntApp.useApp();
  const feedback = useToastStore();
  const modal = useModalFeedback();
  const message = useMemo(() => {
    const show = (args: ArgsProps): MessageType => {
      if (typeof args.content !== "string" || args.icon || args.style || args.styles || args.className || args.classNames || args.onClick || args.pauseOnHover === false) return original.message.open(args);
      const id = feedback.toast({ id: args.key === undefined ? undefined : `rental-message-${args.key}`, title: args.content, type: args.type ?? "info", duration: args.duration === 0 || args.type === "loading" ? Infinity : (args.duration ?? 3) * 1000 });
      let resolve!: (result: boolean) => void;
      const completion = new Promise<boolean>(done => { resolve = done; });
      const unsubscribe = feedback.subscribe(() => {
        if (feedback.getSnapshot().some(row => row.id === id)) return;
        unsubscribe(); resolve(true); args.onClose?.();
      });
      return Object.assign(() => feedback.dismiss(id), { then: completion.then.bind(completion) });
    };
    const api = { ...original.message, open: show, destroy: (key?: React.Key) => {
      if (key === undefined) { feedback.dismiss(); original.message.destroy(); }
      else { feedback.dismiss(`rental-message-${key}`); original.message.destroy(key); }
    } };
    for (const type of ["success", "error", "warning", "info", "loading"] as const) {
      api[type] = (content, duration, onClose) => {
        const args = typeof content === "object" && content && "content" in content ? content : { content };
        return show({ ...args, type, duration: typeof duration === "number" ? duration : args.duration, onClose: typeof duration === "function" ? duration : onClose ?? args.onClose });
      };
    }
    return api;
  }, [feedback, original.message]);
  return { ...original, message, modal };
}
export const App = { useApp };
