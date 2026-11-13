import { useState } from "react";
import { api, type HubState, type Profile } from "../api";
import { Dialog } from "../components/Dialog";
import { Icon, type IconName } from "../components/Icon";
import { useToast } from "../components/Toasts";
import { hotkeyParts } from "../lib/hotkey";
import { AppsTab } from "./tabs/AppsTab";
import { BrowsersTab } from "./tabs/BrowsersTab";
import { GeneralTab } from "./tabs/GeneralTab";
import { ProjectsTab } from "./tabs/ProjectsTab";
import { WallpaperTab } from "./tabs/WallpaperTab";
import { KIND_LABEL, accentVars } from "./profileUtils";

export interface TabProps {
  draft: Profile;
  /** Сохранённая версия (null — профиль ещё не сохранён). */
  saved: Profile | null;
  state: HubState;
  update: (patch: Partial<Profile>) => void;
}

type TabId = "general" | "wallpaper" | "browsers" | "projects" | "apps";

const TABS: Array<{ id: TabId; label: string; icon: IconName }> = [
  { id: "general", label: "Общее", icon: "sliders" },
  { id: "wallpaper", label: "Обои", icon: "image" },
  { id: "browsers", label: "Браузеры", icon: "globe" },
  { id: "projects", label: "Проекты", icon: "code" },
  { id: "apps", label: "Приложения", icon: "app" },
];

interface Props {
  draft: Profile;
  saved: Profile | null;
  state: HubState;
  dirty: boolean;
  saving: boolean;
  isActive: boolean;
  isRunning: boolean;
  onChange: (patch: Partial<Profile>) => void;
  onSave: () => void;
  onRevert: () => void;
  onDelete: (deleteData: boolean) => Promise<void>;
  onSwitch: () => void;
  onState: (s: HubState) => void;
}

