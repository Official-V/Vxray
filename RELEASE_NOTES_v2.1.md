# Vxray v2.1

### 🚀 What's New

* **Per-App Routing for Executables (`.exe` Split Tunneling)**
  * Full support for application-level process routing in TUN mode.
  * You can now selectively route specific apps through the proxy (**Proxy-Only Mode**) or route everything and exclude specific apps (**Bypass Mode**).
  * Toggling Proxy-Only mode or modifying `.exe` rules now instantly triggers a clean TUN adapter restart so process bindings take effect immediately.

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
| **Windows 64-bit** | `Vxray_2.1_x64-setup.exe` |
| **Windows 32-bit** | `Vxray_2.1_x32-setup.exe` |
| **Linux 64-bit (Portable)** | `vxray_2.1_amd64.AppImage` |
| **Linux 64-bit (Debian/Ubuntu)** | `vxray_2.1_amd64.deb` |
