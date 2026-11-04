use serde_json::Value;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;
#[cfg(windows)]
use winreg::enums::*;
#[cfg(windows)]
use winreg::RegKey;

#[cfg(windows)]
pub const EXE_EXT: &str = ".exe";
#[cfg(not(windows))]
pub const EXE_EXT: &str = "";

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn spawn_cmd(#[allow(unused_mut)] mut cmd: Command) -> Result<std::process::Child, std::io::Error> {
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.spawn()
}

pub struct CoreManager {
    pub bin_dir: PathBuf,
    pub data_dir: PathBuf,
    pub current_server_ip: Option<String>,
    pub process: Option<std::process::Child>,
    pub test_process: Option<std::process::Child>,
    pub tun_process: Option<std::process::Child>,
    pub tracker_process: Option<std::process::Child>,
}

impl CoreManager {
    pub fn new() -> Self {
        let exe_path = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("."));
        let app_dir = exe_path.parent().unwrap_or_else(|| std::path::Path::new(".")).to_path_buf();

        let sb_bin = format!("sing-box{}", EXE_EXT);
        let mut bin_dir = app_dir.join("bin");
        if !bin_dir.join(&sb_bin).exists() {
            let tauri_up_bin = app_dir.join("_up_").join("bin");
            if tauri_up_bin.join(&sb_bin).exists() {
                bin_dir = tauri_up_bin;
            } else {
                let current_dir = std::env::current_dir().unwrap_or_default();
                let dev_bin = current_dir.join("bin");
                if dev_bin.join(&sb_bin).exists() {
                    bin_dir = dev_bin;
                } else if current_dir.parent().map(|p| p.join("bin").join(&sb_bin).exists()).unwrap_or(false) {
                    bin_dir = current_dir.parent().unwrap().join("bin");
                }
            }
        }

        let mut data_dir = dirs::config_dir().unwrap_or_else(|| app_dir.clone());
        data_dir.push("Vxray");
        data_dir.push("data");

        if !data_dir.exists() {
            let _ = std::fs::create_dir_all(&data_dir);
        }

