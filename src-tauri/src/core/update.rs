// ===== In-app update pipeline =====
//
// GitHub is the only release source, and the app ships as an NSIS setup.exe, so an
// "update" is really "fetch the next setup.exe and hand the process over to it": there
// is no patching and the install itself stays the installer's job. The commands here
// cover what the UI needs -- look, fetch, hand over -- plus the system summary the
// support card shows.
//
// Every step is best-effort. A user on a flaky link gets a plain error string back, not
// a panic, and a failed check must never stop the app from working: the UI calls these
// on demand and degrades to a "check failed" card.

use serde::{Deserialize, Serialize};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const LATEST_API: &str = "https://api.github.com/repos/Official-V/Vxray/releases/latest";
// GitHub rejects requests without a User-Agent, so identify ourselves.
const USER_AGENT: &str = "Vxray-Updater (github.com/Official-V/Vxray)";

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct UpdateInfo {
    pub update_available: bool,
    pub current_version: String,
    pub latest_version: String,
    pub release_title: String,
    pub release_notes: String,
    pub release_url: String,
    pub download_url: Option<String>,
    pub download_size: u64,
    pub published_at: String,
}

#[derive(Serialize, Clone)]
#[allow(dead_code)]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: u64,
    pub percent: u64,
}

#[derive(Deserialize)]
struct GhRelease {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    html_url: String,
    published_at: Option<String>,
    assets: Vec<GhAsset>,
}

#[derive(Deserialize)]
struct GhAsset {
    name: String,
    browser_download_url: String,
    size: u64,
}

// The project releases with two-part numbers (2.1, 2.2 ...) but older tags used three
// (2.0.1), so the comparison has to tolerate both: compare numerically part by part,
// treating a missing part as 0. Anything that fails to parse is not "newer".
fn parse_version(v: &str) -> Vec<u64> {
    v.trim()
        .trim_start_matches(|c: char| c == 'v' || c == 'V')
        .split('.')
        .filter_map(|part| {
            // Keep the leading digits of a part ("2rc1" -> 2).
            let digits: String = part.chars().take_while(|c| c.is_ascii_digit()).collect();
            digits.parse::<u64>().ok()
        })
        .collect()
}

fn is_newer(latest: &str, current: &str) -> bool {
    let l = parse_version(latest);
    let c = parse_version(current);
    let n = l.len().max(c.len());
    for i in 0..n {
        let a = l.get(i).copied().unwrap_or(0);
        let b = c.get(i).copied().unwrap_or(0);
        if a != b {
            return a > b;
        }
    }
    false
}

// The setup has to match the architecture the app itself was built for, not the machine it
// happens to be running on: a 32-bit install on a 64-bit machine is still a 32-bit install,
// and handing it a 64-bit setup would only fail at install time. Names have varied across
// releases ("Vxray_x64-setup.exe", "Vxray_x32-setup.exe"), so match by shape, preferring an
// explicitly tagged setup and only then falling back to any setup / any exe.
fn arch_tag() -> &'static str {
    if cfg!(target_os = "windows") {
        if cfg!(target_arch = "x86_64") { "x64" } else { "x32" }
    } else if cfg!(target_os = "linux") {
        if cfg!(target_arch = "x86_64") { "amd64" } else { "i386" }
    } else {
        "x64"
    }
}

