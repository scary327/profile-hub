//! Виртуальные рабочие столы Windows 11, обои и тема.

use anyhow::{anyhow, Result};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    SendMessageTimeoutW, SystemParametersInfoW, HWND_BROADCAST, SMTO_ABORTIFHUNG,
    SPIF_SENDCHANGE, SPIF_UPDATEINIFILE, SPI_SETDESKWALLPAPER, WM_SETTINGCHANGE,
};
use winreg::enums::*;
use winreg::RegKey;
use winvd::Desktop;

fn vd_err(e: winvd::Error) -> anyhow::Error {
    anyhow!("виртуальные рабочие столы: {e:?}")
}

fn id_of(d: &Desktop) -> Option<String> {
    d.get_id().ok().map(|g| format!("{g:?}"))
}

pub fn find(desktop_id: &str) -> Option<Desktop> {
    winvd::get_desktops()
        .ok()?
        .into_iter()
        .find(|d| id_of(d).as_deref() == Some(desktop_id))
}

/// Вернуть стол профиля; если его нет — взять текущий (если `adopt_current`) или создать новый.
pub fn ensure(desktop_id: Option<&str>, name: &str, adopt_current: bool) -> Result<(Desktop, String)> {
    if let Some(id) = desktop_id {
        if let Some(d) = find(id) {
            let _ = d.set_name(name);
            return Ok((d, id.to_string()));
        }
    }
    let d = if adopt_current {
        winvd::get_current_desktop().map_err(vd_err)?
    } else {
        winvd::create_desktop().map_err(vd_err)?
    };
    let _ = d.set_name(name);
    let id = id_of(&d).ok_or_else(|| anyhow!("не удалось получить id рабочего стола"))?;
    Ok((d, id))
}

pub fn switch(d: Desktop) -> Result<()> {
    winvd::switch_desktop(d).map_err(vd_err)
}

pub fn remove(desktop_id: &str) -> Result<()> {
    let Some(d) = find(desktop_id) else { return Ok(()) };
    let all = winvd::get_desktops().map_err(vd_err)?;
    let fallback = all
        .into_iter()
        .find(|x| id_of(x).as_deref() != Some(desktop_id))
        .ok_or_else(|| anyhow!("нельзя удалить единственный рабочий стол"))?;
    winvd::remove_desktop(d, fallback).map_err(vd_err)
}

pub fn set_wallpaper(d: &Desktop, path: &str) -> Result<()> {
    if d.set_wallpaper(path).is_ok() {
        return Ok(());
    }
    // запасной вариант: обои текущего стола через SPI
    let wide: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
    let ok = unsafe {
        SystemParametersInfoW(
            SPI_SETDESKWALLPAPER,
            0,
            wide.as_ptr() as *mut _,
            SPIF_UPDATEINIFILE | SPIF_SENDCHANGE,
        )
    };
    if ok == 0 {
        return Err(anyhow!("не удалось установить обои"));
    }
    Ok(())
}

/// Окно (HWND из Tauri) видно на всех рабочих столах.
pub fn pin_window(hwnd: isize) {
    let h = windows::Win32::Foundation::HWND(hwnd as *mut _);
    if let Err(e) = winvd::pin_window(h) {
        log::warn!("pin_window: {e:?}");
    }
}

pub fn move_window(hwnd: isize, d: Desktop) {
    let h = windows::Win32::Foundation::HWND(hwnd as *mut _);
    if let Err(e) = winvd::move_window_to_desktop(d, &h) {
        log::warn!("move_window_to_desktop: {e:?}");
    }
}

/// Тёмная/светлая тема Windows для приложений и системы.
pub fn apply_theme(light: bool) -> Result<()> {
    let key = RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(
        "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
        KEY_READ | KEY_WRITE,
    )?;
    let v: u32 = light as u32;
    let current: u32 = key.get_value("AppsUseLightTheme").unwrap_or(2);
    if current == v {
        return Ok(());
    }
    key.set_value("AppsUseLightTheme", &v)?;
    key.set_value("SystemUsesLightTheme", &v)?;
    let param: Vec<u16> = "ImmersiveColorSet".encode_utf16().chain(Some(0)).collect();
    unsafe {
        SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SETTINGCHANGE,
            0,
            param.as_ptr() as isize,
            SMTO_ABORTIFHUNG,
            1000,
            std::ptr::null_mut(),
        );
    }
    Ok(())
}
