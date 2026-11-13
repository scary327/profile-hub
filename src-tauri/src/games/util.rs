//! Shared helpers: path normalisation, argument splitting, base64, registry access.

use std::path::{Path, PathBuf};

/// Normalise a path to Windows separators and drop a trailing separator.
pub fn norm_path(p: impl AsRef<Path>) -> String {
    let s = p.as_ref().to_string_lossy().replace('/', "\\");
    let trimmed = s.trim_end_matches('\\');
    if trimmed.len() == 2 && trimmed.ends_with(':') {
        // keep "C:\" for drive roots
        format!("{trimmed}\\")
    } else {
        trimmed.to_string()
    }
}

/// `child` lies inside directory `dir` (case-insensitive, separator-agnostic).
pub fn path_inside(child: &str, dir: &str) -> bool {
    let c = norm_path(child).to_lowercase();
    let d = norm_path(dir).to_lowercase();
    let d = d.trim_end_matches('\\');
    !d.is_empty() && c.len() > d.len() && c.starts_with(d) && c[d.len()..].starts_with('\\')
}

/// Extract an exe path from a registry `DisplayIcon` value like
/// `"C:\Games\X\x.exe",0` or `C:\Games\X\x.exe,0`. Returns None if not an .exe.
pub fn exe_from_icon(icon: &str) -> Option<String> {
    let s = icon.trim();
    let path = if let Some(rest) = s.strip_prefix('"') {
        rest.split('"').next().unwrap_or("").to_string()
    } else {
        // strip trailing ",<index>"
        match s.rfind(',') {
            Some(i) if s[i + 1..].trim().trim_start_matches('-').chars().all(|c| c.is_ascii_digit()) => {
                s[..i].to_string()
            }
            _ => s.to_string(),
        }
    };
    let path = path.trim();
    if path.to_lowercase().ends_with(".exe") {
        Some(norm_path(path))
    } else {
        None
    }
}

/// Split a command-line argument string respecting double quotes.
/// `\"` yields a literal quote; other backslashes are literal (paths survive intact).
pub fn split_args(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    let mut has_token = false;
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\\' if chars.peek() == Some(&'"') => {
                chars.next();
                cur.push('"');
                has_token = true;
            }
            '"' => {
                in_quotes = !in_quotes;
                has_token = true;
            }
            c if c.is_whitespace() && !in_quotes => {
                if has_token {
                    out.push(std::mem::take(&mut cur));
                    has_token = false;
                }
            }
            c => {
                cur.push(c);
                has_token = true;
            }
        }
    }
    if has_token {
        out.push(cur);
    }
    out
}

/// Tolerant base64 decoder (standard and URL-safe alphabets, ignores whitespace and padding).
pub fn base64_decode(input: &[u8]) -> Option<Vec<u8>> {
    fn val(c: u8) -> Option<u32> {
        Some(match c {
            b'A'..=b'Z' => (c - b'A') as u32,
            b'a'..=b'z' => (c - b'a' + 26) as u32,
            b'0'..=b'9' => (c - b'0' + 52) as u32,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            _ => return None,
        })
    }
    let mut out = Vec::with_capacity(input.len() * 3 / 4);
    let mut buf = 0u32;
    let mut bits = 0u32;
    for &c in input {
        if c == b'=' {
            break;
        }
        if c.is_ascii_whitespace() {
            continue;
        }
        buf = (buf << 6) | val(c)?;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }
    Some(out)
}

pub fn existing(p: PathBuf) -> Option<String> {
    if p.is_file() {
        Some(norm_path(p))
    } else {
        None
    }
}

pub fn push_unique(v: &mut Vec<String>, s: String) {
    if !v.iter().any(|x| x.eq_ignore_ascii_case(&s)) {
        v.push(s);
    }
}

pub fn env_dir(var: &str, fallback: &str) -> PathBuf {
    std::env::var_os(var)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(fallback))
}

/// Registry helpers.
pub mod reg {
    use winreg::enums::*;
    use winreg::RegKey;