export function ProfileEditor(props: Props) {
  const { draft, saved, state, dirty, saving, isActive, isRunning, onChange, onSave, onRevert, onSwitch, onState } = props;
  const toast = useToast();
  const [tab, setTab] = useState<TabId>("general");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteData, setDeleteData] = useState(false);
  const [closing, setClosing] = useState(false);

  const closeAll = async () => {
    if (!saved) return;
    setClosing(true);
    try {
      onState(await api.closeProfileApps(saved.id));
      toast.show({ kind: "success", title: "Приложения профиля закрыты", icon: saved.icon });
    } catch (e) {
      toast.error(e, "Не удалось закрыть приложения");
    } finally {
      setClosing(false);
    }
  };

  const tabProps: TabProps = { draft, saved, state, update: onChange };
  const hk = hotkeyParts(saved?.hotkey);

  return (
    <div className="editor" style={accentVars(draft.color)}>
      <section className="hero">
        <div className="hero__bg" />
        <div className="hero__icon">{draft.icon || "•"}</div>
        <div className="hero__info">
          <div className="hero__row">
            <h1 className="hero__name">{draft.name || "Без имени"}</h1>
            {dirty && (
              <span className="dirty-pill" title="Есть несохранённые изменения">
                <span className="dirty-pill__dot" /> не сохранено
              </span>
            )}
          </div>
          <div className="hero__meta">
            <span className={`badge badge--${draft.kind}`}>{KIND_LABEL[draft.kind]}</span>
            {!saved ? (
              <span className="hero__state">Новый профиль</span>
            ) : isActive ? (
              <span className="hero__state hero__state--active">
                <span className="live-dot" /> Активный профиль
              </span>
            ) : isRunning ? (
              <span className="hero__state">
                <span className="live-dot live-dot--muted" /> Работает в фоне
              </span>
            ) : (
              <span className="hero__state">Неактивен</span>
            )}
            {hk.length > 0 && (
              <span className="kbd-row" title="Глобальный хоткей профиля">
                {hk.map((k, i) => (
                  <kbd key={i} className="kbd kbd--sm">
                    {k}
                  </kbd>
                ))}
              </span>
            )}
          </div>
        </div>
        <div className="hero__actions">
          <button
            className="btn btn--switch"
            disabled={!saved || isActive}
            onClick={onSwitch}
            title={!saved ? "Сначала сохраните профиль" : isActive ? "Вы уже в этом профиле" : "Переключиться на профиль"}
          >
            <Icon name="swap" size={17} />
            {isActive ? "Вы здесь" : "Переключиться"}
          </button>
        </div>
      </section>

      <div className="editor__toolbar">
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`tab${tab === t.id ? " is-current" : ""}`}
              onClick={() => setTab(t.id)}
            >
              <Icon name={t.icon} size={15} />
              {t.label}
            </button>
          ))}
        </div>
        <div className="editor__toolbar-actions">
          {dirty && (
            <button className="btn btn--ghost" onClick={onRevert} disabled={saving}>
              {saved ? "Отменить" : "Не создавать"}
            </button>
          )}
          <button className={`btn${dirty ? " btn--primary" : ""}`} disabled={!dirty || saving} onClick={onSave} title="Ctrl+S">
            <Icon name="check" size={15} />
            {saving ? "Сохранение…" : saved ? "Сохранить" : "Создать"}
          </button>
        </div>
      </div>

      <div className="editor__content" key={tab}>
        {tab === "general" && <GeneralTab {...tabProps} />}
        {tab === "wallpaper" && <WallpaperTab {...tabProps} />}
        {tab === "browsers" && <BrowsersTab {...tabProps} />}
        {tab === "projects" && <ProjectsTab {...tabProps} />}
        {tab === "apps" && <AppsTab {...tabProps} />}

        <div className="danger-zone">
          <div>
            <div className="danger-zone__title">Управление профилем</div>
            <div className="muted small">Закрыть всё, что запущено в профиле, или удалить его.</div>
          </div>
          <div className="danger-zone__actions">
            <button className="btn" disabled={!saved || closing} onClick={() => void closeAll()}>
              <Icon name="stop" size={12} />
              {closing ? "Закрываем…" : "Закрыть всё в профиле"}
            </button>
            <button
              className="btn btn--danger"
              onClick={() => {
                setDeleteData(false);
                setConfirmDelete(true);
              }}
            >
              <Icon name="trash" size={15} />
              {saved ? "Удалить профиль" : "Отменить создание"}
            </button>
          </div>
        </div>
      </div>

      {confirmDelete && (
        <Dialog
          title={saved ? `Удалить профиль «${draft.name}»?` : "Отменить создание профиля?"}
          icon="🗑️"
          onClose={() => setConfirmDelete(false)}
          actions={
            <>
              <button className="btn btn--ghost" data-autofocus onClick={() => setConfirmDelete(false)}>
                Отмена
              </button>
              <button
                className="btn btn--danger-solid"
                onClick={async () => {
                  setConfirmDelete(false);
                  await props.onDelete(deleteData);
                }}
              >
                {saved ? "Удалить" : "Отменить создание"}
              </button>
            </>
          }
        >
          {saved ? (
            <>
              <p style={{ marginTop: 0 }}>Профиль исчезнет из хаба, его виртуальный рабочий стол будет закрыт.</p>
              <label className="check">
                <input type="checkbox" checked={deleteData} onChange={(e) => setDeleteData(e.target.checked)} />
                <span>
                  Удалить также данные (браузеры, проекты)
                  <span className="check__hint">
                    Папки с данными браузеров и проектов будут удалены безвозвратно.
                  </span>
                </span>
              </label>
              {deleteData && (
                <div className="callout callout--danger">
                  Будут стёрты логины, куки, история браузеров профиля и папка проектов:{" "}
                  <span className="mono">{saved.projectsDir}</span>
                </div>
              )}
            </>
          ) : (
            <p style={{ margin: 0 }}>Несохранённый профиль будет отброшен.</p>
          )}
        </Dialog>
      )}
    </div>
  );
}
