//! Состояние приложения и основная логика: переключение профилей, игровой режим, хоткеи.

use crate::models::*;
use crate::processes::Snapshot;
use crate::{browsers, config, desktop, games, processes, util};
use anyhow::{anyhow, Result};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub struct AppState {
    pub config: Mutex<AppConfig>,
    pub browsers: Mutex<Vec<BrowserInfo>>,
    pub games: Mutex<Option<Vec<Game>>>,
    /// PID'ы приложений, запущенных хабом, по id профиля.
    pub tracked: Mutex<HashMap<String, Vec<u32>>>,
    /// Последний рабочий профиль — куда возвращаться из игрового режима.
    pub prev_work: Mutex<Option<String>>,
    /// Сериализует переключения (хоткей + клик одновременно).
    pub switching: Mutex<()>,
}

impl AppState {
    pub fn new() -> Self {
        let cfg = config::load();
        let prev_work = cfg
            .active_profile_id
            .clone()
            .filter(|id| cfg.profiles.iter().any(|p| &p.id == id && p.kind == ProfileKind::Work));
        AppState {
            config: Mutex::new(cfg),
            browsers: Mutex::new(browsers::detect()),
            games: Mutex::new(None),
            tracked: Mutex::new(HashMap::new()),
            prev_work: Mutex::new(prev_work),
            switching: Mutex::new(()),
        }
    }

    pub fn profiles_root(&self) -> PathBuf {
        PathBuf::from(&self.config.lock().settings.profiles_root)
    }

    pub fn profile(&self, id: &str) -> Result<Profile> {
        self.config
            .lock()
            .profiles
            .iter()
            .find(|p| p.id == id)
            .cloned()
            .ok_or_else(|| anyhow!("профиль не найден"))
    }

    pub fn save_config(&self) -> Result<()> {
        config::save(&self.config.lock())
    }
}

pub fn state(app: &AppHandle) -> tauri::State<'_, AppState> {
    app.state::<AppState>()
}

fn data_dir(root: &Path, id: &str) -> PathBuf {
    config::profile_data_dir(root, id)
}

pub fn hub_state(app: &AppHandle) -> HubState {
    let st = state(app);
    let cfg = st.config.lock().clone();
    let root = PathBuf::from(&cfg.settings.profiles_root);
    let snap = Snapshot::take();
    let running_profiles = {
        let mut tracked = st.tracked.lock();
        // выбросить умершие PID'ы
        for pids in tracked.values_mut() {
            pids.retain(|p| snap.alive(*p));
        }
        cfg.profiles
            .iter()
            .filter(|p| {
                let t = tracked.get(&p.id).map(Vec::as_slice).unwrap_or(&[]);
                !snap.profile_pids(&data_dir(&root, &p.id), t).is_empty()
            })
            .map(|p| p.id.clone())
            .collect()
    };
    let browsers = st.browsers.lock().clone();
    HubState {
        config: cfg,
        browsers,
        running_profiles,
    }
}

pub fn emit_state(app: &AppHandle) {
    let s = hub_state(app);
    let _ = app.emit("state-changed", s);
}

fn hwnd_of(w: &WebviewWindow) -> Option<isize> {
    w.hwnd().ok().map(|h| h.0 as isize)
}

// ---------- окна ----------

pub fn show_hub(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        // закреплять можно только видимое окно — делаем при каждом показе (дёшево)
        if let Some(h) = hwnd_of(&w) {
            desktop::pin_window(h);
        }
        let _ = w.set_focus();
    }
}

pub fn hide_hub(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
}

pub fn toggle_hub(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let visible = w.is_visible().unwrap_or(false);
        let focused = w.is_focused().unwrap_or(false);
        if visible && focused {
            let _ = w.hide();
        } else {
            show_hub(app);
        }
    }
}

fn game_window(app: &AppHandle) -> Result<WebviewWindow> {
    if let Some(w) = app.get_webview_window("game") {
        return Ok(w);
    }
    let w = WebviewWindowBuilder::new(app, "game", WebviewUrl::App("index.html".into()))
        .title("Profile Hub — Игры")
        .fullscreen(true)
        .decorations(false)
        .visible(false)
        .build()?;
    Ok(w)
}

fn show_game_window(app: &AppHandle, desk: Option<winvd::Desktop>) -> Result<()> {
    let w = game_window(app)?;
    w.show()?;
    if let (Some(d), Some(h)) = (desk, hwnd_of(&w)) {
        desktop::move_window(h, d);
    }
    let _ = w.set_fullscreen(true);
    let _ = w.set_focus();
    Ok(())
}

fn hide_game_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("game") {
        let _ = w.hide();
    }
}

// ---------- приложения профиля ----------