        Self {
            bin_dir,
            data_dir,
            current_server_ip: None,
            process: None,
            test_process: None,
            tun_process: None,
            tracker_process: None,
        }
    }

    pub fn is_admin() -> bool {
        #[cfg(target_os = "windows")]
        {
            use std::mem;
            use windows_sys::Win32::Foundation::HANDLE;
            use windows_sys::Win32::Security::{
                GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
            };
            use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

            unsafe {
                let mut token: HANDLE = 0 as HANDLE;
                if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) != 0 {
                    let mut elevation: TOKEN_ELEVATION = mem::zeroed();
                    let mut size = mem::size_of::<TOKEN_ELEVATION>() as u32;
                    let success = GetTokenInformation(
                        token,
                        TokenElevation,
                        &mut elevation as *mut _ as *mut _,
                        size,
                        &mut size,
                    );
                    windows_sys::Win32::Foundation::CloseHandle(token);
                    if success != 0 {
                        return elevation.TokenIsElevated != 0;
                    }
                }
            }
            return false;
        }

        #[cfg(not(target_os = "windows"))]
        {
            if std::fs::OpenOptions::new().read(true).write(true).open("/dev/net/tun").is_ok() {
                return true;
            }
            if let Ok(out) = std::process::Command::new("id").arg("-u").output() {
                if String::from_utf8_lossy(&out.stdout).trim() == "0" {
                    return true;
                }
            }
            false
        }
    }

    pub fn is_tracker_running(&mut self) -> bool {
        if let Some(p) = self.tracker_process.as_mut() {
            matches!(p.try_wait(), Ok(None))
        } else {
            false
        }
    }

    pub fn get_tun_enabled(&self) -> bool {
        self.tun_process.is_some()
    }

    pub fn is_tun_alive(&mut self) -> bool {
        if let Some(p) = self.tun_process.as_mut() {
            matches!(p.try_wait(), Ok(None))
        } else {
            false
        }
    }

    pub fn is_tun_operational(&mut self) -> bool {
        self.is_tun_alive()
    }

    pub fn is_main_core_alive(&mut self) -> bool {
        if let Some(p) = self.process.as_mut() {
            matches!(p.try_wait(), Ok(None))
        } else {
            false
        }
    }

    pub fn tun_adapter_ready() -> bool {
        true
    }

    pub fn reap_dead_core(&mut self) {
        if let Some(p) = self.process.as_mut() {
            let _ = p.try_wait();
        }
    }

    pub fn clear_system_proxy_if_vxray_leftover(&self) {
        self.clear_system_proxy();
    }

    #[cfg(not(target_os = "windows"))]
    fn allow_firewall(_exe_path: &std::path::Path) {}

    #[cfg(target_os = "windows")]
    fn allow_firewall(exe_path: &std::path::Path) {
        if !Self::is_admin() {
            return;
        }
        if let Some(path_str) = exe_path.to_str() {
            let rule_name = format!(
                "Vxray Core ({})",
                exe_path.file_name().unwrap_or_default().to_string_lossy()
            );
            let _ = Command::new("netsh")
                .args([
                    "advfirewall",
                    "firewall",
                    "add",
                    "rule",
                    &format!("name={}", rule_name),
                    "dir=in",
                    "action=allow",
                    &format!("program={}", path_str),
                    "enable=yes",
                ])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
            let _ = Command::new("netsh")
                .args([
                    "advfirewall",
                    "firewall",
                    "add",
                    "rule",
                    &format!("name={}", rule_name),
                    "dir=out",
                    "action=allow",
                    &format!("program={}", path_str),
                    "enable=yes",
                ])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
        }
    }

    pub fn is_alive(&mut self) -> bool {
        let main_alive = if let Some(p) = self.process.as_mut() {
            matches!(p.try_wait(), Ok(None))
        } else {
            false
        };

        if !main_alive {
            return false;
        }

        if let Some(p) = self.tun_process.as_mut() {
            if !matches!(p.try_wait(), Ok(None)) {
                return false;
            }
        }

        true
    }

    #[cfg(windows)]
    fn refresh_wininet(&self) {
        std::thread::spawn(|| {
            std::thread::sleep(std::time::Duration::from_millis(10));
            unsafe {
                windows_sys::Win32::Networking::WinInet::InternetSetOptionW(
                    std::ptr::null_mut(),
                    windows_sys::Win32::Networking::WinInet::INTERNET_OPTION_SETTINGS_CHANGED,
                    std::ptr::null_mut(),
                    0,
                );
                windows_sys::Win32::Networking::WinInet::InternetSetOptionW(
                    std::ptr::null_mut(),
                    windows_sys::Win32::Networking::WinInet::INTERNET_OPTION_REFRESH,
                    std::ptr::null_mut(),
                    0,
                );
            }
        });
    }

    #[cfg(not(windows))]
    fn refresh_wininet(&self) {}

    #[cfg(windows)]
    pub fn set_system_proxy(&self, host: &str, port: u16) {
        if let Ok(hkcu) = RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
            KEY_WRITE,
        ) {
            let proxy_server = format!("{}:{}", host, port);
            let _ = hkcu.set_value("ProxyEnable", &1u32);
            let _ = hkcu.set_value("ProxyServer", &proxy_server);
            let _ = hkcu.set_value("ProxyOverride", &"<local>");
            let _ = hkcu.delete_value("AutoConfigURL");
            self.refresh_wininet();
        }
    }

    #[cfg(not(windows))]
    pub fn set_system_proxy(&self, host: &str, port: u16) {
        let _ = Command::new("gsettings")
            .args(["set", "org.gnome.system.proxy", "mode", "manual"])
            .output();
        let _ = Command::new("gsettings")
            .args(["set", "org.gnome.system.proxy.socks", "host", host])
            .output();
        let _ = Command::new("gsettings")
            .args(["set", "org.gnome.system.proxy.socks", "port", &port.to_string()])
            .output();
    }

    #[cfg(windows)]
    pub fn clear_system_proxy(&self) {
        if let Ok(hkcu) = RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
            KEY_WRITE,
        ) {
            let _ = hkcu.set_value("ProxyEnable", &0u32);
            let _ = hkcu.delete_value("ProxyServer");
            self.refresh_wininet();
        }
    }

    #[cfg(not(windows))]
    pub fn clear_system_proxy(&self) {
        let _ = Command::new("gsettings")
            .args(["set", "org.gnome.system.proxy", "mode", "none"])
            .output();
    }

    #[cfg(windows)]
    pub fn kill_all_cores(&self) {
        let _ = Command::new("taskkill")
            .args(["/F", "/IM", "sing-box.exe", "/T"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        let _ = Command::new("taskkill")
            .args(["/F", "/IM", "xray.exe", "/T"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
            
        let _ = Command::new("taskkill")
            .args(["/F", "/IM", "vxray-tun.exe", "/T"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
            
        let _ = Command::new("taskkill")
            .args(["/F", "/IM", "stat-tracker.exe", "/T"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }

    #[cfg(not(windows))]
    pub fn kill_all_cores(&self) {
        for name in ["sing-box", "xray", "vxray-tun", "stat-tracker"] {
            let _ = Command::new("pkill").args(["-9", "-f", name]).output();
        }
    }

    pub fn start_core(&mut self, mut config: Value) -> Result<(), String> {
        let sb_name = format!("sing-box{}", EXE_EXT);
        let xr_name = format!("xray{}", EXE_EXT);
        let mut exe_name = sb_name.as_str();
        if let Some(core_type) = config.get("__core__").and_then(|v| v.as_str()) {
            if core_type == "xray" {
                exe_name = xr_name.as_str();
            }
        }
        if let Some(obj) = config.as_object_mut() {
            obj.remove("__core__");
        }

        if !self.data_dir.exists() {
            let _ = std::fs::create_dir_all(&self.data_dir);
        }
        let config_path = self.data_dir.join("config.json");
        std::fs::write(&config_path, config.to_string()).map_err(|e| e.to_string())?;

        let log_file =
            std::fs::File::create(self.data_dir.join("core.log")).map_err(|e| e.to_string())?;

        let exe_path = self.bin_dir.join(exe_name);
        Self::allow_firewall(&exe_path);

        let mut cmd = Command::new(&exe_path);
        cmd.current_dir(&self.bin_dir)
            .args(["run", "-c", &config_path.to_string_lossy()])
            .stdout(log_file.try_clone().unwrap())
            .stderr(log_file)
            ;
        let child = spawn_cmd(cmd).map_err(|e| e.to_string())?;

        self.process = Some(child);
        Ok(())
    }

    pub fn take_core_process(&mut self) -> Option<std::process::Child> {
        self.process.take()
    }

    pub fn clear_proxy_if(&self, clear_proxy: bool) {
        if clear_proxy {
            self.clear_system_proxy();
        }
    }

    pub fn start_test_core(&mut self, mut config: Value) -> Result<(), String> {
        self.stop_test_core();

        let sb_name = format!("sing-box{}", EXE_EXT);
        let xr_name = format!("xray{}", EXE_EXT);
        let mut exe_name = sb_name.as_str();
        if let Some(core_type) = config.get("__core__").and_then(|v| v.as_str()) {
            if core_type == "xray" {
                exe_name = xr_name.as_str();
            }
        }
        if let Some(obj) = config.as_object_mut() {
            obj.remove("__core__");
        }

        if !self.data_dir.exists() {
            let _ = std::fs::create_dir_all(&self.data_dir);
        }
        let config_path = self.data_dir.join("test_config.json");
        std::fs::write(&config_path, config.to_string()).map_err(|e| e.to_string())?;

        let exe_path = self.bin_dir.join(exe_name);
        let mut cmd = Command::new(&exe_path);
        cmd.current_dir(&self.bin_dir)
            .args(["run", "-c", &config_path.to_string_lossy()])
            ;
        let child = spawn_cmd(cmd).map_err(|e| e.to_string())?;

        self.test_process = Some(child);
        Ok(())
    }

    pub fn stop_test_core(&mut self) {
        if let Some(mut p) = self.test_process.take() {
            std::thread::spawn(move || {
                let _ = p.kill();
                let _ = p.wait();
            });
        }
    }

    pub fn start_tun_core(&mut self, config: Value, _is_xray: bool) -> Result<(), String> {
        if !self.data_dir.exists() {
            let _ = std::fs::create_dir_all(&self.data_dir);
        }
        let config_path = self.data_dir.join("tun_config.json");
        std::fs::write(&config_path, config.to_string()).map_err(|e| e.to_string())?;

        let log_file =
            std::fs::File::create(self.data_dir.join("tun.log")).map_err(|e| e.to_string())?;

        let tun_name = format!("vxray-tun{}", EXE_EXT);
        let tun_path = self.data_dir.join(&tun_name);
        let source_name = format!("sing-box{}", EXE_EXT);
        let source_bin = self.bin_dir.join(&source_name);
        if !tun_path.exists() || std::fs::metadata(&tun_path).map(|m| m.len()).unwrap_or(0) != std::fs::metadata(&source_bin).map(|m| m.len()).unwrap_or(1) {
            let _ = std::fs::copy(&source_bin, &tun_path);
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&tun_path, std::fs::Permissions::from_mode(0o755));
            }
        }
        #[cfg(windows)]
        {
            let wintun_dst = self.data_dir.join("wintun.dll");
            let wintun_src = self.bin_dir.join("wintun.dll");
            if wintun_src.exists() && (!wintun_dst.exists() || std::fs::metadata(&wintun_dst).map(|m| m.len()).unwrap_or(0) != std::fs::metadata(&wintun_src).map(|m| m.len()).unwrap_or(1)) {
                let _ = std::fs::copy(&wintun_src, &wintun_dst);
            }
        }
        let exe_path = tun_path;
        Self::allow_firewall(&exe_path);

        let mut cmd = Command::new(&exe_path);
        cmd.current_dir(&self.bin_dir)
            .env("ENABLE_DEPRECATED_TUN_ADDRESS_X", "1")
            .args(["run", "-c", &config_path.to_string_lossy()])
            .stdout(log_file.try_clone().unwrap())
            .stderr(log_file)
            ;
        let child = spawn_cmd(cmd).map_err(|e| e.to_string())?;

        self.tun_process = Some(child);
        Ok(())
    }

    pub fn take_tun_process(&mut self) -> Option<std::process::Child> {
        self.tun_process.take()
    }

    pub fn start_tracker_core(&mut self, config: Value) -> Result<(), String> {
        if let Some(mut old) = self.tracker_process.take() {
            let _ = old.kill();
            let _ = old.wait();
        }
        if !self.data_dir.exists() {
            let _ = std::fs::create_dir_all(&self.data_dir);
        }
        let config_path = self.data_dir.join("tracker_config.json");
        std::fs::write(&config_path, config.to_string()).map_err(|e| e.to_string())?;

        let tracker_name = format!("stat-tracker{}", EXE_EXT);
        let exe_path = self.data_dir.join(&tracker_name);
        let source_name = format!("sing-box{}", EXE_EXT);
        let source_bin = self.bin_dir.join(&source_name);
        if !exe_path.exists() || std::fs::metadata(&exe_path).map(|m| m.len()).unwrap_or(0) != std::fs::metadata(&source_bin).map(|m| m.len()).unwrap_or(1) {
            let _ = std::fs::copy(&source_bin, &exe_path);
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&exe_path, std::fs::Permissions::from_mode(0o755));
            }
        }
        Self::allow_firewall(&exe_path);

        let tracker_path = exe_path.clone();
        let mut cmd = Command::new(&tracker_path);
        cmd.current_dir(&self.bin_dir)
            .args(["run", "-c", &config_path.to_string_lossy()])
            ;
        let child = spawn_cmd(cmd).map_err(|e| e.to_string())?;

        self.tracker_process = Some(child);
        Ok(())
    }

    pub fn take_tracker_process(&mut self) -> Option<std::process::Child> {
        self.tracker_process.take()
    }
}

pub fn set_job_handle(_handle: usize) {}
pub const TUN_READY_WINDOW: std::time::Duration = std::time::Duration::from_millis(3000);
