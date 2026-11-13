//! Заряд беспроводных устройств (Bluetooth-наушники, мыши, клавиатуры).
//! Windows хранит его в свойстве устройства DEVPKEY_Bluetooth_Battery; запрос через
//! PowerShell занимает несколько секунд, поэтому опрашиваем в фоне и отдаём кэш.
//! Геймпад сюда не входит — его заряд читается напрямую (см. gamepad.rs).

use crate::models::DeviceBattery;
use parking_lot::Mutex;
use std::os::windows::process::CommandExt;
use std::process::Command;
use std::time::Duration;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const REFRESH_EVERY: Duration = Duration::from_secs(120);

const SCRIPT: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
$k = '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2'
$out = @(Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -match '^(BTHENUM|BTHLE|BTHLEDEVICE|BTHHFENUM)\\' } | ForEach-Object {
  $p = Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName $k
  if ($p -and $p.Data -ne $null) { [pscustomobject]@{ name = $_.FriendlyName; cls = [string]$_.Class; pct = [int]$p.Data } }
})
ConvertTo-Json -InputObject $out -Compress
"#;

static CACHE: Mutex<Vec<DeviceBattery>> = Mutex::new(Vec::new());

pub fn cached() -> Vec<DeviceBattery> {
    CACHE.lock().clone()
}

fn kind_of(name: &str, class: &str) -> &'static str {
    let n = name.to_lowercase();
    let c = class.to_lowercase();
    let has = |words: &[&str]| words.iter().any(|w| n.contains(w));
    if has(&["controller", "gamepad", "dualsense", "dualshock", "xbox", "joy-con"]) {
        "gamepad"
    } else if has(&["mouse", "мыш"]) || c == "mouse" {
        "mouse"
    } else if has(&["keyboard", "клавиат"]) || c == "keyboard" {
        "keyboard"
    } else if has(&["headset", "headphone", "buds", "airpods", "earbuds", "наушник", "hands-free", "wh-", "wf-"])
        || c == "media"
        || c == "audioendpoint"
    {
        "headset"
    } else {
        "other"
    }
}

/// Убрать служебные суффиксы и дубли (одно устройство даёт несколько узлов).
fn clean_name(name: &str) -> String {
    let mut n = name.trim().to_string();
    for suffix in [" Hands-Free HF Audio", " Hands-Free AG Audio", " Hands-Free HF", " Hands-Free", " Avrcp Transport", " A2DP SNK", " Stereo"] {
        if let Some(s) = n.strip_suffix(suffix) {
            n = s.trim().to_string();
        }
    }
    n
}

pub fn parse(json: &str) -> Vec<DeviceBattery> {
    #[derive(serde::Deserialize)]
    struct Row {
        name: Option<String>,
        cls: Option<String>,
        pct: i64,
    }
    let rows: Vec<Row> = serde_json::from_str(json.trim()).unwrap_or_default();
    let mut out: Vec<DeviceBattery> = Vec::new();
    for r in rows {
        let Some(raw) = r.name.filter(|n| !n.trim().is_empty()) else { continue };
        let kind = kind_of(&raw, r.cls.as_deref().unwrap_or(""));
        // заряд геймпада показывается отдельно
        if kind == "gamepad" || !(0..=100).contains(&r.pct) {
            continue;
        }
        let name = clean_name(&raw);
        if out.iter().any(|d| d.name == name) {
            continue;
        }
        out.push(DeviceBattery { name, percent: r.pct as u8, kind: kind.to_string() });
    }
    out.sort_by_key(|d| d.percent);
    out
}

fn query() -> Option<Vec<DeviceBattery>> {
    let out = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", SCRIPT])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    Some(parse(&text))
}

pub fn spawn_watcher() {
    std::thread::Builder::new()
        .name("batteries".into())
        .spawn(|| loop {
            if let Some(list) = query() {
                *CACHE.lock() = list;
            }
            std::thread::sleep(REFRESH_EVERY);
        })
        .expect("не удалось запустить поток батарей");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_filters() {
        let json = r#"[{"name":"WH-1000XM4 Hands-Free AG Audio","cls":"MEDIA","pct":64},
            {"name":"WH-1000XM4","cls":"Bluetooth","pct":64},
            {"name":"DualSense Wireless Controller","cls":"Bluetooth","pct":80},
            {"name":"MX Master 3","cls":"Mouse","pct":18}]"#;
        let list = parse(json);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].name, "MX Master 3");
        assert_eq!(list[0].kind, "mouse");
        assert_eq!(list[1].name, "WH-1000XM4");
        assert_eq!(list[1].kind, "headset");
    }

    #[test]
    fn empty_output_is_empty() {
        assert!(parse("").is_empty());
        assert!(parse("[]").is_empty());
    }
}