pub fn track(app: &AppHandle, profile_id: &str, pid: u32) {
    state(app)
        .tracked
        .lock()
        .entry(profile_id.to_string())
        .or_default()
        .push(pid);
}

pub fn launch_browser(app: &AppHandle, profile_id: &str, kind: BrowserKind) -> Result<()> {
    let st = state(app);
    let info = st
        .browsers
        .lock()
        .iter()
        .find(|b| b.kind == kind)
        .cloned()
        .ok_or_else(|| anyhow!("браузер не найден"))?;
    let dir = browsers::data_dir(&st.profiles_root(), profile_id, kind);
    let pid = browsers::launch(&info, &dir)?;
    track(app, profile_id, pid);
    Ok(())
}

pub fn launch_app(app: &AppHandle, profile_id: &str, app_id: &str) -> Result<()> {
    let p = state(app).profile(profile_id)?;
    let a = p
        .apps
        .iter()
        .find(|a| a.id == app_id)
        .ok_or_else(|| anyhow!("приложение не найдено"))?;
    let pid = util::spawn_detached(&a.path, &util::split_args(&a.args), None)?;
    track(app, profile_id, pid);
    Ok(())
}

/// Закрыть окна всех приложений профиля. Возвращает число закрытых окон.
pub fn close_profile_apps(app: &AppHandle, profile_id: &str) -> usize {
    let st = state(app);
    let root = st.profiles_root();
    let tracked = st.tracked.lock().get(profile_id).cloned().unwrap_or_default();
    let pids = Snapshot::take().profile_pids(&data_dir(&root, profile_id), &tracked);
    let n = processes::close_windows(&pids);
    st.tracked.lock().remove(profile_id);
    n
}

fn is_running(app: &AppHandle, profile_id: &str) -> bool {
    let st = state(app);
    let root = st.profiles_root();
    let tracked = st.tracked.lock().get(profile_id).cloned().unwrap_or_default();
    !Snapshot::take()
        .profile_pids(&data_dir(&root, profile_id), &tracked)
        .is_empty()
}

fn autostart(app: &AppHandle, p: &Profile) {
    for b in p.browsers.iter().filter(|b| b.autostart) {
        if let Err(e) = launch_browser(app, &p.id, b.kind) {
            log::warn!("автозапуск браузера: {e}");
        }
    }
    for a in p.apps.iter().filter(|a| a.autostart) {
        if let Err(e) = launch_app(app, &p.id, &a.id) {
            log::warn!("автозапуск {}: {e}", a.name);
        }
    }
}

// ---------- переключение ----------

fn should_close(on_leave: LeaveBehavior, target: ProfileKind) -> bool {
    match on_leave {
        LeaveBehavior::Keep => false,
        LeaveBehavior::Close => true,
        LeaveBehavior::CloseOnGaming => target == ProfileKind::Gaming,
    }
}

pub fn switch_profile(app: &AppHandle, id: &str) -> Result<()> {
    let st = state(app);
    let _guard = st.switching.lock();

    let target = st.profile(id)?;
    let (prev, settings, owned_desktops) = {
        let cfg = st.config.lock();
        let prev = cfg
            .active_profile_id
            .as_ref()
            .and_then(|pid| cfg.profiles.iter().find(|p| &p.id == pid))
            .cloned();
        let owned: Vec<String> = cfg.profiles.iter().filter_map(|p| p.desktop_id.clone()).collect();
        (prev, cfg.settings.clone(), owned)
    };

    // 1. уходим из старого профиля
    if let Some(prev) = prev.as_ref().filter(|p| p.id != target.id) {
        if should_close(prev.on_leave, target.kind) {
            let n = close_profile_apps(app, &prev.id);
            log::info!("закрыто окон профиля {}: {n}", prev.name);
        }
    }

    // 2. рабочий стол профиля. Самый первый профиль «забирает» текущий стол,
    //    если ни один профиль ещё не владеет существующим столом.
    let any_owned_exists = owned_desktops.iter().any(|d| desktop::find(d).is_some());
    let label = format!("{} {}", target.icon, target.name);
    let (desk, desk_id) = desktop::ensure(target.desktop_id.as_deref(), &label, !any_owned_exists)?;

    if let Some(wp) = target.wallpaper.as_deref().filter(|w| Path::new(w).is_file()) {
        if let Err(e) = desktop::set_wallpaper(&desk, wp) {
            log::warn!("обои: {e}");
        }
    }
    desktop::switch(desk)?;

    if settings.apply_windows_theme {
        if let Err(e) = desktop::apply_theme(target.theme == ThemeMode::Light) {
            log::warn!("тема: {e}");
        }
    }

    // 3. сохранить
    {
        let mut cfg = st.config.lock();
        if let Some(p) = cfg.profiles.iter_mut().find(|p| p.id == target.id) {
            p.desktop_id = Some(desk_id);
        }
        cfg.active_profile_id = Some(target.id.clone());
    }
    st.save_config()?;
    if target.kind == ProfileKind::Work {
        *st.prev_work.lock() = Some(target.id.clone());
    }

    // 4. автозапуск, если профиль ещё не запущен
    if !is_running(app, &target.id) {
        autostart(app, &target);
    }

    // 5. окна
    hide_hub(app);
    match target.kind {
        ProfileKind::Gaming => show_game_window(app, Some(desk))?,
        ProfileKind::Work => hide_game_window(app),
    }

    emit_state(app);
    Ok(())
}

