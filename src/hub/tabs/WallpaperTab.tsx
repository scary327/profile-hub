import { open } from "@tauri-apps/plugin-dialog";
import { FallbackImage } from "../../components/FallbackImage";
import { Icon } from "../../components/Icon";
import { useToast } from "../../components/Toasts";
import type { TabProps } from "../ProfileEditor";

export function WallpaperTab({ draft, update }: TabProps) {
  const toast = useToast();

  const pick = async () => {
    try {
      const file = await open({
        title: "Выберите обои",
        multiple: false,
        directory: false,
        filters: [{ name: "Изображения", extensions: ["jpg", "jpeg", "png", "bmp", "webp", "gif", "jfif"] }],
      });
      if (typeof file === "string") update({ wallpaper: file });
    } catch (e) {
      toast.error(e, "Не удалось открыть диалог");
    }
  };

  const light = draft.theme === "light";

  return (
    <div className="stack">
      <div className="card">
        <div className={`wall-preview${light ? " is-light" : ""}`}>
          <div className="wall-preview__screen">
            {draft.wallpaper ? (
              <FallbackImage
                candidates={[draft.wallpaper]}
                className="wall-preview__img"
                fallback={<div className="wall-preview__empty">Не удалось загрузить картинку</div>}
              />
            ) : (
              <div className="wall-preview__empty wall-preview__empty--gradient">
                <span>{draft.icon}</span>
                Обои не выбраны — Windows оставит текущие
              </div>
            )}
            <div className="wall-preview__window">
              <div className="wall-preview__window-bar">
                <i />
                <i />
                <i />
              </div>
            </div>
            <div className="wall-preview__taskbar">
              <span className="wall-preview__start" />
              <span />
              <span />
              <span />
            </div>
          </div>
        </div>
        <div className="row row--between" style={{ marginTop: 16 }}>
          <div className="path-line" title={draft.wallpaper ?? ""}>
            {draft.wallpaper ?? <span className="muted">Файл не выбран</span>}
          </div>
          <div className="row">
            {draft.wallpaper && (
              <button className="btn btn--ghost" onClick={() => update({ wallpaper: null })}>
                <Icon name="x" size={14} /> Убрать
              </button>
            )}
            <button className="btn btn--primary" onClick={() => void pick()}>
              <Icon name="image" size={15} /> Выбрать файл…
            </button>
          </div>
        </div>
        <div className="field__hint" style={{ marginTop: 12 }}>
          Обои ставятся на виртуальный рабочий стол профиля. Превью показывает выбранную тему ({light ? "светлая" : "тёмная"}).
        </div>
      </div>
    </div>
  );
}
