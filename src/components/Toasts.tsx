import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { errorMessage } from "../lib/errors";
import "./toasts.css";

export type ToastKind = "info" | "success" | "error";

interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  text?: string;
  icon?: string;
  leaving?: boolean;
}

interface ToastApi {
  show: (t: { kind?: ToastKind; title: string; text?: string; icon?: string; duration?: number }) => void;
  error: (e: unknown, title?: string) => void;
}

const Ctx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToast вне ToastProvider");
  return v;
}

export function ToastProvider({ children, variant = "hub" }: { children: ReactNode; variant?: "hub" | "game" }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((ts) => ts.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    window.setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 220);
  }, []);

  const show = useCallback<ToastApi["show"]>(
    ({ kind = "info", title, text, icon, duration }) => {
      const id = ++seq.current;
      setToasts((ts) => [...ts.slice(-3), { id, kind, title, text, icon }]);
      window.setTimeout(() => dismiss(id), duration ?? (kind === "error" ? 6000 : 3200));
    },
    [dismiss],
  );

  const error = useCallback<ToastApi["error"]>(
    (e, title = "Ошибка") => show({ kind: "error", title, text: errorMessage(e) }),
    [show],
  );

  const value = useMemo(() => ({ show, error }), [show, error]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className={`toasts toasts--${variant}`} role="status" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast toast--${t.kind}${t.leaving ? " toast--leaving" : ""}`}
            onClick={() => dismiss(t.id)}
          >
            <span className="toast__icon">{t.icon ?? (t.kind === "error" ? "!" : t.kind === "success" ? "✓" : "i")}</span>
            <div className="toast__body">
              <div className="toast__title">{t.title}</div>
              {t.text && <div className="toast__text">{t.text}</div>}
            </div>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
