#![cfg(test)]

use super::config::*;
use base64::Engine;
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::os::windows::process::CommandExt;
use std::process::Command;

// Diagnostic harness for the core parsers, not a set of assertions: each case feeds a parsed
// outbound to the real sing-box/xray binary and prints whether the core accepts it. Kept
// because the printed ACCEPT/REJECT output is what surfaced the SNI-spoofing and h2-host
// shapes; borrow instead of taking ownership so a case can build two variants off one parse.

fn bin_dir() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("bin")
}

fn check_singbox(name: &str, outbound: &Value) -> bool {
    let cfg = json!({
        "log": {"level": "warning"},
        "inbounds": [{"type": "mixed", "tag": "in", "listen": "127.0.0.1", "listen_port": 20799}],
        "outbounds": [outbound, {"type": "direct", "tag": "direct"}],
        "route": {"final": "proxy"}
    });
    let temp = std::env::temp_dir().join("vxray_audit");
    let _ = std::fs::create_dir_all(&temp);
    let p = temp.join(format!("sb_{}.json", name));
    std::fs::write(&p, serde_json::to_string(&cfg).unwrap()).unwrap();
    // 1.10 renamed the subcommand: bare `sing-box check <file>` is "unknown command", and it
    // wants the config behind -c. An invocation that cannot run prints REJECT for a config the
    // core would have accepted, which is worse than no signal at all.
    let out = Command::new(bin_dir().join("sing-box.exe"))
        .args(["check", "-c"])
        .arg(p.to_string_lossy().as_ref())
        .creation_flags(0x0800_0000)
        .output()
        .unwrap();
    let ok = out.status.success();
    println!(
        "[sing-box {}] {} {}",
        name,
        if ok { "ACCEPT" } else { "REJECT" },
        String::from_utf8_lossy(&out.stderr).trim()
    );
    ok
}

// Runs a whole generated config (not just one outbound) through `sing-box check`. The TUN
// sidecar and the stat-tracker are full configs, so a field the schema rejects anywhere in them
// kills the process at startup -- which is what "TUN connected but no internet" looks like from
// the UI, and cannot be seen by checking an outbound alone.
fn check_singbox_full(name: &str, cfg: &Value) -> bool {
    let temp = std::env::temp_dir().join("vxray_audit");
    let _ = std::fs::create_dir_all(&temp);
    let p = temp.join(format!("sbf_{}.json", name));
    std::fs::write(&p, serde_json::to_string(cfg).unwrap()).unwrap();
    let out = Command::new(bin_dir().join("sing-box.exe"))
        .args(["check", "-c"])
        .arg(p.to_string_lossy().as_ref())
        .creation_flags(0x0800_0000)
        .output()
        .unwrap();
    let ok = out.status.success();
    println!(
        "[singbox-full {}] {} {}",
        name,
        if ok { "ACCEPT" } else { "REJECT" },
        String::from_utf8_lossy(&out.stderr).trim()
    );
    ok
}

// Runs the TUN sidecar for real and reads its log. `check` proves the schema; it says nothing
// about whether the adapter comes up, because a config that checks clean can still fail at the
// Wintun layer. A non-elevated run cannot create the adapter, so the interesting line is the one
// that says so: an error about the *config* here means a bug the app can fix, while one about
// permissions or the driver means the config is right and the environment is the problem.
fn run_tun_sidecar(name: &str, cfg: &Value, secs: u64) -> String {
    let _ = Command::new("taskkill")
        .args(["/F", "/IM", "vxray-tun-probe.exe", "/T"])
        .creation_flags(0x0800_0000)
        .output();
    std::thread::sleep(std::time::Duration::from_millis(200));

    let temp = std::env::temp_dir().join("vxray_audit");
    let _ = std::fs::create_dir_all(&temp);
    let cfg_path = temp.join(format!("tun_probe_{}.json", name));

    // The generated config asks for the app's real adapter name. A probe that reuses it loses
    // the create race to the app's own sidecar every time the app is running, and the driver
    // reports that as "already exists" -- which looks like a config regression but is not. The
    // probe gets its own name so it is exercising the config, not fighting the live tunnel.
    let mut cfg = cfg.clone();
    if let Some(inbounds) = cfg
        .as_object_mut()
        .and_then(|o| o.get_mut("inbounds"))
        .and_then(|i| i.as_array_mut())
    {
        for inbound in inbounds {
            if inbound
                .get("type")
                .and_then(|t| t.as_str())
                .is_some_and(|t| t == "tun")
            {
                inbound["interface_name"] = json!("VxrayProbe");
            }
        }
    }

    std::fs::write(&cfg_path, serde_json::to_string(&cfg).unwrap()).unwrap();

    // A copy under a probe-only name, so the kill above cannot touch a sidecar the app itself
    // started -- and so the firewall rule the manager adds is not the one being exercised.
    let bin = bin_dir();
    let probe = temp.join("vxray-tun-probe.exe");
    let _ = std::fs::copy(bin.join("sing-box.exe"), &probe);

    let log_path = temp.join(format!("tun_probe_{}.log", name));
    let log_file = std::fs::File::create(&log_path).unwrap();
    let mut cmd = Command::new(&probe);
    cmd.current_dir(&bin)
        .arg("run")
        .arg("-c")
        .arg(cfg_path.to_string_lossy().as_ref())
        .stdout(std::process::Stdio::from(log_file.try_clone().unwrap()))
        .stderr(std::process::Stdio::from(log_file))
        .creation_flags(0x0800_0000);
    let mut child = cmd.spawn().unwrap();

    std::thread::sleep(std::time::Duration::from_secs(secs));
    let exited = child.try_wait().ok().flatten().is_some();
    println!("[tun-probe {name}] exited_within_{secs}s={exited}");
    let _ = Command::new("taskkill")
        .args(["/F", "/IM", "vxray-tun-probe.exe", "/T"])
        .creation_flags(0x0800_0000)
        .output();
    std::fs::read_to_string(&log_path).unwrap_or_default()
}

fn check_xray(name: &str, outbound: &Value) -> bool {
    let cfg = json!({
        "log": {"loglevel": "warning"},
        "inbounds": [{"tag": "in", "port": 20798, "listen": "127.0.0.1", "protocol": "socks"}],
        "outbounds": [outbound, {"tag": "direct", "protocol": "freedom"}],
        "routing": {"rules": [{"type": "field", "port": "0-65535", "outboundTag": "proxy"}]}
    });
    let temp = std::env::temp_dir().join("vxray_audit");
    let _ = std::fs::create_dir_all(&temp);
    let p = temp.join(format!("xr_{}.json", name));
    std::fs::write(&p, serde_json::to_string(&cfg).unwrap()).unwrap();
    let bin = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("bin");
    let out = Command::new(bin.join("xray.exe"))
        .args(["run", "-test", "-c"])
        .arg(p.to_string_lossy().as_ref())
        .creation_flags(0x0800_0000)
        .output()
        .unwrap();
    let ok = out.status.success();
    println!(
        "[xray   {}] {} {}",
        name,
        if ok { "ACCEPT" } else { "REJECT" },
        String::from_utf8_lossy(&out.stderr).trim()
    );
    ok
}

#[test]
fn core_ipv6_brackets() {
    let v6 = parse_link("vless://01234567-89ab-cdef-0123-456789abcdef@[2001:db8::1]:443?encryption=none&security=tls&sni=x.com#y")
        .expect("must parse");
    println!("server field => {:?}", v6["server"]);
    check_singbox("vless_ipv6_bracketed", &v6);

    let mut bare = v6.clone();
    bare["server"] = json!("2001:db8::1");
    check_singbox("vless_ipv6_bare", &bare);

    let ss6 = parse_link("ss://YWVzLTI1Ni1nY206dGVzdA==@[2001:db8::1]:8388#x").expect("must parse");
    println!("ss server field => {:?}", ss6["server"]);
    check_singbox("ss_ipv6_bracketed", &ss6);
}

#[test]
fn core_vmess_empty_sni() {
    // xray_config_to_link drops the vmess serverName -> blob has sni:"" -> server_name ""
    let blob = base64::engine::general_purpose::STANDARD_NO_PAD.encode(
        json!({
            "v": "2", "ps": "x", "add": "1.2.3.4", "port": "443",
            "id": "01234567-89ab-cdef-0123-456789abcdef", "aid": "0",
            "scy": "auto", "net": "ws", "type": "none", "host": "1.2.3.4",
            "path": "/", "tls": "tls", "sni": ""
        })
        .to_string(),
    );
    let v = parse_link(&format!("vmess://{}#x", blob)).expect("must parse");
    println!("vmess tls.server_name => {:?}", v["tls"]["server_name"]);
    check_singbox("vmess_empty_sni", &v);
}

#[test]
fn core_hy2_alpn_and_obfs() {
    let without = parse_link("hysteria2://password@1.2.3.4:443?sni=x.com#y").expect("must parse");
    println!("hy2 no alpn => {}", serde_json::to_string(&without["tls"]).unwrap());
    check_singbox("hy2_no_alpn", &without);

    let mut with_alpn = parse_link("hysteria2://password@1.2.3.4:443?sni=x.com&alpn=h3#y").expect("must parse");
    with_alpn["tls"]["alpn"] = json!(["h3"]);
    check_singbox("hy2_alpn_h3", &with_alpn);

    // what sing-box expects for salamander obfs
    let mut with_obfs = parse_link("hysteria2://password@1.2.3.4:443?sni=x.com#y").expect("must parse");
    with_obfs["obfs"] = json!({"type": "salamander", "password": "secret"});
    check_singbox("hy2_obfs_salamander", &with_obfs);
}

#[test]
fn core_tuic_alpn() {
    let without = parse_link("tuic://01234567-89ab-cdef-0123-456789abcdef:pw@1.2.3.4:443?sni=x.com#y")
        .expect("must parse");
    println!("tuic tls => {}", serde_json::to_string(&without["tls"]).unwrap());
    check_singbox("tuic_no_alpn", &without);

    let mut with_alpn = without.clone();
    with_alpn["tls"]["alpn"] = json!(["h3"]);
    check_singbox("tuic_alpn_h3", &with_alpn);
}

#[test]
fn core_vmess_scy_none() {
    // server is set to security none, link says scy none, parser hardcodes "auto"
    let mut auto = parse_link("vmess://eyJ2IjoiMiIsInBzIjoieCIsImFkZCI6IjEuMi4zLjQiLCJwb3J0IjoiNDQzIiwiaWQiOiIwMTIzNDU2Ny04OWFiLWNkZWYtMDEyMy00NTY3ODlhYmNkZWYiLCJhaWQiOiIwIiwic2N5Ijoibm9uZSIsIm5ldCI6InRjcCIsInR5cGUiOiJub25lIiwiaG9zdCI6IiIsInBhdGgiOiIiLCJ0bHMiOiIiLCJzbmkiOiIifQ==").expect("must parse");
    println!("parser security (link said scy=none) => {:?}", auto["security"]);
    auto["tls"] = json!({"enabled": true, "server_name": "x.com", "insecure": true});
    check_singbox("vmess_scy_link_none_parser_auto", &auto);

    let mut manual_none = auto.clone();
    manual_none["security"] = json!("none");
    check_singbox("vmess_security_none", &manual_none);
}

#[test]
fn core_xray_h2_host_array() {
    // Simulate what xray_config_to_link should have produced for httpSettings.host = [array]
    let mut p = parse_link("vless://01234567-89ab-cdef-0123-456789abcdef@1.2.3.4:443?security=tls&sni=h.example.com&type=h2&path=%2Fh2&host=a.example.com#H").expect("must parse");
    p["transport"]["host"] = json!(["a.example.com", "b.example.com"]);
    check_xray("vless_h2_host_array", &p);
}

#[test]
fn core_reality_roundtrip() {
    // The round-tripped reality config loses TLS entirely -- check the no-tls vless outbound
    // against xray to show it is a config that cannot possibly work.
    let cfg = json!({
        "remarks": "R",
        "outbounds": [{
            "tag": "proxy", "protocol": "vless",
            "settings": { "vnext": [{ "address": "1.2.3.4", "port": 443,
                "users": [{ "id": "01234567-89ab-cdef-0123-456789abcdef", "flow": "xtls-rprx-vision" }] }] },
            "streamSettings": { "network": "tcp", "security": "reality",
                "realitySettings": { "serverName": "r.example.com", "publicKey": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "shortId": "ab", "fingerprint": "chrome" } }
        }]
    });
    let l = xray_config_to_link(&cfg).expect("must convert");
    println!("reality converted link => {}", l);
    let p = parse_link(&l).expect("must reparse");
    println!("reality reparsed tls => {:?}", p.get("tls"));
    // xray form of the reparsed (broken) outbound
    let xr = json!({
        "tag": "proxy", "protocol": "vless",
        "settings": { "vnext": [{ "address": "1.2.3.4", "port": 443,
            "users": [{ "id": "01234567-89ab-cdef-0123-456789abcdef", "flow": "xtls-rprx-vision", "encryption": "none" }] }] },
        "streamSettings": { "network": "tcp", "security": "none" }
    });
    check_xray("reality_roundtrip_lost_tls", &xr);
}

