//! Игровой режим: монитор окна, запущенные игры, голосовые приложения и
//! встроенный браузер (отдельный WebView поверх области панели в окне "game").

use crate::core::{self, state};
use crate::models::*;
use crate::{games, util};
use anyhow::{anyhow, Result};
use parking_lot::Mutex;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Monitor, WebviewBuilder, WebviewUrl, WebviewWindow};
use windows_sys::Win32::Foundation::{HWND, LPARAM, RECT};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindow, GetWindowRect, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
    SetForegroundWindow, ShowWindow, GW_OWNER, SW_RESTORE,
};

const BROWSER: &str = "voice-browser";
const BROWSER_HOME: &str = "https://www.google.com/";

fn game_window(app: &AppHandle) -> Result<WebviewWindow> {
    app.get_webview_window("game").ok_or_else(|| anyhow!("игровой режим не открыт"))
}

// ---------------- мониторы ----------------

fn sorted_monitors(w: &WebviewWindow) -> Vec<Monitor> {
    let mut list = w.available_monitors().unwrap_or_default();
    list.sort_by_key(|m| (m.position().x, m.position().y));
    list
}

pub fn list_monitors(app: &AppHandle) -> Result<Vec<MonitorInfo>> {
    let w = game_window(app)?;
    let primary = w.primary_monitor().ok().flatten().and_then(|m| m.name().cloned());
    let current = w.current_monitor().ok().flatten().and_then(|m| m.name().cloned());
    Ok(sorted_monitors(&w)
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let name = m.name().cloned().unwrap_or_else(|| format!("monitor-{i}"));
            let size = m.size();
            let is_primary = primary.as_deref() == Some(name.as_str());
            MonitorInfo {
                label: format!(
                    "Экран {} · {}×{}{}",
                    i + 1,
                    size.width,
                    size.height,
                    if is_primary { " · основной" } else { "" }
                ),
                current: current.as_deref() == Some(name.as_str()),
                primary: is_primary,
                width: size.width,
                height: size.height,
                name,
            }
        })
        .collect())
}

/// Поставить окно на монитор и развернуть на весь экран (fullscreen привязан к монитору окна).
fn place_on(w: &WebviewWindow, m: &Monitor) {
    let _ = w.set_fullscreen(false);
    let _ = w.set_position(*m.position());
    let _ = w.set_size(*m.size());
    let _ = w.set_fullscreen(true);
}

/// Перед показом игрового режима — на сохранённый монитор (если он подключён).
pub fn place_on_saved_monitor(app: &AppHandle, w: &WebviewWindow) {
    let saved = state(app).config.lock().settings.game_monitor.clone();
    let Some(name) = saved else { return };
    if let Some(m) = sorted_monitors(w).into_iter().find(|m| m.name() == Some(&name)) {
        let on_it = w.current_monitor().ok().flatten().and_then(|c| c.name().cloned()) == Some(name);
        if !on_it {
            place_on(w, &m);
        }
    }
}

pub fn move_game_to_monitor(app: &AppHandle, name: &str) -> Result<()> {
    let w = game_window(app)?;
    let m = sorted_monitors(&w)
        .into_iter()
        .find(|m| m.name().map(String::as_str) == Some(name))
        .ok_or_else(|| anyhow!("монитор не найден"))?;
    place_on(&w, &m);
    let _ = w.set_focus();
    let primary = w.primary_monitor().ok().flatten().and_then(|p| p.name().cloned());
    let name = name.to_string();
    state(app).update_config(|cfg| {
        // основной монитор = значение по умолчанию
        cfg.settings.game_monitor = (primary.as_deref() != Some(name.as_str())).then_some(name);
        Ok(())
    })?;
    Ok(())
}

// ---------------- запущенные игры ----------------

static SYS: Mutex<Option<System>> = Mutex::new(None);

