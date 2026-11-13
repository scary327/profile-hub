//! Нативное чтение геймпадов и превращение ввода в действия игрового режима.
//!
//! * DualSense / DualShock 4 читаем напрямую по HID и сами разбираем отчёты
//!   (USB, Bluetooth «простой» 0x01 и расширенный 0x31/0x11). Gamepad API во WebView2
//!   и Windows.Gaming.Input не понимают DualSense по Bluetooth, особенно после того,
//!   как Steam переключил его в расширенный режим.
//! * Остальные (Xbox и пр.) — через gilrs.
//!
//! Действия уходят окну "game" событием "pad-action", состояние — событием "pad-info".

use gilrs::{Axis, Button, Gilrs};
use hidapi::{HidApi, HidDevice};
use parking_lot::Mutex;
use serde::Serialize;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

const INITIAL_DELAY: Duration = Duration::from_millis(350);
const REPEAT_DELAY: Duration = Duration::from_millis(110);
const STICK_THRESHOLD: f32 = 0.5;
const RESCAN_EVERY: Duration = Duration::from_secs(2);

const SONY: u16 = 0x054c;
const DUALSENSE: [u16; 2] = [0x0ce6, 0x0df2]; // DualSense, DualSense Edge
const DUALSHOCK4: [u16; 3] = [0x05c4, 0x09cc, 0x0ba0];

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PadInfo {
    pub connected: bool,
    /// "playstation" | "xbox"
    pub r#type: String,
    pub id: String,
}

impl PadInfo {
    fn none() -> Self {
        PadInfo { connected: false, r#type: "xbox".into(), id: String::new() }
    }
}

static INFO: Mutex<Option<PadInfo>> = Mutex::new(None);

pub fn current_info() -> PadInfo {
    INFO.lock().clone().unwrap_or_else(PadInfo::none)
}

type Dir = Option<&'static str>;

/// Логическое состояние геймпада в терминах игрового режима.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PadState {
    pub confirm: bool,
    pub back: bool,
    pub folder: bool,
    pub tab_prev: bool,
    pub tab_next: bool,
    pub menu: bool,
    /// Create/Share (Sony) или View/Back (Xbox) — панель голоса и браузера.
    pub voice: bool,
    pub dir: Dir,
}

