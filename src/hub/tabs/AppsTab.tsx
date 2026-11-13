import { open } from "@tauri-apps/plugin-dialog";
import { api, type ProfileApp } from "../../api";
import { Icon } from "../../components/Icon";
import { useToast } from "../../components/Toasts";
import { Toggle } from "../../components/Toggle";
import { hashGradient, initials } from "../../lib/hash";
import type { TabProps } from "../ProfileEditor";
import { baseName } from "../profileUtils";

const EXE_FILTERS = [{ name: "Программы и ярлыки", extensions: ["exe", "lnk", "bat", "cmd"] }];

export function AppsTab({ draft, saved, update }: TabProps) {
  const toast = useToast();

  const pickExe = async (): Promise<string | null> => {
    try {
      const f = await open({ title: "Выберите программу", multiple: false, directory: false, filters: EXE_FILTERS });
      return typeof f === "string" ? f : null;
    } catch (e) {
      toast.error(e);
      return null;
    }
  };

  const add = async () => {
    const path = await pickExe();
    if (!path) return;
    const app: ProfileApp = { id: crypto.randomUUID(), name: baseName(path), path, args: "", autostart: false };
    update({ apps: [...draft.apps, app] });
  };

  const patch = (id: string, p: Partial<ProfileApp>) => update({ apps: draft.apps.map((a) => (a.id === id ? { ...a, ...p } : a)) });
  const remove = (id: string) => update({ apps: draft.apps.filter((a) => a.id !== id) });

  const launch = async (app: ProfileApp) => {
    if (!saved) return;
    try {
      await api.launchApp(saved.id, app.id);
      toast.show({ kind: "success", title: `${app.name} запускается` });
    } catch (e) {
      toast.error(e, `Не удалось запустить ${app.name}`);
    }
  };

  return (
    <div className="stack">
      <div className="card card--list">
        <div className="list-head">
          <div className="list-head__title">Приложения профиля</div>
          <button className="btn btn--sm btn--primary" onClick={() => void add()}>
            <Icon name="plus" size={14} /> Добавить
          </button>
        </div>
        {draft.apps.length === 0 && (
          <div className="empty empty--sm">
            <div className="empty__icon">🧩</div>
            <div className="empty__text">
              Добавьте программы, которые нужны в этом профиле: мессенджер, IDE, трекер задач. С автозапуском они откроются
              при входе в профиль.
            </div>
          </div>
        )}
        {draft.apps.map((app) => {
          const isSaved = !!saved?.apps.some((a) => a.id === app.id && a.path === app.path && a.args === app.args);
          return (
            <div key={app.id} className="app-row">
              <span className="proj-icon" style={{ background: hashGradient(app.name || app.path) }}>
                {initials(app.name || baseName(app.path))}
              </span>
              <div className="app-row__fields">
                <input className="input input--sm app-row__name" value={app.name} placeholder="Название" onChange={(e) => patch(app.id, { name: e.target.value })} />
                <button
                  className="path-line path-line--btn"
                  title={`${app.path}\nНажмите, чтобы выбрать другой файл`}
                  onClick={async () => {
                    const p = await pickExe();
                    if (p) patch(app.id, { path: p });
                  }}
                >
                  {app.path}
                </button>
                <input
                  className="input input--sm input--mono"
                  value={app.args}
                  placeholder="Аргументы запуска (необязательно)"
                  onChange={(e) => patch(app.id, { args: e.target.value })}
                />
              </div>
              <div className="app-row__side">
                <label className="toggle-label">
                  <Toggle checked={app.autostart} onChange={(v) => patch(app.id, { autostart: v })} label="Автозапуск" />
                  Автозапуск
                </label>
                <div className="row">
                  <button
                    className="btn btn--sm"
                    disabled={!isSaved}
                    title={isSaved ? "Запустить в этом профиле" : "Сохраните профиль, чтобы запустить"}
                    onClick={() => void launch(app)}
                  >
                    <Icon name="play" size={11} /> Запустить
                  </button>
                  <button className="icon-btn icon-btn--danger" title="Убрать из профиля" onClick={() => remove(app.id)}>
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
