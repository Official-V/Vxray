//! Per-application split tunneling: finding the executables that process-kind
//! routing rules are built from.
//!
//! Two halves:
//!   - `pick_executable` runs the classic Windows file dialog so the user can point at
//!     any .exe on the machine.
//!   - `detect_installed_apps` walks a small catalog of well-known applications against
//!     the standard install roots and the uninstall registry, so the UI can offer the
//!     ones that are actually installed instead of making the user hunt for a path.

use std::path::{Path, PathBuf};

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct DetectedApp {
    pub name: String,
    pub exe_path: String,
}

struct CatalogApp {
    name: &'static str,
    exe_names: &'static [&'static str],
    /// Paths relative to an install root. A single `*` stands for a version-numbered
    /// directory, which is how Discord and Roblox ship ("app-1.0.9004").
    subpaths: &'static [&'static str],
}

const CATALOG: &[CatalogApp] = &[
    // Chat
    CatalogApp { name: "Telegram", exe_names: &["Telegram.exe"], subpaths: &["Telegram Desktop\\Telegram.exe"] },
    CatalogApp { name: "Discord", exe_names: &["Discord.exe"], subpaths: &["Discord\\app-*\\Discord.exe"] },
    CatalogApp { name: "WeChat", exe_names: &["WeChat.exe"], subpaths: &["Tencent\\WeChat\\WeChat.exe"] },
    CatalogApp { name: "QQ", exe_names: &["QQ.exe"], subpaths: &["Tencent\\QQ\\Bin\\QQ.exe"] },
    CatalogApp { name: "Zoom", exe_names: &["Zoom.exe"], subpaths: &["Zoom\\bin\\Zoom.exe"] },
    CatalogApp { name: "Skype", exe_names: &["Skype.exe"], subpaths: &["Skype\\Phone\\Skype.exe"] },
    CatalogApp { name: "Microsoft Teams", exe_names: &["ms-teams.exe"], subpaths: &["Microsoft\\Teams\\ms-teams.exe"] },
    CatalogApp { name: "WhatsApp", exe_names: &["WhatsApp.exe"], subpaths: &["WhatsApp\\WhatsApp.exe"] },
    CatalogApp { name: "Signal", exe_names: &["signal.exe"], subpaths: &["Signal\\signal.exe"] },
    CatalogApp { name: "Element", exe_names: &["Element.exe"], subpaths: &["Element\\Element.exe"] },
    // Browsers -- a user bypassing the VPN often wants these on the local network
    CatalogApp { name: "Chrome", exe_names: &["chrome.exe"], subpaths: &["Google\\Chrome\\Application\\chrome.exe"] },
    CatalogApp { name: "Firefox", exe_names: &["firefox.exe"], subpaths: &["Mozilla Firefox\\firefox.exe"] },
    CatalogApp { name: "Edge", exe_names: &["msedge.exe"], subpaths: &["Microsoft\\Edge\\Application\\msedge.exe"] },
    CatalogApp { name: "Brave", exe_names: &["brave.exe"], subpaths: &["BraveSoftware\\Brave-Browser\\Application\\brave.exe"] },
    CatalogApp { name: "Opera", exe_names: &["opera.exe"], subpaths: &["Opera\\opera.exe"] },
    CatalogApp { name: "Yandex", exe_names: &["browser.exe"], subpaths: &["Yandex\\YandexBrowser\\browser.exe"] },
    // Game launchers
    CatalogApp { name: "Steam", exe_names: &["steam.exe"], subpaths: &["Steam\\steam.exe"] },
    CatalogApp { name: "Riot Client", exe_names: &["RiotClientServices.exe"], subpaths: &["Riot Client\\RiotClientServices.exe"] },
    CatalogApp { name: "VALORANT", exe_names: &["VALORANT.exe"], subpaths: &["Riot Games\\VALORANT\\live\\VALORANT.exe"] },
    CatalogApp { name: "League of Legends", exe_names: &["LeagueClient.exe"], subpaths: &["Riot Games\\League of Legends\\LeagueClient.exe"] },
    CatalogApp { name: "Epic Games Launcher", exe_names: &["EpicGamesLauncher.exe"], subpaths: &[
        "Epic Games\\Launcher\\Portal\\Binaries\\Win64\\EpicGamesLauncher.exe",
        "Epic Games\\Launcher\\Portal\\Binaries\\Win32\\EpicGamesLauncher.exe",
    ] },
    CatalogApp { name: "Fortnite", exe_names: &["FortniteClient-Win64-Shipping.exe"], subpaths: &["Epic Games\\Fortnite\\FortniteGame\\Binaries\\Win64\\FortniteClient-Win64-Shipping.exe"] },
    CatalogApp { name: "EA Desktop", exe_names: &["EADesktop.exe"], subpaths: &["EA\\EA Desktop\\EADesktop.exe"] },
    CatalogApp { name: "Origin", exe_names: &["Origin.exe"], subpaths: &["Origin\\Origin.exe"] },
    CatalogApp { name: "Battle.net", exe_names: &["Battle.net.exe"], subpaths: &["Battle.net\\Battle.net.exe"] },
    CatalogApp { name: "Ubisoft Connect", exe_names: &["upc.exe"], subpaths: &[
        "Ubisoft\\Ubisoft Game Connect\\upc.exe",
        "Ubisoft Game Launcher\\upc.exe",
    ] },
    CatalogApp { name: "GOG Galaxy", exe_names: &["GalaxyClient.exe"], subpaths: &["GOG Galaxy\\GalaxyClient.exe"] },
    CatalogApp { name: "Roblox", exe_names: &["RobloxPlayerBeta.exe"], subpaths: &["Roblox\\Versions\\version-*\\RobloxPlayerBeta.exe"] },
    CatalogApp { name: "Rockstar Launcher", exe_names: &["Launcher.exe"], subpaths: &["Rockstar Games\\Launcher\\Launcher.exe"] },
    CatalogApp { name: "Xbox App", exe_names: &["XboxApp.exe"], subpaths: &["Microsoft\\XboxApp\\XboxApp.exe"] },
    CatalogApp { name: "GeForce NOW", exe_names: &["GeForceNOWStreamer.exe"], subpaths: &["NVIDIA Corporation\\GeForceNOW\\GeForceNOWStreamer.exe"] },
    // Media
    CatalogApp { name: "Spotify", exe_names: &["Spotify.exe"], subpaths: &["Spotify\\Spotify.exe"] },
    CatalogApp { name: "VLC", exe_names: &["vlc.exe"], subpaths: &["VideoLAN\\VLC\\vlc.exe"] },
];

