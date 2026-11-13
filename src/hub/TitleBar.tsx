import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, type Profile } from "../api";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toasts";

export function TitleBar({ active }: { active: Profile | null }) {
  const toast = useToast();
  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar__brand" data-tauri-drag-region>
        <span className="titlebar__logo" data-tauri-drag-region>
          <span />
          <span />
          <span />
        </span>
        <span data-tauri-drag-region>Profile Hub</span>
      </div>
      {active && (
        <div className="titlebar__active" data-tauri-drag-region>
          <span className="titlebar__pulse" />
          <span data-tauri-drag-region>
            Сейчас: {active.icon} {active.name}
          </span>
        </div>
      )}
      <div className="titlebar__buttons">
        <span className="titlebar__hint" data-tauri-drag-region>
          <kbd className="kbd kbd--sm">Esc</kbd> скрыть
        </span>
        <button
          className="titlebar__btn"
          title="Свернуть"
          onClick={() => void getCurrentWindow().minimize().catch((e) => toast.error(e))}
        >
          <Icon name="minus" size={14} />
        </button>
        <button
          className="titlebar__btn titlebar__btn--close"
          title="Скрыть в трей"
          onClick={() => void api.hideHub().catch((e) => toast.error(e))}
        >
          <Icon name="x" size={14} />
        </button>
      </div>
    </header>
  );
}
