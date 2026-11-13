import type { CSSProperties } from "react";
import { api, type BrowserKind } from "../../api";
import { Icon } from "../../components/Icon";
import { useToast } from "../../components/Toasts";
import { Toggle } from "../../components/Toggle";
import type { TabProps } from "../ProfileEditor";
import { BROWSER_COLORS, BROWSER_GLYPH } from "../profileUtils";

export function BrowsersTab({ draft, saved, state, update }: TabProps) {
  const toast = useToast();

  const setEnabled = (kind: BrowserKind, on: boolean) => {
    const rest = draft.browsers.filter((b) => b.kind !== kind);
    update({ browsers: on ? [...rest, { kind, autostart: false }] : rest });
  };
  const setAutostart = (kind: BrowserKind, autostart: boolean) =>
    update({ browsers: draft.browsers.map((b) => (b.kind === kind ? { kind: b.kind, autostart } : b)) });

  const launch = async (kind: BrowserKind, name: string) => {
    if (!saved) return;
    try {
      await api.launchBrowser(saved.id, kind);
      toast.show({ kind: "success", title: `${name} запускается`, text: `В профиле «${saved.name}»` });
    } catch (e) {
      toast.error(e, `Не удалось запустить ${name}`);
    }
  };

  return (
    <div className="stack">
      <div className="callout">
        <Icon name="sparkles" size={16} />
        <div>
          У каждого профиля — свои папки данных браузеров. Аккаунты, куки, расширения и история не пересекаются
          между профилями: войдите в рабочий Google здесь, и он не появится в игровом.
        </div>
      </div>
      <div className="card card--list">
        {state.browsers.length === 0 && <div className="empty-row">Браузеры не найдены</div>}
        {state.browsers.map((b) => {
          const entry = draft.browsers.find((x) => x.kind === b.kind);
          const enabled = !!entry;
          const savedEnabled = !!saved?.browsers.some((x) => x.kind === b.kind);
          return (
            <div key={b.kind} className={`list-row${!b.installed ? " is-disabled" : ""}`}>
              <span className="brand-icon" style={{ "--brand": BROWSER_COLORS[b.kind] } as CSSProperties}>
                {BROWSER_GLYPH[b.kind]}
              </span>
              <div className="list-row__main">
                <div className="list-row__title">{b.name}</div>
                <div className="list-row__sub" title={b.exePath ?? ""}>
                  {b.installed ? (b.exePath ?? "Установлен") : "не установлен"}
                </div>
              </div>
              {b.installed && enabled && (
                <label className="check check--inline">
                  <input type="checkbox" checked={entry.autostart} onChange={(e) => setAutostart(b.kind, e.target.checked)} />
                  <span>Автозапуск</span>
                </label>
              )}
              {b.installed && (
                <button
                  className="btn btn--sm"
                  disabled={!saved || !savedEnabled}
                  title={!saved || !savedEnabled ? "Включите браузер и сохраните профиль" : "Открыть в этом профиле"}
                  onClick={() => void launch(b.kind, b.name)}
                >
                  <Icon name="play" size={11} /> Открыть
                </button>
              )}
              <Toggle checked={enabled} disabled={!b.installed} onChange={(v) => setEnabled(b.kind, v)} label={`Включить ${b.name}`} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
