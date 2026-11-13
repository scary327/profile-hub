//! Состояние приложения и основная логика.
//!
//! Модель: каждый профиль — отдельная учётка Windows. Hub запущен в каждой учётке
//! (общий конфиг в ProgramData). «Текущий профиль» — тот, к которому привязана учётка
//! этого сеанса. Переход в другой профиль = экран входа Windows (сеанс остаётся в фоне)
//! или выход из учётки — по настройке профиля.

use crate::models::*;
use crate::{browsers, config, desktop, games, processes, util, winusers};
use anyhow::{anyhow, bail, Result};
use parking_lot::Mutex;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const USERS_CACHE_TTL: Duration = Duration::from_secs(15);

pub struct AppState {
    /// SID и имя пользователя этого сеанса.
    pub sid: String,
    pub username: String,
    pub config: Mutex<AppConfig>,
    pub browsers: Mutex<Vec<BrowserInfo>>,
    pub games: Mutex<Option<Vec<Game>>>,
    /// PID'ы программ, запущенных хабом в этом сеансе.
    pub tracked: Mutex<Vec<u32>>,
    pub busy_hotkeys: Mutex<Vec<String>>,
    users_cache: Mutex<Option<(Instant, Vec<WinUserInfo>)>>,
}

impl AppState {
    pub fn new() -> Self {
        let (sid, username) = winusers::current_user().unwrap_or_else(|e| {
            log::error!("не удалось определить пользователя: {e:#}");
            (String::new(), std::env::var("USERNAME").unwrap_or_default())
        });
        let cfg = config::load(&sid, &username);
        AppState {
            sid,
            username,
            config: Mutex::new(cfg),
            browsers: Mutex::new(browsers::detect()),
            games: Mutex::new(None),
            tracked: Mutex::new(Vec::new()),
            busy_hotkeys: Mutex::new(Vec::new()),
            users_cache: Mutex::new(None),
        }
    }

    /// Подтянуть изменения, сделанные Hub'ом в другой учётке.
    pub fn refresh_config(&self) {
        if let Some(cfg) = config::reload() {
            *self.config.lock() = cfg;
        }
    }

    /// Прочитать с диска → изменить → записать.
    pub fn update_config<T>(&self, f: impl FnOnce(&mut AppConfig) -> Result<T>) -> Result<T> {
        let mut cfg = config::reload().unwrap_or_else(|| self.config.lock().clone());
        let out = f(&mut cfg)?;
        config::save(&cfg)?;
        *self.config.lock() = cfg;
        Ok(out)
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

    /// Профиль, привязанный к учётке этого сеанса.
    pub fn current_profile(&self) -> Option<Profile> {
        self.config
            .lock()
            .profiles
            .iter()
            .find(|p| p.windows_user.as_ref().is_some_and(|u| u.sid == self.sid))
            .cloned()
    }

    pub fn is_current(&self, p: &Profile) -> bool {
        p.windows_user.as_ref().is_some_and(|u| u.sid == self.sid)
    }

    pub fn windows_users(&self, force: bool) -> Vec<WinUserInfo> {
        let mut cache = self.users_cache.lock();
        if !force {
            if let Some((at, list)) = cache.as_ref() {
                if at.elapsed() < USERS_CACHE_TTL {
                    // сеансы меняются чаще списка учёток — их обновляем всегда
                    let sessions: Vec<String> =
                        winusers::logged_in_usernames().into_iter().map(|n| n.to_lowercase()).collect();
                    return list
                        .iter()
                        .cloned()
                        .map(|mut u| {
                            u.logged_in = sessions.contains(&u.username.to_lowercase());
                            u
                        })
                        .collect();
                }
            }
        }
        match winusers::list_users(&self.sid) {
            Ok(list) => {
                *cache = Some((Instant::now(), list.clone()));
                list
            }
            Err(e) => {
                log::warn!("список учёток: {e:#}");
                cache.as_ref().map(|(_, l)| l.clone()).unwrap_or_default()
            }
        }
    }
}

pub fn state(app: &AppHandle) -> tauri::State<'_, AppState> {
    app.state::<AppState>()
}

pub fn hub_state(app: &AppHandle) -> HubState {
    hub_state_ex(app, false)
}