    pub const UNINSTALL: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";
    pub const UNINSTALL_WOW: &str = r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall";

    pub fn hklm(path: &str) -> Option<RegKey> {
        RegKey::predef(HKEY_LOCAL_MACHINE)
            .open_subkey_with_flags(path, KEY_READ | KEY_WOW64_64KEY)
            .ok()
    }

    pub fn hkcu(path: &str) -> Option<RegKey> {
        RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(path, KEY_READ).ok()
    }

    /// Non-empty trimmed string value.
    pub fn s(key: &RegKey, name: &str) -> Option<String> {
        key.get_value::<String, _>(name)
            .ok()
            .map(|v| v.trim().trim_matches('\0').trim().to_string())
            .filter(|v| !v.is_empty())
    }

    pub fn dword(key: &RegKey, name: &str) -> Option<u32> {
        key.get_value::<u32, _>(name).ok()
    }

    pub fn subkeys(key: &RegKey) -> Vec<String> {
        key.enum_keys().filter_map(Result::ok).collect()
    }

    #[derive(Debug, Clone)]
    pub struct UninstallEntry {
        pub key_name: String,
        pub display_name: String,
        pub publisher: String,
        pub install_location: Option<String>,
        pub display_icon: Option<String>,
        /// EstimatedSize is in KiB.
        pub size_bytes: Option<u64>,
    }

    impl UninstallEntry {
        /// Entry created by another store for its own install (e.g. "Steam App 2357570"),
        /// which that store's scanner already covers.
        pub fn is_store_managed(&self) -> bool {
            let key = self.key_name.to_lowercase();
            let loc = self.install_location.as_deref().unwrap_or("").to_lowercase().replace('/', "\\");
            let icon = self.display_icon.as_deref().unwrap_or("").to_lowercase().replace('/', "\\");
            key.starts_with("steam app ")
                || key.starts_with("uplay install ")
                || loc.contains("\\steamapps\\")
                || icon.contains("\\steam\\games\\")
        }
    }

    /// All Uninstall entries from HKLM (64-bit + WOW6432Node) and HKCU that have a DisplayName.
    pub fn uninstall_entries() -> Vec<UninstallEntry> {
        let roots = [hklm(UNINSTALL), hklm(UNINSTALL_WOW), hkcu(UNINSTALL)];
        let mut out = Vec::new();
        for root in roots.into_iter().flatten() {
            for name in subkeys(&root) {
                let Ok(k) = root.open_subkey_with_flags(&name, KEY_READ) else { continue };
                let Some(display_name) = s(&k, "DisplayName") else { continue };
                out.push(UninstallEntry {
                    key_name: name,
                    display_name,
                    publisher: s(&k, "Publisher").unwrap_or_default(),
                    install_location: s(&k, "InstallLocation").map(|p| p.trim_matches('"').to_string()),
                    display_icon: s(&k, "DisplayIcon"),
                    size_bytes: dword(&k, "EstimatedSize").map(|kb| kb as u64 * 1024),
                });
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn args() {
        assert_eq!(
            split_args(r#"-a "C:\Program Files\x" b\"c """#),
            vec!["-a", r"C:\Program Files\x", "b\"c", ""]
        );
    }

    #[test]
    fn b64() {
        assert_eq!(base64_decode(b"aGVsbG8=").unwrap(), b"hello");
        assert_eq!(base64_decode(b"aGVs\nbG8h").unwrap(), b"hello!");
    }

    #[test]
    fn icon() {
        assert_eq!(exe_from_icon(r#""C:\G\x.exe",0"#).as_deref(), Some(r"C:\G\x.exe"));
        assert_eq!(exe_from_icon(r"C:\G\x.exe,0").as_deref(), Some(r"C:\G\x.exe"));
        assert_eq!(exe_from_icon(r"C:\G\x.ico"), None);
        assert!(path_inside(r"C:\G\x.exe", "c:/g/"));
        assert!(!path_inside(r"C:\Gx\x.exe", r"C:\G"));
    }
}
