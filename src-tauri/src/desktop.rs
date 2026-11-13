//! Оформление учётки профиля: обои и светлая/тёмная тема Windows.
//! Применяется при входе в учётку (у каждой учётки они свои и сохраняются Windows).

use anyhow::{anyhow, Result};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    SendMessageTimeoutW, SystemParametersInfoW, HWND_BROADCAST, SMTO_ABORTIFHUNG, SPIF_SENDCHANGE,
    SPIF_UPDATEINIFILE, SPI_SETDESKWALLPAPER, WM_SETTINGCHANGE,
};
use winreg::enums::*;
use winreg::RegKey;

pub fn set_wallpaper(path: &str) -> Result<()> {
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