pub fn hub_state_ex(app: &AppHandle, force_users: bool) -> HubState {
    let st = state(app);
    st.refresh_config();
    let cfg = st.config.lock().clone();
    let windows_users = st.windows_users(force_users);
    let logged: HashSet<String> = windows_users
        .iter()
        .filter(|u| u.logged_in)
        .map(|u| u.sid.clone())
        .collect();
    let running_profiles = cfg
        .profiles
        .iter()
        .filter(|p| p.windows_user.as_ref().is_some_and(|u| logged.contains(&u.sid)))
        .map(|p| p.id.clone())
        .collect();
    let current_user = windows_users
        .iter()
        .find(|u| u.is_current)
        .cloned()
        .unwrap_or_else(|| WinUserInfo {
            sid: st.sid.clone(),
            username: st.username.clone(),
            full_name: String::new(),
            enabled: true,
            logged_in: true,
            is_current: true,
        });
    let current_profile_id = cfg
        .profiles
        .iter()
        .find(|p| p.windows_user.as_ref().is_some_and(|u| u.sid == st.sid))
        .map(|p| p.id.clone());
    let browsers = st.browsers.lock().clone();
    let busy_hotkeys = st.busy_hotkeys.lock().clone();
    HubState {
        config: cfg,
        browsers,
        running_profiles,
        busy_hotkeys,
        current_user,
        current_profile_id,
        windows_users,
    }
}

pub fn emit_state(app: &AppHandle) {
    let s = hub_state(app);
    let _ = app.emit("state-changed", s);
}

// ---------- окна ----------

pub fn show_hub(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
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

pub fn show_game_window(app: &AppHandle) -> Result<()> {
    let w = game_window(app)?;
    w.show()?;
    let _ = w.set_fullscreen(true);
    let _ = w.set_focus();
    hide_hub(app);
    Ok(())
}

fn hide_game_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("game") {
        let _ = w.hide();
    }
}

fn game_window_visible(app: &AppHandle) -> bool {
    app.get_webview_window("game")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
}

// ---------- программы профиля (только в его учётке) ----------

fn require_current(app: &AppHandle, profile_id: &str) -> Result<Profile> {
    let st = state(app);
    let p = st.profile(profile_id)?;
    if !st.is_current(&p) {
        bail!("Это можно сделать только в учётке профиля «{}»", p.name);
    }
    Ok(p)
}

pub fn launch_browser(app: &AppHandle, profile_id: &str, kind: BrowserKind) -> Result<()> {
    require_current(app, profile_id)?;
    let st = state(app);
    let info = st
        .browsers
        .lock()
        .iter()
        .find(|b| b.kind == kind)
        .cloned()
        .ok_or_else(|| anyhow!("браузер не найден"))?;
    let pid = browsers::launch(&info)?;
    st.tracked.lock().push(pid);
    Ok(())
}

pub fn launch_app(app: &AppHandle, profile_id: &str, app_id: &str) -> Result<()> {
    let p = require_current(app, profile_id)?;
    let a = p
        .apps
        .iter()
        .find(|a| a.id == app_id)
        .ok_or_else(|| anyhow!("приложение не найдено"))?;
    let pid = util::spawn_detached(&a.path, &util::split_args(&a.args), None)?;
    state(app).tracked.lock().push(pid);
    Ok(())
}

/// Закрыть окна программ, запущенных хабом в этой учётке.
pub fn close_profile_apps(app: &AppHandle, profile_id: &str) -> Result<usize> {
    require_current(app, profile_id)?;
    let pids: HashSet<u32> = std::mem::take(&mut *state(app).tracked.lock()).into_iter().collect();
    Ok(processes::close_windows(&pids))
}

fn apply_appearance(p: &Profile, apply_theme: bool) {
    if let Some(wp) = p.wallpaper.as_deref().filter(|w| Path::new(w).is_file()) {
        if let Err(e) = desktop::set_wallpaper(wp) {
            log::warn!("обои: {e:#}");
        }
    }
    if apply_theme {
        if let Err(e) = desktop::apply_theme(p.theme == ThemeMode::Light) {
            log::warn!("тема: {e:#}");
        }
    }
}

/// Применить оформление профиля сразу, если профиль — текущей учётки.
pub fn apply_if_current(app: &AppHandle, p: &Profile) {
    let st = state(app);
    if st.is_current(p) {
        let theme = st.config.lock().settings.apply_windows_theme;
        apply_appearance(p, theme);
    }
}

/// Вызывается при запуске Hub. `at_sign_in` — запуск при входе в Windows (--autostart).
pub fn on_session_start(app: &AppHandle, at_sign_in: bool) {
    let st = state(app);
    let Some(p) = st.current_profile() else {
        log::info!("учётка {} не привязана ни к одному профилю", st.username);
        show_hub(app);
        return;
    };
    log::info!("сеанс профиля «{}» (учётка {})", p.name, st.username);
    let theme = st.config.lock().settings.apply_windows_theme;
    apply_appearance(&p, theme);
    let id = p.id.clone();
    let _ = st.update_config(|cfg| {
        cfg.active_profile_id = Some(id);
        Ok(())
    });
    if at_sign_in {
        for b in p.browsers.iter().filter(|b| b.autostart) {
            if let Err(e) = launch_browser(app, &p.id, b.kind) {
                log::warn!("автозапуск браузера: {e:#}");
            }
        }
        for a in p.apps.iter().filter(|a| a.autostart) {
            if let Err(e) = launch_app(app, &p.id, &a.id) {
                log::warn!("автозапуск {}: {e:#}", a.name);
            }
        }
    }
    if p.kind == ProfileKind::Gaming {
        if let Err(e) = show_game_window(app) {
            log::error!("игровой режим: {e:#}");
        }
    } else if !at_sign_in {
        show_hub(app);
    }
}

