import { useEffect, useRef, type ReactNode } from "react";

let openCount = 0;

/** Открыт ли сейчас хоть один модальный диалог (глобальные хоткеи его уважают). */
export function isModalOpen(): boolean {
  return openCount > 0;
}

interface Props {
  title: string;
  children?: ReactNode;
  actions: ReactNode;
  onClose: () => void;
  icon?: ReactNode;
  width?: number;
}

export function Dialog({ title, children, actions, onClose, icon, width = 420 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    openCount++;
    const prevFocus = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("[data-autofocus], button.btn--primary, button");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      openCount--;
      window.removeEventListener("keydown", onKey, true);
      prevFocus?.focus?.();
    };
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" ref={ref} role="dialog" aria-modal="true" aria-label={title} style={{ width }}>
        <div className="modal__head">
          {icon && <div className="modal__icon">{icon}</div>}
          <h2 className="modal__title">{title}</h2>
        </div>
        {children && <div className="modal__body">{children}</div>}
        <div className="modal__actions">{actions}</div>
      </div>
    </div>
  );
}