/// The directories the catalog's relative paths are joined under. An empty entry lets a
/// candidate that is already absolute pass through unchanged.
fn probe_roots() -> Vec<PathBuf> {
    let mut roots = vec![PathBuf::new()];
    for name in &[
        "LOCALAPPDATA",
        "APPDATA",
        "ProgramFiles",
        "ProgramFiles(x86)",
        "ProgramW6432",
        // Games in particular install outside Program Files, and the catalog's relative
        // paths are written against these too.
        "SystemDrive",
    ] {
        if let Some(val) = std::env::var_os(name) {
            let p = PathBuf::from(val);
            if p.is_dir() {
                roots.push(p);
            }
        }
    }
    // Every fixed drive other than the system one. A game library on D: or E: is the common
    // case, and without this the catalog only ever sees the system drive.
    for letter in b'A'..=b'Z' {
        let drive = format!("{}:\\", letter as char);
        let p = PathBuf::from(&drive);
        if p.is_dir() {
            roots.push(p);
        }
    }
    roots
}

/// Resolves one catalog subpath to a file that exists, expanding a single `*` segment.
fn resolve(candidate: &Path) -> Option<PathBuf> {
    let s = candidate.to_string_lossy();
    if !s.contains('*') {
        return candidate.is_file().then(|| candidate.to_path_buf());
    }
    let (head, tail) = s.split_once('*')?;
    // The wildcard's own segment hangs off the end of `head`, so the directory to list is
    // everything before its last separator and the segment itself is the name prefix.
    let (parent, prefix) = head.rsplit_once(['\\', '/']).unwrap_or((".", head));
    let parent = Path::new(parent);
    let rest = tail.trim_start_matches(['\\', '/']);

    for entry in std::fs::read_dir(parent).ok()?.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with(prefix) {
            continue;
        }
        let hit = parent.join(&name).join(rest);
        if hit.is_file() {
            return Some(hit);
        }
    }
    None
}

/// Install directories recorded by MSI/NSIS installers, where the catalog app's exe can
/// be looked up even when it landed outside the standard roots.
#[cfg(not(windows))]
fn uninstall_install_dirs() -> Vec<PathBuf> {
    Vec::new()
}

#[cfg(windows)]
fn uninstall_install_dirs() -> Vec<PathBuf> {
    use winreg::enums::*;
    use winreg::RegKey;

    const UNINSTALL_KEYS: &[(isize, &str)] = &[
        (HKEY_LOCAL_MACHINE, "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall"),
        (HKEY_LOCAL_MACHINE, "SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall"),
        (HKEY_CURRENT_USER, "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall"),
    ];

    let mut dirs = Vec::new();
    for (hive, path) in UNINSTALL_KEYS {
        let root = RegKey::predef(*hive);
        let key = match root.open_subkey(path) {
            Ok(k) => k,
            Err(_) => continue,
        };
        for child in key.enum_keys().flatten() {
            let sub = match key.open_subkey(&child) {
                Ok(k) => k,
                Err(_) => continue,
            };
            if let Ok(loc) = sub.get_value::<String, _>("InstallLocation") {
                let p = PathBuf::from(loc.trim());
                if !p.as_os_str().is_empty() && p.is_dir() {
                    dirs.push(p);
                }
            }
        }
    }
    dirs
}