// ---------- переключение ----------

fn sign_out_on_leave(on_leave: LeaveBehavior, target: ProfileKind) -> bool {
    match on_leave {
        LeaveBehavior::Keep => false,
        LeaveBehavior::SignOut => true,
        LeaveBehavior::SignOutOnGaming => target == ProfileKind::Gaming,
    }
}

pub fn switch_profile(app: &AppHandle, id: &str) -> Result<()> {
    let st = state(app);
    st.refresh_config();
    let target = st.profile(id)?;
    let Some(target_user) = target.windows_user.clone() else {
        bail!("Сначала создайте учётку Windows для профиля «{}»", target.name);
    };

    // та же учётка — переключаться некуда
    if target_user.sid == st.sid {
        if target.kind == ProfileKind::Gaming {
            show_game_window(app)?;
        } else {
            hide_game_window(app);
            hide_hub(app);
        }
        return Ok(());
    }

    let current = st.current_profile();
    st.update_config(|cfg| {
        cfg.active_profile_id = Some(target.id.clone());
        if let Some(c) = current.as_ref().filter(|c| c.kind == ProfileKind::Work) {
            cfg.prev_work_profile_id = Some(c.id.clone());
        }
        Ok(())
    })?;
    let sign_out = current
        .as_ref()
        .is_some_and(|c| sign_out_on_leave(c.on_leave, target.kind));
    log::info!(
        "переход в профиль «{}» (учётка {}), {}",
        target.name,
        target_user.username,
        if sign_out { "выход из текущей учётки" } else { "текущий сеанс остаётся в фоне" }
    );
    hide_hub(app);
    hide_game_window(app);
    // дать UI получить ответ команды, затем уйти на экран входа
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(400));
        let res = if sign_out { winusers::sign_out() } else { winusers::disconnect_to_sign_in() };
        if let Err(e) = res {
            log::error!("{e:#}");
        }
    });
    Ok(())
}

fn gaming_profile(app: &AppHandle) -> Option<Profile> {
    let st = state(app);
    let cfg = st.config.lock();
    let gaming = cfg.profiles.iter().filter(|p| p.kind == ProfileKind::Gaming);
    // предпочитаем игровой профиль с учёткой
    gaming
        .clone()
        .find(|p| p.windows_user.is_some())
        .or_else(|| gaming.clone().next())
        .cloned()
}

pub fn enter_game_mode(app: &AppHandle) -> Result<()> {
    let st = state(app);
    st.refresh_config();
    match gaming_profile(app) {
        // игровой профиль в другой учётке — переходим туда
        Some(g) if g.windows_user.as_ref().is_some_and(|u| u.sid != st.sid) => switch_profile(app, &g.id),
        // игровой профиль — эта учётка, или учётки у него ещё нет: открываем библиотеку здесь
        _ => show_game_window(app),
    }
}

pub fn exit_game_mode(app: &AppHandle) -> Result<()> {
    let st = state(app);
    st.refresh_config();
    hide_game_window(app);
    let back = {
        let cfg = st.config.lock();
        let has_other_account =
            |p: &&Profile| p.windows_user.as_ref().is_some_and(|u| u.sid != st.sid);
        cfg.prev_work_profile_id
            .as_ref()
            .and_then(|id| cfg.profiles.iter().find(|p| &p.id == id))
            .filter(has_other_account)
            .or_else(|| cfg.profiles.iter().filter(|p| p.kind == ProfileKind::Work).find(has_other_account))
            .map(|p| p.id.clone())
    };
    match back {
        Some(id) => switch_profile(app, &id),
        None => Ok(()), // работа в этой же учётке — просто закрыли окно игр
    }
}

// ---------- учётки ----------

fn ensure_unowned(cfg: &AppConfig, profile_id: &str, sid: &str) -> Result<()> {
    if let Some(other) = cfg
        .profiles
        .iter()
        .find(|p| p.id != profile_id && p.windows_user.as_ref().is_some_and(|u| u.sid == sid))
    {
        bail!("Эта учётка уже привязана к профилю «{}»", other.name);
    }
    Ok(())
}