/// Папки игр (нижний регистр, с завершающим «\») -> id игры.
fn game_dirs(app: &AppHandle) -> Vec<(String, String)> {
    core::games(app, false)
        .into_iter()
        .filter_map(|g| {
            let dir = g.install_dir.clone().or_else(|| match &g.launch {
                LaunchTarget::Exe { path, .. } => {
                    PathBuf::from(path).parent().map(|p| p.to_string_lossy().to_string())
                }
                _ => None,
            })?;
            let mut d = dir.to_lowercase().replace('/', "\\");
            if d.len() < 4 {
                return None; // «C:\» как папка игры — слишком широко
            }
            if !d.ends_with('\\') {
                d.push('\\');
            }
            Some((d, g.id))
        })
        .collect()
}

/// game_id -> (PID'ы, время запуска самого раннего процесса).
fn scan_running(app: &AppHandle) -> HashMap<String, (Vec<u32>, u64)> {
    let dirs = game_dirs(app);
    let mut out: HashMap<String, (Vec<u32>, u64)> = HashMap::new();
    if dirs.is_empty() {
        return out;
    }
    let mut guard = SYS.lock();
    let sys = guard.get_or_insert_with(System::new);
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet),
    );
    for (pid, p) in sys.processes() {
        let Some(exe) = p.exe() else { continue };
        let exe = exe.to_string_lossy().to_lowercase();
        if let Some((_, id)) = dirs.iter().find(|(d, _)| exe.starts_with(d.as_str())) {
            let e = out.entry(id.clone()).or_insert((Vec::new(), u64::MAX));
            e.0.push(pid.as_u32());
            e.1 = e.1.min(p.start_time());
        }
    }
    out
}

pub fn running_games(app: &AppHandle) -> Vec<RunningGame> {
    let mut list: Vec<RunningGame> = scan_running(app)
        .into_iter()
        .map(|(game_id, (_, started_at))| RunningGame { game_id, started_at })
        .collect();
    list.sort_by_key(|r| std::cmp::Reverse(r.started_at));
    list
}

struct FindCtx<'a> {
    pids: &'a HashSet<u32>,
    best: Option<(HWND, i64)>,
}

unsafe extern "system" fn find_proc(hwnd: HWND, lparam: LPARAM) -> i32 {
    // SAFETY: lparam указывает на FindCtx, живущий на стеке вызывающего на время EnumWindows.
    let ctx = unsafe { &mut *(lparam as *mut FindCtx) };
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
    if !ctx.pids.contains(&pid)
        || unsafe { IsWindowVisible(hwnd) } == 0
        || !unsafe { GetWindow(hwnd, GW_OWNER) }.is_null()
    {
        return 1;
    }
    let mut r: RECT = unsafe { std::mem::zeroed() };
    unsafe { GetWindowRect(hwnd, &mut r) };
    let area = (r.right - r.left) as i64 * (r.bottom - r.top) as i64;
    if ctx.best.is_none_or(|(_, a)| area > a) {
        ctx.best = Some((hwnd, area));
    }
    1
}

/// Вывести самое большое окно игры на передний план.
pub fn focus_game(app: &AppHandle, game_id: &str) -> Result<()> {
    let running = scan_running(app);
    let (pids, _) = running.get(game_id).ok_or_else(|| anyhow!("игра не запущена"))?;
    let pids: HashSet<u32> = pids.iter().copied().collect();
    let mut ctx = FindCtx { pids: &pids, best: None };
    unsafe { EnumWindows(Some(find_proc), &mut ctx as *mut FindCtx as LPARAM) };
    let (hwnd, _) = ctx.best.ok_or_else(|| anyhow!("окно игры не найдено"))?;
    unsafe {
        if IsIconic(hwnd) != 0 {
            ShowWindow(hwnd, SW_RESTORE);
        }
        SetForegroundWindow(hwnd);
    }
    Ok(())
}

// ---------------- голос ----------------

fn discord_updater() -> Option<PathBuf> {
    let local = dirs::data_local_dir()?;
    ["Discord", "DiscordPTB", "DiscordCanary"]
        .iter()
        .map(|d| local.join(d).join("Update.exe"))
        .find(|p| p.is_file())
}

fn discord_exe_name(updater: &std::path::Path) -> &'static str {
    match updater.parent().and_then(|p| p.file_name()).and_then(|n| n.to_str()) {
        Some("DiscordPTB") => "DiscordPTB.exe",
        Some("DiscordCanary") => "DiscordCanary.exe",
        _ => "Discord.exe",
    }
}