fn pick_asset(assets: &[GhAsset]) -> Option<&GhAsset> {
    let lower = |a: &GhAsset| a.name.to_lowercase();
    let tag = arch_tag();
    if cfg!(target_os = "windows") {
        assets
            .iter()
            .find(|a| lower(a).contains("setup") && lower(a).contains(tag))
            .or_else(|| assets.iter().find(|a| lower(a).contains("setup")))
            .or_else(|| {
                assets
                    .iter()
                    .find(|a| lower(a).ends_with(".exe") && !lower(a).contains("portable"))
            })
    } else {
        assets
            .iter()
            .find(|a| (lower(a).ends_with(".appimage") || lower(a).ends_with(".deb")) && lower(a).contains(tag))
            .or_else(|| assets.iter().find(|a| lower(a).ends_with(".appimage")))
            .or_else(|| assets.iter().find(|a| lower(a).ends_with(".deb")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn two_part_release_matches_three_part_manifest() {
        // The release tag is "2.1" and the manifest carries "2.1.0"; that is the same
        // release, not an update.
        assert!(!is_newer("2.1", "2.1.0"));
        assert!(!is_newer("v2.1", "2.1.0"));
    }

    #[test]
    fn next_release_is_detected() {
        assert!(is_newer("2.2", "2.1.0"));
        assert!(is_newer("2.1.1", "2.1.0"));
        assert!(is_newer("3.0", "2.9"));
    }

    #[test]
    fn older_release_is_not_an_update() {
        assert!(!is_newer("2.0", "2.1.0"));
        assert!(!is_newer("2.1", "2.2"));
    }

    #[test]
    fn unparseable_tag_is_not_treated_as_newer() {
        assert!(!is_newer("not-a-version", "2.1.0"));
    }

    #[test]
    fn display_drops_trailing_zero() {
        assert_eq!(display_version("2.1.0"), "2.1");
        assert_eq!(display_version("2.1"), "2.1");
        // A real patch number survives.
        assert_eq!(display_version("2.1.5"), "2.1.5");
    }

    #[test]
    fn prefers_a_setup_tagged_for_the_running_architecture() {
        let tag = super::arch_tag();
        let assets = [
            GhAsset { name: "Vxray_portable.zip".into(), browser_download_url: "a".into(), size: 1 },
            GhAsset { name: "Vxray_setup.exe".into(), browser_download_url: "b".into(), size: 2 },
            GhAsset { name: "Vxray_x64-setup.exe".into(), browser_download_url: "c".into(), size: 3 },
            GhAsset { name: "Vxray_x32-setup.exe".into(), browser_download_url: "d".into(), size: 4 },
        ];
        // The release carries both builds; the one that matches this binary wins, and the other
        // is not a substitute for it.
        let expected = if tag == "x64" { "Vxray_x64-setup.exe" } else { "Vxray_x32-setup.exe" };
        assert_eq!(pick_asset(&assets).unwrap().name, expected);

        // A release that only ships one untagged setup still resolves -- there is nothing
        // better to pick, so the tag must not turn a usable asset into none.
        let fallback = [GhAsset { name: "Vxray_setup.exe".into(), browser_download_url: "b".into(), size: 2 }];
        assert_eq!(pick_asset(&fallback).unwrap().name, "Vxray_setup.exe");
    }
}

fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        // Never route the updater through the proxy this app installs: if the core died
        // while ProxyEnable is still set, the release check and the installer download
        // would both be sent at a closed 127.0.0.1:2080 and the user could not fetch the
        // fix from the very tab meant to report it.
        .no_proxy()
        // A blackholed network never resets a TCP handshake, so the connect stage alone can eat
        // the whole budget. Failing the connect early keeps the spinner honest about being
        // broken rather than just slow.
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())
}

// The manifest must carry a three-part semver ("2.1.0") because that is what cargo and the
// Windows version-info resource parse, but the releases are published as two-part numbers
// ("2.1"). Dropping a trailing .0 is what keeps the number the user reads in the app and
// the tag they compare it against the same shape.
fn display_version(v: &str) -> String {
    let v = v.trim();
    if v.ends_with(".0") {
        v[..v.len() - 2].to_string()
    } else {
        v.to_string()
    }
}

#[tauri::command]
pub async fn check_for_updates() -> Result<UpdateInfo, String> {
    let client = build_client()?;
    let resp = client
        .get(LATEST_API)
        .send()
        .await
        .map_err(|e| format!("network error: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("GitHub returned HTTP {}", resp.status()));
    }
    let rel: GhRelease = resp
        .json()
        .await
        .map_err(|e| format!("could not parse release: {e}"))?;

    let current = env!("CARGO_PKG_VERSION").to_string();
    let asset = pick_asset(&rel.assets);
    Ok(UpdateInfo {
        update_available: is_newer(&rel.tag_name, &current),
        current_version: display_version(&current),
        latest_version: rel.tag_name,
        release_title: rel.name.unwrap_or_default(),
        release_notes: rel.body.unwrap_or_default(),
        release_url: rel.html_url,
        download_url: asset.map(|a| a.browser_download_url.clone()),
        download_size: asset.map(|a| a.size).unwrap_or(0),
        published_at: rel.published_at.unwrap_or_default(),
    })
}

// The "What's new" button on the Support card is labelled against the version the user is
// actually running, but `check_for_updates` can only describe the *latest* release. When the
// installed build is ahead of what GitHub has published -- which is the normal state in the
// days between a build and its release -- those two are different releases, and reusing the
// latest one would answer "what's new in 2.1" with 2.0's notes. This fetches the specific tag
// instead, so the card can never show a version's notes under another version's name.
#[tauri::command]
pub async fn get_release_notes(version: String) -> Result<String, String> {
    let tag = version.trim();
    if tag.is_empty() {
        return Err("no version given".into());
    }
    let client = build_client()?;
    let url = format!(
        "https://api.github.com/repos/Official-V/Vxray/releases/tags/v{}",
        tag.trim_start_matches('v')
    );
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("network error: {e}"))?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        // A build that has not been published yet has no notes to show. This is a normal
        // state, not a failure -- report it as empty so the UI can drop the button instead
        // of explaining a 404 to a user who never asked for a URL.
        return Ok(String::new());
    }
    if !resp.status().is_success() {
        return Err(format!("GitHub returned HTTP {}", resp.status()));
    }
    let rel: GhRelease = resp
        .json()
        .await
        .map_err(|e| format!("could not parse release: {e}"))?;
    Ok(rel.body.unwrap_or_default())
}

