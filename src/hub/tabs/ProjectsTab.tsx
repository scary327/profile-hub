import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useState } from "react";
import { api, type ProjectEntry } from "../../api";
import { Icon } from "../../components/Icon";
import { useToast } from "../../components/Toasts";
import { hashGradient, initials } from "../../lib/hash";
import { relativeTime } from "../../lib/time";
import type { TabProps } from "../ProfileEditor";

export function ProjectsTab({ draft, saved, isCurrent, update }: TabProps) {
  const toast = useToast();
  const [projects, setProjects] = useState<ProjectEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");

  // папка проектов лежит в домашней папке учётки профиля — работаем с ней только изнутри этой учётки
  const savedId = saved && isCurrent ? saved.id : null;
  const savedDir = saved?.projectsDir ?? null;

  const load = useCallback(async () => {
    if (!savedId) return;
    setLoading(true);
    try {
      const list = await api.listProjects(savedId);
      setProjects([...list].sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0) || a.name.localeCompare(b.name)));
    } catch (e) {
      toast.error(e, "Не удалось получить список проектов");
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, [savedId, toast]);

  useEffect(() => {
    void load();
  }, [load, savedDir]);

  const pickDir = async () => {
    try {
      const dir = await open({ title: "Папка проектов", directory: true, multiple: false, defaultPath: draft.projectsDir || undefined });
      if (typeof dir === "string") update({ projectsDir: dir });
    } catch (e) {
      toast.error(e);
    }
  };

  const create = async () => {
    const name = newName.trim();
    if (!name || !savedId) return;
    setCreating(true);
    try {
      const p = await api.createProject(savedId, name);
      setNewName("");
      setProjects((list) => [p, ...(list ?? []).filter((x) => x.path !== p.path)]);
      toast.show({ kind: "success", title: `Проект «${p.name}» создан` });
    } catch (e) {
      toast.error(e, "Не удалось создать проект");
    } finally {
      setCreating(false);
    }
  };

  const run = (fn: () => Promise<void>) => void fn().catch((e) => toast.error(e));
  const dirChanged = !!saved && saved.projectsDir !== draft.projectsDir;
  const shown = (projects ?? []).filter((p) => p.name.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <div className="stack">
      <div className="card">
        <div className="field__label">Папка проектов</div>
        <div className="row">
          <div className="path-line path-line--box" title={draft.projectsDir}>
            <Icon name="folder" size={15} />
            <span>
              {draft.projectsDir || <span className="muted">появится после привязки учётки (C:\Users\&lt;имя&gt;\Projects)</span>}
            </span>
          </div>
          {saved && isCurrent && !dirChanged && draft.projectsDir && (
            <button className="btn" onClick={() => run(() => api.openProjectsDir(saved.id))}>
              Открыть
            </button>
          )}
          <button className="btn" onClick={() => void pickDir()}>
            Изменить
          </button>
        </div>
        {dirChanged && <div className="field__hint field__hint--warn">Сохраните профиль, чтобы список ниже показал новую папку.</div>}
      </div>

      {!saved ? (
        <div className="card">
          <div className="empty empty--sm">
            <div className="empty__icon">📁</div>
            <div className="empty__text">Сохраните профиль, чтобы создавать и открывать проекты.</div>
          </div>
        </div>
      ) : !isCurrent ? (
        <div className="card">
          <div className="empty empty--sm">
            <div className="empty__icon">🔒</div>
            <div className="empty__text">
              Проекты лежат в учётке профиля
              {saved.windowsUser ? (
                <>
                  {" "}
                  <span className="mono">{saved.windowsUser.username}</span>
                </>
              ) : null}{" "}
              — список, создание и открытие доступны, когда вы в этом профиле.
            </div>
          </div>
        </div>
      ) : (
        <div className="card card--list">
          <div className="list-head">
            <form
              className="inline-create"
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <Icon name="plus" size={15} />
              <input
                className="inline-create__input"
                placeholder="Новый проект — введите имя и Enter"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                disabled={creating}
              />
              {newName.trim() && (
                <button className="btn btn--sm btn--primary" type="submit" disabled={creating}>
                  Создать
                </button>
              )}
            </form>
            {(projects?.length ?? 0) > 6 && (
              <input className="input input--sm list-head__filter" placeholder="Поиск…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            )}
            <button className="icon-btn" title="Обновить" onClick={() => void load()} disabled={loading}>
              <Icon name="refresh" size={15} className={loading ? "spin" : undefined} />
            </button>
          </div>
          {projects === null || (loading && projects.length === 0) ? (
            <div className="empty-row">Загрузка…</div>
          ) : shown.length === 0 ? (
            <div className="empty-row">{filter ? "Ничего не найдено" : "В папке пока нет проектов"}</div>
          ) : (
            shown.map((p) => (
              <div key={p.path} className="list-row">
                <span className="proj-icon" style={{ background: hashGradient(p.name) }}>
                  {initials(p.name)}
                </span>
                <div className="list-row__main">
                  <div className="list-row__title">{p.name}</div>
                  <div className="list-row__sub">{p.modified ? `изменён ${relativeTime(p.modified)}` : p.path}</div>
                </div>
                <button className="btn btn--sm" onClick={() => run(() => api.openInEditor(p.path))}>
                  <Icon name="code" size={14} /> VS Code
                </button>
                <button className="btn btn--sm btn--ghost" onClick={() => run(() => api.openPath(p.path))}>
                  <Icon name="folder" size={14} /> Папка
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
