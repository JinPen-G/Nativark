import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CheckCircle as CheckCircleFilled,
  CloseCircle as CloseCircleFilled,
  InfoCircle as InfoCircleFilled,
} from "./SiteIcon";

// 轻量操作反馈：成功/失败/提示 Toast，自动消失，非大 Modal、不阻断操作。
type ToastKind = "success" | "error" | "info";
interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}
interface ToastApi {
  show: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Set<number>());
  useEffect(
    () => () => {
      timers.current.forEach((timer) => window.clearTimeout(timer));
      timers.current.clear();
    },
    [],
  );
  const show = useCallback((message: string, kind: ToastKind = "info") => {
    if (!message) return;
    const id = ++seq;
    setItems((list) => [...list, { id, message, kind }]);
    const timer = window.setTimeout(() => {
      setItems((list) => list.filter((item) => item.id !== id));
      timers.current.delete(timer);
    }, 4200);
    timers.current.add(timer);
  }, []);
  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (message: string) => show(message, "success"),
      error: (message: string) => show(message, "error"),
    }),
    [show],
  );
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-host" role="status" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={`toast toast-${item.kind}`}>
            <span className="toast-icon" aria-hidden="true">
              {item.kind === "success" ? (
                <CheckCircleFilled />
              ) : item.kind === "error" ? (
                <CloseCircleFilled />
              ) : (
                <InfoCircleFilled />
              )}
            </span>
            <span>{item.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  // Provider 缺失时降级为 no-op，绝不因反馈层缺失阻断业务流程。
  return ctx ?? { show: () => {}, success: () => {}, error: () => {} };
}