#[test]
fn core_plain_becomes_tls() {
    let cfg = json!({
        "remarks": "P",
        "outbounds": [{
            "tag": "proxy", "protocol": "vless",
            "settings": { "vnext": [{ "address": "1.2.3.4", "port": 80,
                "users": [{ "id": "01234567-89ab-cdef-0123-456789abcdef" }] }] },
            "streamSettings": { "network": "tcp", "security": "" }
        }]
    });
    let l = xray_config_to_link(&cfg).expect("must convert");
    println!("plain converted link => {}", l);
    let p = parse_link(&l).expect("must reparse");
    println!("plain reparsed => {}", serde_json::to_string_pretty(&p).unwrap());
}

#[test]
fn core_ss_link_shapes() {
    // SIP002 standard, the shape every modern ss link uses
    println!(
        "SIP002 ss://aes-128-gcm:password@1.2.3.4:8388 => {:?}",
        parse_link("ss://aes-128-gcm:password@1.2.3.4:8388#x")
    );
    // legacy full-base64 (classic shadowsocks shape)
    println!(
        "legacy ss://base64(all) => {:?}",
        parse_link("ss://YWVzLTI1Ni1nY206dGVzdEAxLjIuMy40OjgzODg=#x")
    );
    // what the url crate does with the legacy blob
    let u = url::Url::parse("ss://YWVzLTI1Ni1nY206dGVzdEAxLjIuMy40OjgzODg=#x").unwrap();
    println!(
        "legacy: host_str={:?} username={:?} port={:?}",
        u.host_str(),
        u.username(),
        u.port()
    );
    let u2 = url::Url::parse("ss://aes-128-gcm:password@1.2.3.4:8388#x").unwrap();
    println!(
        "SIP002: host_str={:?} username={:?} port={:?}",
        u2.host_str(),
        u2.username(),
        u2.port()
    );
}

#[test]
fn core_hy2_tuic_encoded_password() {
    // url crate keeps userinfo percent-encoded -- confirm both parsers leave %40 in place
    let hy2 = parse_link("hysteria2://p%40ss@1.2.3.4:443?sni=x.com#y").expect("must parse");
    println!("hy2 password from link p%40ss => {:?}", hy2["password"]);
    let tuic = parse_link("tuic://01234567-89ab-cdef-0123-456789abcdef:p%40ss@1.2.3.4:443?sni=x.com#y")
        .expect("must parse");
    println!("tuic password from link p%40ss => {:?}", tuic["password"]);
    let vless = parse_link("vless://01234567-89ab-cdef-0123-456789abcdef@1.2.3.4:443?encryption=none#x")
        .expect("must parse");
    println!("vless uuid => {:?}", vless["uuid"]);
}

// The shape the user reported dead: post-quantum VLESS encryption, plaintext httpupgrade
// (security=none), and a path that is nothing but the early-data marker. Answers three
// questions at once: does the parser keep the encryption, does the link really select
// sing-box, and does sing-box accept the resulting outbound at all.
#[test]
fn core_postquantum_httpupgrade() {
    let link = "vless://01234567-89ab-cdef-0123-456789abcdef@lq.example.com:2082\
?encryption=mlkem768x25519plus.native.0rtt.5TVW2D35ZGXXMpNGTg-xDNIN1fypsMOmGiMK1yueKFA\
&security=none&type=httpupgrade&headerType=none&path=%3Fed%3D2560&host=cdn.example.com#pq";
    let p = parse_link(link).expect("must parse");
    println!("parsed encryption => {:?}", p.get("encryption"));
    println!("parsed transport => {}", serde_json::to_string(&p["transport"]).unwrap());
    println!("parsed tls => {:?}", p.get("tls"));
    println!("link_transport_requires_xray => {}", link_transport_requires_xray(&p));

    // The outbound sing-box would actually receive, after clean_singbox_proxy.
    let sb = clean_singbox_proxy(p.clone());
    println!("singbox outbound => {}", serde_json::to_string(&sb).unwrap());
    check_singbox("pq_httpupgrade", &sb);

    // And the xray form, for the case where the user picks the xray core explicitly.
    let (xr, _) = generate_xray_config(link, 2080, None, false).expect("must build an xray config");
    let xr_outbound = &xr["outbounds"][0];
    println!("xray outbound => {}", serde_json::to_string_pretty(xr_outbound).unwrap());
    check_xray("pq_httpupgrade", xr_outbound);
}

// The Fastly-CDN shape the user reported dead on xray: spoofed SNI (sni=speedtest.net) over a
// CDN host, with pinSHA256 asserting the cert the CDN actually presents. `run -test` only
// parses the config, so it says nothing about the handshake; this runs the core for real and
// pushes a request through it, which is the only way to tell a name-check rejection from a
// network problem.
//
// Each caller picks its own port: two invocations sharing one meant the second core could not
// bind and reported "no listener" for a config that was fine. The same reason it has to reap
// strays of its own name first -- a core left over from a previous test run holds the port and
// the new one exits at startup, which reads here as the config under test failing to listen.
// `run_core` builds an xray-shaped config (socks inbound). sing-box needs its own shape, and its
// `run` verb takes the same `-c file`. Keeping the two shapes apart matters because a TLS
// verification failure only shows up on a real handshake, never on `check`.
fn run_core_named(name: &str, exe: &str, cfg: &Value, port: u16, secs: u64) -> String {
    let _ = Command::new("taskkill")
        .args(["/F", "/IM", exe, "/T"])
        .creation_flags(0x0800_0000)
        .output();
    std::thread::sleep(std::time::Duration::from_millis(200));

    let temp = std::env::temp_dir().join("vxray_audit");
    let _ = std::fs::create_dir_all(&temp);
    let p = temp.join(format!("live_{}.json", name));
    std::fs::write(&p, serde_json::to_string(cfg).unwrap()).unwrap();
    let bin = bin_dir();
    let mut cmd = Command::new(bin.join(exe));
    cmd.arg("run").arg("-c").arg(p.to_string_lossy().as_ref());
    cmd.creation_flags(0x0800_0000);
    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let mut child = cmd.spawn().unwrap();

    // Poll for the listener instead of sleeping a fixed gap: a core that exited on a bad config
    // never binds, and a fixed sleep would hide that behind a "no listener" line that reads like
    // a slow start. The cap is long enough for a real cold start, short enough to keep the test
    // honest about which of the two it was.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    let mut bound = false;
    while std::time::Instant::now() < deadline {
        if std::net::TcpStream::connect_timeout(
            &format!("127.0.0.1:{}", port).parse().unwrap(),
            std::time::Duration::from_millis(300),
        )
        .is_ok()
        {
            bound = true;
            break;
        }
        if child.try_wait().ok().flatten().is_some() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(150));
    }
    if !bound {
        println!(
            "[{}] listener never came up on {} (core exited: {})",
            name,
            port,
            child.try_wait().ok().flatten().is_some()
        );
    }

    let req = format!(
        "GET http://www.gstatic.com/generate_204 HTTP/1.1\r\nHost: www.gstatic.com\r\nConnection: close\r\n\r\n"
    );
    if bound {
        if let Ok(mut s) = std::net::TcpStream::connect_timeout(
            &format!("127.0.0.1:{}", port).parse().unwrap(),
            std::time::Duration::from_secs(3),
        ) {
            // Minimal SOCKS5 handshake: greet, ask for the domain, then the request.
            let _ = s.write_all(&[5, 1, 0]);
            let mut g = [0u8; 2];
            let _ = s.read_exact(&mut g);
            let host = b"www.gstatic.com";
            let mut reqb = vec![5, 1, 0, 3, host.len() as u8];
            reqb.extend_from_slice(host);
            reqb.extend_from_slice(&[0, 80]);
            let _ = s.write_all(&reqb);
            let mut r = [0u8; 10];
            let _ = s.read_exact(&mut r);
            let _ = s.write_all(req.as_bytes());
            let _ = s.set_read_timeout(Some(std::time::Duration::from_secs(secs)));
            let mut buf = Vec::new();
            let _ = s.read_to_end(&mut buf);
            println!("[{}] response through proxy: {} bytes", name, buf.len());
            if !buf.is_empty() {
                println!(
                    "[{}] first line: {}",
                    name,
                    String::from_utf8_lossy(&buf).lines().next().unwrap_or("")
                );
            }
        } else {
            println!("[{}] listener vanished before the request", name);
        }
    }
    let _ = child.kill();
    let out = child.wait_with_output().unwrap();
    // Xray writes its log to stdout and sing-box to stderr, and a TLS handshake failure is the
    // one line this harness exists to catch, so joining them is the only way both cores report.
    format!(
        "{}\n{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    )
}

#[test]
fn core_fastly_ws_both_cores_live_handshake() {
    // The ws Fastly pair is the interesting one: xhttp forces xray, but plain ws does not, so the
    // app used to send it to sing-box. sing-box has no field for a certificate hash at all
    // (SingboxOutboundService.cs consumes only `certificate` PEM chains and REALITY), so the pin
    // the link carries is silently dropped and the spoofed SNI is left to be verified by name --
    // which cannot work, because the cert on the wire belongs to the CDN, not to speedtest.net.
    //
    // What the probe separates, and why it is kept: the three runs land at three different layers,
    // and only the middle one is a working client.
    //   sing-box, no pin  -> "tls: failed to verify certificate: x509: certificate is valid for
    //     default.ssl.fastly.net, *.hosts.fastly.net, *.fastly.com, not speedtest.net". The link
    //     is dead before the proxy protocol is ever spoken.
    //   xray, a wrong pin  -> "peer cert is unrecognized (against pinnedPeerCertSha256)". This is
    //     the control: xray is genuinely comparing the live cert to the hash, not ignoring it.
    //   xray, the link's pin -> no TLS line at all. The handshake completes and the only error
    //     left is "failed to decode response header", which is the server refusing the dummy UUID
    //     this probe substitutes for the live one. With the real UUID the link connects.
    let link = "vless://01234567-89ab-cdef-0123-456789abcdef@nvme.kakeroo.ir:443\
?encryption=none&security=tls&sni=speedtest.net&fp=chrome&alpn=h2&insecure=0&allowInsecure=0\
&pcs=CD6E838B9BFE31CAB8B3D5C858B0D6223FE84ECE236C1FDB281BE93C302E1E6E\
&type=ws&host=JABAT.global.ssl.fastly.net&path=%2F#wsfx";

    let (mut xr, _) = generate_xray_config(link, 20796, None, false).expect("must build xray config");
    // `warning` does not print the TLS handshake error that answers the question this probe exists
    // to ask, so raise the floor for the run only.
    xr["log"]["loglevel"] = json!("info");
    println!(
        "xray tlsSettings as built => {}",
        serde_json::to_string(&xr["outbounds"][0]["streamSettings"]["tlsSettings"]).unwrap()
    );
    let log = run_core_named("fastly_ws_xray", "xray.exe", &xr, 20797, 8);
    let mut hit = false;
    for line in log.lines() {
        if line.contains("tls") || line.contains("TLS") || line.contains("certificate")
            || line.contains("failed") || line.contains("Failed") || line.contains("dial")
        {
            println!("[xray  ws] {}", line.trim());
            hit = true;
        }
    }
    if !hit {
        println!("[xray  ws] (no tls/certificate/failed line in the log)");
        for line in log.lines().take(12) {
            println!("[xray  ws raw] {}", line.trim());
        }
    }

    // The sing-box side: the pin is dropped because the core cannot express it. This is the
    // config the app would have built before the fix forced pinned links onto xray, and the
    // probe is what proves that path dead -- insecure follows the link's own flag, which is 0.
    let p = parse_link(link).expect("must parse");
    println!(
        "link_transport_requires_xray => {} (a pin forces xray)",
        link_transport_requires_xray(&p)
    );
    let sb = clean_singbox_proxy(p);
    println!("sing-box tls as built => {}", serde_json::to_string(&sb["tls"]).unwrap());
    let sb_cfg = json!({
        "log": {"level": "warning"},
        "inbounds": [{"type": "mixed", "tag": "in", "listen": "127.0.0.1", "listen_port": 20797}],
        "outbounds": [sb, {"type": "direct", "tag": "direct"}],
        "route": {"final": "proxy"}
    });
    let log = run_core_named("fastly_ws_singbox", "sing-box.exe", &sb_cfg, 20797, 8);
    let mut hit = false;
    for line in log.lines() {
        if line.contains("tls") || line.contains("TLS") || line.contains("certificate")
            || line.contains("failed") || line.contains("Failed")
        {
            println!("[sbox  ws] {}", line.trim());
            hit = true;
        }
    }
    if !hit {
        println!("[sbox  ws] (no tls/certificate/failed line in the log)");
    }

    // Whether the pin itself is being honoured, not just accepted: the same xray config with a
    // hash that cannot be the server's certificate has to be refused at the handshake, while the
    // hash the link carried has to be the one that passes. A live cert that neither hash matches
    // would mean the pin is stale and the fix cannot rescue the link on either core.
    let mut wrong = xr.clone();
    wrong["outbounds"][0]["streamSettings"]["tlsSettings"]["pinnedPeerCertSha256"] =
        json!("0000000000000000000000000000000000000000000000000000000000000000");
    let log = run_core_named("fastly_ws_wrongpin", "xray.exe", &wrong, 20797, 8);
    let mut wrong_lines = Vec::new();
    for line in log.lines() {
        if line.contains("tls") || line.contains("TLS") || line.contains("certificate")
            || line.contains("failed") || line.contains("Failed")
        {
            wrong_lines.push(line.trim().to_string());
        }
    }
    if wrong_lines.is_empty() {
        println!("[xray wrongpin] (no tls/certificate/failed line in the log)");
    } else {
        for line in &wrong_lines {
            println!("[xray wrongpin] {line}");
        }
    }
}