impl PadState {
    fn buttons(&self) -> [(bool, &'static str); 7] {
        [
            (self.confirm, "confirm"),
            (self.back, "back"),
            (self.folder, "folder"),
            (self.tab_prev, "tabPrev"),
            (self.tab_next, "tabNext"),
            (self.menu, "menu"),
            (self.voice, "voice"),
        ]
    }
}

fn stick_dir(x: f32, y_down: f32) -> Dir {
    if x.abs() < STICK_THRESHOLD && y_down.abs() < STICK_THRESHOLD {
        return None;
    }
    Some(if x.abs() > y_down.abs() {
        if x > 0.0 { "right" } else { "left" }
    } else if y_down > 0.0 {
        "down"
    } else {
        "up"
    })
}

// ---------------- Sony HID ----------------

/// Разобрать входной отчёт DualSense/DS4. Возвращает None для «чужих» отчётов.
pub fn parse_sony_report(dualsense: bool, data: &[u8]) -> Option<PadState> {
    // (смещение LX, смещение байта кнопок 0) для каждого формата;
    // LY = LX+1, кнопки 1 и 2 идут сразу за кнопками 0.
    let (lx, b0) = match (data.first()?, dualsense) {
        // DualSense по USB: полный отчёт 64 байта
        (0x01, true) if data.len() >= 64 => (1, 8),
        // DualSense по Bluetooth в простом режиме и DS4 по USB
        (0x01, _) if data.len() >= 8 => (1, 5),
        // DualSense по Bluetooth в расширенном режиме (после Steam/игр)
        (0x31, true) if data.len() >= 12 => (2, 9),
        // DS4 по Bluetooth в расширенном режиме
        (0x11, false) if data.len() >= 11 => (3, 8),
        _ => return None,
    };
    let axis = |i: usize| (data[i] as f32 - 128.0) / 127.0;
    let (x, y) = (axis(lx), axis(lx + 1));
    let (k0, k1, k2) = (data[b0], data[b0 + 1], data[b0 + 2]);
    let hat = k0 & 0x0f;
    let dir = match hat {
        0 | 1 | 7 => Some("up"),
        3..=5 => Some("down"),
        2 => Some("right"),
        6 => Some("left"),
        _ => None,
    }
    .or_else(|| stick_dir(x, y));
    Some(PadState {
        // k0: 0x10 □, 0x20 ✕, 0x40 ○, 0x80 △
        confirm: k0 & 0x20 != 0,
        back: k0 & 0x40 != 0,
        folder: k0 & 0x80 != 0,
        // k1: 0x01 L1, 0x02 R1, 0x10 Create/Share, 0x20 Options
        tab_prev: k1 & 0x01 != 0,
        tab_next: k1 & 0x02 != 0,
        // k2: 0x01 PS
        menu: k1 & 0x20 != 0 || k2 & 0x01 != 0,
        voice: k1 & 0x10 != 0,
        dir,
    })
}

struct SonyPad {
    dev: HidDevice,
    dualsense: bool,
    name: String,
    last: PadState,
}

static LAST_SEEN: Mutex<String> = Mutex::new(String::new());

fn open_sony(api: &mut HidApi) -> Option<SonyPad> {
    let _ = api.refresh_devices();
    let mut candidates: Vec<_> = api
        .device_list()
        .filter(|i| {
            i.vendor_id() == SONY
                && (DUALSENSE.contains(&i.product_id()) || DUALSHOCK4.contains(&i.product_id()))
        })
        .collect();
    // диагностика: логируем набор интерфейсов, когда он меняется
    let seen = candidates
        .iter()
        .map(|i| format!("{:04x} page={:#x} usage={:#x}", i.product_id(), i.usage_page(), i.usage()))
        .collect::<Vec<_>>()
        .join("; ");
    {
        let mut last = LAST_SEEN.lock();
        if *last != seen {
            log::info!("Sony HID-интерфейсы: [{seen}]");
            *last = seen;
        }
    }
    // у геймпада бывает несколько HID-интерфейсов — сначала игровой (usage page 1, usage 5)
    candidates.sort_by_key(|i| !(i.usage_page() == 0x01 && i.usage() == 0x05));
    for info in candidates {
        let pid = info.product_id();
        let dualsense = DUALSENSE.contains(&pid);
        match info.open_device(api) {
            Ok(dev) => {
                let _ = dev.set_blocking_mode(false);
                let name = if dualsense { "DualSense" } else { "DualShock 4" }.to_string();
                log::info!("геймпад по HID: {name} ({:04x}:{pid:04x})", SONY);
                return Some(SonyPad { dev, dualsense, name, last: PadState::default() });
            }
            Err(e) => log::warn!("не удалось открыть {pid:04x}: {e}"),
        }
    }
    None
}

/// Прочитать все накопившиеся отчёты, вернуть последнее состояние. Err — устройство пропало.
fn read_sony(pad: &mut SonyPad) -> Result<PadState, ()> {
    let mut buf = [0u8; 128];
    loop {
        match pad.dev.read(&mut buf) {
            Ok(0) => return Ok(pad.last),
            Ok(n) => {
                if let Some(st) = parse_sony_report(pad.dualsense, &buf[..n]) {
                    pad.last = st;
                }
            }
            Err(e) => {
                log::info!("{} отключён: {e}", pad.name);
                return Err(());
            }
        }
    }
}

// ---------------- gilrs (Xbox и прочие) ----------------

fn gilrs_state(g: &gilrs::Gamepad) -> PadState {
    let dir = if g.is_pressed(Button::DPadUp) {
        Some("up")
    } else if g.is_pressed(Button::DPadDown) {
        Some("down")
    } else if g.is_pressed(Button::DPadLeft) {
        Some("left")
    } else if g.is_pressed(Button::DPadRight) {
        Some("right")
    } else {
        // в gilrs вверх по Y = +
        stick_dir(g.value(Axis::LeftStickX), -g.value(Axis::LeftStickY))
    };
    PadState {
        confirm: g.is_pressed(Button::South),
        back: g.is_pressed(Button::East),
        folder: g.is_pressed(Button::North),
        tab_prev: g.is_pressed(Button::LeftTrigger),
        tab_next: g.is_pressed(Button::RightTrigger),
        menu: g.is_pressed(Button::Start) || g.is_pressed(Button::Mode),
        voice: g.is_pressed(Button::Select),
        dir,
    }
}

// ---------------- общий цикл ----------------

/// Окно игр видно и в фокусе — иначе ввод не наш (например, запущена игра).
fn game_focused(app: &AppHandle) -> bool {
    app.get_webview_window("game")
        .map(|w| w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false))
        .unwrap_or(false)
}

fn set_info(app: &AppHandle, info: PadInfo) {
    let mut cur = INFO.lock();
    if cur.as_ref() != Some(&info) {
        log::info!("геймпад: {info:?}");
        *cur = Some(info.clone());
        drop(cur);
        let _ = app.emit_to("game", "pad-info", info);
    }
}

/// Превращает поток состояний в действия: нажатия по фронту, направления с автоповтором.
struct Repeater {
    prev: PadState,
    next_repeat: Instant,
    armed: bool,
}

impl Repeater {
    fn new() -> Self {
        Repeater { prev: PadState::default(), next_repeat: Instant::now(), armed: false }
    }