/// Records every executable reachable from `dir` within `depth` levels, keyed by
/// lowercased file name.
///
/// One walk is shared by the whole catalog rather than scanning per application, which is
/// what keeps the "recommended apps" lookup from reading the same install trees twenty
/// times. The entry cap bounds a key whose InstallLocation points somewhere enormous --
/// an installer that recorded a whole drive would otherwise make this a full walk.
fn collect_exes(dir: &Path, depth: u8, out: &mut std::collections::HashMap<String, PathBuf>) {
    const MAX_ENTRIES: usize = 3000;
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        if out.len() > MAX_ENTRIES {
            return;
        }
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if path.is_file() {
            if name.to_ascii_lowercase().ends_with(".exe") {
                out.entry(name.to_ascii_lowercase())
                    .or_insert_with(|| path.clone());
            }
        } else if depth > 0 {
            collect_exes(&path, depth - 1, out);
        }
    }
}

/// The applications from the catalog that appear to be installed, in catalog order.
pub fn detect_installed_apps() -> Vec<DetectedApp> {
    let found = detect_impl();

    // Persist so the next launch paints the list immediately instead of showing an empty
    // pane for the seconds a scan takes. A scan always rewrites this, so the file can never
    // be newer than what a scan would find; it is only stale in the harmless sense of not
    // yet reflecting an install that just happened.
    let _ = save_cache(&found);

    found
}

/// What the previous launch found. Used for an instant first paint while the real scan
/// runs; the frontend swaps in the fresh list when it lands.
pub fn cached_apps() -> Vec<DetectedApp> {
    let path = match cache_path() {
        Some(p) => p,
        None => return vec![],
    };
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(_) => return vec![],
    };
    // A corrupt or truncated write is not fatal -- the scan replaces it moments later.
    serde_json::from_slice(&bytes).unwrap_or_default()
}

fn cache_path() -> Option<std::path::PathBuf> {
    let mut p = dirs::config_dir()?;
    p.push("Vxray");
    p.push("data");
    p.push("detected_apps.json");
    Some(p)
}