pub fn enter_game_mode(app: &AppHandle) -> Result<()> {
    let gaming = state(app)
        .config
        .lock()
        .profiles
        .iter()
        .find(|p| p.kind == ProfileKind::Gaming)
        .map(|p| p.id.clone());
    match gaming {
        Some(id) => switch_profile(app, &id),
        None => {
            hide_hub(app);
            show_game_window(app, None)
        }
    }
}

pub fn exit_game_mode(app: &AppHandle) -> Result<()> {
    let st = state(app);
    let back = st.prev_work.lock().clone().or_else(|| {
        st.config
            .lock()
            .profiles
            .iter()
            .find(|p| p.kind == ProfileKind::Work)
            .map(|p| p.id.clone())
    });
    hide_game_window(app);
    match back {
        Some(id) => switch_profile(app, &id),
        None => Ok(()),
    }
}

// ---------- игры ----------

pub fn games(app: &AppHandle, refresh: bool) -> Vec<Game> {
    let st = state(app);
    if !refresh {
        if let Some(g) = st.games.lock().clone() {
            return g;
        }
    }
    let (manual, last) = {
        let cfg = st.config.lock();
        (cfg.manual_games.clone(), cfg.last_played.clone())
    };
    let list = games::scan_all(&manual, &last);
    *st.games.lock() = Some(list.clone());
    list
}

pub fn launch_game(app: &AppHandle, game_id: &str) -> Result<()> {
    let game = games(app, false)
        .into_iter()
        .find(|g| g.id == game_id)
        .ok_or_else(|| anyhow!("игра не найдена"))?;
    games::launch(&game.launch)?;
    let st = state(app);
    let now = util::now_unix();
    st.config.lock().last_played.insert(game_id.to_string(), now);
    st.save_config()?;
    if let Some(list) = st.games.lock().as_mut() {
        if let Some(g) = list.iter_mut().find(|g| g.id == game_id) {
            g.last_played = Some(now);
        }
    }
    Ok(())
}

// ---------- хоткеи ----------

#[derive(Clone)]
enum HotkeyAction {
    ToggleHub,
    GameMode,
    Switch(String),
}

fn run_action(app: AppHandle, action: HotkeyAction) {
    // хоткеи приходят в главном потоке — тяжёлую работу уводим
    std::thread::spawn(move || {
        let res = match action {
            HotkeyAction::ToggleHub => {
                toggle_hub(&app);
                Ok(())
            }
            HotkeyAction::GameMode => {
                let in_game = app
                    .get_webview_window("game")
                    .and_then(|w| w.is_visible().ok())
                    .unwrap_or(false);
                if in_game {
                    exit_game_mode(&app)
                } else {
                    enter_game_mode(&app)
                }
            }
            HotkeyAction::Switch(id) => switch_profile(&app, &id),
        };
        if let Err(e) = res {
            log::error!("хоткей: {e}");
            let _ = app.emit("backend-error", e.to_string());
        }
    });
}

/// Перерегистрировать все глобальные хоткеи. Возвращает список тех, что не удалось занять.
pub fn register_hotkeys(app: &AppHandle) -> Vec<String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let mut list: Vec<(String, HotkeyAction)> = Vec::new();
    {
        let st = state(app);
        let cfg = st.config.lock();
        list.push((cfg.settings.hub_hotkey.clone(), HotkeyAction::ToggleHub));
        list.push((cfg.settings.game_hotkey.clone(), HotkeyAction::GameMode));
        for p in &cfg.profiles {
            if let Some(h) = p.hotkey.clone().filter(|h| !h.trim().is_empty()) {
                list.push((h, HotkeyAction::Switch(p.id.clone())));
            }
        }
    }
    let mut failed = Vec::new();
    for (keys, action) in list {
        if keys.trim().is_empty() {
            continue;
        }
        let res = gs.on_shortcut(keys.as_str(), move |app, _sc, ev| {
            if ev.state == ShortcutState::Pressed {
                run_action(app.clone(), action.clone());
            }
        });
        if let Err(e) = res {
            log::warn!("хоткей {keys} не зарегистрирован: {e}");
            failed.push(keys);
        }
    }
    failed
}