pub fn voice_apps() -> VoiceApps {
    VoiceApps {
        discord: discord_updater().is_some(),
        steam: games::list_launchers().iter().any(|l| l.source == GameSource::Steam),
    }
}

pub fn open_discord() -> Result<()> {
    let up = discord_updater().ok_or_else(|| anyhow!("Discord не установлен"))?;
    let exe = discord_exe_name(&up);
    util::spawn_detached(&up.to_string_lossy(), &["--processStart".into(), exe.into()], None)?;
    Ok(())
}

pub fn open_steam_chat() -> Result<()> {
    games::launch(&LaunchTarget::Uri { uri: "steam://open/friends".into() })
}

// ---------------- встроенный браузер ----------------

fn parse_url(url: &str) -> Result<tauri::Url> {
    let u: tauri::Url = url.parse().map_err(|_| anyhow!("некорректный адрес: {url}"))?;
    if !matches!(u.scheme(), "http" | "https") {
        return Err(anyhow!("можно открывать только http/https"));
    }
    Ok(u)
}

fn place(wv: &tauri::Webview, rect: Rect) -> Result<()> {
    wv.set_position(LogicalPosition::new(rect.x, rect.y))?;
    wv.set_size(LogicalSize::new(rect.width.max(1.0), rect.height.max(1.0)))?;
    Ok(())
}

pub fn browser_open(app: &AppHandle, url: Option<&str>, rect: Rect) -> Result<()> {
    let url = url.map(parse_url).transpose()?;
    if let Some(wv) = app.get_webview(BROWSER) {
        if let Some(u) = url {
            wv.navigate(u)?;
        }
        place(&wv, rect)?;
        wv.show()?;
        let _ = wv.set_focus();
        return Ok(());
    }
    let game = game_window(app)?;
    let start = url.unwrap_or_else(|| BROWSER_HOME.parse().expect("home url"));
    let nav_app = app.clone();
    let load_app = app.clone();
    // Сторонний сайт: никакого доступа к командам Tauri (IPC разрешён только локальному UI),
    // данные (входы, куки) — в профиле WebView2 этой учётки Windows.
    let builder = WebviewBuilder::new(BROWSER, WebviewUrl::External(start))
        .on_navigation(move |u| {
            let _ = nav_app.emit_to("game", "browser-url", u.to_string());
            matches!(u.scheme(), "http" | "https" | "about" | "blob" | "data")
        })
        .on_page_load(move |_wv, payload| {
            let _ = load_app.emit_to("game", "browser-url", payload.url().to_string());
        });
    let wv = game.as_ref().window().add_child(
        builder,
        LogicalPosition::new(rect.x, rect.y),
        LogicalSize::new(rect.width.max(1.0), rect.height.max(1.0)),
    )?;
    let _ = wv.set_focus();
    Ok(())
}

pub fn browser_set_bounds(app: &AppHandle, rect: Rect) -> Result<()> {
    if let Some(wv) = app.get_webview(BROWSER) {
        place(&wv, rect)?;
    }
    Ok(())
}

pub fn browser_hide(app: &AppHandle) -> Result<()> {
    if let Some(wv) = app.get_webview(BROWSER) {
        wv.hide()?;
    }
    // вернуть фокус интерфейсу игр (клавиатура/Esc)
    if let Some(game) = app.get_webview_window("game") {
        let _ = game.set_focus();
    }
    Ok(())
}

pub fn browser_close(app: &AppHandle) -> Result<()> {
    if let Some(wv) = app.get_webview(BROWSER) {
        wv.close()?;
    }
    if let Some(game) = app.get_webview_window("game") {
        let _ = game.set_focus();
    }
    Ok(())
}

pub fn browser_nav(app: &AppHandle, action: &str) -> Result<()> {
    let wv = app.get_webview(BROWSER).ok_or_else(|| anyhow!("браузер не открыт"))?;
    let js = match action {
        "back" => "history.back()",
        "forward" => "history.forward()",
        "reload" => "location.reload()",
        _ => return Err(anyhow!("неизвестное действие")),
    };
    wv.eval(js)?;
    Ok(())
}
