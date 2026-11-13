import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type HubState, type Profile, type ProfileKind } from "../api";
import { Dialog, isModalOpen } from "../components/Dialog";
import { Icon } from "../components/Icon";
import { ToastProvider, useToast } from "../components/Toasts";
import { isTypingTarget } from "../lib/errors";
import { useHubState } from "../lib/useHubState";
import { LibraryPage } from "./LibraryPage";
import { NewProfileDialog } from "./NewProfileDialog";
import { ProfileEditor } from "./ProfileEditor";
import { SettingsPage } from "./SettingsPage";
import { Sidebar } from "./Sidebar";
import { SwitchOverlay } from "./SwitchOverlay";
import { TitleBar } from "./TitleBar";
import { accentVars, profilesEqual } from "./profileUtils";
import "./hub.css";

export type HubView = "profile" | "settings" | "library";

export function Hub() {
  return (
    <ToastProvider>
      <HubInner />
    </ToastProvider>
  );
}

function HubInner() {
  const { state, error, setState, reload } = useHubState();
  const toast = useToast();

  const [view, setView] = useState<HubView>("profile");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Profile | null>(null);
  /** Снимок профиля, от которого считается «грязность» черновика. */
  const [baseline, setBaseline] = useState<Profile | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingNav, setPendingNav] = useState<{ run: () => void } | null>(null);
  const [kindPicker, setKindPicker] = useState(false);
  const [switching, setSwitching] = useState<Profile | null>(null);

  const profiles = useMemo(() => state?.config.profiles ?? [], [state]);
  const activeId = state?.config.activeProfileId ?? null;
  const saved = profiles.find((p) => p.id === selectedId) ?? null;
  const dirty = !!draft && (isNew || !profilesEqual(draft, baseline));

  // Предупредить о хоткеях, которые заняла другая программа (один раз на каждый набор).
  const busyKey = (state?.busyHotkeys ?? []).join(", ");
  useEffect(() => {
    if (!busyKey) return;
    toast.show({
      kind: "error",
      title: "Хоткей занят другой программой",
      text: `${busyKey} — выберите другое сочетание в настройках или профиле`,
      duration: 8000,
    });
  }, [busyKey, toast]);

  const loadDraft = useCallback((p: Profile | null, asNew = false) => {
    setSelectedId(p?.id ?? null);
    setDraft(p);
    setBaseline(p);
    setIsNew(asNew);
  }, []);

  // Первичный выбор профиля и синхронизация «чистого» черновика с бэкендом.
  useEffect(() => {
    if (!state) return;
    if (isNew) return;
    if (!selectedId || !saved) {
      const fallback = profiles.find((p) => p.id === activeId) ?? profiles[0] ?? null;
      if (fallback?.id !== selectedId || draft !== fallback) loadDraft(fallback);
      return;
    }
    if (!dirty && !profilesEqual(saved, baseline, true)) {
      setDraft(saved);
      setBaseline(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  /** Выполнить переход, спросив про несохранённые изменения. */
  const guard = useCallback(
    (run: () => void) => {
      if (dirty) setPendingNav({ run });
      else run();
    },
    [dirty],
  );

  const selectProfile = (id: string) =>
    guard(() => {
      const p = profiles.find((x) => x.id === id) ?? null;
      loadDraft(p);
      setView("profile");
    });

  const openView = (v: HubView) => {
    if (v === "profile") return setView("profile");
    guard(() => {
      if (isNew) loadDraft(profiles.find((p) => p.id === activeId) ?? profiles[0] ?? null);
      setView(v);
    });
  };

  const createProfile = async (kind: ProfileKind) => {
    setKindPicker(false);
    try {
      const template = await api.newProfileTemplate(kind);
      loadDraft(template, true);
      setView("profile");
    } catch (e) {
      toast.error(e, "Не удалось создать шаблон профиля");
    }
  };

  const save = useCallback(async (): Promise<boolean> => {
    if (!draft) return false;
    if (!draft.name.trim()) {
      toast.show({ kind: "error", title: "Укажите имя профиля" });
      return false;
    }
    setSaving(true);
    try {
      const latest = state?.config.profiles.find((p) => p.id === draft.id);
      const toSave: Profile = { ...draft, name: draft.name.trim(), desktopId: latest?.desktopId ?? draft.desktopId };
      const res = await api.saveProfile(toSave);
      setState(res);
      const fresh = res.config.profiles.find((p) => p.id === draft.id) ?? toSave;
      loadDraft(fresh);
      toast.show({ kind: "success", title: isNew ? "Профиль создан" : "Изменения сохранены", icon: fresh.icon });
      return true;
    } catch (e) {
      toast.error(e, "Не удалось сохранить профиль");
      return false;
    } finally {
      setSaving(false);
    }
  }, [draft, state, isNew, setState, loadDraft, toast]);

  const revert = () => {
    if (isNew) loadDraft(profiles.find((p) => p.id === activeId) ?? profiles[0] ?? null);
    else loadDraft(saved);
  };

  const deleteProfile = async (deleteData: boolean) => {
    if (!draft) return;
    if (isNew) {
      loadDraft(profiles.find((p) => p.id === activeId) ?? profiles[0] ?? null);
      return;
    }
    try {
      const res = await api.deleteProfile(draft.id, deleteData);
      setState(res);
      const next = res.config.profiles.find((p) => p.id === res.config.activeProfileId) ?? res.config.profiles[0] ?? null;
      loadDraft(next);
      toast.show({ kind: "success", title: `Профиль «${draft.name}» удалён` });
    } catch (e) {
      toast.error(e, "Не удалось удалить профиль");
    }
  };

  const switchBusy = useRef(false);
  const switchTo = useCallback(
    async (id: string) => {
      const target = profiles.find((p) => p.id === id);
      if (!target || switchBusy.current) return;
      switchBusy.current = true;
      setSwitching(target);
      const started = performance.now();
      try {
        const res: HubState = await api.switchProfile(id);
        setState(res);
        toast.show({ kind: "success", title: `Вы в профиле «${target.name}»`, icon: target.icon });
      } catch (e) {
        toast.error(e, "Не удалось переключиться");
      } finally {
        const left = Math.max(0, 750 - (performance.now() - started));
        window.setTimeout(() => {
          setSwitching(null);
          switchBusy.current = false;
        }, left);
      }
    },
    [profiles, setState, toast],
  );

  // Глобальные клавиши хаба: Esc — скрыть, 1–9 — переключение, Ctrl+S — сохранить.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isModalOpen()) return;
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyS") {
        e.preventDefault();
        if (dirty) void save();
        return;
      }
      if (e.key === "Escape") {
        if (isTypingTarget(e.target)) {
          (e.target as HTMLElement).blur();
          return;
        }
        e.preventDefault();
        void api.hideHub().catch((err) => toast.error(err));
        return;
      }
      if (isTypingTarget(e.target) || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      const m = /^Digit([1-9])$/.exec(e.code) ?? /^Numpad([1-9])$/.exec(e.code);
      if (m) {
        const p = profiles[Number(m[1]) - 1];
        if (p) {
          e.preventDefault();
          void switchTo(p.id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [profiles, switchTo, dirty, save, toast]);

  const active = profiles.find((p) => p.id === activeId);

  return (
    <div className="hub" style={accentVars(active?.color ?? draft?.color)}>
      <div className="hub__glow" aria-hidden="true" />
      <TitleBar active={active ?? null} />
      <div className="hub__body">
        <Sidebar
          profiles={profiles}
          activeId={activeId}
          runningIds={state?.runningProfiles ?? []}
          selectedId={view === "profile" ? selectedId : null}
          draft={isNew ? draft : null}
          view={view}
          onSelect={selectProfile}
          onNew={() => guard(() => setKindPicker(true))}
          onView={openView}
        />
        <main className="hub__main">
          {!state ? (
            <div className="hub__loading">
              {error ? (
                <div className="empty">
                  <div className="empty__icon">⚠️</div>
                  <div className="empty__title">Не удалось связаться с бэкендом</div>
                  <div className="empty__text">{error}</div>
                  <button className="btn btn--primary" onClick={() => void reload()}>
                    <Icon name="refresh" /> Повторить
                  </button>
                </div>
              ) : (
                <div className="spinner" />
              )}
            </div>
          ) : view === "settings" ? (
            <SettingsPage state={state} onState={setState} />
          ) : view === "library" ? (
            <LibraryPage state={state} onState={setState} />
          ) : draft ? (
            <ProfileEditor
              key={draft.id}
              draft={draft}
              saved={isNew ? null : saved}
              state={state}
              dirty={dirty}
              saving={saving}
              isActive={draft.id === activeId}
              isRunning={state.runningProfiles.includes(draft.id)}
              onChange={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))}
              onSave={() => void save()}
              onRevert={revert}
              onDelete={deleteProfile}
              onSwitch={() => void switchTo(draft.id)}
              onState={setState}
            />
          ) : (
            <div className="hub__loading">
              <div className="empty">
                <div className="empty__icon">✨</div>
                <div className="empty__title">Профилей пока нет</div>
                <div className="empty__text">Создайте первый профиль — для работы или для игр.</div>
                <button className="btn btn--primary" onClick={() => setKindPicker(true)}>
                  <Icon name="plus" /> Новый профиль
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      {kindPicker && <NewProfileDialog onPick={createProfile} onClose={() => setKindPicker(false)} />}

      {pendingNav && (
        <Dialog
          title="Несохранённые изменения"
          icon="✏️"
          onClose={() => setPendingNav(null)}
          actions={
            <>
              <button className="btn btn--ghost" onClick={() => setPendingNav(null)}>
                Отмена
              </button>
              <button
                className="btn"
                onClick={() => {
                  const run = pendingNav.run;
                  setPendingNav(null);
                  revert();
                  run();
                }}
              >
                Не сохранять
              </button>
              <button
                className="btn btn--primary"
                onClick={async () => {
                  const run = pendingNav.run;
                  setPendingNav(null);
                  if (await save()) run();
                }}
              >
                Сохранить
              </button>
            </>
          }
        >
          В профиле «{draft?.name || "без имени"}» есть изменения, которые ещё не сохранены.
        </Dialog>
      )}

      {switching && <SwitchOverlay profile={switching} />}
    </div>
  );
}