// Where a finished download lands. A dedicated folder keeps it out of the root of %TEMP%
// and makes the leftovers of an interrupted or completed update easy to remove on the
// next start -- the installer cannot delete itself while it is running.
pub fn update_temp_dir() -> std::path::PathBuf {
    let mut p = std::env::temp_dir();
    p.push("VxrayUpdate");
    let _ = std::fs::create_dir_all(&p);
    p
}

// Drop the previous run's installer. Best-effort: a locked file just waits for the next
// launch, and a missing folder is not an error.
pub fn cleanup_old_installer() {
    let dir = update_temp_dir();
    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::create_dir_all(&dir);
}

#[tauri::command]
pub async fn download_update(app: AppHandle, url: String) -> Result<String, String> {
    if url.is_empty() {
        return Err("no download URL for this release".into());
    }
    let name = url.rsplit('/').next().unwrap_or("vxray-setup.exe");
    let dest = update_temp_dir().join(name);
    if dest.exists() {
        let _ = std::fs::remove_file(&dest);
    }

    let client = build_client()?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("network error: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("download failed: HTTP {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);

    // Stream to disk so a 40MB installer never sits whole in memory, reporting each
    // percent crossed. Throttling on the percent keeps a fast link from flooding the
    // webview with an event per 8KB chunk.
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let mut file = tokio::fs::File::create(&dest)
        .await
        .map_err(|e| format!("cannot write to temp folder: {e}"))?;
    let mut stream = resp.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_percent: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("download interrupted: {e}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("disk write failed: {e}"))?;
        downloaded = downloaded.saturating_add(chunk.len() as u64);
        let percent = if total > 0 {
            downloaded.min(total) * 100 / total
        } else {
            0
        };
        if percent != last_percent || total == 0 {
            last_percent = percent;
            let _ = app.emit(
                "update-download-progress",
                DownloadProgress {
                    downloaded,
                    total,
                    percent,
                },
            );
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;

    // A file smaller than the announced payload was truncated mid-transfer.
    if total > 0 && downloaded < total {
        let _ = std::fs::remove_file(&dest);
        return Err("download incomplete".into());
    }

    Ok(dest.to_string_lossy().into_owned())
}

// Launch the installer and get out of its way. This is the "restart" half of the update:
// the new setup.exe installs over the running app, which means the running app has to be
// gone first or the installer would hit locked files.
#[tauri::command]
pub async fn install_update(
    core: tauri::State<'_, std::sync::Mutex<crate::core::manager::CoreManager>>,
    path: String,
) -> Result<(), String> {
    let installer = std::path::Path::new(&path);
    if !installer.exists() {
        return Err("installer file is missing".into());
    }

    // The system proxy and the cores must be released before we die: leaving
    // 127.0.0.1:2080 as the user's proxy with nothing listening on it strands the
    // machine without internet until the new app starts, and a live sing-box keeps a
    // lock on the files the installer is about to replace.
    {
        let mut c = core.lock().unwrap();
        c.clear_proxy_if(true);
        if let Some(mut p) = c.take_core_process() {
            let _ = p.kill();
            let _ = p.wait();
        }
        if let Some(mut p) = c.take_tracker_process() {
            let _ = p.kill();
            let _ = p.wait();
        }
        if let Some(mut p) = c.take_tun_process() {
            let _ = p.kill();
            let _ = p.wait();
        }
        // Catch-all for a core child that is not behind one of the handles above: the
        // latency-test core, and any ping helper it spawned. These hold an image lock on
        // bin/sing-box.exe too, and the installer replaces that file.
        c.kill_all_cores();
    }

    #[cfg(windows)]
    {
        // setup.exe is manifested to require admin. When we are already elevated -- which
        // is the state every TUN user is in -- ShellExecuteW launches it as a *direct
        // child*, and a child of this process belongs to its kill-on-close job object
        // (main.rs). We would exit 600ms later and take the installer down with us.
        // Breaking away from the job first is what keeps the installer alive past our exit;
        // it only fails when we are not elevated, in which case the shell has to elevate
        // for us and the elevated process is created by the Application Information
        // service rather than as our child -- already outside the job.
        const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x01000000;
        let spawned = std::process::Command::new(installer)
            .creation_flags(CREATE_BREAKAWAY_FROM_JOB | CREATE_NO_WINDOW)
            .spawn();
        if spawned.is_err() {
            // Not elevated: let the shell put up the UAC prompt.
            use std::os::windows::ffi::OsStrExt;
            let wide: Vec<u16> = installer
                .as_os_str()
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();
            unsafe {
                let _ = windows_sys::Win32::System::Com::CoInitializeEx(
                    std::ptr::null(),
                    (windows_sys::Win32::System::Com::COINIT_APARTMENTTHREADED
                        | windows_sys::Win32::System::Com::COINIT_DISABLE_OLE1DDE) as u32,
                );
                let hinst = windows_sys::Win32::UI::Shell::ShellExecuteW(
                    0 as isize,
                    windows_sys::w!("runas"),
                    wide.as_ptr(),
                    std::ptr::null(),
                    std::ptr::null(),
                    windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL as i32,
                );
                // ShellExecuteW returns a pseudo-HINSTANCE; a value of 32 or less is an
                // error code (the user declining UAC, or AV quarantining the file). The
                // proxy is already cleared, so report it rather than leaving the machine
                // dark and quitting anyway.
                if hinst as usize <= 32 {
                    return Err(format!(
                        "could not start the installer (error {})",
                        hinst as usize
                    ));
                }
            }
        }
    }

    // Give the shell a beat to spawn the installer, then quit so it can write over us.
    std::thread::sleep(Duration::from_millis(600));
    std::process::exit(0);
}

#[derive(Serialize)]
pub struct SystemInfo {
    pub app_version: String,
    pub os_name: String,
    pub os_arch: String,
    pub singbox_version: Option<String>,
    pub xray_version: Option<String>,
    pub core_type: String,
}

// Reads the version the bundled cores report for themselves. Falling back to "unknown"
// keeps the support card usable when a binary is missing or the AV stalls it.
//
// This is called from an async command on the same runtime as `check_for_updates`, so it uses
// the async process API under a hard deadline. A synchronous `output()` would park a tokio
// worker for as long as the binary stalls -- an antivirus holding the file, a hung exe, a
// dialog it wants answered -- and this command runs on the very tab open that also triggers
// the update check; a parked worker is how a slow spinner becomes a permanently stuck one.
async fn core_version(bin_dir: &std::path::Path, exe: &str) -> Option<String> {
    let path = bin_dir.join(exe);
    if !path.exists() {
        return None;
    }

    let child = tokio::process::Command::new(&path)
        .arg("version")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .stdin(std::process::Stdio::null())
        // These are console binaries launched from a windowed app; without this flag each one
        // flashes a black console box in front of the user. This command runs the moment the
        // Support tab opens, so it would flash two of them on every visit.
        .creation_flags(0x0800_0000)
        // wait_with_output takes the child, so on a timeout the handle is gone with it.
        // Kill on drop is what turns a stalled `version` into a closed process instead of an
        // orphan that keeps running after this function has given up on it.
        .kill_on_drop(true)
        .spawn()
        .ok()?;

    // `child` moves into the future, so the deadline below is the only thing standing between
    // this call and a worker parked for the life of the binary.
    let out = match tokio::time::timeout(Duration::from_secs(8), child.wait_with_output()).await {
        Ok(Ok(o)) => o,
        // The binary ran and still failed, or its output could not be read. Either way the
        // version is simply not available, and kill_on_drop has already cleaned up.
        _ => return None,
    };

    if !out.status.success() {
        return None;
    }
    let first = String::from_utf8_lossy(&out.stdout)
        .lines()
        .next()?
        .to_string();
    // "sing-box version 1.11.0" / "Xray 1.8.0 (Xray, Inc.)" -> the bare number.
    let num = first
        .split_whitespace()
        .find(|tok| tok.chars().next().is_some_and(|c| c.is_ascii_digit()))?;
    Some(num.to_string())
}

// Derives the marketing name from the registry.
//
// The obvious value, ProductName, is not trustworthy: setup media for Windows 11
// populated it with the Windows 10 edition table, so a Windows 11 machine happily reports
// "Windows 10 Pro" (verified on build 26200). GetVersionEx then lies the other way once an
// app is not manifested for the newest OS. The one stable signal is the build number:
// major 10 with a build at or above 22000 is Windows 11, and anything below is Windows 10.
// The edition ("Pro") is taken from the tail of ProductName, which is the part of it that
// is actually correct.
#[cfg(windows)]
fn os_name() -> String {
    use winreg::enums::*;
    use winreg::RegKey;
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let nt = hklm
        .open_subkey("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion")
        .ok();

    let Some(nt) = nt else {
        return "Windows".to_string();
    };

    let product: Option<String> = nt.get_value("ProductName").ok();
    let display: Option<String> = nt.get_value("DisplayVersion").ok();
    let major: Option<u32> = nt.get_value("CurrentMajorVersionNumber").ok();
    let build: Option<String> = nt.get_value("CurrentBuild").ok();
    let ubr: Option<u32> = nt.get_value("UBR").ok();

    // "Windows 10 Pro" -> "Pro"; falls back to the whole value when the shape differs.
    let edition = product.as_deref().and_then(|p| {
        let rest = p.strip_prefix("Windows 10 ").or_else(|| p.strip_prefix("Windows 11 "))?;
        Some(rest.to_string())
    });

    let major = major.unwrap_or(10);
    let build_no = build.as_deref().and_then(|b| b.parse::<u32>().ok()).unwrap_or(0);

    let version_name = if major >= 11 || (major == 10 && build_no >= 22000) {
        "Windows 11"
    } else if major == 10 {
        "Windows 10"
    } else {
        "Windows"
    };

    let mut s = version_name.to_string();
    if let Some(ed) = edition {
        s = format!("{s} {ed}");
    }
    if let Some(d) = display {
        s = format!("{s} {d}");
    }
    // The full build number is what identifies the exact cumulative update, so include
    // UBR when it is present.
    match (build.as_deref(), ubr) {
        (Some(b), Some(u)) => s = format!("{s} (build {b}.{u})"),
        (Some(b), None) => s = format!("{s} (build {b})"),
        _ => {}
    }
    s
}

#[cfg(not(windows))]
fn os_name() -> String {
    "Unknown".to_string()
}

// Same resolution CoreManager uses: beside the installed exe, with the _up_ and dev
// fallbacks for a run from the build tree.
fn resolve_bin_dir() -> std::path::PathBuf {
    let app_dir = match std::env::current_exe() {
        Ok(e) => match e.parent() {
            Some(p) => p.to_path_buf(),
            None => return std::path::PathBuf::new(),
        },
        Err(_) => return std::path::PathBuf::new(),
    };
    let mut bin_dir = app_dir.join("bin");
    if !bin_dir.exists() {
        let up = app_dir.join("_up_").join("bin");
        if up.exists() {
            bin_dir = up;
        } else {
            let cwd = std::env::current_dir().unwrap_or_default();
            if cwd.join("bin").exists() {
                bin_dir = cwd.join("bin");
            } else if cwd.parent().map(|p| p.join("bin").exists()).unwrap_or(false) {
                bin_dir = cwd.parent().unwrap().join("bin");
            }
        }
    }
    bin_dir
}

#[tauri::command]
pub async fn get_system_info(
    settings: tauri::State<'_, std::sync::Mutex<crate::core::settings::SettingsManager>>,
) -> Result<SystemInfo, String> {
    let core_type = settings.lock().unwrap().settings.core_choice.clone();
    let bin_dir = resolve_bin_dir();
    // Both cores are asked together: a stalled binary costs its own eight seconds either way,
    // and they are independent of each other.
    let (singbox_version, xray_version) = tokio::join!(
        core_version(&bin_dir, "sing-box.exe"),
        core_version(&bin_dir, "xray.exe"),
    );
    Ok(SystemInfo {
        app_version: display_version(env!("CARGO_PKG_VERSION")),
        os_name: os_name(),
        os_arch: std::env::consts::ARCH.to_string(),
        singbox_version,
        xray_version,
        core_type,
    })
}

// Cheap version read for the hero badge -- get_system_info also returns this but it
// shells out to both cores, and the badge wants a value long before anyone opens the
// System & Engine card.
#[tauri::command]
pub fn get_app_version() -> String {
    display_version(env!("CARGO_PKG_VERSION"))
}

// Opens a link in the user's browser. Tauri's shell plugin would need a capability entry
// to be callable from the webview, and the project ships without one, so shell-execute
// it from here instead.
#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("only http(s) links may be opened".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        let wide: Vec<u16> = std::ffi::OsStr::new(&url)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        unsafe {
            let _ = windows_sys::Win32::System::Com::CoInitializeEx(
                std::ptr::null(),
                (windows_sys::Win32::System::Com::COINIT_APARTMENTTHREADED
                    | windows_sys::Win32::System::Com::COINIT_DISABLE_OLE1DDE) as u32,
            );
            windows_sys::Win32::UI::Shell::ShellExecuteW(
                0 as isize,
                std::ptr::null(),
                wide.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL as i32,
            );
        }
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("xdg-open").arg(&url).spawn();
        return Ok(());
    }
}
