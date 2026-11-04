# Vxray v2.1

### 🚀 What's New

* **Dedicated Proxy-Only Mode (Strict Split Tunneling)**
  * Added **Proxy-Only Mode** for TUN mode: when enabled, only the specific applications you choose (e.g. Telegram, Discord, Chrome, Steam) are routed through the proxy.
  * All other applications, background services, Windows updates, and online games bypass the tunnel entirely and connect directly to your local internet.
  * Ensures maximum connection speed, zero extra ping, and eliminates bandwidth waste from unneeded background traffic.
  * Accurately reflects the exit proxy IP on the dashboard indicator exclusively for proxy-routed traffic.

* **Per-App Routing & Process Management (`.exe` Rules)**
  * Full application-level process routing for Windows executables.
  * Select between **Proxy-Only Mode** (whitelist specific apps) or **Bypass Mode** (route everything and exclude selected apps).
  * Automatically detects running processes or lets you pick any `.exe` binary from your disk.
  * Toggling Proxy-Only mode or modifying `.exe` rules instantly triggers a clean TUN adapter restart so process bindings take effect immediately.

* **Smart Routing Reload (Fast Reconnect)**
  * Changes to domain lists, DNS options, and routing presets (Bypass Iran, Bypass LAN, Block Ads) now reload the core configuration in milliseconds without dropping or recreating the virtual TUN adapter.
  * Full adapter restarts only occur when strictly necessary (process/executable rule changes).

* **New App & Support Center**
  * **In-App Update Center**: Check for updates, track real-time download progress with download sizes, and perform a one-click "Restart & Install" without manually downloading setup files from a browser.
  * **System & Engine Diagnostics**: View active app version, OS architecture, and core engine versions (sing-box / Xray) in one place.
  * **Copy System Info**: One-click button to export your environment details when reporting issues on GitHub or Telegram.
  * Quick links to community support channels and GitHub issue tracker.

* **Linux Release Support**
  * Added Linux release packaging (`.AppImage` and `.deb`) for 64-bit systems alongside Windows releases.
  * Native Linux kernel TUN interface integration (`/dev/net/tun`) without external drivers.

---

### 🛠️ Fixes & Improvements

* Fixed an issue where the IP indicator in Proxy-Only mode showed the local IP instead of the proxy exit IP.
* Added dedicated health-check routing and Iranian domain DNS bypass in TUN mode for lower lookup latency.
* Corrected routing precedence so traffic for non-selected apps is not accidentally intercepted when Proxy-Only mode is active.
* Proper cleanup of lingering virtual adapter routes and system proxy configurations on disconnect and system sleep.
* Added native support and compiled installers for both 64-bit (`x64`) and 32-bit (`x32`) Windows systems.

---

### 📦 Downloads & Verification

| Platform / Architecture | Package |
| :--- | :--- |
| **Windows 64-bit** | `Vxray-2.1_x64-setup.exe` |
| **Windows 32-bit** | `Vxray-2.1_x32-setup.exe` |
| **Linux 64-bit (Portable)** | `Vxray_2.1_amd64.AppImage` |
| **Linux 64-bit (Debian / Ubuntu)** | `Vxray_2.1_amd64.deb` |