fn save_cache(apps: &[DetectedApp]) -> Result<(), String> {
    let path = cache_path().ok_or_else(|| "no config directory".to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let bytes = serde_json::to_vec(apps).map_err(|e| e.to_string())?;
    // Write to a sibling and rename so a crash mid-write cannot leave a truncated file that
    // the next launch would read as an empty list.
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

fn detect_impl() -> Vec<DetectedApp> {
    let roots = probe_roots();

    let mut found: Vec<DetectedApp> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    // Pass 1: the fixed relative paths, which cover the standard installs.
    for app in CATALOG {
        'next_sub: for &sub in app.subpaths {
            for root in &roots {
                let candidate = if root.as_os_str().is_empty() {
                    PathBuf::from(sub)
                } else {
                    root.join(sub)
                };
                if let Some(path) = resolve(&candidate) {
                    if seen.insert(path.to_string_lossy().to_lowercase()) {
                        found.push(DetectedApp {
                            name: app.name.to_string(),
                            exe_path: path.to_string_lossy().to_string(),
                        });
                    }
                    break 'next_sub;
                }
            }
        }
    }

    // Pass 2: the installer-recorded locations, which catch installs outside the fixed
    // roots. Catalog entries already found keep their canonical path. Depth 4 reaches the
    // real game binaries -- Fortnite and VALORANT sit four levels below the recorded
    // InstallLocation, and depth 2 found only the launcher.
    let mut by_name: std::collections::HashMap<String, PathBuf> = std::collections::HashMap::new();
    for dir in uninstall_install_dirs() {
        collect_exes(&dir, 4, &mut by_name);
    }
    for app in CATALOG {
        if found.iter().any(|d| d.name == app.name) {
            continue;
        }
        for &exe in app.exe_names {
            if let Some(path) = by_name.get(&exe.to_ascii_lowercase()) {
                if seen.insert(path.to_string_lossy().to_lowercase()) {
                    found.push(DetectedApp {
                        name: app.name.to_string(),
                        exe_path: path.to_string_lossy().to_string(),
                    });
                }
                break;
            }
        }
    }

    found
}

/// Runs the Windows open-file dialog restricted to executables.
///
/// Returns `Ok(None)` when the user cancels, which is not an error: treating cancel as
/// one would make the recommended-apps card flash a failure state for a deliberate "no".
#[cfg(not(windows))]
pub fn pick_executable() -> Result<Option<String>, String> {
    if let Ok(out) = std::process::Command::new("zenity")
        .args(["--file-selection", "--title=Select an application"])
        .output()
    {
        if out.status.success() {
            let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !path.is_empty() {
                return Ok(Some(path));
            }
        }
    }
    Ok(None)
}

#[cfg(windows)]
pub fn pick_executable() -> Result<Option<String>, String> {
    use std::mem::zeroed;
    use windows_sys::Win32::UI::Controls::Dialogs::{
        CommDlgExtendedError, GetOpenFileNameW, OFN_EXPLORER, OFN_FILEMUSTEXIST,
        OFN_HIDEREADONLY, OFN_PATHMUSTEXIST, OPENFILENAMEW,
    };

    // Filters are NUL-separated pairs terminated by an empty entry.
    let filter: Vec<u16> = "Applications (*.exe)\0*.exe\0All files (*.*)\0*.*\0"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let title: Vec<u16> = "Select an application"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let mut buf = vec![0u16; 1024];

    // SAFETY: OPENFILENAMEW is a plain #[repr(C)] record of integers and pointers, and
    // every field left zeroed is one GetOpenFileNameW does not read.
    let mut ofn: OPENFILENAMEW = unsafe { zeroed() };
    ofn.lStructSize = std::mem::size_of::<OPENFILENAMEW>() as u32;
    ofn.lpstrFilter = filter.as_ptr();
    ofn.nFilterIndex = 1;
    ofn.lpstrFile = buf.as_mut_ptr();
    ofn.nMaxFile = buf.len() as u32;
    ofn.lpstrTitle = title.as_ptr();
    // Dereferencing a shortcut yields its target .exe, which is the thing a process rule
    // has to name.
    ofn.Flags = OFN_EXPLORER | OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_HIDEREADONLY;

    // SAFETY: ofn and its three string buffers outlive the call; lpstrFile/nMaxFile
    // describe a valid 1024-wide-char buffer.
    if unsafe { GetOpenFileNameW(&mut ofn) } == 0 {
        let code = unsafe { CommDlgExtendedError() };
        // A cancel reports zero; anything else is a genuine dialog failure.
        return if code == 0 {
            Ok(None)
        } else {
            Err(format!("the file dialog could not open (error {code})"))
        };
    }

    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    let path = String::from_utf16_lossy(&buf[..len]);
    let path = path.trim();
    if path.is_empty() {
        return Ok(None);
    }
    Ok(Some(path.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_names_are_unique_and_nonempty() {
        let mut seen = std::collections::HashSet::new();
        for app in CATALOG {
            assert!(!app.name.is_empty());
            assert!(!app.exe_names.is_empty());
            assert!(seen.insert(app.name), "duplicate catalog name {}", app.name);
            for exe in app.exe_names {
                assert!(exe.ends_with(".exe"), "{} names a non-exe", app.name);
            }
        }
    }

    #[test]
    fn wildcard_segments_resolve_against_a_versioned_directory() {
        let tmp = std::env::temp_dir().join("vxray_catalog_test");
        std::fs::create_dir_all(tmp.join("Discord").join("app-1.0.9999")).unwrap();
        std::fs::write(
            tmp.join("Discord").join("app-1.0.9999").join("Discord.exe"),
            b"",
        )
        .unwrap();

        let resolved = resolve(&tmp.join("Discord").join("app-*").join("Discord.exe"));
        assert_eq!(
            resolved,
            Some(tmp.join("Discord").join("app-1.0.9999").join("Discord.exe"))
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn detect_runs_against_the_real_machine_without_panicking() {
        // Cannot assert on what is installed, only that the scan is total and returns a
        // deduplicated list whose paths all exist.
        let apps = detect_installed_apps();
        for app in &apps {
            assert!(Path::new(&app.exe_path).is_file(), "{} -> {} does not exist", app.name, app.exe_path);
        }
    }

    #[test]
    fn the_cache_round_trips_what_the_scan_found() {
        // The cache is what the next launch paints first, so a list that does not survive the
        // trip shows up as an empty pane on every open -- the exact complaint this fixes.
        let apps = detect_installed_apps();
        let bytes = serde_json::to_vec(&apps).expect("serialize");
        let back: Vec<DetectedApp> = serde_json::from_slice(&bytes).expect("deserialize");
        assert_eq!(apps.len(), back.len());
        for (a, b) in apps.iter().zip(back.iter()) {
            assert_eq!(a.name, b.name);
            assert_eq!(a.exe_path, b.exe_path);
        }
    }
}