#[test]
fn core_fastly_xhttp_live_handshake() {
    // The xhttp Fastly link already forced xray (xhttp is Xray-only), so the core choice was never
    // its problem -- the dropped pin was. It is kept as the second leg of the ws probe above: same
    // CDN, same spoofed SNI, same pin, and the transport that already ran on the right core and
    // still could not connect. If the pin reaches `pinnedPeerCertSha256` the handshake completes
    // here; the `allowInsecure: true` this used to inject is what Xray 26.3.27 refuses at load.
    let link = "vless://01234567-89ab-cdef-0123-456789abcdef@NVME.kakeroo.ir:443\
?encryption=none&security=tls&type=xhttp&headerType=none&host=cjfdaqqq.global.ssl.fastly.net\
&mode=auto&sni=speedtest.net&fp=chrome\
&pinSHA256=CD6E838B9BFE31CAB8B3D5C858B0D6223FE84ECE236C1FDB281BE93C302E1E6E&alpn=h2#fx";
    let (mut cfg, _) = generate_xray_config(link, 20798, None, false).expect("must build xray config");
    let tls = &cfg["outbounds"][0]["streamSettings"]["tlsSettings"];
    println!("xray tlsSettings => {}", serde_json::to_string(tls).unwrap());
    assert!(
        tls.get("pinnedPeerCertSha256").is_some(),
        "the xhttp Fastly link must carry the pin into the xray config"
    );
    assert_ne!(
        tls.get("allowInsecure"),
        Some(&json!(true)),
        "allowInsecure:true is refused at load by Xray 26.3.27 and takes the whole core down"
    );

    cfg["log"]["loglevel"] = json!("info");
    let log = run_core_named("fastly_xhttp", "xray.exe", &cfg, 20799, 8);
    for line in log.lines() {
        if line.contains("tls")
            || line.contains("TLS")
            || line.contains("certificate")
            || line.contains("failed")
            || line.contains("Failed")
        {
            println!("[xray xhttp] {}", line.trim());
        }
    }
}
#[test]
fn core_postquantum_trojan() {
    let link = "trojan://password123@tj.example.com:443\
?encryption=mlkem768x25519plus.native.0rtt.5TVW2D35ZGXXMpNGTg-xDNIN1fypsMOmGiMK1yueKFA\
&security=tls&sni=tj.example.com&type=ws&host=tj.example.com&path=%2Ftj#pqt";
    let p = parse_trojan(link).expect("must parse");
    println!("trojan encryption => {:?}", p.get("encryption"));
    println!("trojan requires_xray => {}", link_transport_requires_xray(&p));
    assert_eq!(
        p.get("encryption").and_then(|e| e.as_str()).unwrap_or(""),
        "mlkem768x25519plus.native.0rtt.5TVW2D35ZGXXMpNGTg-xDNIN1fypsMOmGiMK1yueKFA",
        "parse_trojan must keep the post-quantum encryption so the router can see it"
    );
    assert!(
        link_transport_requires_xray(&p),
        "a trojan link with post-quantum encryption must route to xray"
    );

    let (xr, _) = generate_xray_config(link, 2080, None, false).expect("must build an xray config");
    let user = &xr["outbounds"][0]["settings"]["servers"][0];
    println!("xray trojan server => {}", serde_json::to_string(user).unwrap());
    assert_eq!(
        user["encryption"],
        json!("mlkem768x25519plus.native.0rtt.5TVW2D35ZGXXMpNGTg-xDNIN1fypsMOmGiMK1yueKFA"),
        "the xray trojan server entry has to carry the key agreement"
    );
    check_xray("pq_trojan", &xr["outbounds"][0]);
}

// The regression guard: ordinary `encryption=none` is on nearly every VLESS link in the wild,
// and it must NOT force xray, or the per-app rules that only sing-box can match would be
// silently dropped for every standard server.
#[test]
fn plain_encryption_none_does_not_force_xray() {
    let plain = parse_link(
        "vless://01234567-89ab-cdef-0123-456789abcdef@1.2.3.4:443?encryption=none&security=tls&sni=x.com&type=ws#p",
    )
    .expect("must parse");
    assert!(
        !link_transport_requires_xray(&plain),
        "encryption=none is the standard VLESS parameter and must stay on sing-box"
    );
}

// The TUN sidecar is what actually breaks when a mode toggle report says "connected but no
// internet": the UI shows the adapter up, but the sidecar is a sing-box process that exits at
// startup on any field its schema rejects, and the machine is then left with the system proxy
// cleared and no route at all. `check` parses the whole config, so this catches a shape an
// outbound-only probe cannot see. strict_route on, because that is the variant that exercises
// route_exclude_address, and a domain server, because that adds the dns-direct rule.
#[test]
fn core_tun_sidecar_config_is_valid() {
    let settings = crate::core::settings::Settings::default();
    for strict in [true, false] {
        let cfg = generate_tun_config(
            2080,
            "vless://01234567-89ab-cdef-0123-456789abcdef@example.com:443?encryption=none&security=tls&sni=x.com#t",
            None,
            false,
            strict,
            "https://1.1.1.1/dns-query".to_string(),
            "8.8.8.8".to_string(),
            Some(&settings),
        );
        println!(
            "tun cfg (strict={}) => {}",
            strict,
            serde_json::to_string(&cfg["inbounds"][0]).unwrap()
        );
        assert!(
            check_singbox_full(&format!("tun_strict_{}", strict), &cfg),
            "sing-box must accept the TUN sidecar config the app generates"
        );
    }
}

// Same for the stat-tracker that fronts an xray core: if it rejects its config the whole
// xray-in-TUN path dies at startup, and the symptom is the same cleared-proxy no-route state.
#[test]
fn core_tracker_config_is_valid() {
    let cfg = tracker_config(2080);
    assert!(
        check_singbox_full("tracker", &cfg),
        "sing-box must accept the stat-tracker config"
    );
}

// The vocabulary diff against v2rayN's BaseFmt.ResolveUriQuery, which is the reference parser
// the user's working configs are built against. Every name listed there is a parameter a
// subscription can legitimately emit; each one our parser silently drops is a config that
// connects in v2rayN and is dead here. Printing what we actually kept makes the gap visible
// instead of being inferred from a link that fails for an unrelated reason.
#[test]
fn core_v2rayn_parameter_coverage() {
    // A VLESS link carrying one of every query parameter v2rayN documents.
    let link = "vless://01234567-89ab-cdef-0123-456789abcdef@server.example.com:443\
?encryption=none&flow=xtls-rprx-vision&security=tls&sni=s.example.com&alpn=h2%2Chttp%2F1.1\
&fp=chrome&pbk=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&sid=ab&spx=%2F\
&pqv=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\
&ech=%2Fdns-query&vcn=s.example.com\
&pcs=CD6E838B9BFE31CAB8B3D5C858B0D6223FE84ECE236C1FDB281BE93C302E1E6E\
&insecure=1&allowInsecure=1&allow_insecure=1\
&type=ws&host=cdn.example.com&path=%2Fws%3Fed%3D2048#full";
    let p = parse_vless(link).expect("must parse");
    println!(
        "kept => {}",
        serde_json::to_string_pretty(&p).unwrap()
    );

    // Every name v2rayN reads off the query string. If one is missing from the parsed object
    // entirely, it is dropped on the floor -- the link works in v2rayN and is dead here.
    let carried = [
        "encryption", "flow", "security", "sni", "alpn", "fp", "pbk", "sid", "spx", "pqv",
        "ech", "vcn", "pcs", "type", "host", "path",
    ];
    for name in carried {
        let in_tls = p.get("tls").map(|t| t.get(name).is_some()).unwrap_or(false);
        let in_transport = p
            .get("transport")
            .map(|t| t.get(name).is_some())
            .unwrap_or(false);
        let top = p.get(name).is_some();
        println!(
            "[coverage] {:<12} {}",
            name,
            if top || in_tls || in_transport { "KEPT" } else { "DROPPED" }
        );
    }

    // Three spellings of the skip-verify flag, and v2rayN accepts all of them. A link using a
    // spelling we do not read gets a strict cert check it was never meant to have.
    for (label, query) in [
        ("insecure", "insecure=1"),
        ("allowInsecure", "allowInsecure=1"),
        ("allow_insecure", "allow_insecure=1"),
    ] {
        let l = format!(
            "vless://01234567-89ab-cdef-0123-456789abcdef@server.example.com:443?security=tls&sni=s.example.com&{}#i",
            query
        );
        let p = parse_vless(&l).expect("must parse");
        println!(
            "[insecure spelling {}] tls.insecure => {}",
            label, p["tls"]["insecure"]
        );
    }
}

