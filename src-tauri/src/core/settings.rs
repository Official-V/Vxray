use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;

#[derive(Clone, Serialize, Deserialize, Debug, Default)]
pub struct ServerStats {
    #[serde(default)]
    pub usage_history: Vec<(u64, u64)>, // Keeping for backwards compatibility
    #[serde(default)]
    pub daily_usage: std::collections::HashMap<String, u64>,
    #[serde(default)]
    pub ping_history: Vec<u64>,
    #[serde(default)]
    pub total_used: u64,
    // The traffic stream reports up and down separately; total_used folds them together, so this
    // is the half that used to be discarded at the single call site that reads it.
    #[serde(default)]
    pub total_upload: u64,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ServerGroup {
    pub name: String,
    pub servers: Vec<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upload: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub download: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expire: Option<u64>,
    #[serde(default = "default_true")]
    pub auto_update: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub update_interval: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub announcement: Option<String>,
}

fn default_true() -> bool {
    true
}

fn default_rule_kind() -> String {
    "domain".to_string()
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct RoutingRule {
    // One malformed entry in the array used to fail the whole Settings parse, which resets
    // everything above to defaults -- subscriptions included -- on the next launch. Defaulting
    // the three keys drops only the broken row.
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub pattern: String,
    #[serde(default)]
    pub action: String, // "direct", "block", "proxy"
    /// "domain" or "process". A process rule matches sing-box's `process_name`, i.e.
    /// split tunneling per .exe; a domain rule is the ordinary domain/IP kind. The
    /// default keeps settings.json written before this field existed loading as domain
    /// rules, which is what every such rule actually was.
    #[serde(default = "default_rule_kind")]
    pub kind: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

// Google DoH, not Cloudflare: 1.1.1.1 is intercepted by Iranian ISPs (see
// config::sanitize_remote_dns) so it must never be the shipped default.
fn default_remote_dns() -> String {
    "https://8.8.8.8/dns-query".to_string()
}

fn default_local_dns() -> String {
    "local".to_string()
}

fn default_core() -> String {
    "auto".to_string()
}

fn default_language() -> String {
    "en".to_string()
}

// The stylesheet keys the whole palette off html[data-theme], so the persisted value is
// just that attribute. Anything stored before the toggle existed has no field and lands
// here on "dark", which is what the app already looked like.
fn default_theme() -> String {
    "dark".to_string()
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct UiState {
    pub last_selected: Option<String>,
    pub tun_enabled: bool,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default)]
    pub auto_reconnect: bool,
    #[serde(default)]
    pub auto_start: bool,
    #[serde(default)]
    pub start_minimized: bool,
    #[serde(default = "default_true")]
    pub live_ping_enabled: bool,
    #[serde(default)]
    pub last_connection_link: Option<String>,
    #[serde(default)]
    pub last_connection_tun: bool,
    #[serde(default)]
    pub pinned_subscriptions: Vec<String>,
    #[serde(default)]
    pub subscription_order: Vec<String>,
    #[serde(default = "default_true")]
    pub auto_update_subs: bool,
    #[serde(default = "default_theme")]
    pub theme: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Settings {
    #[serde(default)]
    pub stats: std::collections::HashMap<String, ServerStats>,
    #[serde(default)]
    pub routing_rules: Vec<RoutingRule>,
    #[serde(default = "default_true")]
    pub bypass_iran: bool,
    #[serde(default = "default_true")]
    pub bypass_lan: bool,
    #[serde(default)]
    pub block_ads: bool,
    // Inverts the default route: everything goes direct and only rules with the
    // "proxy" action use the VPN. Without it there is no way to say "I only want the
    // VPN for this one site".
    #[serde(default)]
    pub proxy_only_mode: bool,
    #[serde(default = "default_remote_dns")]
    pub remote_dns: String,
    #[serde(default = "default_local_dns")]
    pub local_dns: String,
    #[serde(default)]
    pub tls_fragment: bool,
    // strict_route installs WFP filters that force every destination not listed in the TUN's
    // route_exclude_address back into the tunnel. It did exactly that to the main core's own
    // connection to the tunnel server: the adapter reported internet access while nothing proxied
    // could load. Off is the shape 2.0.1 shipped and the one v2rayN's template ships; on stays
    // selectable now that the server addresses are excluded, it is just not the default.
    #[serde(default)]
    pub strict_route: bool,
    #[serde(default = "default_core")]
    pub core_choice: String,
    pub subscriptions: Vec<Value>,
    pub servers: std::collections::HashMap<String, ServerGroup>,
    pub ui: UiState,
}

impl Default for Settings {
    fn default() -> Self {
        let mut servers = std::collections::HashMap::new();
        servers.insert(
            "manual".to_string(),
            ServerGroup {
                name: "Manually Added".to_string(),
                servers: vec![],
                upload: None,
                download: None,
                total: None,
                expire: None,
                auto_update: false,
                update_interval: None,
                announcement: None,
            },
        );

        Settings {
            stats: std::collections::HashMap::new(),
            routing_rules: vec![],
            bypass_iran: true,
            bypass_lan: true,
            block_ads: false,
            proxy_only_mode: false,
            remote_dns: default_remote_dns(),
            local_dns: "local".to_string(),
            tls_fragment: false,
            strict_route: false,
            core_choice: "auto".to_string(),
            subscriptions: vec![],
            servers,
            ui: UiState {
                last_selected: None,
                tun_enabled: false,
                language: default_language(),
                auto_reconnect: false,
                auto_start: false,
                start_minimized: false,
                live_ping_enabled: true,
                last_connection_link: None,
                last_connection_tun: false,
                pinned_subscriptions: vec![],
                subscription_order: vec![],
                auto_update_subs: true,
                theme: default_theme(),
            },
        }
    }
}

impl Settings {
    /// Collapses the process rules to one entry per image name.
    ///
    /// sing-box is first-match-wins, so a second rule for the same application never applied --
    /// it sat beneath the first one and the toggle above it read as broken, which is how a user
    /// ends up with one app listed under both Bypass and Proxy. The rule actually in force is the
    /// first *enabled* one for that image (a disabled rule is not emitted at all), falling back to
    /// the first one when none of them is enabled, so dropping the rest changes no routing.
    /// Returns whether anything was removed, so the caller can persist the repair.
    pub fn reconcile_process_rules(&mut self) -> bool {
        let mut first_enabled = std::collections::HashMap::<String, usize>::new();
        let mut first_any = std::collections::HashMap::<String, usize>::new();
        for (i, rule) in self.routing_rules.iter().enumerate() {
            if rule.kind != "process" {
                continue;
            }
            let image = rule
                .pattern
                .rsplit(['\\', '/'])
                .next()
                .unwrap_or(&rule.pattern)
                .to_ascii_lowercase();
            first_any.entry(image.clone()).or_insert(i);
            if rule.enabled {
                first_enabled.entry(image).or_insert(i);
            }
        }

        // One surviving index per image: the first enabled rule is the one actually in force,
        // because a disabled rule is never written into the core's config; only when none of a
        // image's rules is enabled does the first one stand in for the group.
        let keep: std::collections::HashSet<usize> = first_any
            .keys()
            .map(|image| first_enabled.get(image).copied().unwrap_or(first_any[image]))
            .collect();

        let before = self.routing_rules.len();
        let mut kept = Vec::with_capacity(keep.len());
        for (i, rule) in self.routing_rules.drain(..).enumerate() {
            if rule.kind != "process" || keep.contains(&i) {
                kept.push(rule);
            }
        }
        self.routing_rules = kept;
        self.routing_rules.len() != before
    }
}

pub struct SettingsManager {
    pub file_path: PathBuf,
    pub settings: Settings,
}

impl SettingsManager {
    pub fn new() -> Self {
        let mut custom_dir = None;
        let args: Vec<String> = std::env::args().collect();
        if let Some(idx) = args.iter().position(|a| a == "--config-dir") {
            if idx + 1 < args.len() {
                custom_dir = Some(std::path::PathBuf::from(&args[idx + 1]));
            }
        }

        let mut file_path = custom_dir.unwrap_or_else(|| {
            let mut p = dirs::config_dir().unwrap_or_else(|| {
                std::env::current_exe()
                    .unwrap_or_default()
                    .parent()
                    .unwrap()
                    .to_path_buf()
            });
            p.push("Vxray");
            p
        });
        let _ = fs::create_dir_all(&file_path);
        file_path.push("settings.json");

        let mut settings = if file_path.exists() {
            if let Ok(content) = fs::read_to_string(&file_path) {
                match serde_json::from_str::<Settings>(&content) {
                    Ok(s) => s,
                    // Reporting this is the difference between "my subscriptions vanished" and
                    // "one row in my routing list was unreadable". The file is left as it is so
                    // the user can recover it; overwriting it here would destroy the evidence.
                    Err(e) => {
                        eprintln!(
                            "settings.json at {} was unreadable ({}); keeping the file and \
                             starting from defaults",
                            file_path.display(),
                            e
                        );
                        Settings::default()
                    }
                }
            } else {
                Settings::default()
            }
        } else {
            Settings::default()
        };

        // Run before anything else reads the rules, so the running cores and the saved file agree.
        if settings.reconcile_process_rules() {
            let _ = fs::write(&file_path, serde_json::to_string_pretty(&settings).unwrap_or_default());
        }

        Self {
            file_path,
            settings,
        }
    }

    /// Writes via a temp file in the same directory, then renames into place. A settings.json
    /// written directly is truncated to zero by a crash or a power loss partway through the
    /// write, and the next launch then silently resets every subscription and rule to defaults.
    pub fn save(&self) -> Result<(), String> {
        let content = serde_json::to_string_pretty(&self.settings)
            .map_err(|e| format!("Serialization error: {}", e))?;
        let mut tmp = self.file_path.clone();
        tmp.set_extension("json.tmp");
        fs::write(&tmp, &content).map_err(|e| format!("Failed to save settings: {}", e))?;
        fs::rename(&tmp, &self.file_path).map_err(|e| {
            // Leave the settings file alone -- the rename is what failed, so the old one is
            // still the last known good copy, and retrying the write is not the fix.
            let _ = fs::remove_file(&tmp);
            format!("Failed to save settings: {}", e)
        })?;
        Ok(())
    }

    pub fn get_server_groups(&self) -> Value {
        json!({
            "groups": &self.settings.servers,
            "pinned": &self.settings.ui.pinned_subscriptions,
            "order": &self.settings.ui.subscription_order,
        })
    }

    pub fn toggle_pin_subscription(&mut self, group_key: &str) -> Vec<String> {
        if self
            .settings
            .ui
            .pinned_subscriptions
            .contains(&group_key.to_string())
        {
            self.settings
                .ui
                .pinned_subscriptions
                .retain(|k| k != group_key);
        } else {
            self.settings
                .ui
                .pinned_subscriptions
                .push(group_key.to_string());
        }
        let _ = self.save();
        self.settings.ui.pinned_subscriptions.clone()
    }

    pub fn save_subscription_order(&mut self, order: Vec<String>) {
        self.settings.ui.subscription_order = order;
        let _ = self.save();
    }

    pub fn set_server_groups(&mut self, groups: std::collections::HashMap<String, ServerGroup>) {
        self.settings.servers = groups;
        let _ = self.save();
    }

    pub fn add_manual_server(&mut self, link: String, remark: String) {
        if !self.settings.servers.contains_key("manual") {
            self.settings.servers.insert(
                "manual".to_string(),
                ServerGroup {
                    name: "Manually Added".to_string(),
                    servers: vec![],
                    upload: None,
                    download: None,
                    total: None,
                    expire: None,
                    auto_update: false,
                    update_interval: None,
                    announcement: None,
                },
            );
        }
        if let Some(group) = self.settings.servers.get_mut("manual") {
            let server_obj = json!({
                "link": link,
                "remark": remark,
            });
            group.servers.push(server_obj);
            let _ = self.save();
        }
    }

    pub fn get_subscriptions(&self) -> Value {
        let mut list = Vec::new();
        for (url, group) in &self.settings.servers {
            if url == "manual" {
                continue;
            }
            let is_pinned = self.settings.ui.pinned_subscriptions.contains(url);
            let mut stats = self.settings.stats.get(url).cloned().unwrap_or_default();
            
            let mut all_pings = Vec::new();
            for server in &group.servers {
                if let Some(link) = server.get("link").and_then(|v| v.as_str()) {
                    if let Some(server_stat) = self.settings.stats.get(link) {
                        all_pings.extend(server_stat.ping_history.clone());
                    }
                }
            }
            if !all_pings.is_empty() {
                stats.ping_history = all_pings;
            }

            list.push(json!({
                "url": url,
                "name": group.name,
                "servers_count": group.servers.len(),
                "upload": group.upload,
                "download": group.download,
                "total": group.total,
                "expire": group.expire,
                "auto_update": group.auto_update,
                "update_interval": group.update_interval.unwrap_or(24),
                "pinned": is_pinned,
                "stats": stats,
                "announcement": &group.announcement,
            }));
        }
        json!(list)
    }

    pub fn add_subscription(&mut self, url: String) {
        self.settings.subscriptions.push(json!({"url": url}));
        let _ = self.save();
    }

    pub fn delete_subscription(&mut self, group_key: &str) {
        // Remove from subscriptions list
        self.settings.subscriptions.retain(|sub| {
            if let Some(url) = sub.get("url").and_then(|v| v.as_str()) {
                url != group_key
            } else {
                true
            }
        });
        // Remove server group
        self.settings.servers.remove(group_key);

        // Drop every other place the url is still referenced, otherwise pins, ordering and
        // stats keep pointing at a group that no longer exists. Same fields
        // edit_subscription migrates when a url changes.
        self.settings.ui.pinned_subscriptions.retain(|p| p != group_key);
        self.settings.ui.subscription_order.retain(|o| o != group_key);
        self.settings.stats.remove(group_key);

        let _ = self.save();
    }

    pub fn update_ui_state(&mut self, last_selected: Option<String>, tun_enabled: Option<bool>) {
        if let Some(ls) = last_selected {
            self.settings.ui.last_selected = Some(ls);
        }
        if let Some(te) = tun_enabled {
            self.settings.ui.tun_enabled = te;
        }
        let _ = self.save();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app_rule(id: &str, path: &str, action: &str, enabled: bool) -> RoutingRule {
        RoutingRule {
            id: id.into(),
            pattern: path.into(),
            action: action.into(),
            kind: "process".into(),
            enabled,
        }
    }

    fn domain_rule(id: &str) -> RoutingRule {
        RoutingRule {
            id: id.into(),
            pattern: "example.com".into(),
            action: "direct".into(),
            kind: "domain".into(),
            enabled: true,
        }
    }

    fn settings_with(rules: Vec<RoutingRule>) -> Settings {
        let mut s = Settings::default();
        s.routing_rules = rules;
        s
    }

    #[test]
    fn reconcile_keeps_one_rule_per_application() {
        // The exact shape the user ended up with: the same Discord binary under both Bypass and
        // Proxy, both enabled. Bypass came first, so it is the rule that is actually in force.
        let mut s = settings_with(vec![
            app_rule("1", "C:\\AppData\\Discord.exe", "bypass", true),
            app_rule("2", "C:\\AppData\\Discord.exe", "proxy", true),
        ]);

        assert!(s.reconcile_process_rules());
        assert_eq!(s.routing_rules.len(), 1);
        assert_eq!(s.routing_rules[0].id, "1");
        assert_eq!(s.routing_rules[0].action, "bypass");
    }

    #[test]
    fn reconcile_matches_image_name_not_full_path() {
        // sing-box keys a process rule on the bare image name, so these two are the same
        // application written two ways and must collapse -- casing included.
        let mut s = settings_with(vec![
            app_rule("1", "C:\\Users\\me\\Spotify.exe", "bypass", true),
            app_rule("2", "D:\\spotify.exe", "proxy", true),
        ]);

        assert!(s.reconcile_process_rules());
        assert_eq!(s.routing_rules.len(), 1);
        assert_eq!(s.routing_rules[0].id, "1");
    }

    #[test]
    fn reconcile_prefers_the_enabled_rule() {
        // A disabled rule is not emitted, so it is not in force: dropping the enabled copy beneath
        // it would change the routing, not just tidy it up.
        let mut s = settings_with(vec![
            app_rule("1", "Telegram.exe", "bypass", false),
            app_rule("2", "Telegram.exe", "proxy", true),
        ]);

        assert!(s.reconcile_process_rules());
        assert_eq!(s.routing_rules.len(), 1);
        assert_eq!(s.routing_rules[0].id, "2");
        assert!(s.routing_rules[0].enabled);
    }

    #[test]
    fn reconcile_leaves_domain_rules_alone() {
        // Domains are not keyed on an image name, so duplicates there are a user's deliberate
        // choice and none of this function's business.
        let mut s = settings_with(vec![
            app_rule("1", "Spotify.exe", "bypass", true),
            app_rule("2", "Spotify.exe", "proxy", true),
            domain_rule("3"),
            domain_rule("4"), // same pattern as 3 -- a process dedup would have eaten it
        ]);

        assert!(s.reconcile_process_rules());
        assert_eq!(s.routing_rules.len(), 3);
        assert_eq!(
            s.routing_rules
                .iter()
                .filter(|r| r.kind == "domain")
                .count(),
            2
        );
        assert_eq!(s.routing_rules[0].id, "1");
    }

    #[test]
    fn reconcile_reports_nothing_to_do_when_clean() {
        let mut s = settings_with(vec![
            app_rule("1", "Spotify.exe", "bypass", true),
            app_rule("2", "Discord.exe", "bypass", true),
        ]);

        assert!(!s.reconcile_process_rules());
        assert_eq!(s.routing_rules.len(), 2);
    }
}