fn link(app: &AppHandle, profile_id: &str, user: WindowsUser) -> Result<()> {
    let st = state(app);
    st.update_config(|cfg| {
        ensure_unowned(cfg, profile_id, &user.sid)?;
        let p = cfg
            .profiles
            .iter_mut()
            .find(|p| p.id == profile_id)
            .ok_or_else(|| anyhow!("Сначала сохраните профиль"))?;
        if p.projects_dir.trim().is_empty() {
            p.projects_dir = config::default_projects_dir(&user.username);
        }
        p.windows_user = Some(user);
        Ok(())
    })?;
    register_hotkeys(app);
    Ok(())
}

pub fn create_windows_user(app: &AppHandle, profile_id: &str, username: &str, password: Option<&str>) -> Result<()> {
    let st = state(app);
    let profile = st.profile(profile_id).map_err(|_| anyhow!("Сначала сохраните профиль"))?;
    if profile.windows_user.is_some() {
        bail!("У профиля уже есть учётка");
    }
    winusers::validate_username(username)?;
    if st
        .windows_users(true)
        .iter()
        .any(|u| u.username.eq_ignore_ascii_case(username))
    {
        bail!("Пользователь «{username}» уже существует — выберите его в «Выбрать существующую»");
    }
    let password = password.filter(|p| !p.is_empty());
    let sid = winusers::create_user(username, &profile.name, password)?;
    log::info!("создана учётка {username} для профиля «{}»", profile.name);
    link(app, profile_id, WindowsUser { sid, username: username.to_string() })?;
    st.windows_users(true);
    Ok(())
}

pub fn link_current_user(app: &AppHandle, profile_id: &str) -> Result<()> {
    let st = state(app);
    let user = WindowsUser { sid: st.sid.clone(), username: st.username.clone() };
    link(app, profile_id, user)?;
    if let Ok(p) = st.profile(profile_id) {
        apply_if_current(app, &p);
    }
    Ok(())
}

pub fn link_windows_user(app: &AppHandle, profile_id: &str, sid: &str) -> Result<()> {
    let st = state(app);
    let u = st
        .windows_users(true)
        .into_iter()
        .find(|u| u.sid == sid)
        .ok_or_else(|| anyhow!("Учётка не найдена"))?;
    link(app, profile_id, WindowsUser { sid: u.sid, username: u.username })
}

pub fn unlink_windows_user(app: &AppHandle, profile_id: &str) -> Result<()> {
    state(app).update_config(|cfg| {
        let p = cfg
            .profiles
            .iter_mut()
            .find(|p| p.id == profile_id)
            .ok_or_else(|| anyhow!("профиль не найден"))?;
        p.windows_user = None;
        Ok(())
    })
}

pub fn delete_profile(app: &AppHandle, id: &str, delete_account: bool) -> Result<()> {
    let st = state(app);
    let p = st.profile(id)?;
    if delete_account {
        if let Some(u) = &p.windows_user {
            if u.sid == st.sid {
                bail!("Нельзя удалить учётку, в которой вы сейчас находитесь");
            }
            winusers::delete_user(&u.sid)?;
            log::info!("удалена учётка {}", u.username);
            st.windows_users(true);
        }
    }
    st.update_config(|cfg| {
        cfg.profiles.retain(|p| p.id != id);
        for slot in [&mut cfg.active_profile_id, &mut cfg.prev_work_profile_id] {
            if slot.as_deref() == Some(id) {
                *slot = None;
            }
        }
        Ok(())
    })?;
    register_hotkeys(app);
    Ok(())
}

// ---------- игры ----------

pub fn games(app: &AppHandle, refresh: bool) -> Vec<Game> {
    let st = state(app);
    if !refresh {
        if let Some(g) = st.games.lock().clone() {
            return g;
        }
    }
    st.refresh_config();
    let (manual, last): (Vec<ManualGame>, HashMap<String, u64>) = {
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
    st.update_config(|cfg| {
        cfg.last_played.insert(game_id.to_string(), now);
        Ok(())
    })?;
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
                let in_gaming_account =
                    state(&app).current_profile().is_some_and(|p| p.kind == ProfileKind::Gaming);
                if game_window_visible(&app) {
                    exit_game_mode(&app)
                } else if in_gaming_account {
                    // в игровой учётке хоткей просто возвращает библиотеку
                    show_game_window(&app)
                } else {
                    enter_game_mode(&app)
                }
            }
            HotkeyAction::Switch(id) => switch_profile(&app, &id),
        };
        if let Err(e) = res {
            log::error!("хоткей: {e:#}");
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
    *state(app).busy_hotkeys.lock() = failed.clone();
    failed
}