    /// `active == false` — окно не в фокусе: запоминаем состояние, ничего не шлём,
    /// чтобы при возврате фокуса не сработали уже зажатые кнопки.
    fn step(&mut self, st: PadState, active: bool, mut emit: impl FnMut(&'static str)) {
        let now = Instant::now();
        if !active || !self.armed {
            self.prev = st;
            self.next_repeat = now + INITIAL_DELAY;
            self.armed = active;
            return;
        }
        for ((on, name), (was, _)) in st.buttons().into_iter().zip(self.prev.buttons()) {
            if on && !was {
                emit(name);
            }
        }
        if st.dir != self.prev.dir {
            if let Some(d) = st.dir {
                emit(d);
                self.next_repeat = now + INITIAL_DELAY;
            }
        } else if let Some(d) = st.dir {
            if now >= self.next_repeat {
                emit(d);
                self.next_repeat = now + REPEAT_DELAY;
            }
        }
        self.prev = st;
    }
}

pub fn spawn(app: AppHandle) {
    std::thread::Builder::new()
        .name("gamepad".into())
        .spawn(move || run(app))
        .expect("не удалось запустить поток геймпада");
}

fn run(app: AppHandle) {
    let mut hid = HidApi::new()
        .map_err(|e| log::error!("hidapi не запустился: {e}"))
        .ok();
    let mut gilrs = Gilrs::new().map_err(|e| log::error!("gilrs не запустился: {e}")).ok();
    let mut sony: Option<SonyPad> = None;
    let mut last_scan = Instant::now() - RESCAN_EVERY;
    let mut rep = Repeater::new();

    loop {
        // gilrs обновляет состояние только по мере чтения событий
        if let Some(g) = gilrs.as_mut() {
            while g.next_event().is_some() {}
        }

        if sony.is_none() && last_scan.elapsed() >= RESCAN_EVERY {
            last_scan = Instant::now();
            if let Some(api) = hid.as_mut() {
                sony = open_sony(api);
            }
        }

        let mut state = None;
        let mut info = PadInfo::none();
        if let Some(pad) = sony.as_mut() {
            match read_sony(pad) {
                Ok(st) => {
                    state = Some(st);
                    info = PadInfo { connected: true, r#type: "playstation".into(), id: pad.name.clone() };
                }
                Err(()) => sony = None,
            }
        }
        if state.is_none() {
            if let Some(g) = gilrs.as_ref() {
                // Sony через gilrs пропускаем: его читает HID-ветка
                if let Some((_, pad)) = g.gamepads().find(|(_, p)| p.vendor_id() != Some(SONY)) {
                    state = Some(gilrs_state(&pad));
                    info = PadInfo { connected: true, r#type: "xbox".into(), id: pad.name().to_string() };
                }
            }
        }
        set_info(&app, info);

        let focused = game_focused(&app);
        if let Some(st) = state {
            rep.step(st, focused, |a| {
                let _ = app.emit_to("game", "pad-action", a);
            });
        } else {
            rep = Repeater::new();
        }

        // окно игр скрыто — опрашиваем редко, чтобы не тратить CPU
        std::thread::sleep(if focused { Duration::from_millis(8) } else { Duration::from_millis(100) });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn report(id: u8, len: usize, lx_at: usize, b0_at: usize, b0: u8, b1: u8, b2: u8) -> Vec<u8> {
        let mut r = vec![0u8; len];
        r[0] = id;
        r[lx_at] = 128;
        r[lx_at + 1] = 128;
        r[lx_at + 2] = 128;
        r[lx_at + 3] = 128;
        r[b0_at] = b0;
        r[b0_at + 1] = b1;
        r[b0_at + 2] = b2;
        r
    }

    #[test]
    fn dualsense_bt_extended_cross_and_dpad_up() {
        let r = report(0x31, 78, 2, 9, 0x20 | 0x00, 0, 0);
        let st = parse_sony_report(true, &r).unwrap();
        assert!(st.confirm && !st.back);
        assert_eq!(st.dir, Some("up"));
    }

    #[test]
    fn dualsense_bt_simple_circle_neutral() {
        let r = report(0x01, 10, 1, 5, 0x40 | 0x08, 0, 0);
        let st = parse_sony_report(true, &r).unwrap();
        assert!(st.back && !st.confirm);
        assert_eq!(st.dir, None);
    }

    #[test]
    fn dualsense_usb_l1_r1_options_ps() {
        let r = report(0x01, 64, 1, 8, 0x08, 0x01 | 0x02 | 0x20, 0x01);
        let st = parse_sony_report(true, &r).unwrap();
        assert!(st.tab_prev && st.tab_next && st.menu && !st.voice);
    }

    #[test]
    fn dualsense_create_is_voice() {
        let r = report(0x31, 78, 2, 9, 0x08, 0x10, 0);
        assert!(parse_sony_report(true, &r).unwrap().voice);
    }

    #[test]
    fn stick_gives_direction() {
        let mut r = report(0x31, 78, 2, 9, 0x08, 0, 0);
        r[2] = 255; // LX вправо
        assert_eq!(parse_sony_report(true, &r).unwrap().dir, Some("right"));
        r[2] = 128;
        r[3] = 0; // LY вверх
        assert_eq!(parse_sony_report(true, &r).unwrap().dir, Some("up"));
    }

    #[test]
    fn ds4_bt_triangle() {
        let r = report(0x11, 78, 3, 8, 0x80 | 0x08, 0, 0);
        assert!(parse_sony_report(false, &r).unwrap().folder);
    }

    #[test]
    fn unknown_report_ignored() {
        assert!(parse_sony_report(true, &[0x05, 1, 2, 3]).is_none());
    }
}