// Probes one TLS field at a time against both cores, so a parameter we are about to start
// carrying can be matched to the schema that actually takes it. Sing-box and Xray spell these
// differently and neither documents the overlap; asking the binary is the only source that does
// not go stale.
//
// Both checkers want the outbound in their own shape, so the sing-box column goes through
// clean_singbox_proxy (which is what strips the tcp transport 1.10 no longer has) and the xray
// column through generate_xray_config. Feeding one core the other's outbound rejects everything
// for the shape, and the field under test is never actually examined.
#[test]
fn core_advanced_tls_fields() {
    let base_link = "vless://01234567-89ab-cdef-0123-456789abcdef@server.example.com:443?security=tls&sni=s.example.com#base";

    // ECH: sing-box spells it tls.ech, Xray uses echConfigList. `ech` in the link is a
    // DNS-over-HTTPS URL or a PEM list, not a boolean.
    let mut ech_sb = clean_singbox_proxy(parse_link(base_link).expect("must parse"));
    ech_sb["tls"]["ech"] = json!({"enabled": true, "config": ["-----BEGIN EC-----\nAAAA\n-----END EC-----\n"]});
    check_singbox("ech_singbox", &ech_sb);

    let (mut xr, _) = generate_xray_config(base_link, 2080, None, false).expect("must build");
    xr["outbounds"][0]["streamSettings"]["tlsSettings"]["echConfigList"] =
        json!(["-----BEGIN EC-----\nAAAA\n-----END EC-----\n"]);
    xr["outbounds"][0]["streamSettings"]["tlsSettings"]["echForceQuery"] = json!("full");
    check_xray("ech_xray", &xr["outbounds"][0]);

    // Verify-by-name (`vcn`) and the cert pin (`pcs`): Xray-only shapes.
    let (mut xr2, _) = generate_xray_config(base_link, 2080, None, false).expect("must build");
    xr2["outbounds"][0]["streamSettings"]["tlsSettings"]["verifyPeerCertByName"] =
        json!("s.example.com");
    check_xray("vcn_xray", &xr2["outbounds"][0]);

    let (mut xr3, _) = generate_xray_config(base_link, 2080, None, false).expect("must build");
    xr3["outbounds"][0]["streamSettings"]["tlsSettings"]["pinnedPeerCertSha256"] =
        json!("CD6E838B9BFE31CAB8B3D5C858B0D6223FE84ECE236C1FDB281BE93C302E1E6E");
    check_xray("pcs_xray", &xr3["outbounds"][0]);

    // REALITY's post-quantum signature (`pqv`) and spider path (`spx`).
    let reality_link = "vless://01234567-89ab-cdef-0123-456789abcdef@server.example.com:443?security=reality&sni=s.example.com&pbk=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&sid=ab#r";
    let reality = parse_link(reality_link).expect("must parse");
    check_singbox("reality_singbox", &clean_singbox_proxy(reality.clone()));

    let (mut xr4, _) = generate_xray_config(reality_link, 2080, None, false).expect("must build");
    println!(
        "reality xray streamSettings => {}",
        serde_json::to_string(&xr4["outbounds"][0]["streamSettings"]).unwrap()
    );
    check_xray("reality_xray", &xr4["outbounds"][0]);

    let (mut xr5, _) = generate_xray_config(reality_link, 2080, None, false).expect("must build");
    xr5["outbounds"][0]["streamSettings"]["realitySettings"]["mldsa65Verify"] =
        json!("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    check_xray("reality_pqv_xray", &xr5["outbounds"][0]);
    // The checker prints the trimmed stderr, but xray's real reason for a reject can be further
    // up; dump the whole outbound so the field spelling under test is visible next to the result.
    println!(
        "pqv outbound => {}",
        serde_json::to_string(&xr5["outbounds"][0]["streamSettings"]).unwrap()
    );
    let (mut xr7, _) = generate_xray_config(base_link, 2080, None, false).expect("must build");
    xr7["outbounds"][0]["streamSettings"]["tlsSettings"]["echConfigList"] =
        json!("-----BEGIN EC-----\nAAAA\n-----END EC-----\n");
    xr7["outbounds"][0]["streamSettings"]["tlsSettings"]["echForceQuery"] = json!("full");
    println!(
        "ech outbound => {}",
        serde_json::to_string(&xr7["outbounds"][0]["streamSettings"]).unwrap()
    );
    check_xray("ech_xray_str", &xr7["outbounds"][0]);

    // Sing-box's spellings for the same parameters, so the parser's intermediate names can be
    // mapped onto what that core reads. It takes the pin as a certificate array and has no
    // verify-by-name equivalent.
    let mut sb_pin = clean_singbox_proxy(parse_link(base_link).expect("must parse"));
    sb_pin["tls"]["certificate"] =
        json!(["-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n"]);
    check_singbox("cert_singbox", &sb_pin);

    let mut sb_vcn = clean_singbox_proxy(parse_link(base_link).expect("must parse"));
    sb_vcn["tls"]["verify_peer_cert_by_name"] = json!("s.example.com");
    check_singbox("vcn_singbox", &sb_vcn);

    let mut sb_ech_url = clean_singbox_proxy(parse_link(base_link).expect("must parse"));
    sb_ech_url["tls"]["ech"] = json!({"enabled": true, "config": ["https://1.1.1.1/dns-query"]});
    check_singbox("ech_url_singbox", &sb_ech_url);

    // The parser now keeps cert_sha256 as an intermediate name; sing-box has to reject it if it
    // is not one of its own, and clean_singbox_proxy has to be the thing that drops it.
    let mut sb_sha = clean_singbox_proxy(parse_link(base_link).expect("must parse"));
    sb_sha["tls"]["cert_sha256"] =
        json!("CD6E838B9BFE31CAB8B3D5C858B0D6223FE84ECE236C1FDB281BE93C302E1E6E");
    check_singbox("cert_sha256_singbox", &sb_sha);
}

// The regression this whole sweep exists for. Xray 26.3.27 removed `allowInsecure` outright --
// the config fails to load with "The feature allowInsecure has been removed and migrated to
// pinnedPeerCertSha256" -- so emitting it does not merely fail the handshake, it stops the core
// from starting at all. A spoofed-SNI CDN link has to carry its own pin into the xray config.
#[test]
fn core_pin_survives_xray_conversion() {
    let link = "vless://01234567-89ab-cdef-0123-456789abcdef@NVME.kakeroo.ir:443\
?encryption=none&security=tls&type=xhttp&headerType=none&host=cjfdaqqq.global.ssl.fastly.net\
&mode=auto&sni=speedtest.net&fp=chrome\
&pinSHA256=CD6E838B9BFE31CAB8B3D5C858B0D6223FE84ECE236C1FDB281BE93C302E1E6E&alpn=h2#fx";
    let parsed = parse_link(link).expect("must parse");
    assert_eq!(
        parsed["tls"]["cert_sha256"],
        json!("CD6E838B9BFE31CAB8B3D5C858B0D6223FE84ECE236C1FDB281BE93C302E1E6E"),
        "the parser has to keep the pin's value, not just its presence -- xray names the cert"
    );

    let (xr, _) = generate_xray_config(link, 2080, None, false).expect("must build xray config");
    let tls = &xr["outbounds"][0]["streamSettings"]["tlsSettings"];
    println!("xray tlsSettings => {}", serde_json::to_string(tls).unwrap());
    assert!(
        tls.get("allowInsecure").is_none(),
        "allowInsecure is gone from Xray 26.3.27 and its presence fails config load"
    );
    assert_eq!(
        tls["pinnedPeerCertSha256"],
        json!("CD6E838B9BFE31CAB8B3D5C858B0D6223FE84ECE236C1FDB281BE93C302E1E6E"),
        "the pin has to land in xray's current field or the spoofed SNI is refused"
    );
    check_xray("pin_xray", &xr["outbounds"][0]);
}

// The v2rayN parameters that need both a parser change and a conversion change: each is kept
// under its own name on the way in, emitted in the core's spelling on the way out, and dropped
// by clean_singbox_proxy if the other core does not know it. One case per family, because a
// fix that lands only the pin is the bug this one replaced.
#[test]
fn core_advanced_params_roundtrip() {
    let link = "vless://01234567-89ab-cdef-0123-456789abcdef@server.example.com:443\
?encryption=none&security=tls&sni=s.example.com&fp=chrome&alpn=h2\
&insecure=1&vcn=s.example.com&ech=AAAA#adv";
    let p = parse_link(link).expect("must parse");
    let tls = &p["tls"];
    println!("parsed tls => {}", serde_json::to_string(tls).unwrap());
    assert_eq!(tls["insecure"], json!(true), "insecure=1 must be honoured");
    assert_eq!(
        tls["verify_peer_cert_by_name"],
        json!("s.example.com"),
        "vcn must be kept"
    );
    assert!(tls.get("ech").is_some(), "ech must be kept");

    // The sing-box path must still load: clean_singbox_proxy drops the xray-only names.
    let sb = clean_singbox_proxy(p.clone());
    println!("singbox tls => {}", serde_json::to_string(&sb["tls"]).unwrap());
    assert!(sb["tls"].get("cert_sha256").is_none());
    assert!(sb["tls"].get("verify_peer_cert_by_name").is_none());
    assert!(sb["tls"].get("ech").is_some(), "ech is a sing-box field too");
    check_singbox("advanced_singbox", &sb);

    // The xray path must carry them into xray's own spellings.
    let (xr, _) = generate_xray_config(link, 2080, None, false).expect("must build");
    let xt = &xr["outbounds"][0]["streamSettings"]["tlsSettings"];
    println!("xray tlsSettings => {}", serde_json::to_string(xt).unwrap());
    assert!(xt.get("allowInsecure").is_none(), "removed in 26.3.27");
    assert_eq!(xt["verifyPeerCertByName"], json!("s.example.com"));
    assert!(xt.get("echConfigList").is_some());
    check_xray("advanced_xray", &xr["outbounds"][0]);
}

// The posture a sing-box-only link asks for when it pins a certificate AND explicitly refuses to
// skip verification. Sing-box has no hash-pin field, so the pin cannot be honoured on this path --
// the only thing left that the link can still get is the strict verification it asked for. If a
// present pin were read as permission to skip the check, a link that said "verify, and here is the
// cert I expect" would connect against any certificate, including a substituted one.
#[test]
fn hy2_pin_plus_explicit_insecure_zero_keeps_verification() {
    const PIN: &str = "CD6E838B9BFE31CAB8B3D5C858B0D6223FE84ECE236C1FDB281BE93C302E1E6E";
    let link = format!(
        "hysteria2://letmein@example.com:443/?insecure=0&pinSHA256={PIN}&sni=example.com#p"
    );
    let p = parse_link(&link).expect("must parse");
    assert_eq!(
        p["tls"]["insecure"],
        json!(false),
        "an explicit insecure=0 must outrank a present pin on the sing-box-only protocols"
    );
    assert_eq!(p["tls"]["cert_sha256"], json!(PIN), "the pin's value is kept for the xray path");

    // The sing-box pass drops the pin (no field) but must not also lose the verification request.
    let sb = clean_singbox_proxy(p);
    assert!(sb["tls"].get("cert_sha256").is_none(), "sing-box has no hash-pin field");
    assert_eq!(
        sb["tls"]["insecure"],
        json!(false),
        "the explicit verification posture has to survive into the config the core loads"
    );
    check_singbox("hy2_pin_insecure0", &sb);
}

// The same posture over TUIC, which is also sing-box-only. One case per family: a fix that only
// covered hy2 would leave tuic quietly inverted.
#[test]
fn tuic_pin_plus_explicit_insecure_zero_keeps_verification() {
    const PIN: &str = "CD6E838B9BFE31CAB8B3D5C858B0D6223FE84ECE236C1FDB281BE93C302E1E6E";
    let link = format!(
        "tuic://01234567-89ab-cdef-0123-456789abcdef:pw@example.com:443/?insecure=0&pinSHA256={PIN}&sni=example.com#p"
    );
    let p = parse_link(&link).expect("must parse");
    assert_eq!(
        p["tls"]["insecure"],
        json!(false),
        "the pin must not be allowed to flip an explicit insecure=0 on tuic either"
    );
    let sb = clean_singbox_proxy(p);
    assert!(sb["tls"].get("cert_sha256").is_none());
    assert_eq!(sb["tls"]["insecure"], json!(false));
    check_singbox("tuic_pin_insecure0", &sb);
}

// The control: the pin still earns its skip-verify when the link says nothing about verification.
// The explicit-wins rule must not regress the CDN-fronted case the pin exists for.
#[test]
fn hy2_pin_alone_still_skips_the_name_check() {
    const PIN: &str = "CD6E838B9BFE31CAB8B3D5C858B0D6223FE84ECE236C1FDB281BE93C302E1E6E";
    let link = format!(
        "hysteria2://letmein@example.com:443/?pinSHA256={PIN}&sni=speedtest.net#p"
    );
    let p = parse_link(&link).expect("must parse");
    assert_eq!(
        p["tls"]["insecure"],
        json!(true),
        "a pin with no explicit insecure flag is permission to skip the name check"
    );
}

// ===== TEMPORARY TAG-REFERENCE AUDIT =====
// Walks every config the builders can produce and resolves every outbound / inbound / DNS-server
// reference, then feeds the whole matrix to the real binaries. Printed lines are the report.

fn tags_in(arr: &[Value]) -> std::collections::HashSet<String> {
    arr.iter()
        .filter_map(|o| o.get("tag").and_then(|t| t.as_str()).map(|s| s.to_string()))
        .collect()
}

fn as_str_list(v: &Value) -> Vec<String> {
    match v {
        Value::String(s) => vec![s.clone()],
        Value::Array(a) => a.iter().filter_map(|x| x.as_str().map(String::from)).collect(),
        _ => vec![],
    }
}

/// Resolves every cross-reference in one generated config. Returns the list of broken refs.
fn broken_refs(name: &str, cfg: &Value) -> Vec<String> {
    let mut out = vec![];
    let is_xray = cfg.get("__core__").and_then(|v| v.as_str()) == Some("xray");

    let outbounds = cfg.get("outbounds").and_then(|o| o.as_array());
    let inbounds = cfg.get("inbounds").and_then(|o| o.as_array());
    let outbound_tags: std::collections::HashSet<String> =
        outbounds.map(|a| tags_in(a)).unwrap_or_default();
    let inbound_tags: std::collections::HashSet<String> = inbounds.map(|a| tags_in(a)).unwrap_or_default();

    let (rules_key, sub_key) = if is_xray { ("routing", "rules") } else { ("route", "rules") };
    let rules = cfg
        .get(rules_key)
        .and_then(|r| r.get(sub_key))
        .and_then(|r| r.as_array());

    if let Some(rules) = rules {
        for (i, r) in rules.iter().enumerate() {
            let ob = if is_xray { r.get("outboundTag") } else { r.get("outbound") };
            if let Some(o) = ob.and_then(|o| o.as_str()) {
                if !outbound_tags.contains(o) {
                    out.push(format!("{name}: rule[{i}] -> outbound \"{o}\" (no such outbound)"));
                }
            }
            let ib = if is_xray { r.get("inboundTag") } else { r.get("inbound") };
            for t in as_str_list(&ib.cloned().unwrap_or(Value::Null)) {
                if !inbound_tags.contains(&t) {
                    out.push(format!("{name}: rule[{i}] -> inbound \"{t}\" (no such inbound)"));
                }
            }
        }
    }

    if let Some(f) = cfg.get(rules_key).and_then(|r| r.get("final")).and_then(|f| f.as_str()) {
        if !outbound_tags.contains(f) {
            out.push(format!("{name}: {rules_key}.final -> \"{f}\" (no such outbound)"));
        }
    }

    let dns = match cfg.get("dns") {
        Some(d) => d,
        None => return out,
    };
    let server_tags: std::collections::HashSet<String> =
        dns.get("servers").and_then(|s| s.as_array()).map(|a| tags_in(a)).unwrap_or_default();
    if let Some(rules) = dns.get("rules").and_then(|r| r.as_array()) {
        for (i, r) in rules.iter().enumerate() {
            if let Some(s) = r.get("server").and_then(|s| s.as_str()) {
                if !server_tags.contains(s) {
                    out.push(format!("{name}: dns.rule[{i}] -> server \"{s}\" (no such dns server)"));
                }
            }
        }
    }
    if let Some(f) = dns.get("final").and_then(|f| f.as_str()) {
        if !server_tags.contains(f) {
            out.push(format!("{name}: dns.final -> \"{f}\" (no such dns server)"));
        }
    }
    out
}

fn check_full(name: &str, cfg: &Value) -> bool {
    let is_xray = cfg.get("__core__").and_then(|v| v.as_str()) == Some("xray");
    let mut c = cfg.clone();
    if let Some(obj) = c.as_object_mut() {
        obj.remove("__core__");
    }
    let temp = std::env::temp_dir().join("vxray_audit");
    let _ = std::fs::create_dir_all(&temp);
    let p = temp.join(format!("audit_{name}.json"));
    std::fs::write(&p, serde_json::to_string(&c).unwrap()).unwrap();

    let bin = bin_dir();
    let (exe, args): (&str, Vec<&str>) = if is_xray {
        ("xray.exe", vec!["run", "-test", "-c"])
    } else {
        ("sing-box.exe", vec!["check", "-c"])
    };
    let o = Command::new(bin.join(exe))
        .args(args)
        .arg(p.to_string_lossy().as_ref())
        .creation_flags(0x0800_0000)
        .output()
        .unwrap();
    let ok = o.status.success();
    println!(
        "[{}] {} {}",
        if is_xray { "xray " } else { "sb   " },
        name,
        if ok {
            "ACCEPT".to_string()
        } else {
            format!("REJECT: {}", String::from_utf8_lossy(&o.stderr).trim())
        }
    );
    ok
}

fn dns_route_agreement(name: &str, cfg: &Value, settings: &crate::core::settings::Settings) {
    // Every domain the DNS rules send to the local resolver must be routed direct (or block),
    // and every domain sent to the remote resolver must be routed through the proxy. A mismatch
    // is the silent double-tunnel / half-loaded page.
    let is_xray = cfg.get("__core__").and_then(|v| v.as_str()) == Some("xray");
    let dns_rules = cfg.get("dns").and_then(|d| d.get("rules")).and_then(|r| r.as_array());
    let route_rules = cfg
        .get(if is_xray { "routing" } else { "route" })
        .and_then(|r| r.get("rules"))
        .and_then(|r| r.as_array());

    let local_server = if is_xray { "" } else { "dns_local" };
    let mut dns_local: Vec<String> = vec![];
    let mut dns_remote: Vec<String> = vec![];
    // The two cores spell the split differently. sing-box resolves through named servers in
    // `dns.rules`; xray pins a domain list to a resolver inside each `dns.servers` entry and
    // never names one. Reading the xray form through the sing-box one would report every user
    // rule missing, and the check would stop meaning anything on that core.
    if is_xray {
        if let Some(servers) = cfg.get("dns").and_then(|d| d.get("servers")).and_then(|s| s.as_array()) {
            let local_addr = "1.1.1.1".to_string();
            let remote_addr = "8.8.8.8".to_string();
            for s in servers {
                let obj = match s.as_object() {
                    Some(o) => o,
                    None => continue, // the unpinned fallback entry is a bare address string
                };
                let addr = obj.get("address").and_then(|a| a.as_str()).unwrap_or("");
                let doms = as_str_list(&obj.get("domains").cloned().unwrap_or(Value::Null));
                if addr == local_addr {
                    dns_local.extend(doms);
                } else if addr == remote_addr {
                    dns_remote.extend(doms);
                }
            }
        }
    } else if let Some(rules) = dns_rules {
        for r in rules {
            let srv = r.get("server").and_then(|s| s.as_str()).unwrap_or("");
            for d in as_str_list(&r.get("domain_suffix").cloned().unwrap_or(Value::Null)) {
                if srv == local_server || srv == "dns-direct" {
                    dns_local.push(d);
                } else if srv == "dns_remote" || srv == "dns-remote" {
                    dns_remote.push(d);
                }
            }
        }
    }

    // The presets (Iran) legitimately appear in the local resolver list and also in a direct route
    // rule, so compare only the domains that came from user rules -- those are the ones the two
    // builders build from the same source list.
    let user_local: Vec<String> = settings
        .routing_rules
        .iter()
        .filter(|r| {
            r.enabled
                && r.kind != "process"
                && matches!(r.action.as_str(), "bypass" | "direct" | "block")
        })
        .filter_map(|r| {
            let p = r.pattern.trim();
            if p.is_empty() || is_ip_or_cidr(p) {
                None
            } else {
                Some(p.trim_start_matches("*.").to_string())
            }
        })
        .collect();
    let user_proxy: Vec<String> = settings
        .routing_rules
        .iter()
        .filter(|r| r.enabled && r.kind != "process" && r.action == "proxy")
        .filter_map(|r| {
            let p = r.pattern.trim();
            if p.is_empty() || is_ip_or_cidr(p) {
                None
            } else {
                Some(p.trim_start_matches("*.").to_string())
            }
        })
        .collect();

    for d in &user_local {
        if !dns_local.iter().any(|x| x == d) {
            println!("[AGREE-FAIL {name}] bypass rule \"{d}\" is NOT in the local-resolver DNS list");
        }
    }
    for d in &user_proxy {
        if !dns_remote.iter().any(|x| x == d) {
            println!("[AGREE-FAIL {name}] proxy rule \"{d}\" is NOT in the remote-resolver DNS list");
        }
    }

    // And the route side: a user proxy domain must be routed to the proxy outbound. The TUN
    // sidecar is exempt -- it routes by process and forwards everything else to the main core,
    // which holds the domain rules, so a sidecar with no domain route is correct and a check
    // that demanded one would report every server on every link.
    if let Some(rules) = route_rules {
        if !name.starts_with("tun_") {
        for d in &user_proxy {
            let routed_proxy = rules.iter().any(|r| {
                let doms = if is_xray {
                    as_str_list(&r.get("domain").cloned().unwrap_or(Value::Null))
                        .into_iter()
                        .map(|x| x.trim_start_matches("domain:").to_string())
                        .collect::<Vec<_>>()
                } else {
                    as_str_list(&r.get("domain_suffix").cloned().unwrap_or(Value::Null))
                };
                let ob = if is_xray {
                    r.get("outboundTag").and_then(|o| o.as_str()).unwrap_or("")
                } else {
                    r.get("outbound").and_then(|o| o.as_str()).unwrap_or("")
                };
                doms.iter().any(|x| x == d) && ob == "proxy"
            });
            if !routed_proxy {
                println!("[AGREE-FAIL {name}] proxy rule \"{d}\" is NOT routed to the proxy outbound");
            }
        }
        }
    }
}

#[test]
fn audit_all_configs() {
    use crate::core::settings::{RoutingRule, Settings};

    let links: Vec<(&str, &str)> = vec![
        ("vless_ws", "vless://01234567-89ab-cdef-0123-456789abcdef@example.com:443?encryption=none&security=reality&sni=example.com&fp=chrome&pbk=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&sid=ab&type=ws&host=example.com&path=%2Fpath#t"),
        ("vless_xhttp", "vless://01234567-89ab-cdef-0123-456789abcdef@example.com:443?encryption=none&security=tls&type=xhttp&host=example.com&path=%2Fx&mode=packet-up#x"),
        ("vless_tcphttp", "vless://01234567-89ab-cdef-0123-456789abcdef@example.com:443?encryption=none&type=tcp&headerType=http&host=example.com&path=%2Fh#th"),
        ("vless_grpc", "vless://01234567-89ab-cdef-0123-456789abcdef@grpc.example.com:443?encryption=none&security=reality&sni=grpc.example.com&pbk=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&sid=ab&type=grpc&serviceName=grpcsvc#g"),
        ("vless_h2", "vless://01234567-89ab-cdef-0123-456789abcdef@h2.example.com:443?encryption=none&security=tls&sni=h2.example.com&type=h2&host=h2.example.com&path=%2Fh2#h2"),
        ("vless_httpupgrade", "vless://01234567-89ab-cdef-0123-456789abcdef@hu.example.com:443?encryption=none&security=tls&sni=hu.example.com&type=httpupgrade&host=hu.example.com&path=%2Fhu#hu"),
        ("vmess_tls", "vmess://eyJ2IjoiMiIsInBzIjoidm0iLCJhZGQiOiJ2bS5leGFtcGxlLmNvbSIsInBvcnQiOiI0NDMiLCJpZCI6IjAxMjM0NTY3LTg5YWItY2RlZi0wMTIzLTQ1Njc4OWFiY2RlZiIsImFpZCI6IjAiLCJuZXQiOiJ3cyIsInR5cGUiOiJub25lIiwiaG9zdCI6InZtLmV4YW1wbGUuY29tIiwicGF0aCI6Ii92bSIsInRscyI6InRscyIsInNuaSI6InZtLmV4YW1wbGUuY29tIn0="),
        ("trojan_tls", "trojan://password123@tj.example.com:443?security=tls&sni=tj.example.com&type=ws&host=tj.example.com&path=%2Ftj#tj"),
        ("ss", "ss://YWVzLTI1Ni1nY206dGVzdA==@1.2.3.4:8388#ss"),
        ("hy2", "hysteria2://password@hy.example.com:443?sni=hy.example.com#hy"),
        ("tuic", "tuic://01234567-89ab-cdef-0123-456789abcdef@tu.example.com:443?sni=tu.example.com#tu"),
        // The post-quantum key is the real one `xray vlessenc mlkem768x25519plus` prints, so this
        // exercises the encryption path against the core instead of a placeholder that only proves
        // the parser does not crash.
        ("vless_pq", "vless://01234567-89ab-cdef-0123-456789abcdef@example.com:443?encryption=mlkem768x25519plus.native.0rtt.AI5XgGUSIPTwmYjoGkhwc_VKtW2irElwBgpmIvucnhY&security=tls&sni=example.com&type=ws&host=example.com&path=%2Fp#pq"),
        ("trojan_pq", "trojan://password123@tj.example.com:443?encryption=mlkem768x25519plus.native.0rtt.AI5XgGUSIPTwmYjoGkhwc_VKtW2irElwBgpmIvucnhY&security=tls&sni=tj.example.com&type=ws&host=tj.example.com&path=%2Ft#pq"),
        // A truncated key used to panic xray (`slice bounds out of range`), and a release build
        // aborts on that, so this link would have taken the whole core down. It has to reach
        // `none` and still load.
        ("vless_pq_badkey", "vless://01234567-89ab-cdef-0123-456789abcdef@example.com:443?encryption=mlkem768x25519plus.native.0rtt.xxx&security=tls&sni=example.com&type=ws&host=example.com&path=%2Fp#pqb"),
        ("vless_reality_tcp", "vless://01234567-89ab-cdef-0123-456789abcdef@1.2.3.4:443?encryption=none&security=reality&sni=example.com&pbk=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&sid=ab&flow=xtls-rprx-vision#pr"),
    ];

    let mk_rules = || -> Vec<RoutingRule> {
        vec![
            RoutingRule { id: "d1".into(), pattern: "bypassed.com".into(), action: "bypass".into(), kind: "domain".into(), enabled: true },
            RoutingRule { id: "d2".into(), pattern: "proxied.com".into(), action: "proxy".into(), kind: "domain".into(), enabled: true },
            RoutingRule { id: "d3".into(), pattern: "*.wild.com".into(), action: "direct".into(), kind: "domain".into(), enabled: true },
            RoutingRule { id: "d4".into(), pattern: "10.20.30.0/24".into(), action: "block".into(), kind: "domain".into(), enabled: true },
            RoutingRule { id: "p1".into(), pattern: "C:\\Telegram\\Telegram.exe".into(), action: "proxy".into(), kind: "process".into(), enabled: true },
        ]
    };

    let mut settings_variants: Vec<(&str, Settings)> = vec![
        ("default", Settings::default()),
        ("ads", { let mut s = Settings::default(); s.block_ads = true; s }),
        ("proxy_only", { let mut s = Settings::default(); s.proxy_only_mode = true; s }),
        ("xray_choice", { let mut s = Settings::default(); s.core_choice = "xray".to_string(); s }),
        ("xray_choice_ads", { let mut s = Settings::default(); s.core_choice = "xray".to_string(); s.block_ads = true; s.proxy_only_mode = true; s }),
        ("named_doh", { let mut s = Settings::default(); s.remote_dns = "https://dns.google/dns-query".to_string(); s.local_dns = "https://dns.cloudflare.com/dns-query".to_string(); s }),
        ("rules", { let mut s = Settings::default(); s.routing_rules = mk_rules(); s }),
        ("rules_xray", { let mut s = Settings::default(); s.core_choice = "xray".to_string(); s.routing_rules = mk_rules(); s }),
        ("rules_proxy_only", { let mut s = Settings::default(); s.proxy_only_mode = true; s.routing_rules = mk_rules(); s }),
        ("empty_dns", { let mut s = Settings::default(); s.remote_dns = String::new(); s.local_dns = String::new(); s }),
        ("plain_ip_dns", { let mut s = Settings::default(); s.remote_dns = "1.1.1.1".to_string(); s.local_dns = "8.8.8.8".to_string(); s }),
    ];

    let mut all_broken: Vec<String> = vec![];
    let mut any_reject = false;

    for (lname, link) in &links {
        for (sname, s) in &mut settings_variants {
            let tag = format!("{lname}_{sname}");
            let (cfg, _ip, is_xray) = match generate_config(link, 2080, Some(s), false) {
                Ok(t) => t,
                Err(e) => {
                    println!("[BUILD-FAIL {tag}] {e}");
                    continue;
                }
            };
            all_broken.extend(broken_refs(&tag, &cfg));
            dns_route_agreement(&tag, &cfg, s);
            if !check_full(&tag, &cfg) {
                any_reject = true;
            }

            // TUN sidecar for the same combination, both legs and both exact_ip states.
            for exact in [Some("1.2.3.4".to_string()), None] {
                for strict in [true, false] {
                    let ttag = format!("tun_{tag}_{}", if exact.is_some() { "ip" } else { "noip" });
                    let tun = generate_tun_config(
                        2080,
                        link,
                        exact.clone(),
                        is_xray,
                        strict,
                        s.remote_dns.clone(),
                        s.local_dns.clone(),
                        Some(s),
                    );
                    all_broken.extend(broken_refs(&ttag, &tun));
                    dns_route_agreement(&ttag, &tun, s);
                    if !check_full(&ttag, &tun) {
                        any_reject = true;
                    }
                }
            }
        }
    }

    // The stat-tracker and the two test-config builders.
    all_broken.extend(broken_refs("tracker", &tracker_config(2080)));
    if !check_full("tracker", &tracker_config(2080)) {
        any_reject = true;
    }
    let test_links: Vec<String> = links.iter().map(|(_, l)| l.to_string()).collect();
    let mass = generate_mass_test_config(test_links, 25000);
    all_broken.extend(broken_refs("mass_test", &mass));
    if !check_full("mass_test", &mass) {
        any_reject = true;
    }
    for (lname, link) in &links {
        let single = generate_single_test_config(link, 30000);
        let stag = format!("single_{lname}");
        all_broken.extend(broken_refs(&stag, &single));
        if !check_full(&stag, &single) {
            any_reject = true;
        }
    }

    println!("\n===== BROKEN REFERENCES: {} =====", all_broken.len());
    for b in &all_broken {
        println!("  {b}");
    }
    println!("===== ANY REJECT: {any_reject} =====");
    assert!(all_broken.is_empty(), "broken cross-references found");
}

#[test]
fn audit_vless_grpc_authority() {
    // The CDN-fronted REALITY-over-gRPC shape: `authority` names the :authority the CDN edge routes
    // the call on. sing-box's GRPCOutboundOptions has no such field and answers
    // `outbounds[0].transport.authority: json: unknown field "authority"`, which exits the whole
    // core at startup -- every server in the profile dies over one link, and the mass test with it.
    // clean_singbox_proxy's grpc arm has to strip it before it reaches that core.
    let link = "vless://01234567-89ab-cdef-0123-456789abcdef@grpc.example.com:443\
?encryption=none&security=reality&sni=grpc.example.com&fp=chrome\
&pbk=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&sid=ab\
&type=grpc&serviceName=grpcsvc&authority=front.cdn.example.com&mode=multi#ga";
    let p = parse_link(link).expect("must parse");
    println!(
        "grpc authority -> intermediate transport = {}",
        serde_json::to_string(&p["transport"]).unwrap()
    );
    assert_eq!(p["transport"]["authority"], "front.cdn.example.com");
    assert_eq!(p["transport"]["mode"], "multi");
    // A CDN-fronted gRPC call has to run on xray: sing-box's GRPCOutboundOptions has no
    // `authority` field, so the sanitiser below strips it to keep the core alive and the front is
    // lost -- the edge routes on a name the client never sent. Xray 26.3.27 reads it natively.
    assert!(link_transport_requires_xray(&p));

    // The outbound sing-box actually receives.
    let sb = clean_singbox_proxy(p.clone());
    println!(
        "grpc authority -> singbox transport = {}",
        serde_json::to_string(&sb["transport"]).unwrap()
    );
    assert!(sb["transport"].get("authority").is_none());
    assert!(sb["transport"].get("mode").is_none());
    assert_eq!(sb["transport"]["service_name"], "grpcsvc");
    check_singbox("vless_grpc_authority", &sb);

    // The mass test builds one file for the whole batch, so a field that escapes the sanitiser
    // would read every other server in the batch dead alongside this one.
    let mass = generate_mass_test_config(vec![link.to_string()], 31000);
    check_singbox_full("mass_grpc_authority", &mass);

    // And the xray core still gets authority, since it is Xray's own spelling.
    let (xr, _) = generate_xray_config(link, 2080, None, false).expect("must build");
    println!(
        "grpc authority -> xray grpcSettings = {}",
        serde_json::to_string(&xr["outbounds"][0]["streamSettings"]["grpcSettings"]).unwrap()
    );
    assert_eq!(
        xr["outbounds"][0]["streamSettings"]["grpcSettings"]["authority"],
        "front.cdn.example.com"
    );
    check_xray("vless_grpc_authority_xray", &xr["outbounds"][0]);
}

// ==== VMess link-parser audit: parameters v2rayN honours that Vxray drops ====

fn vmess_blob_link(blob: &Value) -> String {
    let b64 = base64::engine::general_purpose::STANDARD_NO_PAD.encode(blob.to_string());
    format!("vmess://{}#x", b64)
}

#[test]
fn audit_vmess_kcp_blob() {
    // v2rayN maps blob net=kcp to the mKCP transport: `type` is the header flavour and `path` the
    // seed (VmessFmt.cs:121-133). Vxray's blob reader has no kcp arm, so the catch-all flattens it
    // to TCP and both are lost.
    let link = vmess_blob_link(&json!({
        "v": "2", "ps": "kcp", "add": "1.2.3.4", "port": "443",
        "id": "01234567-89ab-cdef-0123-456789abcdef", "aid": "0",
        "scy": "auto", "net": "kcp", "type": "srtp", "host": "",
        "path": "the-seed", "tls": "", "sni": ""
    }));
    let p = parse_link(&link).expect("must parse");
    println!("kcp blob -> transport = {}", serde_json::to_string(&p["transport"]).unwrap());
    println!("kcp blob -> requires_xray = {}", link_transport_requires_xray(&p));

    // What the link becomes on the xray core.
    let (xr, _) = generate_xray_config(&link, 2080, None, false).expect("must build");
    println!(
        "kcp blob -> xray streamSettings = {}",
        serde_json::to_string(&xr["outbounds"][0]["streamSettings"]).unwrap()
    );
    check_xray("vmess_kcp_flattened", &xr["outbounds"][0]);

    // What it would have been if the parser had kept kcp: v2rayN's kcpSettings shape, which xray
    // accepts -- proving the transport itself is supported and the loss is in the parser.
    let with_kcp = json!({
        "tag": "proxy", "protocol": "vmess",
        "settings": { "vnext": [{ "address": "1.2.3.4", "port": 443,
            "users": [{ "id": "01234567-89ab-cdef-0123-456789abcdef", "alterId": 0, "security": "auto" }] }] },
        "streamSettings": { "network": "kcp", "security": "none",
            "kcpSettings": { "mtu": 1350, "tti": 20, "uplinkCapacity": 5, "downlinkCapacity": 20,
                "congestion": false, "readBufferSize": 2, "writeBufferSize": 2,
                "header": { "type": "srtp" }, "seed": "the-seed" } }
    });
    check_xray("vmess_kcp_as_v2rayn_builds_it", &with_kcp);
}

#[test]
fn audit_vmess_scy_case() {
    // v2rayN clamps scy to VmessSecurities and falls back to DefaultSecurity="auto" on anything
    // else (VmessFmt.cs:113, V2rayOutboundService.cs:97-104, Global.cs:256-263). Vxray passes the
    // raw value through to both cores, so a generator emitting an uppercase or unlisted cipher
    // connects in v2rayN and kills/refuses the core here.
    for scy in [
        "AES-128-GCM", "CHACHA20-POLY1305", "NONE", "ZERO", "aes-128-cfb", "auto", "none",
    ] {
        let link = vmess_blob_link(&json!({
            "v": "2", "ps": "c", "add": "1.2.3.4", "port": "443",
            "id": "01234567-89ab-cdef-0123-456789abcdef", "aid": "0",
            "scy": scy, "net": "tcp", "type": "none", "host": "", "path": "", "tls": "", "sni": ""
        }));
        let p = parse_link(&link).expect("must parse");
        let passed = p["security"].as_str().unwrap_or("");
        let sb = clean_singbox_proxy(p.clone());
        let sb_ok = check_singbox(&format!("vmess_scy_{scy}"), &sb);
        let (xr, _) = generate_xray_config(&link, 2080, None, false).expect("must build");
        let xr_ok = check_xray(&format!("vmess_scy_{scy}"), &xr["outbounds"][0]);
        println!(
            "scy={scy:20} passed_through={passed:20} sing-box={} xray={}",
            if sb_ok { "ACCEPT" } else { "REJECT" },
            if xr_ok { "ACCEPT" } else { "REJECT" }
        );
    }
}

// The user's own server list, with the live UUID swapped for the probe dummy. Every one of these
// connects in v2rayN; the question is which core each lands on here and whether that core accepts
// the config the app actually builds for it. Answers print as CORE / ACCEPT / REJECT per link.
#[test]
fn user_links_report() {
    let links = [
        // Fastly CDN, spoofed SNI, pinned cert, h2
        "vless://01234567-89ab-cdef-0123-456789abcdef@nvme.kakeroo.ir:443?encryption=none&security=tls&sni=speedtest.net&fp=chrome&alpn=h2&insecure=0&allowInsecure=0&pcs=CD6E838B9BFE31CAB8B3D5C858B0D6223FE84ECE236C1FDB281BE93C302E1E6E&type=ws&host=JABAT.global.ssl.fastly.net&path=%2F#a",
        "vless://01234567-89ab-cdef-0123-456789abcdef@nvme.kakeroo.ir:443?encryption=none&security=tls&sni=speedtest.net&fp=chrome&alpn=h2&insecure=0&allowInsecure=0&pcs=CD6E838B9BFE31CAB8B3D5C858B0D6223FE84ECE236C1FDB281BE93C302E1E6E&type=ws&host=SWITERLANDSZURICH.global.ssl.fastly.net&path=%2F#b",
        "vless://01234567-89ab-cdef-0123-456789abcdef@nvme.kakeroo.ir:443?encryption=none&security=tls&sni=speedtest.net&fp=chrome&alpn=h2&insecure=0&allowInsecure=0&pcs=CD6E838B9BFE31CAB8B3D5C858B0D6223FE84ECE236C1FDB281BE93C302E1E6E&type=xhttp&host=cjfdaqqq.global.ssl.fastly.net&path=%2F&mode=auto#c",
        // mastermarly / appleseraj, ws + early data
        "vless://01234567-89ab-cdef-0123-456789abcdef@erosan.appleseraj.ir:443?encryption=none&security=tls&sni=BUL33N.mastermarly.ir&fp=firefox&insecure=0&allowInsecure=0&type=ws&host=BUL33N.mastermarly.ir&path=%3Fed%3D2560#d",
        "vless://01234567-89ab-cdef-0123-456789abcdef@lq.mastermarly.ir:443?encryption=none&security=tls&sni=LKONAnot.mastermarly.ir&fp=firefox&insecure=0&allowInsecure=0&type=ws&host=LKONAnot.mastermarly.ir&path=%3Fed%3D2048#e",
        "vless://01234567-89ab-cdef-0123-456789abcdef@erosan.appleseraj.ir:443?encryption=none&security=tls&sni=cumara.mastermarly.ir&fp=firefox&insecure=0&allowInsecure=0&type=ws&host=cumara.mastermarly.ir&path=%3Fed%3D2048#f",
        "vless://01234567-89ab-cdef-0123-456789abcdef@erosan.appleseraj.ir:443?encryption=none&security=tls&sni=falmo.mastermarly.ir&fp=firefox&insecure=0&allowInsecure=0&type=ws&host=falmo.mastermarly.ir&path=%3Fed%3D2048#g",
        // post-quantum httpupgrade, plaintext (security=none), amki.ir hosts
        "vless://01234567-89ab-cdef-0123-456789abcdef@erosan.appleseraj.ir:2052?encryption=mlkem768x25519plus.native.0rtt.3T-r7QwAKlx2azINqc6KbjweO7oTlRkvSdbOcQP7Pwk&security=none&type=httpupgrade&host=sw247.amki.ir&path=%3Fed%3D2560#h",
        "vless://01234567-89ab-cdef-0123-456789abcdef@lq.mastermarly.ir:2052?encryption=mlkem768x25519plus.native.0rtt.3T-r7QwAKlx2azINqc6KbjweO7oTlRkvSdbOcQP7Pwk&security=none&type=httpupgrade&host=TIBANI.amki.ir&path=%3Fed%3D2048#i",
        "vless://01234567-89ab-cdef-0123-456789abcdef@erosan.appleseraj.ir:2052?encryption=mlkem768x25519plus.native.0rtt.3T-r7QwAKlx2azINqc6KbjweO7oTlRkvSdbOcQP7Pwk&security=none&type=httpupgrade&host=AASCLO.amki.ir&path=%3Fed%3D2560#j",
        "vless://01234567-89ab-cdef-0123-456789abcdef@lq.mastermarly.ir:2052?encryption=mlkem768x25519plus.native.0rtt.3T-r7QwAKlx2azINqc6KbjweO7oTlRkvSdbOcQP7Pwk&security=none&type=httpupgrade&host=vavacr.amki.ir&path=%3Fed%3D2560#k",
        "vless://01234567-89ab-cdef-0123-456789abcdef@lq.mastermarly.ir:2052?encryption=mlkem768x25519plus.native.0rtt.3T-r7QwAKlx2azINqc6KbjweO7oTlRkvSdbOcQP7Pwk&security=none&type=httpupgrade&host=DOCANSAAA.amki.ir&path=%3Fed%3D2560#l",
        "vless://01234567-89ab-cdef-0123-456789abcdef@erosan.appleseraj.ir:2052?encryption=mlkem768x25519plus.native.0rtt.3T-r7QwAKlx2azINqc6KbjweO7oTlRkvSdbOcQP7Pwk&security=none&type=httpupgrade&host=NEW2027.amki.ir&path=%3Fed%3D2560#m",
        "vless://01234567-89ab-cdef-0123-456789abcdef@erosan.appleseraj.ir:2052?encryption=mlkem768x25519plus.native.0rtt.3T-r7QwAKlx2azINqc6KbjweO7oTlRkvSdbOcQP7Pwk&security=none&type=httpupgrade&host=irlandoo.amki.ir&path=%3Fed%3D2560#n",
        "vless://01234567-89ab-cdef-0123-456789abcdef@erosan.appleseraj.ir:2082?encryption=mlkem768x25519plus.native.0rtt.5TVW2D35ZGXXMpNGTg-xDNIN1fypsMOmGiMK1yueKFA&security=none&type=httpupgrade&host=CHZ.amki.ir&path=%3Fed%3D2048#o",
    ];

    for (i, link) in links.iter().enumerate() {
        let tag = link.rsplit('#').next().unwrap_or("?");
        match parse_link(link) {
            None => {
                println!("[{i:>2} {tag}] PARSE FAILED");
                continue;
            }
            Some(p) => {
                let needs_xray = link_transport_requires_xray(&p);
                println!(
                    "[{i:>2} {tag}] transport={} sni={} requires_xray={}",
                    p["transport"]["type"],
                    p["tls"]["server_name"],
                    needs_xray
                );
                match generate_config(link, 20790 + i as u16, None, false) {
                    Err(e) => println!("      GENERATE ERROR: {e}"),
                    Ok((cfg, _, used_xray)) => {
                        let core = cfg["__core__"].as_str().unwrap_or("?");
                        if used_xray {
                            let ok = check_xray(&format!("user{i}"), &cfg["outbounds"][0]);
                            println!("      CORE={core} requires_xray={needs_xray} => {}",
                                if ok { "ACCEPT" } else { "REJECT" });
                            if !ok {
                                let ss = &cfg["outbounds"][0]["streamSettings"];
                                println!("      streamSettings = {}", serde_json::to_string(ss).unwrap());
                            }
                        } else {
                            let ok = check_singbox(&format!("user{i}"), &cfg["outbounds"][0]);
                            println!("      CORE={core} requires_xray={needs_xray} => {}",
                                if ok { "ACCEPT" } else { "REJECT" });
                            if !ok {
                                println!("      outbound = {}", serde_json::to_string(&cfg["outbounds"][0]).unwrap());
                            }
                        }
                    }
                }
            }
        }
    }
}

// The TUN sidecar is a sing-box binary that has to accept the *full* config, not one outbound --
// a field it rejects anywhere kills the process at startup, and from the UI that reads as "TUN is
// on but there is no internet". This runs the whole config for each of the user's link shapes.
#[test]
fn user_links_tun_config_report() {
    let links = [
        "vless://01234567-89ab-cdef-0123-456789abcdef@nvme.kakeroo.ir:443?encryption=none&security=tls&sni=speedtest.net&fp=chrome&alpn=h2&insecure=0&allowInsecure=0&pcs=CD6E838B9BFE31CAB8B3D5C858B0D6223FE84ECE236C1FDB281BE93C302E1E6E&type=ws&host=JABAT.global.ssl.fastly.net&path=%2F#a",
        "vless://01234567-89ab-cdef-0123-456789abcdef@erosan.appleseraj.ir:443?encryption=none&security=tls&sni=BUL33N.mastermarly.ir&fp=firefox&insecure=0&allowInsecure=0&type=ws&host=BUL33N.mastermarly.ir&path=%3Fed%3D2560#d",
        "vless://01234567-89ab-cdef-0123-456789abcdef@erosan.appleseraj.ir:2052?encryption=mlkem768x25519plus.native.0rtt.3T-r7QwAKlx2azINqc6KbjweO7oTlRkvSdbOcQP7Pwk&security=none&type=httpupgrade&host=sw247.amki.ir&path=%3Fed%3D2560#h",
        "vless://01234567-89ab-cdef-0123-456789abcdef@erosan.appleseraj.ir:2052?encryption=mlkem768x25519plus.native.0rtt.3T-r7QwAKlx2azINqc6KbjweO7oTlRkvSdbOcQP7Pwk&security=none&type=httpupgrade&host=AASCLO.amki.ir&path=%3Fed%3D2560#j",
    ];
    for (i, link) in links.iter().enumerate() {
        let tag = link.rsplit('#').next().unwrap_or("?");
        // is_xray follows the real connect path: the pin and the post-quantum encryption both
        // force xray, and the sidecar is handed that choice, not a guess.
        let p = parse_link(link).expect("must parse");
        let is_xray = link_transport_requires_xray(&p);
        let cfg = generate_tun_config(
            2080,
            link,
            Some("1.2.3.4".into()),
            is_xray,
            true,
            "https://dns.google/dns-query".to_string(),
            "8.8.8.8".to_string(),
            None,
        );
        let ok = check_singbox_full(&format!("user_tun{i}_{tag}"), &cfg);
        println!(
            "[tun {tag:>2}] is_xray={is_xray} => {}",
            if ok { "ACCEPT" } else { "REJECT" }
        );
    }
}

// The config checking clean is not the same as the adapter coming up. This runs the sidecar the
// way `start_tun_core` does and prints the log lines that decide which one it was, so a TUN that
// shows on and routes nothing has a recorded reason instead of a guess.
#[test]
fn tun_sidecar_startup_probe() {
    let link = "vless://01234567-89ab-cdef-0123-456789abcdef@nvme.kakeroo.ir:443\
?encryption=none&security=tls&sni=speedtest.net&fp=chrome&alpn=h2&insecure=0&allowInsecure=0\
&pcs=CD6E838B9BFE31CAB8B3D5C858B0D6223FE84ECE236C1FDB281BE93C302E1E6E\
&type=ws&host=JABAT.global.ssl.fastly.net&path=%2F#wsfx";
    let cfg = generate_tun_config(
        2080,
        link,
        Some("1.2.3.4".into()),
        true,
        true,
        "https://dns.google/dns-query".to_string(),
        "8.8.8.8".to_string(),
        None,
    );
    let log = run_tun_sidecar("fastly", &cfg, 4);
    let mut printed = false;
    for line in log.lines() {
        let l = line.trim();
        if l.is_empty() {
            continue;
        }
        if l.contains("tun") || l.contains("TUN") || l.contains("error")
            || l.contains("ERROR") || l.contains("warn") || l.contains("WARN")
            || l.contains("wintun") || l.contains("Wintun") || l.contains("route")
        {
            println!("[tun-probe] {l}");
            printed = true;
        }
    }
    if !printed {
        println!("[tun-probe] (log had no tun/error/route line; first 10 lines follow)");
        for line in log.lines().take(10) {
            if !line.trim().is_empty() {
                println!("[tun-probe raw] {}", line.trim());
            }
        }
    }

    // The probe either comes up clean or fails at the adapter, never at the config. Creating a
    // Wintun interface needs a driver privilege the test session may lack, and the core says so
    // plainly; any other fatal line is the config -- an unknown field, a malformed route, a DNS
    // rule the schema rejects -- and is the regression this probe exists to catch. A run with no
    // fatal lines at all is the best outcome: the adapter came up, so the config carried it.
    let fatal = log
        .lines()
        .map(|l| l.trim())
        .filter(|l| l.contains("FATAL") || l.contains("ERROR"))
        .collect::<Vec<_>>();
    let benign = |l: &&str| {
        l.contains("Access is denied")
            || l.contains("access is denied")
            || l.contains("permission")
            || l.contains("elevat")
            // A probe adapter left behind by a crashed run is the same privilege story one layer
            // down: the driver cannot create it, and the config had nothing to do with it.
            || l.contains("already exists")
    };
    let config_is_bad = !fatal.is_empty() && !fatal.iter().all(benign);
    assert!(
        !config_is_bad,
        "the TUN sidecar failed for a reason other than the adapter: {}",
        fatal.join(" | ")
    );
    if fatal.is_empty() {
        println!(
            "[tun-probe] the sidecar came up and stayed up; the config carried a real adapter"
        );
    } else {
        println!(
            "[tun-probe] config is sound; the only failure is the adapter privilege, which a real \
             elevated session has"
        );
    }
}

#[test]
fn audit_vmess_std_encryption_case() {
    // The standard `vmess://uuid@host:port?encryption=` form honours `encryption` at all, and the
    // value reaches sing-box unvalidated there too.
    for enc in ["AES-128-GCM", "auto", "none", "chacha20-poly1305"] {
        let link = format!(
            "vmess://01234567-89ab-cdef-0123-456789abcdef@1.2.3.4:443?encryption={enc}&security=tls&sni=s.example.com&type=ws&host=s.example.com&path=%2Fw#e"
        );
        let p = parse_link(&link).expect("must parse");
        let sb = clean_singbox_proxy(p.clone());
        let ok = check_singbox(&format!("vmess_std_enc_{enc}"), &sb);
        println!(
            "std encryption={enc:20} parsed_security={:?} sing-box={}",
            p["security"].as_str(),
            if ok { "ACCEPT" } else { "REJECT" }
        );
    }
}

#[test]
fn audit_vmess_aid_nonzero() {
    // alterId 64 with scy absent ("auto"): does either core refuse the pairing?
    let link = vmess_blob_link(&json!({
        "v": "2", "ps": "aid", "add": "1.2.3.4", "port": "443",
        "id": "01234567-89ab-cdef-0123-456789abcdef", "aid": "64",
        "net": "tcp", "type": "none", "host": "", "path": "", "tls": "", "sni": ""
    }));
    let p = parse_link(&link).expect("must parse");
    println!(
        "aid=64 -> security={:?} alter_id={:?}",
        p["security"].as_str(),
        p["alter_id"]
    );
    check_singbox("vmess_aid64", &clean_singbox_proxy(p.clone()));
    let (xr, _) = generate_xray_config(&link, 2080, None, false).expect("must build");
    check_xray("vmess_aid64", &xr["outbounds"][0]);
}

#[test]
fn audit_vmess_sni_roundtrip() {
    // xray_config_to_link hardcodes "sni": "" for vmess (config.rs:1323), so a subscription that
    // returns full Xray JSON loses serverName on the way back through a link.
    let cfg = json!({
        "remarks": "CDN",
        "outbounds": [{
            "tag": "proxy", "protocol": "vmess",
            "settings": { "vnext": [{ "address": "198.51.100.5", "port": 443,
                "users": [{ "id": "01234567-89ab-cdef-0123-456789abcdef", "alterId": 0, "security": "auto" }] }] },
            "streamSettings": { "network": "ws", "security": "tls",
                "tlsSettings": { "serverName": "real.example.com", "alpn": ["h2", "http/1.1"],
                    "fingerprint": "chrome", "allowInsecure": false },
                "wsSettings": { "path": "/vm", "headers": { "Host": "front.example.com" } } }
        }]
    });
    let l = xray_config_to_link(&cfg).expect("must convert");
    println!("round-tripped link => {l}");
    let p = parse_link(&l).expect("must reparse");
    println!(
        "round-trip server_name = {:?}  (original serverName was \"real.example.com\")",
        p["tls"]["server_name"].as_str()
    );
    println!("round-trip alpn        = {:?}  (original was [\"h2\",\"http/1.1\"])", p["tls"].get("alpn"));
    println!("round-trip fingerprint = {:?}", p["tls"].get("utls"));
    println!(
        "round-trip host header = {:?}  (original was \"front.example.com\")",
        p["transport"]["headers"]["Host"].as_str()
    );
    check_singbox("vmess_roundtrip", &clean_singbox_proxy(p));
}

#[test]
fn audit_vmess_reality_roundtrip() {
    // The vmess blob branch only marks tls when streamSettings.security == "tls"; a reality vmess
    // config round-trips into an unencrypted link.
    let cfg = json!({
        "remarks": "R",
        "outbounds": [{
            "tag": "proxy", "protocol": "vmess",
            "settings": { "vnext": [{ "address": "1.2.3.4", "port": 443,
                "users": [{ "id": "01234567-89ab-cdef-0123-456789abcdef", "alterId": 0, "security": "auto" }] }] },
            "streamSettings": { "network": "tcp", "security": "reality",
                "realitySettings": { "serverName": "r.example.com", "publicKey": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                    "shortId": "ab", "fingerprint": "chrome" } }
        }]
    });
    let l = xray_config_to_link(&cfg).expect("must convert");
    println!("reality vmess link => {l}");
    let p = parse_link(&l).expect("must reparse");
    println!("reality vmess reparsed tls => {:?}", p.get("tls"));
}

#[test]
fn audit_vmess_std_kcp() {
    // The standard form does carry kcp (build_transport_block has the arm); where does it land?
    let link = "vmess://01234567-89ab-cdef-0123-456789abcdef@1.2.3.4:443?type=kcp&seed=the-seed&headerType=srtp&security=tls&sni=s.example.com#k";
    let p = parse_link(link).expect("must parse");
    println!(
        "std kcp -> transport = {} requires_xray = {}",
        serde_json::to_string(&p["transport"]).unwrap(),
        link_transport_requires_xray(&p)
    );
    let (xr, _) = generate_xray_config(link, 2080, None, false).expect("must build");
    println!(
        "std kcp -> xray streamSettings = {}",
        serde_json::to_string(&xr["outbounds"][0]["streamSettings"]).unwrap()
    );
    check_xray("vmess_std_kcp", &xr["outbounds"][0]);
}

#[test]
fn audit_vless_mlkem_encryption() {
    let link = "vless://28eb2ffa-81c0-450c-ae60-db87bacc0cc0@erosan.appleseraj.ir:2082?encryption=mlkem768x25519plus.native.0rtt.5TVW2D35ZGXXMpNGTg-xDNIN1fypsMOmGiMK1yueKFA&security=none&type=httpupgrade&headerType=none&path=%3Fed%3D2560&host=AASCLO.amki.ir#test";
    let p = parse_link(link).expect("must parse");
    assert!(link_transport_requires_xray(&p));
    let (xr, _) = generate_xray_config(link, 23450, None, false).expect("must generate xray config");
    assert_eq!(xr["outbounds"][0]["protocol"], "vless");
    assert_eq!(
        xr["outbounds"][0]["settings"]["vnext"][0]["users"][0]["encryption"],
        "mlkem768x25519plus.native.0rtt.5TVW2D35ZGXXMpNGTg-xDNIN1fypsMOmGiMK1yueKFA"
    );
}

#[test]
fn process_rules_generate_process_name_not_domain() {
    use crate::core::settings::{RoutingRule, Settings};

    let mut settings = Settings::default();
    settings.bypass_iran = false;
    settings.bypass_lan = false;
    settings.block_ads = false;
    settings.routing_rules = vec![
        RoutingRule {
            id: "r1".into(),
            pattern: r"C:\Users\test\AppData\Roaming\Telegram Desktop\Telegram.exe".into(),
            action: "bypass".into(),
            kind: "process".into(),
            enabled: true,
        },
        RoutingRule {
            id: "r2".into(),
            pattern: r"C:\Program Files\Google\Chrome\Application\chrome.exe".into(),
            action: "proxy".into(),
            kind: "process".into(),
            enabled: true,
        },
        RoutingRule {
            id: "r3".into(),
            pattern: "example.com".into(),
            action: "bypass".into(),
            kind: "domain".into(),
            enabled: true,
        },
    ];

    // Sing-box builder: process rules should produce process_name, domain rules should produce domain_suffix
    let sb_rules = build_singbox_routing_rules(&settings);
    // Filter out the built-in NCSI bypass rule (msftconnecttest.com) to isolate user custom rules
    let custom: Vec<&Value> = sb_rules.iter().filter(|r| {
        if r.get("process_name").is_some() { return true; }
        if let Some(ds) = r.get("domain_suffix") {
            // Exclude the NCSI bypass rule
            if let Some(arr) = ds.as_array() {
                return !arr.iter().any(|v| v.as_str() == Some("msftconnecttest.com"));
            }
        }
        false
    }).collect();
    assert_eq!(custom.len(), 3, "expected 3 custom rules (2 process + 1 domain), got: {:?}", custom);

    let tg_rule = custom.iter().find(|r| r.get("process_name").is_some() && r["process_name"][0] == "Telegram.exe").expect("must find Telegram process_name rule");
    assert_eq!(tg_rule["outbound"], "direct", "bypass action should map to direct outbound");

    let chrome_rule = custom.iter().find(|r| r.get("process_name").is_some() && r["process_name"][0] == "chrome.exe").expect("must find chrome process_name rule");
    assert_eq!(chrome_rule["outbound"], "proxy", "proxy action should map to proxy outbound");

    let domain_rule = custom.iter().find(|r| r.get("domain_suffix").is_some()).expect("must find domain_suffix rule");
    assert_eq!(domain_rule["domain_suffix"][0], "example.com");

    println!("[process-rules] sing-box rules OK: Telegram.exe->direct, chrome.exe->proxy, example.com->direct");

    // Xray builder: process rules should be SKIPPED, domain rules should still appear
    let xr_rules = build_xray_routing_rules(&settings);
    let xr_domain: Vec<&Value> = xr_rules.iter().filter(|r| r.get("domain").is_some()).collect();
    assert_eq!(xr_domain.len(), 1, "expected exactly 1 domain rule in xray output");
    // No process_name or domain rule for exe names should exist
    for r in &xr_rules {
        if let Some(domains) = r.get("domain") {
            let arr = domains.as_array().unwrap();
            for d in arr {
                let s = d.as_str().unwrap();
                assert!(!s.contains(".exe"), "xray routing must not contain .exe domain rules, found: {}", s);
            }
        }
    }
    println!("[process-rules] xray rules OK: process rules correctly skipped");

    // TUN config: process_name rules must appear in the sidecar config
    let link = "vless://01234567-89ab-cdef-0123-456789abcdef@1.2.3.4:443?encryption=none&security=tls&sni=test.com&fp=chrome&type=ws&host=test.com&path=%2F#t";
    let tun_cfg = generate_tun_config(
        2080,
        link,
        Some("1.2.3.4".into()),
        false,
        true,
        "https://dns.google/dns-query".to_string(),
        "8.8.8.8".to_string(),
        Some(&settings),
    );
    let tun_rules = tun_cfg["route"]["rules"].as_array().expect("route.rules must be array");
    let tun_process_rules: Vec<&Value> = tun_rules.iter().filter(|r| {
        r.get("process_name").map_or(false, |pn| {
            let arr = pn.as_array().unwrap();
            // Exclude the built-in sidecar bypass rule (7 internal exes)
            arr.len() <= 2
        })
    }).collect();
    assert_eq!(tun_process_rules.len(), 2, "expected 2 per-app process_name rules in TUN config, got: {:?}", tun_process_rules);

    let tun_tg = tun_process_rules.iter().find(|r| r["process_name"].as_array().unwrap().iter().any(|v| v == "Telegram.exe")).expect("TUN must have Telegram.exe rule");
    assert_eq!(tun_tg["outbound"], "direct");
    let tun_chrome = tun_process_rules.iter().find(|r| r["process_name"].as_array().unwrap().iter().any(|v| v == "chrome.exe")).expect("TUN must have chrome.exe rule");
    assert_eq!(tun_chrome["outbound"], "proxy");

    println!("[process-rules] TUN config OK: process_name rules present in sidecar routing");

    // Verify the TUN config passes sing-box schema validation
    assert!(check_singbox_full("process_rules_tun", &tun_cfg), "TUN config with process_name rules must pass sing-box check");
    println!("[process-rules] TUN config passed sing-box schema validation");
}

#[test]
fn proxy_only_mode_routing_verification() {
    use crate::core::settings::{RoutingRule, Settings};

    let link = "vless://01234567-89ab-cdef-0123-456789abcdef@1.2.3.4:443?encryption=none&security=tls&sni=test.com&fp=chrome&type=ws&host=test.com&path=%2F#t";

    // 1. Normal mode (proxy_only_mode = false)
    let mut normal_settings = Settings::default();
    normal_settings.proxy_only_mode = false;
    normal_settings.bypass_iran = false;
    normal_settings.bypass_lan = false;

    let (sb_normal, _, _) = generate_config(link, 2080, Some(&normal_settings), false).unwrap();
    assert_eq!(sb_normal["route"]["final"], "proxy", "normal sing-box must have final=proxy");

    let tun_normal = generate_tun_config(2080, link, Some("1.2.3.4".into()), false, true, "https://1.1.1.1/dns-query".into(), "8.8.8.8".into(), Some(&normal_settings));
    assert_eq!(tun_normal["route"]["final"], "proxy", "normal TUN must have final=proxy");

    let (xr_normal, _) = generate_xray_config(link, 2080, Some(&normal_settings), false).unwrap();
    assert_eq!(xr_normal["outbounds"][0]["tag"], "proxy", "normal xray must have proxy as default outbound");

    // 2. Proxy-only mode with TUN enabled (tun_mode = true)
    let mut po_settings = Settings::default();
    po_settings.proxy_only_mode = true;
    po_settings.bypass_iran = false;
    po_settings.bypass_lan = false;

    po_settings.routing_rules = vec![
        RoutingRule {
            id: "1".into(),
            pattern: "C:\\Program Files\\Telegram\\Telegram.exe".into(),
            action: "proxy".into(),
            kind: "process".into(),
            enabled: true,
        },
        RoutingRule {
            id: "2".into(),
            pattern: "youtube.com".into(),
            action: "proxy".into(),
            kind: "domain".into(),
            enabled: true,
        },
    ];

    let (sb_po_tun, _, _) = generate_config(link, 2080, Some(&po_settings), true).unwrap();
    assert_eq!(sb_po_tun["route"]["final"], "proxy", "in TUN mode, main core sing-box always proxies traffic forwarded to it");

    let tun_po = generate_tun_config(2080, link, Some("1.2.3.4".into()), false, true, "https://1.1.1.1/dns-query".into(), "8.8.8.8".into(), Some(&po_settings));
    assert_eq!(tun_po["route"]["final"], "direct", "proxy-only TUN must have final=direct");

    // Verify proxy-only TUN contains selected process rule
    let tun_po_rules = tun_po["route"]["rules"].as_array().expect("tun_po route.rules must be array");
    let has_telegram_proc = tun_po_rules.iter().any(|r| {
        r.get("process_name").map_or(false, |pn| pn.as_array().map_or(false, |a| a.iter().any(|p| p == "Telegram.exe"))) &&
        r.get("outbound").map_or(false, |o| o == "proxy")
    });
    assert!(has_telegram_proc, "proxy-only TUN must route selected Telegram.exe to proxy");

    // Verify proxy-only TUN contains selected domain rule
    let has_youtube_domain = tun_po_rules.iter().any(|r| {
        r.get("domain_suffix").map_or(false, |ds| ds.as_array().map_or(false, |a| a.iter().any(|d| d == "youtube.com"))) &&
        r.get("outbound").map_or(false, |o| o == "proxy")
    });
    assert!(has_youtube_domain, "proxy-only TUN must route selected youtube.com domain to proxy");

    // Verify proxy-only TUN does not have general google.com or cloudflare.com proxied
    let has_general_google = tun_po_rules.iter().any(|r| {
        r.get("domain_suffix").map_or(false, |ds| ds.as_array().map_or(false, |a| a.iter().any(|d| d == "google.com"))) &&
        r.get("outbound").map_or(false, |o| o == "proxy")
    });
    assert!(!has_general_google, "proxy-only TUN must NOT proxy general google.com");

    let (xr_po_tun, _) = generate_xray_config(link, 2080, Some(&po_settings), true).unwrap();
    assert_eq!(xr_po_tun["outbounds"][0]["tag"], "proxy", "in TUN mode, main core xray always proxies traffic forwarded to it");

    // 3. Proxy-only mode with TUN disabled (tun_mode = false, System Proxy mode)
    let (sb_po_sys, _, _) = generate_config(link, 2080, Some(&po_settings), false).unwrap();
    assert_eq!(sb_po_sys["route"]["final"], "direct", "in System Proxy mode, unmatched traffic connects direct");

    // Verify health-check domains rule exists in sb_po_sys
    let sb_rules = sb_po_sys["route"]["rules"].as_array().expect("route.rules must be array");
    let has_health_check_sb = sb_rules.iter().any(|r| {
        r.get("domain_suffix").map_or(false, |ds| ds.as_array().map_or(false, |a| a.iter().any(|d| d == "ip-api.com"))) &&
        r.get("outbound").map_or(false, |o| o == "proxy")
    });
    assert!(has_health_check_sb, "sb_po_sys must contain health-check proxy rule for IP check");

    let (xr_po_sys, _) = generate_xray_config(link, 2080, Some(&po_settings), false).unwrap();
    assert_eq!(xr_po_sys["outbounds"][0]["tag"], "direct", "in System Proxy mode, xray default outbound must be direct");

    let xr_rules = xr_po_sys["routing"]["rules"].as_array().expect("routing.rules must be array");
    let has_health_check_xr = xr_rules.iter().any(|r| {
        r.get("domain").map_or(false, |ds| ds.as_array().map_or(false, |a| a.iter().any(|d| d == "domain:ip-api.com"))) &&
        r.get("outboundTag").map_or(false, |o| o == "proxy")
    });
    assert!(has_health_check_xr, "xr_po_sys must contain health-check proxy rule for IP check");

    // All configs must pass full sing-box schema validation
    assert!(check_singbox_full("normal_tun", &tun_normal), "normal TUN must pass sing-box check");
    assert!(check_singbox_full("proxy_only_tun", &tun_po), "proxy-only TUN must pass sing-box check");
    assert!(check_singbox_full("proxy_only_sys", &sb_po_sys), "proxy-only system sing-box must pass sing-box check");
    println!("[proxy-only-mode] All assertions passed successfully!");
}