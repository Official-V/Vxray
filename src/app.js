const { invoke } = window.__TAURI__.core;

// ===== State =====
let selectedServerLink = null;
let connectedServerLink = null;
let isRunning = false;
let isConnecting = false;
let isInvoking = false;
let testingActive = false;
let logsOpen = false;
let livePingInterval = null;
let crashCheckInterval = null;
let connectStartTime = 0;
let consecutivePingFailures = 0;
let baseIp = null;
let isTunRouted = false;
let isDraggingGroup = false;
let isDraggingServer = false;
let draggedServerLink = null;
let draggedServerGroup = null;

// ===== DOM Refs =====
const serverList = document.getElementById('server-list');
const logViewer = document.getElementById('log-viewer');
const btnConnect = document.getElementById('btn-connect');
const btnTest = document.getElementById('btn-test');
const btnLogs = document.getElementById('btn-logs');
const statusLabel = document.getElementById('status-label');

// Sets html[data-theme] and mirrors it to localStorage. The mirror is what the
// pre-paint script in index.html reads on the next launch so the window never opens in
// the wrong theme and flips; the backend copy is the authoritative record.
function applyTheme(theme) {
  if (theme !== 'light' && theme !== 'dark') theme = 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('vxray_theme', theme); } catch (_) {}
  const toggle = document.getElementById('toggle-light-theme');
  if (toggle && toggle.checked !== (theme === 'light')) toggle.checked = (theme === 'light');
}

function animateTextChange(element, newText) {
  if (!element || element.textContent === newText) return;
  element.style.transition = 'opacity 0.2s ease-in-out';
  element.style.opacity = '0';
  setTimeout(() => {
    element.textContent = newText;
    element.style.opacity = '1';
    if (newText.length > 15) element.title = newText;
  }, 200);
}

function animateIpAndFlag(newIp, newFlagSrc) {
  const ipAddress = document.getElementById('ip-address');
  const flagImg = document.getElementById('flag-img');
  if (!ipAddress || !flagImg) return;

  if (ipAddress.textContent === newIp && flagImg.src === newFlagSrc) return;

  // Cleanup old transitions so they don't fight with Web Animations API
  ipAddress.style.transition = 'none';
  flagImg.style.transition = 'none';

  const animOut = [
    { opacity: 1, transform: 'translateY(0) scale(1) rotateX(0deg)', filter: 'blur(0px)' },
    { opacity: 0, transform: 'translateY(-15px) scale(0.9) rotateX(45deg)', filter: 'blur(8px)' }
  ];
  
  const animIn = [
    { opacity: 0, transform: 'translateY(15px) scale(0.9) rotateX(-45deg)', filter: 'blur(8px)' },
    { opacity: 1, transform: 'translateY(0) scale(1) rotateX(0deg)', filter: 'blur(0px)' }
  ];
  
  const options = { duration: 600, easing: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)', fill: 'forwards' };

  const p1 = ipAddress.animate(animOut, { ...options, duration: 400, easing: 'ease-in' }).finished;
  const p2 = flagImg.animate(animOut, { ...options, duration: 400, easing: 'ease-in' }).finished;

  Promise.all([p1, p2]).then(() => {
    ipAddress.textContent = newIp;
    if (newIp.length > 15) ipAddress.title = newIp;

    if (newFlagSrc) {
      flagImg.src = newFlagSrc;
      flagImg.style.display = 'inline';
    } else {
      flagImg.style.display = 'none';
      flagImg.src = '';
    }

    const ipIn = ipAddress.animate(animIn, options);
    const flagIn = flagImg.animate(animIn, options);

    // A forwards fill pins filter:blur(0) on the element forever, which outranks the
    // .spoiler class and would stop the IP blur toggle from ever applying. Commit the
    // end state by hand instead.
    ipIn.onfinish = () => ipIn.cancel();
    flagIn.onfinish = () => flagIn.cancel();
  }).catch(() => {});
}

let _lastDashState = 'offline';
let _lastDashPing = null;

function updateSmartDash(state, pingMs = null) {
  _lastDashState = state;
  _lastDashPing = pingMs;

  const dash = document.getElementById('lcd-network');
  const capsule = document.getElementById('lcd-capsule');

  const icon = document.getElementById('dash-icon');
  const title = document.getElementById('dash-title');
  const subtitle = document.getElementById('dash-subtitle');
  const rimPing = document.getElementById('live-ping-rim');
  
  if (!dash || !icon || !title || !subtitle) return;
  
  dash.classList.remove('offline', 'online', 'processing', 'connected', 'timeout');
  dash.classList.add(state);
  if (capsule) {
    capsule.classList.remove('offline', 'online', 'processing', 'connected', 'timeout');
    capsule.classList.add(state);
  }
  
  const IOS_SPINNER_HTML = `<div class="ios-spinner"><div class="blade"></div><div class="blade"></div><div class="blade"></div><div class="blade"></div><div class="blade"></div><div class="blade"></div><div class="blade"></div><div class="blade"></div><div class="blade"></div><div class="blade"></div><div class="blade"></div><div class="blade"></div></div>`;

  const setCapsuleBadge = (text, color = null, bg = null) => {
    if (rimPing) {
      rimPing.textContent = text;
      rimPing.style.color = color || 'var(--ov-04)';
      rimPing.style.background = bg || 'var(--ov-006)';
      rimPing.style.border = '1px solid var(--ov-008)';
      rimPing.style.boxShadow = 'inset 0 1px 2px rgba(0,0,0,0.12)';
      rimPing.style.minWidth = '48px';
    }
  };
  
  if (state === 'offline') {
    icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
    title.textContent = t('status.offline');
    subtitle.textContent = t('status.waiting_network');
    setCapsuleBadge('OFF', 'var(--ov-03)');
  } else if (state === 'online') {
    icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
    title.textContent = t('status.system_ready');
    subtitle.textContent = t('status.idle');
    setCapsuleBadge('READY', 'var(--ov-045)');
  } else if (state === 'processing') {
    icon.innerHTML = IOS_SPINNER_HTML;
    title.textContent = t('status.processing');
    subtitle.textContent = t('status.connecting_server');
    if (rimPing) {
      rimPing.innerHTML = IOS_SPINNER_HTML;
      rimPing.style.background = 'var(--ov-008)';
      rimPing.style.border = '1px solid var(--ov-018)';
      rimPing.style.boxShadow = 'inset 0 1px 2px rgba(0,0,0,0.12), 0 0 14px var(--ov-018)';
      rimPing.style.minWidth = '48px';
    }
  } else if (state === 'timeout') {
    icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
    title.textContent = t('status.timeout');

    const livePingToggle = document.getElementById('toggle-live-ping');
    const isPingEnabled = livePingToggle ? livePingToggle.checked : true;
    const tunSwitch = document.getElementById('tun-toggle');
    const isTun = tunSwitch ? tunSwitch.checked : false;

    subtitle.textContent = t(isTun ? 'status.global_tunnel' : 'status.system_proxy');
    subtitle.style.color = 'var(--text-secondary)';

    setCapsuleBadge('ERR', '#fbbf24', 'rgba(251,191,36,0.1)');
  } else if (state === 'connected') {
    icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="pulse"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>';
    title.textContent = t('status.connected');
    
    const livePingToggle = document.getElementById('toggle-live-ping');
    const isPingEnabled = livePingToggle ? livePingToggle.checked : true;
    const tunSwitch = document.getElementById('tun-toggle');
    const isTun = tunSwitch ? tunSwitch.checked : false;
    
    subtitle.textContent = isTun ? 'Global Tunnel Active' : 'System Proxy Active';
    subtitle.style.color = 'var(--text-secondary)';

    if (pingMs === 'Timeout') {
      setCapsuleBadge('ERR', '#ef4444', 'rgba(239,68,68,0.1)');
    } else if (!isPingEnabled) {
      setCapsuleBadge('LIVE', '#4ade80', 'rgba(74,222,128,0.1)');
    } else {
      if (pingMs === null) {
        if (rimPing && rimPing.textContent && rimPing.textContent.includes('ms')) {
          // Preserve the last known ping value during transient updates
        } else {
          setCapsuleBadge('PING', 'var(--ov-04)');
        }
      } else {
        const pingColor = pingMs < 500 ? '#4ade80' : '#fbbf24';
        setCapsuleBadge(pingMs + ' ms', pingColor, 'var(--ov-006)');
      }
    }
  }
}


const livePing = document.getElementById('live-ping');
const flagImg = document.getElementById('flag-img');
const locPrefix = document.getElementById('loc-prefix');
const countryName = document.getElementById('country-name');
const ipAddress = document.getElementById('ip-address');
const tunToggle = document.getElementById('tun-toggle');
const btnUpdateSubs = document.getElementById('btn-update-subs');
const toggleAutoReconnect = document.getElementById('toggle-auto-reconnect');
const toggleAutoStart = document.getElementById('toggle-auto-start');
const toggleStartMinimized = document.getElementById('toggle-start-minimized');
const rowStartMinimized = document.getElementById('row-start-minimized');

// ===== Initialization =====

function updateTunUIState() {
  const tunSwitch = document.getElementById('tun-toggle');
  if (!tunSwitch) return;
  
  const microCheckbox = document.getElementById('micro-tun-checkbox');
  if (microCheckbox) {
      microCheckbox.checked = tunSwitch.checked;
  }
}

function toggleMicroDrawer() {
  const sidebar = document.getElementById('sidebar');
  const drawer = document.getElementById('lcd-network');
  
  if (sidebar && sidebar.classList.contains('collapsed')) {
    sidebar.classList.remove('collapsed');
    if (drawer) {
      drawer.classList.add('open');
      localStorage.setItem('drawerOpen', 'true');
    }
    return;
  }
  
  if (drawer) {
    const isOpen = drawer.classList.toggle('open');
    localStorage.setItem('drawerOpen', isOpen ? 'true' : 'false');
  }
}

function toggleTunUI() {
  const tunSwitch = document.getElementById('tun-toggle');
  if (!tunSwitch) return;
  tunSwitch.checked = !tunSwitch.checked;
  const e = new Event('change');
  tunSwitch.dispatchEvent(e);
}

async function initApp() {
  checkIp(false);

  // Titlebar controls
  const minBtn = document.getElementById('titlebar-minimize');
  if (minBtn) minBtn.addEventListener('click', () => invoke('minimize_window'));

  const maxBtn = document.getElementById('titlebar-maximize');
  if (maxBtn) maxBtn.addEventListener('click', () => invoke('maximize_window'));

  const closeBtn = document.getElementById('titlebar-close');
  if (closeBtn) {
    closeBtn.addEventListener('mouseenter', () => closeBtn.classList.add('is-hovered'));
    closeBtn.addEventListener('mouseleave', () => closeBtn.classList.remove('is-hovered'));
    closeBtn.addEventListener('click', () => {
        closeBtn.classList.remove('is-hovered');
        invoke('close_window');
    });
  }

  // Restore drawer state from memory
  const savedDrawerState = localStorage.getItem('drawerOpen');
  if (savedDrawerState === 'true') {
    const drawer = document.getElementById('lcd-network');
    if (drawer) drawer.classList.add('open');
  }

  // Hover tracking for dock capsule shadow
  const dock = document.getElementById('lcd-network');
  if (dock) {
    dock.addEventListener('mousemove', (e) => {
      const rect = dock.getBoundingClientRect();
      dock.style.setProperty('--mouse-x', `${(e.clientX - rect.left).toFixed(1)}px`);
      dock.style.setProperty('--mouse-y', `${(e.clientY - rect.top).toFixed(1)}px`);
    });
  }

  // Hover tracking for connect button & tabs (dynamic island specular hover)
  const connectBtn = document.getElementById('btn-connect');
  if (connectBtn) {
    connectBtn.addEventListener('mousemove', (e) => {
      const rect = connectBtn.getBoundingClientRect();
      connectBtn.style.setProperty('--mouse-x', `${(e.clientX - rect.left).toFixed(1)}px`);
      connectBtn.style.setProperty('--mouse-y', `${(e.clientY - rect.top).toFixed(1)}px`);
    });
  }

  document.querySelectorAll('.tab-btn').forEach((tab) => {
    tab.addEventListener('mousemove', (e) => {
      const rect = tab.getBoundingClientRect();
      tab.style.setProperty('--mouse-x', `${(e.clientX - rect.left).toFixed(1)}px`);
      tab.style.setProperty('--mouse-y', `${(e.clientY - rect.top).toFixed(1)}px`);
    });
  });

  // Load TUN state
  try {
    const tunEnabled = await invoke('get_tun_enabled');
    if (tunToggle) { tunToggle.checked = tunEnabled; updateTunUIState(); }
      updateSmartDash('offline');
  } catch (_) {}
  // Restore interface language before the dynamic lists render, so the first paint
  // is already translated instead of flashing English and swapping.
  try {
    const lang = await invoke('get_language');
    applyLanguage(lang);
    const langSelectEl = document.getElementById('select-language');
    if (langSelectEl && lang) {
      langSelectEl.value = lang;
      const sel = document.getElementById('language-dropdown-selected');
      const dd = document.getElementById('language-dropdown');
      if (dd && sel) {
        dd.querySelectorAll('.custom-dropdown-option').forEach(o => {
          const on = o.getAttribute('data-value') === lang;
          o.classList.toggle('active', on);
          if (on) sel.textContent = o.textContent.trim();
        });
      }
    }
  } catch (_) {}

  // Load Startup Settings
  let startupSettings = null;
  try {
    startupSettings = await invoke('get_startup_settings');
    if (startupSettings) {
      if (toggleAutoReconnect) toggleAutoReconnect.checked = startupSettings.auto_reconnect;
      if (toggleAutoStart) toggleAutoStart.checked = startupSettings.auto_start;
      if (toggleStartMinimized) toggleStartMinimized.checked = startupSettings.start_minimized;
      if (startupSettings.auto_start && rowStartMinimized) {
        rowStartMinimized.classList.add('enabled');
      }
      applyTheme(startupSettings.theme);
    }
  } catch (_) {}

  // The switch ships checked in index.html, so without this the TUN preference is whatever the
  // markup happened to say rather than what the user last chose. The auto-reconnect below reads
  // this checkbox for its mode, so a stale ON made a user who had switched TUN off reconnect
  // through a tunnel -- and on a non-elevated launch that also triggered the elevation restart
  // they had already declined.
  await syncTunSwitchFromBackend();

  // Auto Reconnect Logic
  try {
    const info = await invoke('get_auto_reconnect_info');
    if (info.auto_reconnect && info.link && info.link !== "") {
      setTimeout(() => {
        selectedServerLink = info.link;
        connectToLink(info.link, false);
      }, 500);
    }
  } catch (_) {}

  // Toggles handlers
  if (tunToggle) tunToggle.addEventListener('change', handleTunToggle);

  // The three General toggles are wired once, in initSettingsListeners, which also handles the
  // dimming of Start Minimized. Attaching them here as well meant every flip invoked the
  // backend twice, and these copies awaited an invoke with no catch -- a rejection became an
  // unhandled promise rejection and the checkbox stayed flipped with no message. The branch
  // below that toggled `.enabled` on #row-start-minimized was dead too: that id is not in
  // index.html, so only the opacity/pointerEvents treatment in the other listener ever applied.

  // Load servers
  setTimeout(refreshServerList, 50);
  setTimeout(() => checkIp(false), 300);
  setTimeout(runLivePing, 600);
  if (!startupSettings || startupSettings.auto_update_subs !== false) {
    setTimeout(updateAllSubscriptions, 2000);
  }

  // Start timers
  livePingInterval = setInterval(runLivePing, 4000);
  crashCheckInterval = setInterval(checkCoreHealth, 2000);

  // The backend reaps a core that died on its own and clears the system proxy it was
  // carrying. It announces that here. checkCoreHealth owns the reconnect attempt and the
  // back-off counters around it, and its guard is `if (!isRunning ...) return` -- so this
  // listener must not touch isRunning, or the next poll would find the flag already cleared
  // and never reconnect at all. It paints nothing either, for the same reason: a spinner set
  // here would spin forever on the one path where that poll bails out early. Logging is safe.
  window.__TAURI__.event.listen('core-died', () => {
    log(t('log.core_died'));
  }).catch(e => console.error('could not subscribe to core-died:', e));

  // Global drag handling to absolutely prevent the "not allowed" cross cursor anywhere in the window
  document.addEventListener('dragenter', (e) => {
    if (isDraggingGroup || isDraggingServer) {
      e.preventDefault();
    }
  });
  
  document.addEventListener('dragover', (e) => {
    if (isDraggingGroup || isDraggingServer) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  });

  document.addEventListener('drop', (e) => {
    if (isDraggingGroup || isDraggingServer) {
      e.preventDefault();
    }
  });

  // Version badge next to the logo. Read straight from the binary -- it is the one
  // number the updater compares against, so it must not drift from the package metadata.
  renderSupportVersion();

  // Silent release check. A user behind a restricted route sees nothing of a failure
  // here: only a found update lights the badges, and the card is left untouched until
  // the user actually opens the tab and asks.
  setTimeout(() => { checkForUpdates(false); }, 3000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// ===== Sidebar Toggle =====
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('collapsed');
}

// ===== Tab Switching =====
function switchTab(index) {
  document.getElementById('tab-servers').classList.toggle('active', index === 0);
  document.getElementById('tab-subscriptions')?.classList.toggle('active', index === 1);
  document.getElementById('tab-routing')?.classList.toggle('active', index === 2);
  document.getElementById('tab-settings').classList.toggle('active', index === 3);
  document.getElementById('tab-speedtest')?.classList.toggle('active', index === 4);
  
  document.getElementById('page-servers').classList.toggle('active', index === 0);
  document.getElementById('page-subscriptions')?.classList.toggle('active', index === 1);
  document.getElementById('page-routing')?.classList.toggle('active', index === 2);
  document.getElementById('page-settings').classList.toggle('active', index === 3);
  document.getElementById('page-speedtest')?.classList.toggle('active', index === 4);

  // Only show log button on Servers tab
  const logBtn = document.getElementById('btn-logs');
  if (logBtn) {
    logBtn.style.display = index === 0 ? '' : 'none';
    if (index !== 0 && logsOpen) {
      logsOpen = false;
      logViewer.classList.remove('open');
      logBtn.classList.remove('active');
    }
  }

  if (index === 1) {
    refreshSubscriptions();
  }
}

// ===== Server List =====
let collapsedGroups = {};
let announcementOpenGroups = {};
let draggedGroupKey = null;

async function togglePinSubscription(groupKey) {
  try {
    // Rust command parameter is `url` (the subscription URL, which is the group key)
    await invoke('toggle_pin_subscription', { url: groupKey });
    await refreshServerList();
  } catch (e) {
    log(t('log.pin_failed', null, {err: e}));
  }
}

async function refreshServerList() {
  try {
    const rawData = await invoke('get_servers');
    serverList.innerHTML = '';
    const parsed = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;

    let groupsMap = {};
    let pinnedList = [];
    let orderList = [];

    if (parsed.groups) {
      groupsMap = parsed.groups;
      pinnedList = parsed.pinned || [];
      orderList = parsed.order || [];
    } else {
      groupsMap = parsed;
    }

    const groupEntries = Object.entries(groupsMap);

    // Sort entries: manual first, then pinned, then ordered/default
    groupEntries.sort(([keyA], [keyB]) => {
      if (keyA === 'manual') return -1;
      if (keyB === 'manual') return 1;

      const isPinnedA = pinnedList.includes(keyA);
      const isPinnedB = pinnedList.includes(keyB);

      if (isPinnedA && !isPinnedB) return -1;
      if (!isPinnedA && isPinnedB) return 1;

      const idxA = orderList.indexOf(keyA);
      const idxB = orderList.indexOf(keyB);

      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return 0;
    });

    for (const [groupKey, groupData] of groupEntries) {
      const servers = groupData.servers || [];
      const isCollapsed = collapsedGroups[groupKey] || false;
      const isPinned = pinnedList.includes(groupKey);

      // Group container
      const groupEl = document.createElement('div');
      groupEl.className = 'sub-group' + (isCollapsed ? ' collapsed' : '') + (isPinned ? ' is-pinned' : '');
      groupEl.dataset.groupKey = groupKey;

      // Group header
      const header = document.createElement('div');
      header.className = 'group-header';
      header.draggable = true;

      let currentGhost = null;

      // Drag and drop event listeners
      header.addEventListener('dragstart', (e) => {
        if (e.target.closest('.group-dropdown-menu') || e.target.closest('.group-action-btn')) {
          e.preventDefault();
          return;
        }

        // Clear any accidental text selection so browser doesn't snapshot multi-line selections
        if (window.getSelection) {
          window.getSelection().removeAllRanges();
        }

        isDraggingGroup = true;
        draggedGroupKey = groupKey;

        // Create a crisp, single-item drag preview pill
        const ghost = document.createElement('div');
        ghost.className = 'drag-ghost-pill';

        const displayName = groupData.name || 'Subscription';
        const serverCount = servers.length;

        const iconSvg = groupKey === 'manual'
          ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="4" ry="4"></rect><rect x="2" y="14" width="20" height="8" rx="4" ry="4"></rect><line x1="6" y1="6" x2="6.01" y2="6"></line><line x1="6" y1="18" x2="6.01" y2="18"></line></svg>'
          : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>';

        ghost.innerHTML = `
          <div class="ghost-icon">${iconSvg}</div>
          <span class="ghost-title">${displayName}</span>
          ${isPinned ? '<span class="ghost-pin"><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M16 12V4H17V2H7V4H8V12L6 14V16H11V22H13V16H18V14L16 12Z"/></svg></span>' : ''}
          <span class="ghost-badge">${serverCount}</span>
        `;

        document.body.appendChild(ghost);
        currentGhost = ghost;

        // Position drag preview neatly under the mouse pointer
        e.dataTransfer.setDragImage(ghost, 24, 22);

        setTimeout(() => {
          if (ghost.parentNode) ghost.remove();
        }, 50);

        // Defer adding the class so the browser captures the original look for the drag image
        setTimeout(() => {
          groupEl.classList.add('dragging');
        }, 0);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', groupKey);
      });

      header.addEventListener('dragend', () => {
        if (currentGhost && currentGhost.parentNode) {
          currentGhost.remove();
          currentGhost = null;
        }
        groupEl.classList.remove('dragging');
        document.querySelectorAll('.sub-group').forEach(el => {
          el.classList.remove('drag-target-above', 'drag-target-below');
        });
        setTimeout(() => {
          isDraggingGroup = false;
          draggedGroupKey = null;
        }, 100);
      });

      // Handle drop targets on groupEl to allow dropping anywhere in the group
      groupEl.addEventListener('dragenter', (e) => {
        if (!draggedGroupKey) return;
        e.preventDefault(); // Necessary for allowing drop
      });

      groupEl.addEventListener('dragover', (e) => {
        if (!draggedGroupKey) return;
        e.preventDefault(); // ALWAYS prevent default so the cross cursor disappears
        e.dataTransfer.dropEffect = 'move';

        if (draggedGroupKey === groupKey) return; // Don't draw blue lines over itself

        const rect = groupEl.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;

        // Clear all previous targets
        document.querySelectorAll('.sub-group').forEach(el => {
          el.classList.remove('drag-target-above', 'drag-target-below');
        });

        if (e.clientY < midpoint) {
          groupEl.classList.add('drag-target-above');
        } else {
          groupEl.classList.add('drag-target-below');
        }
      });

      groupEl.addEventListener('dragleave', (e) => {
        // Prevent flickering by ensuring we actually left the group element
        if (!groupEl.contains(e.relatedTarget)) {
          groupEl.classList.remove('drag-target-above', 'drag-target-below');
        }
      });

      groupEl.addEventListener('drop', async (e) => {
        e.preventDefault();
        groupEl.classList.remove('drag-target-above', 'drag-target-below');

        if (!draggedGroupKey || draggedGroupKey === groupKey) return;

        const rect = groupEl.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        const placeBefore = e.clientY < midpoint;

        // Find the dragged element securely without querySelector
        const draggedEl = Array.from(serverList.querySelectorAll('.sub-group'))
          .find(el => el.dataset.groupKey === draggedGroupKey);
          
        if (draggedEl && groupEl !== draggedEl) {
          if (placeBefore) {
            serverList.insertBefore(draggedEl, groupEl);
          } else {
            serverList.insertBefore(draggedEl, groupEl.nextSibling);
          }

          const newOrder = Array.from(serverList.querySelectorAll('.sub-group'))
            .map(el => el.dataset.groupKey);

          try {
            // Rust command parameter is `urls`
            await invoke('save_subscription_order', { urls: newOrder });
          } catch (_) {}
        }
      });

      // Chevron
      const chevron = document.createElement('span');
      chevron.className = 'group-chevron';
      chevron.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';

      // Name
      const nameEl = document.createElement('span');
      nameEl.className = 'group-name';
      // The manual group's stored name is an English sentinel; map it at render time so
      // the header follows the interface language without touching what is persisted.
      nameEl.textContent = groupKey === 'manual'
        ? t('subs.manual_name')
        : (groupData.name || t('server.unknown_group'));

      if (isPinned) {
        const pinBadge = document.createElement('span');
        pinBadge.className = 'group-pin-badge';
        pinBadge.title = t('group.pin_to_top');
        pinBadge.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M16 12V4H17V2H7V4H8V12L6 14V16H11V22H13V16H18V14L16 12Z"/></svg>';
        nameEl.appendChild(pinBadge);
      }

      // Count badge
      const countEl = document.createElement('span');
      countEl.className = 'group-count';
      countEl.textContent = servers.length;

      // Actions
      const actionsEl = document.createElement('div');
      actionsEl.className = 'group-actions';

      // Hover-visible ping button on the header (available for both manual & subscription groups)
      const hoverPingBtn = document.createElement('button');
      hoverPingBtn.className = 'group-action-btn ping-all-btn';
      hoverPingBtn.title = t('group.test_latency');
      hoverPingBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"></path><path d="M1.42 9a16 16 0 0 1 21.16 0"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>';
      let groupPingActive = false;
      hoverPingBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (groupPingActive) {
          // Stop
          shouldStopTesting = true;
          invoke('cancel_latency_tests').catch(()=>{});
          hoverPingBtn.title = t('group.test_latency');
          hoverPingBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"></path><path d="M1.42 9a16 16 0 0 1 21.16 0"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>';
          groupPingActive = false;
          
          const gEl = document.querySelector(`.sub-group[data-group-key="${groupKey}"]`);
          if (gEl) {
            gEl.querySelectorAll('.server-latency').forEach(latEl => {
              if (latEl.textContent === '...' || latEl.textContent === 'Testing...') {
                updateLatencyDisplay(latEl, '');
              }
            });
          }
          return;
        }
        groupPingActive = true;
        hoverPingBtn.title = t('group.stop');
        hoverPingBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12"></rect></svg>';
        await pingGroup(groupKey);
        hoverPingBtn.title = t('group.test_latency');
        hoverPingBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"></path><path d="M1.42 9a16 16 0 0 1 21.16 0"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>';
        groupPingActive = false;
      });

      const optionsBtn = document.createElement('button');
      optionsBtn.className = 'group-action-btn';
      optionsBtn.title = t('group.options');
      optionsBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1.5"></circle><circle cx="19" cy="12" r="1.5"></circle><circle cx="5" cy="12" r="1.5"></circle></svg>';

      const dropdownMenu = document.createElement('div');
      dropdownMenu.className = 'group-dropdown-menu';

      // View Statistic (Both)
      const statsItem = document.createElement('button');
      statsItem.className = 'dropdown-item';
      statsItem.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 20V10M12 20V4M6 20v-6"></path></svg> ' + t('group.menu.view_stats');
      statsItem.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdownMenu.classList.remove('show');
        openStatsModal(groupKey, true, groupKey === 'manual' ? t('subs.manual_name') : (groupData.name || groupKey), groupData);
      });

      // Pin/Unpin Item (Both)
      const pinItem = document.createElement('button');
      pinItem.className = 'dropdown-item';
      pinItem.innerHTML = isPinned
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" y1="2" x2="22" y2="22"></line><path d="M12 17v5M9 9l-3 3v3h12v-3l-3-3M15 4a2 2 0 0 1 2 2v2H7V6a2 2 0 0 1 2-2h6z"></path></svg> ' + t('group.menu.unpin')
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5M9 9l-3 3v3h12v-3l-3-3M15 4a2 2 0 0 1 2 2v2H7V6a2 2 0 0 1 2-2h6z"></path></svg> ' + t('group.menu.pin');

      pinItem.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdownMenu.classList.remove('show');
        togglePinSubscription(groupKey);
      });

      if (groupKey === 'manual') {
        // TCP ping test for every manually added server
        const tcpPingItem = document.createElement('button');
        tcpPingItem.className = 'dropdown-item';
        tcpPingItem.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg> ' + t('group.menu.tcp_ping');
        tcpPingItem.addEventListener('click', (e) => {
          e.stopPropagation();
          dropdownMenu.classList.remove('show');
          tcpPingGroup(groupKey);
        });

        // Clear all manual servers
        const deleteItem = document.createElement('button');
        deleteItem.className = 'dropdown-item delete';
        deleteItem.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg> ' + t('group.menu.delete_all_servers');
        deleteItem.addEventListener('click', async (e) => {
          e.stopPropagation();
          dropdownMenu.classList.remove('show');
          try {
            await invoke('clear_manual_servers');
            log(t('log.manual_deleted'));
            await refreshServerList();
          } catch (err) {
            log(t('log.clear_manual_failed', null, {err: err}));
          }
        });

        dropdownMenu.appendChild(statsItem);
        dropdownMenu.appendChild(pinItem);
        dropdownMenu.appendChild(tcpPingItem);
        dropdownMenu.appendChild(deleteItem);
      } else {
        // Edit Subscription
        const editItem = document.createElement('button');
        editItem.className = 'dropdown-item';
        editItem.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg> ' + t('common.edit');
        editItem.addEventListener('click', (e) => {
          e.stopPropagation();
          dropdownMenu.classList.remove('show');
          openEditSubModal(groupKey, groupData);
        });
        
        // Share Link
        const shareItem = document.createElement('button');
        shareItem.className = 'dropdown-item';
        shareItem.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg> ' + t('group.menu.share_link');
        shareItem.addEventListener('click', (e) => {
          e.stopPropagation();
          dropdownMenu.classList.remove('show');
          copyToClipboard(groupKey);
        });

        // Auto Update Toggle
        const autoUpdateItem = document.createElement('button');
        autoUpdateItem.className = 'dropdown-item';
        const isAutoUpdate = groupData.auto_update || false;
        autoUpdateItem.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15A9 9 0 0 1 3.51 9 9 9 0 0 1 20.49 15z"></path></svg> ' + t('group.menu.auto_update') + ' <span class="toggle-badge' + (isAutoUpdate ? ' active' : '') + '">' + (isAutoUpdate ? t('common.on') : t('common.off')) + '</span>';
        autoUpdateItem.addEventListener('click', (e) => {
          e.stopPropagation();
          dropdownMenu.classList.remove('show');
          invoke('toggle_auto_update', { groupKey: groupKey, enabled: !isAutoUpdate }).then(() => refreshServerList()).catch(e => console.error(e));
        });

        const updateItem = document.createElement('button');
        updateItem.className = 'dropdown-item';
        updateItem.id = `group-update-${hashCode(groupKey)}`;
        updateItem.innerHTML = '<svg class="update-svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg> ' + t('common.update');
        updateItem.addEventListener('click', (e) => {
          e.stopPropagation();
          dropdownMenu.classList.remove('show');
          updateSingleSubscription(groupKey);
        });

        const deleteItem = document.createElement('button');
        deleteItem.className = 'dropdown-item delete';
        deleteItem.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg> ' + t('common.delete');
        deleteItem.addEventListener('click', (e) => {
          e.stopPropagation();
          dropdownMenu.classList.remove('show');
          deleteSubscription(groupKey);
        });

        // TCP ping: raw reachability of every config, no core involved, so it can run while a
        // real-delay test is mid-flight without disturbing it.
        const tcpPingItem = document.createElement('button');
        tcpPingItem.className = 'dropdown-item';
        tcpPingItem.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg> ' + t('group.menu.tcp_ping');
        tcpPingItem.addEventListener('click', (e) => {
          e.stopPropagation();
          dropdownMenu.classList.remove('show');
          tcpPingGroup(groupKey);
        });

        dropdownMenu.appendChild(editItem);
        dropdownMenu.appendChild(statsItem);
        dropdownMenu.appendChild(shareItem);
        dropdownMenu.appendChild(autoUpdateItem);
        dropdownMenu.appendChild(pinItem);
        dropdownMenu.appendChild(updateItem);
        dropdownMenu.appendChild(tcpPingItem);
        dropdownMenu.appendChild(deleteItem);
      }

      optionsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.group-dropdown-menu.show').forEach(el => {
          if (el !== dropdownMenu) el.classList.remove('show');
        });
        dropdownMenu.classList.toggle('show');
      });

      actionsEl.appendChild(optionsBtn);
      header.appendChild(dropdownMenu);

      header.appendChild(chevron);
      const infoContainer = document.createElement('div');
      infoContainer.className = 'group-info';
      infoContainer.appendChild(nameEl);
      header.appendChild(infoContainer);

      

      

      if (groupKey !== 'manual' && groupData.total && groupData.total > 0) {
        const used = (groupData.upload || 0) + (groupData.download || 0);
        const remaining = groupData.total - used;
        const remainingPct = Math.max(0, Math.min(100, Math.round((remaining / groupData.total) * 100)));
        
        const wrapper = document.createElement('div');
        wrapper.className = 'group-traffic-ring-wrapper';
        
        const text = document.createElement('div');
        text.className = 'group-traffic-ring-text';
        text.textContent = formatBytes(remaining > 0 ? remaining : 0) + ' / ' + formatBytes(groupData.total);
        
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '-4 -4 44 44');
        svg.setAttribute('class', 'circular-chart');
        
        const pathBg = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        pathBg.setAttribute('class', 'circle-bg');
        pathBg.setAttribute('d', 'M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831');
        
        const pathFill = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const colorClass = remainingPct <= 20 ? 'critical' : remainingPct <= 50 ? 'warning' : 'success';
        pathFill.setAttribute('class', 'circle-fill ' + colorClass);
        pathFill.setAttribute('stroke-dasharray', remainingPct + ', 100');
        pathFill.setAttribute('d', 'M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831');
        
        svg.appendChild(pathBg);
        svg.appendChild(pathFill);
        
        wrapper.appendChild(text);
        wrapper.appendChild(svg);
        
        header.appendChild(wrapper);
      }

      header.appendChild(countEl);
      if (hoverPingBtn) { header.appendChild(hoverPingBtn); }
      header.appendChild(actionsEl);

      // Click header to toggle collapse
      header.addEventListener('click', (e) => {
        if (isDraggingGroup || isDraggingServer) return;
        collapsedGroups[groupKey] = !collapsedGroups[groupKey];
        groupEl.classList.toggle('collapsed');
        saveCollapsedGroupsToSettings();
      });

      groupEl.appendChild(header);

      // Subscription announcement drawer & interactive zabooneh (pull-tab)
      if (groupData.announcement && groupData.announcement.trim()) {
        groupEl.classList.add('has-announcement');

        const assembly = document.createElement('div');
        assembly.className = 'subscription-drawer-assembly';

        // Check if user previously opened it, otherwise default to closed
        const isDrawerOpen = announcementOpenGroups[groupKey] || false;

        // 1. Drawer body (slides down from behind the subscription header)
        const drawerBody = document.createElement('div');
        drawerBody.className = 'subscription-drawer-body' + (isDrawerOpen ? '' : ' is-closed');
        drawerBody.addEventListener('click', (e) => e.stopPropagation());

        const content = document.createElement('div');
        content.className = 'announcement-content';

        const textEl = document.createElement('span');
        textEl.className = 'announcement-text';
        textEl.setAttribute('dir', 'auto');
        textEl.textContent = groupData.announcement.trim();
        textEl.title = groupData.announcement.trim();

        content.appendChild(textEl);
        drawerBody.appendChild(content);

        // 2. Zabooneh (Tongue / pull-tab at bottom of the drawer)
        const zaboonehWrapper = document.createElement('div');
        zaboonehWrapper.className = 'subscription-zabooneh-wrapper';

        const zabooneh = document.createElement('button');
        zabooneh.className = 'subscription-zabooneh' + (isDrawerOpen ? ' tab-open' : '');
        zabooneh.title = t('common.toggle_announcement');
        zabooneh.innerHTML = `
          <span class="ann-tab-icon">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 6a13 13 0 0 0 8.4-2.8A1 1 0 0 1 21 4v12a1 1 0 0 1-1.6.8A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"></path>
              <path d="M6 14a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14"></path>
              <line x1="8" y1="6" x2="8" y2="14"></line>
            </svg>
          </span>
          <span class="ann-tab-label">${t('common.announcement')}</span>
          <span class="ann-tab-chevron">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </span>
        `;

        zabooneh.addEventListener('click', (e) => {
          e.stopPropagation();
          const willOpen = drawerBody.classList.contains('is-closed');
          if (willOpen) {
            drawerBody.classList.remove('is-closed');
            zabooneh.classList.add('tab-open');
            announcementOpenGroups[groupKey] = true;
          } else {
            drawerBody.classList.add('is-closed');
            zabooneh.classList.remove('tab-open');
            announcementOpenGroups[groupKey] = false;
          }
        });

        zaboonehWrapper.appendChild(zabooneh);
        assembly.appendChild(drawerBody);
        assembly.appendChild(zaboonehWrapper);
        groupEl.appendChild(assembly);
      }

      // Servers container
      const serversContainer = document.createElement('div');
      serversContainer.className = 'group-servers';

      serversContainer.addEventListener('dragenter', (e) => {
        if (isDraggingServer && draggedServerGroup === groupKey) e.preventDefault();
      });
      serversContainer.addEventListener('dragover', (e) => {
        if (isDraggingServer && draggedServerGroup === groupKey) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }
      });

      for (const s of servers) {
        const item = createServerItem(s, groupKey);
        serversContainer.appendChild(item);
      }

      groupEl.appendChild(serversContainer);
      serverList.appendChild(groupEl);
    }

    // Add dragover to the server list container itself to prevent cross cursor in gaps.
    // refreshServerList re-runs on every pin, update, delete and language change, and a plain
    // addEventListener here would stack another pair on the persistent #server-list each time.
    // The handlers are idempotent so nothing visibly breaks, but the count grows without bound
    // for the lifetime of the window.
    if (!serverList.dataset.dragWired) {
      serverList.dataset.dragWired = '1';
      serverList.addEventListener('dragenter', (e) => {
        if (draggedGroupKey) e.preventDefault();
      });
      serverList.addEventListener('dragover', (e) => {
        if (draggedGroupKey) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }
      });
    }

  } catch (e) {
    log(t('log.load_servers_failed', null, {err: e}));
  }
}

function createServerItem(serverData, groupKey) {
  const link = serverData.link;
  const remark = serverData.remark || 'Server';
  const latency = serverData.latency;

  const item = document.createElement('div');
  item.className = 'server-item';
  item.dataset.link = link;
  item.dataset.group = groupKey;

  if (link === selectedServerLink) {
    item.classList.add('selected');
  }
  if (link === connectedServerLink) {
    if (consecutivePingFailures >= 4) {
      item.classList.add('timeout');
    } else if (isConnecting) {
      item.classList.add('processing');
    } else {
      item.classList.add('connected');
    }
  }

  // Flag
  const flagEl = document.createElement('div');
  flagEl.className = 'server-flag';
  const flagEmoji = extractFlagEmoji(remark);
  if (flagEmoji) {
    const code = emojiToCountryCode(flagEmoji);
    if (code) {
      const img = document.createElement('img');
      img.src = `https://flagcdn.com/w40/${code}.png`;
      img.alt = code;
      img.onerror = () => { flagEl.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.7"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>'; };
      flagEl.appendChild(img);
    } else {
      flagEl.textContent = flagEmoji;
    }
  } else {
    flagEl.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.7"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>';
  }

  // Name
  const nameEl = document.createElement('div');
  nameEl.className = 'server-name';
  let cleanName = remark
    .replace(/[\uD83C][\uDDE6-\uDDFF][\uD83C][\uDDE6-\uDDFF]/g, '')
    .replace(/[\uD83C][\uDF0D-\uDF10]/g, '')
    .trim()
    .replace(/^[A-Z]{2}\b\s*[-|:]?\s*(?=\S)/, '')
    .replace(/^[-|:]\s*/, '')
    .trim();
  nameEl.textContent = cleanName || 'Server';

  // Latency
  const latencyEl = document.createElement('div');
  latencyEl.className = 'server-latency';
  latencyEl.id = `latency-${hashCode(link)}`;
  updateLatencyDisplay(latencyEl, latency);

  // TCP ping lives in its own chip rather than as a second number in the one above. The two
  // measure different things -- reachability of the server versus speed of a request through
  // it -- and sharing an element would mean each test overwriting the other's result.
  const tcpLatencyEl = document.createElement('div');
  tcpLatencyEl.className = 'server-latency tcp';
  tcpLatencyEl.id = `tcp-latency-${hashCode(link)}`;

  // Action Buttons
  const actionsEl = document.createElement('div');
  actionsEl.className = 'server-actions';

  actionsEl.appendChild(makeActionBtn('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 20V10M12 20V4M6 20v-6"></path></svg>', () => openStatsModal(link, false, cleanName || 'Server', null)));
  actionsEl.appendChild(makeActionBtn('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"></path><path d="M1.42 9a16 16 0 0 1 21.16 0"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>', () => pingSingleItem(link)));
  actionsEl.appendChild(makeActionBtn('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="3" ry="3"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>', async () => {
    await copyToClipboard(link);
    showServerCopiedFeedback(item);
    log(t('log.link_copied'));
  }));
  actionsEl.appendChild(makeActionBtn('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>', () => {
    openEditServerModal(groupKey, link);
  }));
  actionsEl.appendChild(makeActionBtn('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>', () => deleteServer(groupKey, link), true));

  // Click to select
  item.addEventListener('click', (e) => {
    if (e.target.closest('.server-action-btn')) return;
    selectServer(link);
  });

  // Double-click mirrors the connect button: connect when idle, switch when already
  // connected elsewhere, disconnect when already on this one. Selecting first keeps the
  // two paths reading the same state, so this can never disagree with the button.
  item.addEventListener('dblclick', (e) => {
    if (e.target.closest('.server-action-btn')) return;
    e.preventDefault();
    selectServer(link);
    toggleConnection();
  });

  // Discoverability: the hint lives on the item rather than in the list header so it
  // survives re-render.
  item.title = t('server.double_click_hint');

  // Server Drag & Drop for playlist reordering
  let currentServerGhost = null;
  item.draggable = true;

  item.addEventListener('dragstart', (e) => {
    if (e.target.closest('.server-action-btn') || e.target.closest('.server-actions')) {
      e.preventDefault();
      return;
    }
    e.stopPropagation();

    if (window.getSelection) {
      window.getSelection().removeAllRanges();
    }

    isDraggingServer = true;
    draggedServerLink = link;
    draggedServerGroup = groupKey;

    // Create custom drag ghost for this single server
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost-server';
    
    const flagHtml = flagEl.innerHTML;
    const latencyText = latencyEl.textContent ? latencyEl.textContent.trim() : '';

    ghost.innerHTML = `
      <div class="ghost-flag">${flagHtml}</div>
      <span class="ghost-name">${cleanName || 'Server'}</span>
      ${latencyText ? `<span class="ghost-latency">${latencyText}</span>` : ''}
    `;

    document.body.appendChild(ghost);
    currentServerGhost = ghost;

    e.dataTransfer.setDragImage(ghost, 20, 21);

    setTimeout(() => {
      if (ghost.parentNode) ghost.remove();
    }, 50);

    setTimeout(() => {
      item.classList.add('dragging');
    }, 0);

    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', link);
  });

  item.addEventListener('dragend', () => {
    if (currentServerGhost && currentServerGhost.parentNode) {
      currentServerGhost.remove();
      currentServerGhost = null;
    }
    item.classList.remove('dragging');
    document.querySelectorAll('.server-item').forEach(el => {
      el.classList.remove('drag-target-above', 'drag-target-below');
    });
    setTimeout(() => {
      isDraggingServer = false;
      draggedServerLink = null;
      draggedServerGroup = null;
    }, 100);
  });

  item.addEventListener('dragover', (e) => {
    if (!isDraggingServer || draggedServerGroup !== groupKey) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';

    if (draggedServerLink === link) return;

    const rect = item.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;

    document.querySelectorAll('.server-item').forEach(el => {
      el.classList.remove('drag-target-above', 'drag-target-below');
    });

    if (e.clientY < midpoint) {
      item.classList.add('drag-target-above');
    } else {
      item.classList.add('drag-target-below');
    }
  });

  item.addEventListener('dragleave', (e) => {
    if (!item.contains(e.relatedTarget)) {
      item.classList.remove('drag-target-above', 'drag-target-below');
    }
  });

  item.addEventListener('drop', async (e) => {
    if (!isDraggingServer || draggedServerGroup !== groupKey || !draggedServerLink) return;
    e.preventDefault();
    e.stopPropagation();

    item.classList.remove('drag-target-above', 'drag-target-below');

    if (draggedServerLink === link) return;

    const container = item.closest('.group-servers');
    if (!container) return;

    const draggedEl = Array.from(container.querySelectorAll('.server-item'))
      .find(el => el.dataset.link === draggedServerLink);

    if (!draggedEl || draggedEl === item) return;

    const rect = item.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    const placeBefore = e.clientY < midpoint;

    if (placeBefore) {
      container.insertBefore(draggedEl, item);
    } else {
      container.insertBefore(draggedEl, item.nextSibling);
    }

    const orderedLinks = Array.from(container.querySelectorAll('.server-item'))
      .map(el => el.dataset.link);

    try {
      await invoke('save_server_order', { groupKey, orderedLinks });
    } catch (err) {
      console.error('Failed to save server order:', err);
    }
  });

  item.appendChild(flagEl);
  item.appendChild(nameEl);
  item.appendChild(latencyEl);
  item.appendChild(tcpLatencyEl);
  item.appendChild(actionsEl);

  return item;
}

function makeActionBtn(icon, callback, isDelete = false) {
  const btn = document.createElement('button');
  btn.className = 'server-action-btn' + (isDelete ? ' delete' : '');
  btn.innerHTML = icon;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    callback();
  });
  return btn;
}

function selectServer(link) {
  selectedServerLink = link;
  document.querySelectorAll('.server-item').forEach(el => {
    el.classList.toggle('selected', el.dataset.link === link);
    // Clear failed state when user interacts
    if (el.dataset.link !== connectedServerLink) {
      el.classList.remove('failed', 'processing');
    }
  });
  updateConnectBtnText();
}

// ===== Connection =====
let isConnectToLinkActive = false;

async function toggleConnection() {
  if (!selectedServerLink) {
    log(t('log.select_server_first'));
    return;
  }
  
  // ALWAYS allow forced disconnect if we are running or connecting to the selected server
  if ((isRunning || isConnectToLinkActive || isConnecting) && (connectedServerLink === selectedServerLink || !connectedServerLink)) {
    log(t('log.aborting'));
    isInvoking = true;
    updateConnectBtnText();
    try {
      await disconnect();
    } finally {
      isInvoking = false;
      updateConnectBtnText();
    }
    return;
  }

  if (isInvoking || isConnectToLinkActive) {
    log(t('log.processing_ui'));
    return;
  }

  isInvoking = true;
  updateConnectBtnText();

  try {
    if (isRunning) {
      if (connectedServerLink === selectedServerLink) {
        await disconnect();
      } else {
        log(t('log.switching'));
        await connectToLink(selectedServerLink, true);
      }
    } else {
      await connectToLink(selectedServerLink, false);
    }
  } finally {
    isInvoking = false;
    updateConnectBtnText();
  }
}

  async function connectToLink(link, seamless) {
  if (isConnectToLinkActive) {
    log(t('log.in_progress'));
    return;
  }
  isConnectToLinkActive = true;

  if (connectedServerLink && connectedServerLink !== link) {
      const oldItem = document.querySelector(`.server-item[data-link="${connectedServerLink}"]`);
      if (oldItem) oldItem.classList.remove('connected', 'processing', 'timeout');
    }

    connectedServerLink = link;
  log(t('log.configuring_core', null, {link: link.substring(0, 40)}));

  const tunMode = tunToggle.checked;

  isRunning = true;
  isConnecting = true;
  isTunRouted = false;
  connectStartTime = Date.now();
  updateConnectBtnText();
  
  updateSmartDash('processing');
  animateIpAndFlag('---.---.---.---', null);
  animateTextChange(document.getElementById('country-name'), t('status.checking'));
    
    const item = document.querySelector(`.server-item[data-link="${link}"]`);
  if (item) {
    item.classList.remove('connected', 'failed', 'timeout');
    item.classList.add('processing');
  }

  if (tunMode) {
    try {
      const admin = await invoke('is_admin');
      if (!admin) {
          await invoke('toggle_tun', { enabled: true });
        
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.top = '0'; overlay.style.left = '0';
        overlay.style.width = '100vw'; overlay.style.height = '100vh';
        overlay.style.backgroundColor = 'rgba(0,0,0,0.85)';
        overlay.style.color = 'white';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.zIndex = '9999';
        overlay.style.backdropFilter = 'blur(4px)';
        overlay.innerHTML = `<div style="text-align:center; padding: 20px; border-radius: 12px; background: var(--bg-secondary);"><h3>${t('tun.admin_required')}</h3><p style="margin-top: 10px; color: var(--text-secondary);">${t('tun.admin_required_desc')}</p></div>`;
        document.body.appendChild(overlay);
        
        // Same handover as the TUN toggle, with the same failure mode: the promise is fired on
        // a timer nobody awaits, so a refused UAC leaves the sheet up and this connect's
        // isRunning/isConnecting flags set forever. The catch undoes both, which is also what
        // lets the user click Connect again -- with the flags still raised the button would
        // only log that a connection is already in progress.
        setTimeout(() => {
          invoke('restart_as_admin').catch((e) => {
            log(t('log.tun_elevation_failed', null, {err: e}));
            overlay.remove();
            isRunning = false;
            isConnecting = false;
            isConnectToLinkActive = false;
            const givingUpItem = document.querySelector(`.server-item[data-link="${link}"]`);
            if (givingUpItem) givingUpItem.classList.remove('processing');
            updateConnectBtnText();
            updateSmartDash('offline');
          });
        }, 3000);
        isConnectToLinkActive = false;
        return;
      }
    } catch (e) {
      // `is_admin` rejecting here used to fall through to a connect that needs elevation it
      // does not have. Report it and release the flags rather than silently connecting in
      // the wrong mode.
      log(t('log.tun_admin_check_failed', null, {err: e}));
      isRunning = false;
      isConnecting = false;
      isConnectToLinkActive = false;
      updateConnectBtnText();
      updateSmartDash('offline');
      return;
    }
  }

    try {
        const result = await invoke('connect', { link, tunMode });
        
        if (!isRunning || connectedServerLink !== link) {
            log(t('log.aborted'));
            // The backend may still have brought the tunnel up by now. Leaving
            // isConnecting set here is what pinned the UI on "Connecting" after a
            // proxy-only toggle: we hold the in-progress guard, so no other
            // connect is running, and the spinner has no owner left.
            isConnecting = false;
            updateConnectBtnText();
            const abortedItem = document.querySelector(`.server-item[data-link="${link}"]`);
            if (abortedItem) abortedItem.classList.remove('processing');
            return;
        }

        if (result === null || result === undefined || result === 'ok' || result === true) {
          log(t('log.seamless'));
          
          if (!tunMode) {
            // Instantly update UI to Connected for proxy mode
            isConnecting = false;
            isTunRouted = true;
            updateSmartDash('connected');
            
            const connectedItem = document.querySelector(`.server-item[data-link="${link}"]`);
            if (connectedItem) {
              connectedItem.classList.remove('processing', 'failed', 'timeout');
              connectedItem.classList.add('connected');
            }
          } else {
            // For TUN mode, keep processing until checkIp verifies connectivity
            isConnecting = true;
            isTunRouted = false;
            updateSmartDash('processing');
            const connectedItem = document.querySelector(`.server-item[data-link="${link}"]`);
            if (connectedItem) {
              connectedItem.classList.remove('connected', 'failed', 'timeout');
              connectedItem.classList.add('processing');
            }
          }
          
          // Let IP checking run in background after a healthy delay to ensure old proxy socket is fully dead
          setTimeout(() => checkIp(true), 300);
          // The new link may carry a transport the app rules cannot ride on.
          refreshProcessRuleWarning();
      try { await invoke('save_last_connection', { link, tunMode }); } catch (_) {}
      
      // Start real live traffic tracking via clash API
      startTrafficTracking(link);
    } else {
      log(t('log.failed_prefix', null, {err: result}));
      forceShowLogs();
      const item = document.querySelector(`.server-item[data-link="${link}"]`);
      if (item) {
        item.classList.remove('processing', 'connected');
      }
      await disconnect();
    }
  } catch (e) {
    if (errorTag(e) === 'log.tun_start_failed' || errorTag(e) === 'log.tun_adapter_unstable') {
      await tunFellBackToProxy(link, e);
      return;
    }
    log(t('log.error_prefix', null, {err: e}));
    forceShowLogs();
    const item = document.querySelector(`.server-item[data-link="${link}"]`);
    if (item) {
      item.classList.remove('processing', 'connected');
    }
    await disconnect();
  } finally {
    isConnectToLinkActive = false;
  }
}

let trafficController = null;

async function startTrafficTracking(link) {
  if (trafficController) {
    trafficController.abort();
  }
  trafficController = new AbortController();
  
  // Helper: get local YYYY-MM-DD date string (not UTC)
  function getLocalDate() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  
  let retryCount = 0;
  const maxRetries = 15; // Up to 15 seconds of retrying
  
  const connectAndRead = async () => {
    try {
      const response = await fetch('http://127.0.0.1:9090/traffic', { signal: trafficController.signal });
      retryCount = 0; // Connected successfully, reset
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      
      while (isRunning && connectedServerLink === link) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunks = decoder.decode(value, { stream: true }).split('\n');
        for (const chunk of chunks) {
          if (!chunk.trim()) continue;
          try {
            const data = JSON.parse(chunk);
              const speed = data.up + data.down;
              const up = data.up || 0;
              if (speed > 0) {
                const date = getLocalDate();
                const item = Array.from(document.querySelectorAll('.server-item')).find(el => el.dataset.link === link);
                const group = item ? item.dataset.group : null;
                invoke('add_live_traffic', { link, group, speed, upload: up, date }).then(res => {
                  if (res) {
                    // Update group (subscription) UI live
                    if (group) {
                      const hash = hashCode(group);
                      const usageEl = document.getElementById(`client-usage-${hash}`);
                      if (usageEl) {
                        usageEl.textContent = formatBytes(res.group_total);
                      }
                      const uploadEl = document.getElementById(`client-upload-${hash}`);
                      if (uploadEl) {
                        uploadEl.textContent = formatBytes(res.group_upload);
                      }
                    }
                  }
                }).catch(console.error);
                
                // Update Smart Dash live speed
                const dashStats = document.getElementById('smart-dash-stats');
                if (dashStats) {
                  const currentTotalMatch = dashStats.textContent.match(/Total: (.*?)(?: \||$)/);
                  if (currentTotalMatch) {
                    // Visual estimation for dash, actual precise update happens periodically
                  }
                }
              }
          } catch (e) {}
        }
      }
    } catch (err) {
      if (err.name === 'AbortError' || !isRunning || connectedServerLink !== link) return;
      // Retry: the clash_api may not be ready yet (core startup delay)
      if (retryCount < maxRetries) {
        retryCount++;
        setTimeout(connectAndRead, 1000);
      }
    }
  };
  
  connectAndRead();
}

// The backend tags the errors it raises after already saving the session: "i18n:<key>" for
// a self-contained message, or "i18n:<key>|<detail>" when it also has a raw cause to show.
// i18n.js owns the protocol; this is the read side for the error handlers below.
function errorTag(e) {
  return isTaggedError(e) ? e.slice(5).split('|', 2)[0] : null;
}

// A TUN failure that reaches the frontend is not a failed connection: the backend fell back
// to the system proxy and the core is up, so disconnecting here would hang up a working
// session one line after telling the user it still works. Settle the UI into the state the
// machine is actually in -- proxy mode, TUN switch off -- and leave the session alone.
async function tunFellBackToProxy(link, e) {
  const connectedItem = document.querySelector(`.server-item[data-link="${link}"]`);
  if (connectedItem) connectedItem.classList.remove('processing');
  isRunning = true;
  isConnecting = false;
  isReconnecting = false;
  connectedServerLink = link;
  isTunRouted = false;
  updateSmartDash('connected');
  updateConnectBtnText();
  syncTunSwitchFromBackend();
  // Proxy mode can carry the per-app rules a TUN adapter could not, so a warning that was
  // showing a beat ago no longer applies.
  refreshProcessRuleWarning();
  startTrafficTracking(link);
  try { await invoke('save_last_connection', { link, tunMode: false }); } catch (_) {}
  setTimeout(() => checkIp(true), 200);
  log(e);
  forceShowLogs();
}

async function disconnect() {
  try {
    await invoke('disconnect');
    await invoke('save_last_connection', { link: "", tunMode: false });
  } catch (_) {}

  isRunning = false;
  isConnecting = false;
  isReconnecting = false;
  if (trafficController) trafficController.abort();
  
  if (connectedServerLink) {
    const item = document.querySelector(`.server-item[data-link="${connectedServerLink}"]`);
    if (item) {
      item.classList.remove('connected', 'processing', 'timeout');
    }
  }
  
  connectedServerLink = null;
  consecutivePingFailures = 0;
  isConnectToLinkActive = false;
  // Nothing is connected, so any rule that looked inert has nothing to warn about now.
  refreshProcessRuleWarning();

  // Instantly update the UI to offline/online state
  if (baseIp) {
    updateSmartDash('online');
    animateIpAndFlag(baseIp, null);
  } else {
    updateSmartDash('offline');
    animateIpAndFlag('---.---.---.---', null);
  }
  ipAddress.title = '';

  updateConnectBtnText();
  
  // Background task: check local IP and update flag/country
  // The disconnect that fired this is not awaited anywhere, so a user who reconnects in the
  // second or two this request takes is fully connected again by the time it lands. Applying
  // the result unconditionally would then flip a live dashboard back to READY and paint the
  // unproxied IP on top of the real one, where it stays -- nothing else in the UI repaints the
  // IP on its own. Capture what was connected when this started and drop the result if it is
  // no longer this disconnect's world.
  const disconnectToken = ++checkIpToken;
  invoke('check_ip', { useProxy: false }).then(data => {
    if (disconnectToken !== checkIpToken) return;
    if (isRunning || connectedServerLink) return;
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    if (parsed.query) {
      // The sidecar is in no hurry to die, and while it is still up this request rides it even
      // though it asked for no proxy. Painting the tunnel's exit IP as the local one would make
      // the next connect compare the real proxied IP against it and report no routing.
      if (parsed.tun_routed) return;
      animateTextChange(countryName, parsed.country || t('dock.unknown_country'));
      const code = (parsed.countryCode || '').toLowerCase();
      let flagSrc = null;
      if (code && code !== 'unknown') {
        flagSrc = `https://flagcdn.com/w40/${code}.png`;
      }
      animateIpAndFlag(parsed.query || '---.---.---.---', flagSrc);
      baseIp = parsed.query;
      updateSmartDash('online');
    }
  }).catch(() => {});
}

function updateConnectBtnText() {
  const btnConnect = document.getElementById('btn-connect');
  if (!btnConnect) return;
  const textSpan = btnConnect.querySelector('.connect-text');

  if (!selectedServerLink) {
    // Nothing is selected. This used to early-return and keep whatever label a previous
    // selection had painted, so deleting the connected server left a button reading
    // "Disconnect" that only logged "select a server first" when clicked -- a control that
    // explains neither its state nor why it does nothing.
    if (textSpan) textSpan.textContent = t('common.connect');
    btnConnect.classList.remove('disconnect');
    const group = document.getElementById('lcd-capsule');
    if (group) group.classList.remove('disconnect');
    return;
  }

  if (isRunning) {
    if (selectedServerLink === connectedServerLink) {
      if (textSpan) textSpan.textContent = t('common.disconnect');
      btnConnect.classList.add('disconnect');
      const group = document.getElementById('lcd-capsule');
      if (group) group.classList.add('disconnect');
    } else {
      if (textSpan) textSpan.textContent = t('common.switch_server');
      btnConnect.classList.remove('disconnect');
      const group = document.getElementById('lcd-capsule');
      if (group) group.classList.remove('disconnect');
    }
  } else {
    if (textSpan) textSpan.textContent = t('common.connect');
    btnConnect.classList.remove('disconnect');
    const group = document.getElementById('lcd-capsule');
    if (group) group.classList.remove('disconnect');
  }
}

// ===== IP Check =====
// Bumped by every connect and every disconnect, so an in-flight `check_ip` can tell whether
// the state it was launched against is still the state on screen. See `disconnect` for why a
// late result is worse than no result.
let checkIpToken = 0;

async function checkIp(useProxy) {
  if (useProxy && !isRunning) return;

  const myToken = ++checkIpToken;
  try {
    const data = await invoke('check_ip', { useProxy });
    if (useProxy && !isRunning) return; // Disconnected while awaiting
    if (myToken !== checkIpToken) return; // A later connect or disconnect superseded this one
    
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;

    if (parsed.error) {
      if (isRunning && isConnecting) {
        if (Date.now() - connectStartTime > 15000) {
          log(t('log.timeout_unreachable'));
          isConnecting = false;
          consecutivePingFailures = 4; // Force ping failure state so it matches
          updateSmartDash('timeout');
          
          if (connectedServerLink) {
            const item = document.querySelector(`.server-item[data-link="${connectedServerLink}"]`);
            if (item) {
              item.classList.remove('processing', 'connected');
              item.classList.add('timeout');
            }
          }
          return;
        }
        const pollInterval = (Date.now() - connectStartTime < 3000) ? 250 : 500;
        setTimeout(() => checkIp(useProxy), pollInterval);
        return;
      }
      animateTextChange(countryName, t('dock.ip_failed'));
      animateIpAndFlag(t('dock.ip_failed'), 'data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22%2394a3b8%22%3E%3Cpath d=%22M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z%22/%3E%3C/svg%3E');
      return;
    }

    if (isRunning && isConnecting) {
      // A TUN adapter routes the app's own unproxied requests too, so this probe reports the
      // tunnel's exit IP and the comparison underneath can only ever agree. In that mode "traffic
      // is not being routed" is undecidable from two IPs that cannot differ, so the test is
      // skipped rather than allowed to call a working tunnel a timeout.
      if (!useProxy && !parsed.tun_routed && baseIp && parsed.query === baseIp) {
        if (Date.now() - connectStartTime > 15000) {
          log(t('log.timeout_routing'));
          isConnecting = false;
          consecutivePingFailures = 4;
          updateSmartDash('timeout');
          
          if (connectedServerLink) {
            const item = document.querySelector(`.server-item[data-link="${connectedServerLink}"]`);
            if (item) {
              item.classList.remove('processing', 'connected');
              item.classList.add('timeout');
            }
          }
          return;
        }
        const pollInterval2 = (Date.now() - connectStartTime < 3000) ? 250 : 500;
        setTimeout(() => checkIp(useProxy), pollInterval2);
        return;
      }

      if (!isTunRouted) {
        isTunRouted = true;
        runLivePing();
      }
    }

    if (isRunning) {
      if (!useProxy) {
        // The probe that asks for no proxy still rides a live TUN adapter, so in that mode its
        // address is the tunnel's exit and storing it here would poison the comparison above
        // for the whole session.
        if (parsed.query && !baseIp && !parsed.tun_routed) baseIp = parsed.query;
        return; // Prevent delayed local IP check from overwriting VPN IP
      }

      if (isConnecting && isTunRouted) {
        consecutiveReconnects = 0;
        log(t('log.connected_ip', null, {ip: parsed.query}));
      } else if (!isConnecting && !testingActive) {
        // Do not overwrite ping
      }
    } else {
      // Not connected but got an IP — we're online (just idle)
      if (!useProxy) {
        // A sidecar still winding down answers this probe through the tunnel, so the address is
        // not the machine's own. Leaving baseIp empty shows no IP rather than recording one the
        // next connect would compare its proxied IP against.
        if (!parsed.tun_routed) {
          updateSmartDash('online');
          baseIp = parsed.query;
        }
      }
    }

    animateTextChange(countryName, parsed.country || t('dock.unknown_country'));
    const code = (parsed.countryCode || '').toLowerCase();
    let flagSrc = null;
    if (code && code !== 'unknown') {
      flagSrc = `https://flagcdn.com/w40/${code}.png`;
    }
    animateIpAndFlag(parsed.query || '---.---.---.---', flagSrc);
  } catch (e) {
    if (isRunning && isConnecting) {
      if (Date.now() - connectStartTime > 5000) {
        log(t('log.timeout_network'));
        isConnecting = false;
        consecutivePingFailures = 4;
        updateSmartDash('timeout');
        
        if (connectedServerLink) {
          const item = document.querySelector(`.server-item[data-link="${connectedServerLink}"]`);
          if (item) {
            item.classList.remove('processing', 'connected');
            item.classList.add('timeout');
          }
        }
        return;
      }
      const pollInterval3 = (Date.now() - connectStartTime < 3000) ? 250 : 500;
      setTimeout(() => checkIp(useProxy), pollInterval3);
    }
  }
}

// ===== Live Ping =====
// The `.ping-off` class this used to toggle has no CSS rule, so it did nothing. The
// badge actually reflects the setting inside updateSmartDash (static "LIVE" vs. the
// live ms value), so re-rendering the dash is what makes the toggle visible.
function applyLivePingToggle() {
  updateSmartDash(_lastDashState, _lastDashPing);
}

async function runLivePing() {
  if (!isRunning || !connectedServerLink) {
    updateLivePingLabel(null);
    return;
  }

  const currentLink = connectedServerLink;
  const pingStartTime = Date.now();
  try {
    const latency = await invoke('get_live_ping', { link: currentLink });
    if (currentLink === connectedServerLink && connectStartTime <= pingStartTime) {
      updateLivePingLabel(latency);
    }
  } catch (_) {
    if (currentLink === connectedServerLink && connectStartTime <= pingStartTime) {
      updateLivePingLabel(null);
    }
  }
}

function updateLivePingLabel(latency) {
  if (!isRunning) {
    consecutivePingFailures = 0;
    return;
  }

  if (latency === null || latency === 'Timeout' || latency === undefined) {
    consecutivePingFailures++;
    
    if (consecutivePingFailures >= 4) {
      log(t('log.may_be_unreachable'));
      if (isConnecting) {
        isConnecting = false; // Give up loading state and show timeout visually
      }
      updateSmartDash('timeout');
      
      if (connectedServerLink) {
        const item = document.querySelector(`.server-item[data-link="${connectedServerLink}"]`);
        if (item) {
          item.classList.remove('processing');
          item.classList.remove('connected');
          item.classList.add('timeout');
        }
      }
    } else {
      if (isConnecting) {
        updateSmartDash('processing');
      } else {
        // Suppress transient 'Timeout' error state to prevent UI flashing.
        // It smoothly preserves the last known ping value until the max failure limit is reached.
        updateSmartDash('connected', null);
      }
    }
    return;
  }

  consecutivePingFailures = 0;

  const ms = typeof latency === 'number' ? latency : parseInt(latency);
  
  if (connectedServerLink && (!isConnecting || isTunRouted)) {
    const item = document.querySelector(`.server-item[data-link="${connectedServerLink}"]`);
    if (item) {
      item.classList.remove('processing');
      item.classList.remove('timeout');
      item.classList.add('connected');
    }
  }
  
  if (isConnecting) {
    if (isTunRouted) {
      isConnecting = false;
      updateSmartDash('connected', ms);
    } else {
      updateSmartDash('processing');
    }
  } else {
    updateSmartDash('connected', ms);
  }
}

// ===== Crash Monitor =====
let isReconnecting = false;
let consecutiveReconnects = 0;

async function checkCoreHealth() {
  // A mode switch holds the backend's reload lock for as long as it is bringing the adapter up,
  // and `revive_tun` takes the same lock. A beat that fires mid-switch queues a repair behind a
  // supervised bring-up that will report its own outcome, and the next beat queues another. Each
  // one then runs its own reload once the lock is free, so a slow adapter stopped being slow and
  // became a freeze. `isConnecting` is set for the whole switch in `handleTunToggle` and cleared
  // on every path out of it.
  if (!isRunning || isReconnecting || isConnectToLinkActive || isConnecting) return;

  try {
    const alive = await invoke('is_core_alive');
      if (!alive) {
        // A TUN session is two processes: the adapter and the core beneath it. Losing the adapter
        // used to be answered by reconnecting, which kills the core as well -- the session dies
        // over one replaceable process, and that is the "the connection dies" half of TUN mode.
        // Ask for the adapter alone back first. It reports whether the session survived without a
        // reconnect; a session it cannot repair returns false and takes the reconnect below.
        let revived = false;
        try {
          revived = await invoke('revive_tun');
        } catch (e) {
          // The reload lands in proxy mode when the adapter will not stay up, and the backend tags
          // the error for a human message. Log it and let the reconnect decide whether it is still
          // needed -- the liveness re-check below is what stops a needless one.
          log(e);
          // The backend cleared its TUN flag on the way down, and the switch has to agree before
          // the reconnect below reads it: `connectToLink` takes its mode from this checkbox, so a
          // stale ON sends the repair straight back into the same adapter that just failed.
          await syncTunSwitchFromBackend();
          revived = false;
        }

        if (revived) {
          // The adapter is a new process, so the routes it published are new too; the dashboard is
          // otherwise showing the latency of an adapter that no longer exists.
          isTunRouted = true;
          consecutivePingFailures = 0;
          // `revive_tun` reports success only once the adapter has installed a default route, so
          // the dashboard can settle on the real state right away rather than on a process that
          // is alive but still coming up. Without this the poll's next beat would repaint a
          // latency for a tunnel that is not carrying anything yet.
          updateSmartDash('connected');
          return;
        }

        // The session really is gone, or the reload could not save it. Re-check liveness before
        // reconnecting: a sidecar the reload repaired between the two calls leaves nothing to do,
        // and reconnecting anyway is the needless disconnect this whole branch exists to avoid.
        if (await invoke('is_core_alive')) {
          // The reload put the session into proxy mode when it could not bring the adapter back,
          // and this is the only path that knows. `isTunRouted` is still true from before and the
          // ping label below believes it, so the dashboard keeps advertising a tunnel over a
          // machine that routes through the system proxy.
          if (isTunRouted) {
            isTunRouted = false;
            await syncTunSwitchFromBackend();
          }
          return;
        }

        // Save the link before any state changes
        const savedLink = connectedServerLink;
        if (!savedLink) return;
        
        isReconnecting = true;
        consecutiveReconnects++;
        updateSmartDash('processing');
        
        if (consecutiveReconnects > 3) {
          log(t('log.core_start_failed', null, {count: consecutiveReconnects}));
          isReconnecting = false;
          isRunning = false;
          // Cleared before the disconnect is awaited rather than after: until that async call
          // lands, isRunning is still true, so the next 2s poll saw a dead core and started
          // another reconnect cycle on top of this give-up -- the two took turns logging
          // "failed" and "reconnecting" indefinitely.
          await disconnect();
          return;
        }

        log(t('log.core_reconnecting', null, {count: consecutiveReconnects, link: savedLink.substring(0, 40)}));
        
        // Wait a moment then reconnect
        setTimeout(async () => {
          if (isConnectToLinkActive || !isReconnecting) {
              log(t('log.reconnect_aborted'));
              isReconnecting = false;
              return;
          }
          try {
            connectedServerLink = null; // Reset so connectToLink works clean
            isRunning = false;
            isConnecting = false;
            selectedServerLink = savedLink;
            await connectToLink(savedLink, true);
            isReconnecting = false;
            // We do not reset consecutiveReconnects here; we wait for a successful connection to do it.
          } catch (e) {
            log(t('log.reconnect_failed', null, {err: e}));
            // Restore state for next retry attempt
            connectedServerLink = savedLink;
            isRunning = true; // Keep health check alive
            isReconnecting = false;
            // The next health check (every 2s) will detect core is dead and retry
          }
        }, 2000);
      }
  } catch (_) {}
}

// ===== Latency Testing =====
let shouldStopTesting = false;

async function testAllLatency() {
  if (testingActive) {
    shouldStopTesting = true;
    invoke('cancel_latency_tests').catch(()=>{});
    if (btnTest) { btnTest.textContent = t('ping.stopping'); btnTest.disabled = true; }
    return;
  }

  testingActive = true;
  shouldStopTesting = false;
  invoke('start_latency_tests').catch(()=>{});
  if (btnTest) btnTest.textContent = t('ping.stop_testing');

  const links = [];
  document.querySelectorAll('.server-item').forEach(item => {
    links.push(item.dataset.link);
    const latEl = item.querySelector('.server-latency');
    if (latEl) updateLatencyDisplay(latEl, t('ping.testing'));
  });

  if (links.length === 0) {
    finishLatencyTest();
    return;
  }

  const maxConcurrency = 5;
  let currentIndex = 0;
  
  async function worker() {
    while (currentIndex < links.length && !shouldStopTesting) {
      const index = currentIndex++;
      const link = links[index];
      
      updateLatencyUi(link, 'Testing...');
      try {
        const result = await invoke('test_single_latency', { link });
        if (shouldStopTesting) { updateLatencyUi(link, ''); return; }
        const parsed = typeof result === 'string' ? JSON.parse(result) : result;
        const latency = parsed.latency !== undefined ? parsed.latency : parsed;
        updateLatencyUi(link, latency);
      } catch (e) {
        if (!shouldStopTesting) updateLatencyUi(link, 'Error');
      }
    }
  }

  const workers = [];
  for (let i = 0; i < maxConcurrency; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);

  if (shouldStopTesting) {
    const placeholder = t('ping.testing');
    document.querySelectorAll('.server-item').forEach(item => {
      const latEl = item.querySelector('.server-latency');
      if (latEl && (latEl.textContent === placeholder || latEl.textContent === '...')) {
        updateLatencyDisplay(latEl, '');
      }
    });
  }

  // The flags have to reset on every exit path, not just the stop path. This used to call a
  // `finishLatencyTest` that does not exist anywhere in the app, so the normal completion threw
  // here, `testingActive` stayed true, and pingSingleItem/pingGroup have been silently refusing
  // to run ever after -- they gate on that flag.
  testingActive = false;
  shouldStopTesting = false;
}

async function pingSingleItem(link) {
  // Allow concurrent single-server pings (don't block on testingActive)
  // Only block if a full testAllLatency is in progress
  if (testingActive) return;
  updateLatencyUi(link, '...');

  try {
    const result = await invoke('test_single_latency', { link });
    const parsed = typeof result === 'string' ? JSON.parse(result) : result;
    const latency = parsed.latency !== undefined ? parsed.latency : parsed;
    updateLatencyUi(link, latency);
  } catch (e) {
    updateLatencyUi(link, 'Error');
  }
}

function updateLatencyUi(link, latency) {
  const hash = hashCode(link);
  const el = document.getElementById(`latency-${hash}`);
  if (el) updateLatencyDisplay(el, latency);
}

function updateLatencyDisplay(el, latency) {
  if (latency === null || latency === undefined || latency === '') {
    el.textContent = '';
    el.className = 'server-latency';
    return;
  }

  if (typeof latency === 'number') {
    el.textContent = `${latency} ms`;
    if (latency < 0) {
      // Negative latency (e.g. -1) means the test failed/timed out.
      el.className = 'server-latency red';
    } else if (latency < 500) {
      el.className = 'server-latency green';
    } else {
      el.className = 'server-latency yellow';
    }
  } else {
    el.textContent = String(latency);
    if (latency === '...') {
      el.className = 'server-latency';
    } else {
      el.className = 'server-latency red';
    }
  }
}

// ===== Settings =====
// The one list of schemes this client can import. Both the smart-add box and the import modal
// classify pasted text against it, so a second copy anywhere would drift and silently stop
// recognising a scheme the parser still accepts.
const PROXY_PREFIXES = ['vless://', 'vmess://', 'ss://', 'trojan://', 'hy2://', 'hysteria2://', 'tuic://'];

async function handleSmartAdd() {
  const input = document.getElementById('txt-input');
  const text = input.value.trim();
  if (!text) return;

  const isProxy = PROXY_PREFIXES.some(p => text.toLowerCase().startsWith(p));

  if (text.startsWith('http') && text.includes('://') && !isProxy) {
    // Subscription URL
    try {
      await invoke('add_subscription', { url: text });
      input.value = '';
      await updateAllSubscriptions();
    } catch (e) {
      log(t('log.add_sub_failed', null, {err: e}));
    }
  } else if (text.includes('://')) {
    // Single server link
    try {
      await invoke('add_server', { link: text });
      input.value = '';
      await refreshServerList();
      switchTab(0);
    } catch (e) {
      log(t('log.add_server_failed', null, {err: e}));
    }
  } else {
    // Neither a subscription URL nor a server link. Falling through silently left the text in
    // the box and no message anywhere, which reads as the button having ignored the click.
    log(t('log.add_unrecognised'));
  }
}

async function updateAllSubscriptions(force) {
  const btn = document.getElementById('btn-update-subs');
  const allBtn = document.getElementById('btn-update-all-subs');
  if (btn) { btn.disabled = true; btn.textContent = t('log.updating'); }
  if (allBtn) {
    allBtn.disabled = true;
    const svg = allBtn.querySelector('.update-all-svg');
    if (svg) svg.classList.add('spin');
  }

  // Counted rather than assumed: the loop below swallows every per-subscription failure, so a
  // provider that blocks every fetch used to end with "subscriptions updated" logged anyway and
  // the stale lists left looking fresh. The message is only honest when something actually ran.
  let attempted = 0;
  let failed = 0;

  try {
    const subsRaw = await invoke('get_subscriptions');
    const subs = typeof subsRaw === 'string' ? JSON.parse(subsRaw) : subsRaw;

    if (Array.isArray(subs)) {
      for (const sub of subs) {
        const u = typeof sub === 'string' ? sub : (sub.url || sub);
        // A subscription the user set to Manual must be skipped by the automatic
        // refresh; only an explicit "Update All" press overrides it.
        if (u && u !== 'manual' && (force || sub.auto_update !== false)) {
          attempted++;
          try {
            await invoke('update_subscription', { url: u });
          } catch (e) {
            failed++;
            console.error('Failed to update ' + u + ': ' + e);
          }
        }
      }
    }
    await refreshServerList();
    await refreshSubscriptions();
    if (attempted === 0) {
      log(t('log.subs_nothing_to_update'));
    } else if (failed === attempted) {
      log(t('log.subs_updated_none'));
    } else if (failed > 0) {
      log(t('log.subs_updated_partial', null, {ok: attempted - failed, fail: failed}));
    } else {
      log(t('log.subs_updated'));
    }
  } catch (e) {
    log(t('log.update_failed', null, {err: e}));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = t('page.subscriptions.update_all');
    }
    if (allBtn) {
      allBtn.disabled = false;
      const svg = allBtn.querySelector('.update-all-svg');
      if (svg) svg.classList.remove('spin');
    }
  }
}

async function deleteServer(groupKey, link) {
  // Find server element and trigger Telegram-style deletion animation
  const itemEl = Array.from(document.querySelectorAll('.server-item')).find(el => el.dataset.link === link);
  if (itemEl) {
    itemEl.classList.add('deleting-telegram');
  }

  // Run backend delete in parallel
  const deletePromise = invoke('delete_server', { group: groupKey, link });

  // Wait for the collapse and dissolve animation to complete
  await new Promise(r => setTimeout(r, 340));

  try {
    await deletePromise;
    if (selectedServerLink === link) {
      selectedServerLink = null;
    }
    await refreshServerList();
  } catch (e) {
    log(t('log.delete_failed', null, {err: e}));
    await refreshServerList();
  }
}

async function deleteSubscription(groupKey) {
  try {
    await invoke('delete_subscription', { groupKey });
    log(t('log.sub_removed'));
    await refreshServerList();
  } catch (e) {
    log(t('log.delete_sub_failed', null, {err: e}));
  }
}

async function updateSingleSubscription(groupKey) {
  const btnId = `group-update-${hashCode(groupKey)}`;
  const btn = document.getElementById(btnId);
  if (btn) btn.classList.add('updating');

  try {
    await invoke('update_subscription', { url: groupKey });
    await refreshServerList();
    log(t('log.sub_updated', null, {name: (groupKey.split('/')[2] || groupKey)}));
  } catch (e) {
    log(t('log.update_failed', null, {err: e}));
  }

  if (btn) btn.classList.remove('updating');
}

async function pingGroup(groupKey) {
  if (testingActive) return;
  testingActive = true;
  shouldStopTesting = false;
  invoke('start_latency_tests').catch(()=>{});

  const groupEl = document.querySelector(`.sub-group[data-group-key="${groupKey}"]`);
  if (!groupEl) { testingActive = false; return; }

  // Expand if collapsed
  if (groupEl.classList.contains('collapsed')) {
    collapsedGroups[groupKey] = false;
    groupEl.classList.remove('collapsed');
  }

  const items = groupEl.querySelectorAll('.server-item');
  const links = [];
  items.forEach(item => {
    links.push(item.dataset.link);
    const latEl = item.querySelector('.server-latency');
    if (latEl) updateLatencyDisplay(latEl, t('ping.testing'));
  });
  links.forEach(link => updateLatencyUi(link, t('ping.testing')));
    try {
      const results = await invoke('test_all_latency', { links });
      const parsed = typeof results === 'string' ? JSON.parse(results) : results;

      for (const [link, latency] of Object.entries(parsed)) {
        updateLatencyUi(link, latency);
      }
    } catch (e) {
    if (!shouldStopTesting) {
      links.forEach(link => updateLatencyUi(link, 'Error'));
    }
  }

  // A failed or partial response leaves the chips the backend never answered on the translated
  // "Testing..." string for good, which reads as a test that never finished. Anything still
  // showing the placeholder has no result to show, on either exit path.
  const placeholder = t('ping.testing');
  items.forEach(item => {
    const latEl = item.querySelector('.server-latency');
    if (latEl && (latEl.textContent === placeholder || latEl.textContent === '...')) {
      updateLatencyDisplay(latEl, '');
    }
  });

  testingActive = false;
  shouldStopTesting = false;
}

// Reachability of every server in a group, measured by a raw TCP connect. Deliberately touches
// none of the state the real-delay path uses: `testingActive`, `shouldStopTesting` and the
// backend's CANCEL_TESTS all gate that path, and setting them here would cut short a real-delay
// test running at the same time. The backend bounds each connect itself, so there is no stop
// button to wire and no flag to leave stuck at true if this throws.
let tcpTestingActive = false;

async function tcpPingGroup(groupKey) {
  if (tcpTestingActive) return;
  tcpTestingActive = true;

  try {
    const groupEl = document.querySelector(`.sub-group[data-group-key="${groupKey}"]`);
    if (!groupEl) return;

    if (groupEl.classList.contains('collapsed')) {
      collapsedGroups[groupKey] = false;
      groupEl.classList.remove('collapsed');
    }

    const items = groupEl.querySelectorAll('.server-item');
    const links = [];
    items.forEach(item => {
      links.push(item.dataset.link);
      updateTcpLatencyUi(item.dataset.link, '...');
    });

    const results = await invoke('test_all_tcp_ping', { links });
    const parsed = typeof results === 'string' ? JSON.parse(results) : results;

    for (const [link, ms] of Object.entries(parsed)) {
      updateTcpLatencyUi(link, ms);
    }
    // A partial or failed response never touches the links the backend did not answer for, so
    // without this they sit on the "..." painted before the invoke forever -- indistinguishable
    // from a test that is still running. Clearing every chip still showing the placeholder is
    // also what makes a total failure read as finished rather than hung.
    items.forEach(item => {
      const latEl = document.getElementById(`tcp-latency-${hashCode(item.dataset.link)}`);
      if (latEl && (latEl.textContent === '...' || latEl.textContent === 'Testing...')) {
        updateTcpLatencyDisplay(latEl, -1);
      }
    });
    log(t('log.tcp_ping_done'));
  } catch (e) {
    console.error('TCP ping test failed:', e);
  } finally {
    tcpTestingActive = false;
  }
}

function updateTcpLatencyUi(link, ms) {
  const el = document.getElementById(`tcp-latency-${hashCode(link)}`);
  if (el) updateTcpLatencyDisplay(el, ms);
}

function updateTcpLatencyDisplay(el, ms) {
  if (ms === null || ms === undefined || ms === '') {
    el.textContent = '';
    el.className = 'server-latency tcp';
    return;
  }

  // The real-delay chip renders a failed test as "-1 ms"; here the numbers are small enough
  // that a dash reads more clearly as "no result" than a negative latency would.
  if (typeof ms === 'number') {
    if (ms < 0) {
      el.textContent = 'TCP —';
      el.className = 'server-latency tcp red';
    } else {
      el.textContent = `TCP ${ms} ms`;
      el.className = 'server-latency tcp ' + (ms < 500 ? 'green' : 'yellow');
    }
  } else {
    el.textContent = 'TCP ...';
    el.className = 'server-latency tcp';
  }
}

async function clearData() {
  const ok = confirm(t('settings.clear_data.confirm'));
  if (!ok) return;

  try {
    await invoke('clear_data');
    selectedServerLink = null;
    connectedServerLink = null;
    await refreshServerList();
    await refreshSubscriptions();
    await refreshRoutingRules();
    await refreshStatsData();
    await loadSettingsValues();
    log(t('log.data_cleared'));
  } catch (e) {
    log(t('log.clear_failed', null, {err: e}));
  }
}

// ===== TUN Toggle =====
let isTunSwitching = false;

// Puts the switch back where the backend actually has it. Every toggle flips the checkbox
// optimistically, and several paths below can fail after the flip; without this the control
// shows a mode the app never entered, and `get_tun_enabled` is otherwise read only once at
// startup, so the disagreement outlives the window.
async function syncTunSwitchFromBackend() {
  try {
    const enabled = await invoke('get_tun_enabled');
    if (tunToggle) {
      tunToggle.checked = !!enabled;
      updateTunUIState();
    }
  } catch (_) {}
}

async function handleTunToggle() {
  // The chip has no debounce of its own: each click dispatches a fresh `change`, and a mode
  // switch costs up to the readiness window. A second click while the first is still in flight
  // does not cancel it -- `switch_tun_mode` holds the reload lock for its whole run, so the two
  // serialize and the second one kills a sidecar the first one only just started, over a link the
  // user may have changed in between. Refusing the click is the only safe answer, and the flag is
  // cleared on every way out below rather than at one site.
  if (isTunSwitching) {
    log(t('log.processing_ui'));
    return;
  }
  isTunSwitching = true;
  const done = () => { isTunSwitching = false; };

  const checked = tunToggle.checked;
  // Instantly update the visual micro-checkbox so the UI feels smooth and responsive
  updateTunUIState();

  if (checked) {
    try {
      const admin = await invoke('is_admin');
      if (!admin) {
        await invoke('toggle_tun', { enabled: true });

        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.top = '0'; overlay.style.left = '0';
        overlay.style.width = '100vw'; overlay.style.height = '100vh';
        overlay.style.backgroundColor = 'rgba(0,0,0,0.85)';
        overlay.style.color = 'white';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.zIndex = '9999';
        overlay.style.backdropFilter = 'blur(4px)';
        overlay.innerHTML = `<div style="text-align:center; padding: 20px; border-radius: 12px; background: var(--bg-secondary);"><h3>${t('tun.admin_required')}</h3><p style="margin-top: 10px; color: var(--text-secondary);">${t('tun.admin_required_desc')}</p></div>`;
        document.body.appendChild(overlay);

        // The restart is fired on a timer rather than awaited, so a refused UAC or a backend
        // error rejects a promise nobody is watching and the sheet above is the last thing
        // painted. Attach the catch here so the failure is visible instead of permanent: the
        // overlay comes down, the switch goes back to the state the backend is actually in, and
        // the dashboard is not left pinned on a spinner for a restart that will not happen.
        setTimeout(() => {
          invoke('restart_as_admin').catch((e) => {
            log(t('log.tun_elevation_failed', null, {err: e}));
            overlay.remove();
            syncTunSwitchFromBackend();
            if (isRunning || isConnecting) updateSmartDash('connected');
          });
        }, 3000);
        done();
        return;
      }
    } catch (e) {
      // `is_admin` itself can reject. Without this the toggle falls through to the plain
      // invoke below and silently tries to enable TUN without the elevation it needs.
      log(t('log.tun_admin_check_failed', null, {err: e}));
      syncTunSwitchFromBackend();
      done();
      return;
    }
  }

  try {
    await invoke('toggle_tun', { enabled: checked });
  } catch (e) {
    // The switch was flipped optimistically at the top of this function. A rejected write
    // leaves it showing the mode the backend never entered, and nothing else in the app
    // re-reads the setting after startup, so the disagreement would survive until restart.
    log(t('log.tun_toggle_failed', null, {err: e}));
    syncTunSwitchFromBackend();
    done();
    return;
  }

  // If connected, reconnect with new mode
  if (isRunning && connectedServerLink) {
    const modeStr = checked ? 'TUN' : 'System Proxy';
    log(t('log.switching_mode', null, {mode: modeStr}));
    
    const activeItem = document.querySelector(`.server-item[data-link="${connectedServerLink}"]`);
    if (activeItem) {
      activeItem.classList.remove('connected', 'failed', 'timeout');
      activeItem.classList.add('processing');
    }
    updateSmartDash('processing');
    try {
      const linkToReconnect = connectedServerLink;
      
      isConnecting = true;
      isTunRouted = false;
      connectStartTime = Date.now();
      consecutivePingFailures = 0;
      
      try {
        await invoke('switch_tun_mode', { tunMode: checked, link: linkToReconnect });
        
        if (!isRunning || connectedServerLink !== linkToReconnect) {
            log(t('log.tun_switch_aborted'));
            isConnecting = false;
            done();
            return;
        }

        if (checked) {
          // In TUN mode: keep processing state on both the slot and dashboard until checkIp verifies connectivity!
          isConnecting = true;
          isTunRouted = false;
          updateSmartDash('processing');
          if (activeItem) {
            activeItem.classList.remove('connected', 'failed', 'timeout');
            activeItem.classList.add('processing');
          }
        } else {
          // Switched to proxy mode: system proxy is immediately active
          isConnecting = false;
          isTunRouted = true;
          updateSmartDash('connected');
          if (activeItem) {
            activeItem.classList.remove('processing', 'failed', 'timeout');
            activeItem.classList.add('connected');
          }
        }
        done();

        setTimeout(() => checkIp(true), 300);

        // Restart traffic tracking after seamless reconnect
        startTrafficTracking(linkToReconnect);
      } catch (e) {
        if (errorTag(e) === 'log.tun_start_failed' || errorTag(e) === 'log.tun_adapter_unstable') {
          await tunFellBackToProxy(linkToReconnect, e);
          done();
          return;
        }
        log(t('log.tun_switch_conn_failed', null, {err: e}));
        isConnecting = false;
        disconnect();
      } finally {
        isConnectToLinkActive = false;
      }
    } catch (e) {
      isConnecting = false;
      log(t('log.tun_switch_failed', null, {err: e}));
      if (consecutivePingFailures >= 4) {
        updateSmartDash('timeout');
      } else {
        updateSmartDash('connected'); // Revert to connected on failure
      }
      done();
    }
  }

  // The two paths above that fall out of the reconnect block instead of returning -- a toggle while
  // not connected, and a switch failure that is not the TUN-start fallback -- reach the end of the
  // function without passing any of the done() calls above. Re-clearing here is a no-op on the
  // paths that already cleared it, and it is the difference between a chip that recovers and one
  // that stays dead for the rest of the session.
  done();
}

// ===== Logs =====
function toggleLogs() {
  logsOpen = !logsOpen;
  logViewer.classList.toggle('open', logsOpen);
  if (btnLogs) btnLogs.classList.toggle('active', logsOpen);
}

function forceShowLogs() {
  logsOpen = true;
  logViewer.classList.add('open');
  if (btnLogs) btnLogs.classList.add('active');
}

function log(msg) {
  const line = document.createElement('div');
  // A message the backend tagged is already a complete, translated sentence; resolving it
  // here keeps every log() call site free of the tag protocol.
  line.textContent = errorTag(msg) ? resolveTagged(msg) : msg;
  logViewer.appendChild(line);
  logViewer.scrollTop = logViewer.scrollHeight;
}

// ===== Clipboard =====
// Fires the write and then confirms it, so the copy buttons do not look dead.
let copyToastTimer = null;
function showToast(msg) {
  let toast = document.getElementById('copy-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'copy-toast';
    toast.className = 'copy-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.remove('show');
  void toast.offsetWidth; // restart the entry transition on rapid re-copies
  toast.classList.add('show');
  clearTimeout(copyToastTimer);
  copyToastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
}

async function copyToClipboard(text) {
  let ok = false;
  try {
    await invoke('copy_to_clipboard', { text });
    ok = true;
  } catch (err) {
    console.warn('Native clipboard copy failed, falling back:', err);
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch (_) {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand('copy');
      document.body.removeChild(ta);
    }
  }
  if (ok) showToast(t('common.copied'));
}

// ===== Helpers =====
function extractFlagEmoji(text) {
  const match = text.match(/[\uD83C][\uDDE6-\uDDFF][\uD83C][\uDDE6-\uDDFF]/);
  return match ? match[0] : null;
}

function emojiToCountryCode(emoji) {
  try {
    const codePoints = [...emoji].map(c => c.codePointAt(0));
    return codePoints.map(cp => String.fromCharCode(cp - 0x1F1E6 + 0x61)).join('');
  } catch (_) {
    return null;
  }
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

// ===== Global Events =====
document.addEventListener('click', (e) => {
  // Close any open dropdown menus if clicking outside
  if (!e.target.closest('.group-dropdown-menu') && !e.target.closest('.group-action-btn')) {
    document.querySelectorAll('.group-dropdown-menu.show').forEach(el => {
      el.classList.remove('show');
    });
  }
});

// Disable default right-click across the entire application.
// Only right-clicking on a subscription header opens its 3-dots dropdown menu.
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();

  const groupHeader = e.target.closest('.group-header');
  if (groupHeader && !e.target.closest('.group-dropdown-menu')) {
    e.stopPropagation();
    const dropdownMenu = groupHeader.querySelector('.group-dropdown-menu');
    if (dropdownMenu) {
      document.querySelectorAll('.group-dropdown-menu.show').forEach(el => {
        if (el !== dropdownMenu) el.classList.remove('show');
      });
      dropdownMenu.classList.toggle('show');
    }
  }
});

// ===== Selected Server Ping Shortcut =====
function triggerPingTestShortcut() {
  // Check if a server is selected (has white glowing plate / selectedServerLink)
  let targetLink = selectedServerLink;
  if (!targetLink) {
    const selectedItem = document.querySelector('.server-item.selected');
    if (selectedItem && selectedItem.dataset.link) {
      targetLink = selectedItem.dataset.link;
    }
  }

  if (targetLink) {
    // Only test the single server that was clicked/selected
    pingSingleItem(targetLink);
  } else {
    log(t('log.select_server_click'));
  }
}

// ===== Server Copied Visual Feedback =====
function showServerCopiedFeedback(itemOrLink) {
  let el = null;
  if (typeof itemOrLink === 'string') {
    el = Array.from(document.querySelectorAll('.server-item')).find(item => item.dataset.link === itemOrLink);
  } else if (itemOrLink instanceof HTMLElement) {
    el = itemOrLink.closest('.server-item') || itemOrLink;
  }
  if (!el) {
    el = document.querySelector('.server-item.selected');
  }
  if (!el) return;

  const nameEl = el.querySelector('.server-name');
  if (nameEl) {
    if (nameEl.dataset.isCopying === 'true') return;
    nameEl.dataset.isCopying = 'true';
    const origHtml = nameEl.innerHTML;
    const origText = nameEl.textContent;

    // Pure glowing animated typography (exact text "Copied Link", no capsule, no box, no checkmark)
    nameEl.innerHTML = `<span class="copied-link-text">${t('common.copied_link')}</span>`;

    setTimeout(() => {
      const textSpan = nameEl.querySelector('.copied-link-text');
      if (textSpan) {
        textSpan.classList.add('fade-out');
        setTimeout(() => {
          if (nameEl && nameEl.dataset.isCopying === 'true') {
            nameEl.innerHTML = origHtml || origText;
            nameEl.style.animation = 'fancyTextIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards';
            setTimeout(() => {
              if (nameEl) nameEl.style.animation = '';
              delete nameEl.dataset.isCopying;
            }, 210);
          }
        }, 190);
      } else {
        nameEl.innerHTML = origHtml || origText;
        delete nameEl.dataset.isCopying;
      }
    }, 1100);
  }
}

// ===== Selected Server Copy Shortcut =====
async function triggerCopyShortcut() {
  let targetLink = selectedServerLink;
  let targetItem = null;
  if (!targetLink) {
    targetItem = document.querySelector('.server-item.selected');
    if (targetItem && targetItem.dataset.link) {
      targetLink = targetItem.dataset.link;
    }
  } else {
    targetItem = Array.from(document.querySelectorAll('.server-item')).find(el => el.dataset.link === targetLink);
  }

  if (targetLink) {
    await copyToClipboard(targetLink);
    showServerCopiedFeedback(targetItem || targetLink);
    log(t('log.link_copied'));
  } else {
    log(t('log.select_server_click'));
  }
}

// ===== Global Keyboard Shortcuts =====
// The Persian layout labels these keys with Persian letters (V -> ر, C -> ز, R -> ق),
// so the e.key comparisons need the Persian glyph to work on a Persian keyboard.
// Written as escapes because the raw glyphs were once mangled into mojibake by a
// bad codepage round-trip, and the escapes cannot decay that way.
window.addEventListener('keydown', async (e) => {
  const isCtrlOrCmd = e.ctrlKey || e.metaKey;
  const isKeyR = e.code === 'KeyR' || e.keyCode === 82 || e.which === 82 || (e.key && e.key.toLowerCase() === 'r') || e.key === 'ق';
  const isKeyV = e.code === 'KeyV' || e.keyCode === 86 || e.which === 86 || (e.key && e.key.toLowerCase() === 'v') || e.key === 'ر';
  const isKeyC = e.code === 'KeyC' || e.keyCode === 67 || e.which === 67 || (e.key && e.key.toLowerCase() === 'c') || e.key === 'ژ' || e.key === 'ز';
  const isF5 = e.key === 'F5' || e.keyCode === 116 || e.code === 'F5';

  // 1. Enter in subscription add input
  if (e.key === 'Enter' && document.activeElement?.id === 'txt-input') {
    handleSmartAdd();
    return;
  }

  // 2. Escape to close any open modal
  if (e.key === 'Escape' || e.keyCode === 27) {
    closeImportModal();
    closeEditSubModal();
    closeEditServerModal();
    closeStatsModal();
    return;
  }

  // 3. Ctrl+R / Cmd+R / F5: Test real delay ping of ONLY the selected server (disable browser reload)
  if ((isCtrlOrCmd && isKeyR) || isF5) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    triggerPingTestShortcut();
    return;
  }

  // 4. Ctrl+C / Cmd+C: Copy link of the selected server
  if (isCtrlOrCmd && isKeyC) {
    const selection = window.getSelection()?.toString();
    const active = document.activeElement;
    const isInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);

    // If user has highlighted text or is selecting text inside an input, preserve normal copy
    if ((selection && selection.trim().length > 0) || (isInput && active.selectionStart !== active.selectionEnd)) {
      return;
    }

    let targetLink = selectedServerLink || document.querySelector('.server-item.selected')?.dataset.link;
    if (targetLink) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      await triggerCopyShortcut();
    }
    return;
  }

  // 5. Ctrl+V / Cmd+V: Global paste to import servers or subscriptions
  if (isCtrlOrCmd && isKeyV) {
    const active = document.activeElement;
    const isInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
    
    // If typing in another input (e.g. search, renaming), let browser handle normal paste
    if (isInput && active.id !== 'txt-import-content') {
      return;
    }

    // If already inside the import textarea, let normal paste happen and update preview
    if (active && active.id === 'txt-import-content') {
      setTimeout(updateImportPreview, 20);
      return;
    }

    // Global paste triggered from outside inputs
    e.preventDefault();
    e.stopPropagation();
    await handleGlobalPasteShortcut();
  }
}, { capture: true, passive: false });

async function handleGlobalPasteShortcut() {
  try {
    let text = '';
    try {
      text = await invoke('read_from_clipboard');
    } catch (_) {
      text = await navigator.clipboard.readText();
    }
    if (!text || !text.trim()) {
      openImportModal();
      return;
    }

    const { servers, subscriptions } = await parseImportContent(text);
    openImportModal();
    const textarea = document.getElementById('txt-import-content');
    if (textarea) {
      textarea.value = text.trim();
      updateImportPreview();
    }

    if (servers.length > 0 || subscriptions.length > 0) {
      await executeBatchImport();
    }
  } catch (err) {
    console.warn('Clipboard read error on Ctrl+V:', err);
    openImportModal();
  }
}


function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function refreshSubscriptions() {
  try {
    const subsRaw = await invoke('get_subscriptions');
    const subs = typeof subsRaw === 'string' ? JSON.parse(subsRaw) : subsRaw;
    const listEl = document.getElementById('subscriptions-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    if (!subs || !Array.isArray(subs) || subs.length === 0) {
      listEl.innerHTML = `
        <div style="text-align: center; padding: 48px 20px; color: var(--text-secondary); background: var(--ov-003); border: 1px dashed var(--ov-012); border-radius: 14px;">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.4; margin-bottom: 10px;"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
          <div style="font-size: 15px; font-weight: 600; color: var(--text-strong); margin-bottom: 4px;">${t('subs.empty.title')}</div>
          <div style="font-size: 12px; color: var(--text-faint);">${t('subs.empty.desc')}</div>
        </div>
      `;
      return;
    }

    subs.forEach(sub => {
      const url = sub.url;
      const hash = hashCode(url);
      const card = document.createElement('div');
      card.className = 'sub-manage-card';
      card.dataset.url = url;

      // Quota calculation
      let quotaHtml = '';
      let remainingQuotaText = '-';
      if (sub.total && sub.total > 0) {
        const used = (sub.upload || 0) + (sub.download || 0);
        const rem = Math.max(0, sub.total - used);
        remainingQuotaText = formatBytes(rem);
        const pct = Math.min(100, Math.max(0, Math.round((used / sub.total) * 100)));
        const barClass = pct >= 90 ? 'critical' : (pct >= 70 ? 'warning' : 'success');
        
        let expireText = '';
        if (sub.expire) {
          const now = Math.floor(Date.now() / 1000);
          const days = Math.max(0, Math.floor((sub.expire - now) / 86400));
          expireText = `<span class="sub-quota-expire">${t('subs.days_left', null, {count: days, n: days})}</span>`;
        }

        quotaHtml = `
          <div class="sub-quota-box">
            <div class="sub-quota-header">
              <span class="sub-quota-used">${formatBytes(used)} / ${formatBytes(sub.total)} (${pct}%)</span>
              ${expireText}
            </div>
            <div class="sub-quota-bar-wrapper">
              <div class="sub-quota-bar-fill ${barClass}" style="width: ${pct}%;"></div>
            </div>
          </div>
        `;
      } else if (sub.expire) {
        const now = Math.floor(Date.now() / 1000);
        const days = Math.max(0, Math.floor((sub.expire - now) / 86400));
        quotaHtml = `
          <div class="sub-quota-box">
            <div class="sub-quota-header">
              <span class="sub-quota-used">${t('subs.quota.unlimited')}</span>
              <span class="sub-quota-expire">${t('subs.days_left', null, {count: days, n: days})}</span>
            </div>
          </div>
        `;
      }

      // Latency calculation
      const pings = sub.stats?.ping_history || [];
      const avgPing = pings.length > 0 ? Math.round(pings.reduce((a, b) => a + b, 0) / pings.length) + ' ms' : '- ms';

      const serializedSub = JSON.stringify(sub).replace(/"/g, '&quot;');

      card.innerHTML = `
        <div class="sub-card-header">
          <div class="sub-card-title-group">
            <h3 class="sub-card-title" title="${escapeHtml(sub.name || url)}">${escapeHtml(sub.name || url)}</h3>
            <div class="sub-badges">
              <span class="sub-badge servers-badge">${t('common.servers_n', null, {count: sub.servers_count || 0, n: sub.servers_count || 0})}</span>
              ${sub.auto_update ? `<span class="sub-badge update-badge">${t('subs.badge.auto_interval', null, {n: sub.update_interval || 24})}</span>` : `<span class="sub-badge off-badge">${t('subs.badge.manual')}</span>`}
              ${sub.pinned ? `<span class="sub-badge pin-badge">${t('subs.badge.pinned')}</span>` : ''}
            </div>
          </div>
          <div class="sub-card-actions">
            <button class="sub-act-btn btn-update" id="sub-update-btn-${hash}" title="${t('subs.tooltip.update_now')}" onclick="updateSingleSubscriptionCard('${url}', this)">
              <svg class="sub-act-svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
            </button>
            <button class="sub-act-btn btn-stats-toggle" id="sub-stats-toggle-${hash}" title="${t('subs.tooltip.analytics')}" onclick="toggleCardStats('${url}', this)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 20V10M12 20V4M6 20v-6"></path></svg>
            </button>
            <button class="sub-act-btn btn-edit" title="${t('modal.edit_sub.title')}" onclick='openEditSubModal("${url}", ${serializedSub})'>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            </button>
            <button class="sub-act-btn btn-delete" title="${t('subs.tooltip.delete')}" onclick="deleteSubscriptionFromTab('${url}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </div>

        <div class="sub-card-body">
          <div class="sub-url-row" onclick="copyToClipboard('${url}')" title="${t('subs.tooltip.copy_url')}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
            <span class="sub-url-text">${url}</span>
            <span class="sub-copy-hint">${t('subs.copy_hint')}</span>
          </div>
          ${quotaHtml}
          ${sub.announcement ? `
            <div class="sub-announcement-strip">
              <span class="announcement-badge-pill">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M11 5L6 9H2v6h4l5 4V5z"></path>
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
                </svg>
                <span class="announcement-badge-label">${t('subs.badge.announcement')}</span>
              </span>
              <span style="flex: 1; color: var(--text-strong);">${escapeHtml(sub.announcement)}</span>
              <span class="announcement-live-dot"></span>
            </div>
          ` : ''}
        </div>

        <!-- Embedded Live Analytics Drawer -->
        <div class="sub-card-stats-drawer" id="stats-drawer-${hash}" style="display: none;">
          <div class="sub-stats-metrics">
            <div class="sub-metric-card">
              <span class="sub-metric-label">${t('subs.metric.client_usage')}</span>
              <span class="sub-metric-value" id="client-usage-${hash}">${formatBytes(sub.stats?.total_used || 0)}</span>
            </div>
            <div class="sub-metric-card">
              <span class="sub-metric-label">${t('subs.metric.client_upload')}</span>
              <span class="sub-metric-value" id="client-upload-${hash}">${formatBytes(sub.stats?.total_upload || 0)}</span>
            </div>
            <div class="sub-metric-card">
              <span class="sub-metric-label">${t('subs.metric.avg_ping')}</span>
              <span class="sub-metric-value">${avgPing}</span>
            </div>
            <div class="sub-metric-card">
              <span class="sub-metric-label">${t('subs.metric.remaining_data')}</span>
              <span class="sub-metric-value">${remainingQuotaText}</span>
            </div>
            <div class="sub-metric-card">
              <span class="sub-metric-label">${t('edit_sub.auto_update')}</span>
              <span class="sub-metric-value">${sub.auto_update ? sub.update_interval + 'h' : t('subs.badge.manual')}</span>
            </div>
          </div>
          <div class="sub-stats-chart-wrapper">
            <canvas id="sub-chart-${hash}" class="sub-canvas" width="550" height="130"></canvas>
          </div>
        </div>
      `;

      listEl.appendChild(card);
    });
  } catch (e) {
    console.error("Failed to load subs:", e);
  }
}

async function updateSingleSubscriptionCard(url, btn) {
  const svg = btn ? btn.querySelector('.sub-act-svg') : null;
  if (svg) svg.classList.add('spin');
  try {
    await invoke('update_subscription', { url });
    await refreshSubscriptions();
    await refreshServerList();
  } catch (e) {
    console.error('Update failed:', e);
  } finally {
    if (svg) svg.classList.remove('spin');
  }
}

async function deleteSubscriptionFromTab(url) {
  try {
    await invoke('delete_subscription', { groupKey: url });
    await refreshSubscriptions();
    await refreshServerList();
  } catch (e) {
    console.error('Delete failed:', e);
  }
}

async function toggleCardStats(url, btn) {
  const hash = hashCode(url);
  const drawer = document.getElementById(`stats-drawer-${hash}`);
  if (!drawer) return;
  const isHidden = drawer.style.display === 'none';
  drawer.style.display = isHidden ? 'flex' : 'none';
  if (btn) btn.classList.toggle('active', isHidden);

  if (isHidden) {
    try {
      const stats = await invoke('get_item_stats', { isGroup: true, key: url });
      const canvas = document.getElementById(`sub-chart-${hash}`);
      if (canvas && stats) {
        setTimeout(() => renderDailyUsageGraph(canvas, stats.daily_usage || {}), 50);
      }
      const usageEl = document.getElementById(`client-usage-${hash}`);
      if (usageEl && stats) {
        usageEl.textContent = formatBytes(stats.total_used || 0);
      }
    } catch (e) {
      console.error(e);
    }
  }
}

function selectIntervalChip(hours) {
  const input = document.getElementById('edit-sub-interval');
  if (input) input.value = hours;
  document.querySelectorAll('.interval-chip').forEach(chip => {
    chip.classList.toggle('active', parseInt(chip.getAttribute('data-hours')) === hours);
  });
}

function copyCurrentEditUrl() {
  if (currentEditSubKey) {
    copyToClipboard(currentEditSubKey);
    const btn = document.getElementById('btn-edit-copy-url');
    if (btn) {
      const span = btn.querySelector('span');
      if (span) {
        const orig = span.textContent;
        span.textContent = t('common.copied');
        setTimeout(() => span.textContent = orig, 1500);
      }
    }
  }
}

// An IP or a CIDR range is not a hostname: the stripping below would turn "192.168.1.1:80"
// into "192.168.1" and "10.0.0.0/8" into "10", both of which match nothing and read exactly
// like a working rule. Anything that parses as an address is handed through untouched.
function looksLikeAddress(p) {
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(p)) return true;         // 192.168.1.1
    if (/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(p)) return true; // 10.0.0.0/8
    if (/^[0-9a-fA-F:]+$/.test(p) && p.includes(':')) return true; // IPv6, ::/0
    return false;
}

function cleanRoutingPattern(raw) {
    let p = raw.trim();
    if (looksLikeAddress(p)) return p;
    // Strip protocol
    p = p.replace(/^https?:\/\//i, '');
    // Strip trailing slashes and paths
    p = p.replace(/\/.*$/, '');
    // Strip port
    p = p.replace(/:\d+$/, '');
    // Strip leading/trailing dots
    p = p.replace(/^\.+|\.+$/g, '');
    return p;
}

// Each section has its own input, so the action comes from the section the user is
// typing into rather than from a dropdown that can disagree with the visible list.
function handleAddRoutingRule(action) {
    const inputId = action === 'proxy' ? 'txt-proxy-pattern' : 'txt-bypass-pattern';
    const rawPattern = document.getElementById(inputId).value;
    if (!rawPattern.trim()) return;
    // An executable pasted into the domain box is a process rule. The backend reclassifies it
    // too, but going through cleanRoutingPattern first would destroy the path, and the row
    // would render in the domain list instead of the application list. Hand the path to the
    // exe box and let the normal handler run -- it owns the optimistic row and the in-flight
    // guard, which this path needs for the same reasons the picker does.
    if (/\.exe$/i.test(rawPattern.trim())) {
      const exeInput = document.getElementById('txt-' + action + '-exe');
      if (exeInput) exeInput.value = rawPattern.trim();
      document.getElementById(inputId).value = '';
      handleAddProcessRule(action);
      return;
    }
    const pattern = cleanRoutingPattern(rawPattern);
    if (!pattern) return;
    const rule = {
      id: 'rule_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      pattern: pattern,
      action: action,
      enabled: true,
    };
    invoke('add_routing_rule', { rule: rule }).then((reloaded) => {
        document.getElementById(inputId).value = '';
        refreshRoutingRules();
        if(!reloaded && window.restartConnectionIfActive) window.restartConnectionIfActive();
    }).catch(e => console.error(e));
}

document.addEventListener("DOMContentLoaded", () => {
    refreshSubscriptions();
});

function switchSettingsTab(tabId) {
  document.querySelectorAll('.settings-tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  document.querySelectorAll('#page-settings .settings-pane').forEach(pane => {
    pane.classList.remove('active');
  });

  // Match on data-tab, not textContent -- the label is translated, so a text match
  // breaks the moment the language changes.
  document.querySelectorAll('.settings-tab-btn').forEach(btn => {
    if (btn.getAttribute('data-tab') === tabId) {
      btn.classList.add('active');
    }
  });
  const pane = document.getElementById('settings-' + tabId);
  if (pane) pane.classList.add('active');

  // The support tab's content is fetched on first open rather than at startup: probing
  // the cores for their versions and hitting GitHub belong on demand, not on launch.
  if (tabId === 'support') onSupportTabOpen();
}

// ===== App & Support: update center =====
//
// The UI half of core/update.rs. The backend owns the network and the handover to the
// installer; this owns the states the user sees -- nothing checked yet, checking, up to
// date, an update waiting, or the check failed -- plus the download progress bar.

let lastUpdateInfo = null;       // result of the most recent check_for_updates
let updateChecking = false;
let updateDownloading = false;
let updateCheckError = null;     // only set when a check the user asked for failed
let downloadedInstallerPath = null;
let updateProgressUnlisten = null;
let appVersion = '';
let systemInfoLoaded = false;
let lastSystemInfo = null;

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return '0 MB';
  const mb = n / (1024 * 1024);
  return mb < 10 ? mb.toFixed(1) + ' MB' : Math.round(mb) + ' MB';
}

// Only a check the user triggered gets to put an error on screen. The startup probe is
// best-effort and must stay invisible when the network will not cooperate.

// A click that lands while a check is already running used to be dropped outright, leaving the
// card pulsing and no amount of clicking able to change it. The intent is latched and replayed
// when the in-flight check lands.
let updatePendingManual = false;

async function checkForUpdates(manual) {
  if (updateChecking) {
    if (manual) updatePendingManual = true;
    return;
  }
  updateChecking = true;
  updateCheckError = null;

  const btn = document.getElementById('btn-check-updates');
  const label = document.getElementById('support-check-label');
  // Only a check the user asked for owns the button. The startup probe used to disable it and
  // relabel it for up to thirty seconds, so on a network that will not answer the control sat
  // there greyed out and unresponsive, reading as "stuck on checking".
  if (manual) {
    if (btn) { btn.disabled = true; btn.classList.add('spinning'); }
    if (label) { label.textContent = t('support.checking'); label.dir = 'auto'; }
  }
  if (manual) renderUpdateCard();

  try {
    lastUpdateInfo = await invoke('check_for_updates');
  } catch (e) {
    if (manual) {
      updateCheckError = (e && e.message) ? e.message : String(e);
      lastUpdateInfo = null;
    } else {
      console.error('silent update check failed:', e);
    }
  } finally {
    updateChecking = false;
    if (btn) { btn.disabled = false; btn.classList.remove('spinning'); }
    if (label) { label.textContent = t('support.check_button'); label.dir = 'auto'; }

    const available = !!(lastUpdateInfo && lastUpdateInfo.update_available);
    setUpdateBadges(available);
    // Repaint regardless of who asked. Gating this on `manual || available` left the card
    // pulsing forever after a silent check came back empty: opening the tab had already painted
    // the checking state, and nothing in that branch ever replaced it.
    renderUpdateCard();

    if (updatePendingManual) {
      updatePendingManual = false;
      checkForUpdates(true);
    }
  }
}

// Lights the dot on the Settings nav item and the pill on the tab itself. Both stay live
// across the app, not just on the support tab, so a pending release is never hidden.
function setUpdateBadges(visible) {
  const nav = document.getElementById('nav-update-badge');
  const tab = document.getElementById('support-tab-update-badge');
  if (nav) nav.style.display = visible ? '' : 'none';
  if (tab) tab.style.display = visible ? '' : 'none';
}

async function renderSupportVersion() {
  if (!appVersion) {
    try { appVersion = await invoke('get_app_version'); } catch (e) { return; }
  }
  const el = document.getElementById('support-current-version');
  if (el) {
    el.textContent = t('support.hero.version_badge', null, { version: appVersion });
    el.dir = 'auto';
  }
}

// Rebuilds the state card from whatever the last check returned. The card is one element
// that swaps its look by class. Release notes are the one piece of remote content here;
// they are assigned as textContent rather than innerHTML, which is what stops a stray tag
// in a GitHub markdown body from ever executing.
function renderUpdateCard() {
  const card = document.getElementById('support-update-card');
  if (!card) return;

  const leaf = (text, extra) => {
    const s = document.createElement('span');
    s.textContent = text;
    s.dir = 'auto';
    if (extra) for (const k in extra) s.classList.add(extra[k]);
    return s;
  };

  const reset = (cls) => {
    card.className = 'support-card ' + cls;
    card.innerHTML = '';
    return card;
  };

  if (updateChecking) {
    reset('checking');
    const head = document.createElement('div');
    head.className = 'support-card-head';
    head.appendChild(Object.assign(document.createElement('span'), { className: 'support-status-dot' }));
    head.appendChild(leaf(t('support.checking'), ['support-card-title']));
    card.appendChild(head);
    return;
  }

  if (updateCheckError) {
    reset('failed');
    const head = document.createElement('div');
    head.className = 'support-card-head';
    head.appendChild(Object.assign(document.createElement('span'), { className: 'support-status-dot' }));
    head.appendChild(leaf(t('support.check_failed'), ['support-card-title']));
    card.appendChild(head);
    card.appendChild(leaf(updateCheckError, ['support-card-desc']));
    return;
  }

  if (!lastUpdateInfo) { reset('empty'); return; }

  if (!lastUpdateInfo.update_available) {
    reset('up-to-date');
    const head = document.createElement('div');
    head.className = 'support-card-head';
    head.appendChild(Object.assign(document.createElement('span'), { className: 'support-status-dot' }));
    head.appendChild(leaf(t('support.up_to_date'), ['support-card-title']));
    card.appendChild(head);
    card.appendChild(leaf(t('support.up_to_date_desc'), ['support-card-desc']));

    // The button is only offered here, when the installed version is the latest one, because
    // the notes for a pending release are already shown in the card above.
    //
    // `lastUpdateInfo` describes the *latest* GitHub release, which is not necessarily this
    // build: between a build and its release the installed version runs ahead of what has
    // been published, and reusing those notes would answer "what's new in 2.1" with 2.0's
    // changelog. The notes are fetched for the version the card actually names, on demand --
    // the anonymous API is rate-limited hard enough that fetching them on every tab open
    // would be the difference between a button that works and one that rate-limits.
    const myVersion = (lastUpdateInfo.current_version || '').trim();
    if (myVersion) {
      const actions = document.createElement('div');
      actions.className = 'support-card-actions';
      const btn = document.createElement('button');
      btn.className = 'support-gh-btn';
      btn.type = 'button';
      btn.textContent = t('support.patch_notes');
      btn.dir = 'auto';
      // Toggle rather than navigate: the notes belong with the rest of the card, and a panel here
      // reuses the exact styling the available-update branch already paints its notes with.
      btn.addEventListener('click', async () => {
        const existing = card.querySelector('.support-notes');
        if (existing) {
          existing.remove();
          return;
        }
        const box = document.createElement('div');
        box.className = 'support-notes';
        box.dir = 'auto';
        card.appendChild(box);
        try {
          // A version that has not been published yet has no notes on GitHub; the backend
          // reports that as an empty string rather than an error, and an empty body is the
          // same as no button at all.
          const notes = (await invoke('get_release_notes', { version: myVersion }) || '').trim();
          // Remote content: assigned, never parsed as markup.
          box.textContent = notes || t('support.no_patch_notes');
        } catch (err) {
          box.textContent = t('support.no_patch_notes');
        }
      });
      actions.appendChild(btn);
      card.appendChild(actions);
    }
    return;
  }

  reset('available');
  const tag = lastUpdateInfo.latest_version.replace(/^v+/i, '');

  const head = document.createElement('div');
  head.className = 'support-card-head';
  head.appendChild(Object.assign(document.createElement('span'), { className: 'support-status-dot' }));
  head.appendChild(leaf(t('support.update_available_title', null, { version: tag }), ['support-card-title']));
  card.appendChild(head);
  card.appendChild(leaf(t('support.update_available_desc'), ['support-card-desc']));

  const notes = (lastUpdateInfo.release_notes || '').trim();
  if (notes) {
    card.appendChild(leaf(t('support.release_notes'), ['support-notes-title']));
    const box = document.createElement('div');
    box.className = 'support-notes';
    box.dir = 'auto';
    box.textContent = notes;
    card.appendChild(box);
  }

  const actions = document.createElement('div');
  actions.className = 'support-card-actions';

  if (lastUpdateInfo.download_url) {
    const dl = document.createElement('button');
    dl.className = 'support-download-btn';
    dl.textContent = updateDownloading ? t('support.downloading') : t('support.download_install');
    dl.dir = 'auto';
    dl.disabled = updateDownloading;
    dl.addEventListener('click', () => startUpdateDownload());
    actions.appendChild(dl);
  } else {
    card.appendChild(leaf(t('support.no_installer'), ['support-card-desc']));
  }

  const gh = document.createElement('button');
  gh.className = 'support-gh-btn';
  gh.textContent = t('support.view_release');
  gh.dir = 'auto';
  gh.addEventListener('click', () => openSupportUrl(lastUpdateInfo.release_url));
  actions.appendChild(gh);
  card.appendChild(actions);
}

async function startUpdateDownload() {
  if (updateDownloading || !lastUpdateInfo || !lastUpdateInfo.download_url) return;
  updateDownloading = true;
  renderUpdateCard();

  const wrap = document.getElementById('support-progress-wrap');
  const fill = document.getElementById('support-progress-fill');
  const pct = document.getElementById('support-progress-percent');
  const size = document.getElementById('support-progress-size');
  const label = document.getElementById('support-progress-label');
  const installRow = document.getElementById('support-install-row');

  if (fill) fill.style.width = '0%';
  if (pct) pct.textContent = '0%';
  if (size) size.textContent = '';
  if (label) { label.textContent = t('support.downloading'); label.dir = 'auto'; label.classList.remove('error'); }
  if (installRow) installRow.classList.remove('visible');
  if (wrap) wrap.classList.add('visible');

  // Percent events come from the backend as it streams; only the newest subscription is
  // wanted, so the previous listener is dropped before attaching a new one.
  try {
    if (updateProgressUnlisten) { updateProgressUnlisten(); updateProgressUnlisten = null; }
    updateProgressUnlisten = await window.__TAURI__.event.listen('update-download-progress', (e) => {
      const p = (e && e.payload) || {};
      const pc = Math.max(0, Math.min(100, Math.round(p.percent || 0)));
      if (fill) fill.style.width = pc + '%';
      if (pct) pct.textContent = pc + '%';
      if (size) {
        size.textContent = p.total > 0
          ? formatBytes(p.downloaded) + ' / ' + formatBytes(p.total)
          : formatBytes(p.downloaded);
      }
    });
  } catch (e) {
    console.error('could not subscribe to download progress:', e);
  }

  try {
    downloadedInstallerPath = await invoke('download_update', { url: lastUpdateInfo.download_url });
    if (wrap) wrap.classList.remove('visible');
    if (installRow) installRow.classList.add('visible');
    const ready = document.getElementById('support-ready-text');
    if (ready) { ready.classList.remove('error'); ready.dir = 'auto'; }
  } catch (e) {
    // A failed download is not a failed check: keep the card in its "available" state so
    // the button is live for a retry, and put the reason where the bar was.
    console.error('update download failed:', e);
    if (label) {
      label.textContent = (e && e.message) ? e.message : String(e);
      label.classList.add('error');
    }
  } finally {
    if (updateProgressUnlisten) { updateProgressUnlisten(); updateProgressUnlisten = null; }
    updateDownloading = false;
    renderUpdateCard();
  }
}

// Hands the finished installer to the OS and quits; the backend clears the proxy and the
// cores first, so nothing after this call runs in this process.
async function installDownloadedUpdate() {
  if (!downloadedInstallerPath) return;
  const btn = document.getElementById('btn-restart-install');
  if (btn) { btn.disabled = true; }
  try {
    await invoke('install_update', { path: downloadedInstallerPath });
  } catch (e) {
    // Success never returns: the process hands over to the installer and quits. Reaching
    // here means the handover itself was refused, so put the reason where the prompt was
    // and leave the button live for another attempt.
    console.error('install handover failed:', e);
    if (btn) { btn.disabled = false; }
    const ready = document.getElementById('support-ready-text');
    if (ready) {
      ready.textContent = (e && e.message) ? e.message : String(e);
      ready.classList.add('error');
    }
  }
}

function openSupportUrl(url) {
  invoke('open_external_url', { url }).catch(e => console.error('could not open url:', e));
}

// ===== App & Support: system & engine =====

function onSupportTabOpen() {
  renderSupportVersion();
  renderUpdateCard();
  if (!systemInfoLoaded) loadSystemInfo();
}

async function loadSystemInfo() {
  ['sysinfo-app', 'sysinfo-os', 'sysinfo-core'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '…';
  });
  try {
    lastSystemInfo = await invoke('get_system_info');
    systemInfoLoaded = true;
    renderSystemInfo();
  } catch (e) {
    console.error('could not read system info:', e);
    ['sysinfo-app', 'sysinfo-os', 'sysinfo-core'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = t('support.sysinfo.unknown');
    });
  }
}

function renderSystemInfo() {
  if (!lastSystemInfo) return;
  const set = (id, text) => {
    const el = document.getElementById(id);
    if (el) { el.textContent = text; el.dir = 'auto'; }
  };
  set('sysinfo-app', lastSystemInfo.app_version || t('support.sysinfo.unknown'));
  set('sysinfo-os', lastSystemInfo.os_name + ' (' + lastSystemInfo.os_arch + ')');
  const sb = lastSystemInfo.singbox_version || t('support.sysinfo.unknown');
  const xr = lastSystemInfo.xray_version || t('support.sysinfo.unknown');
  set('sysinfo-core', 'Sing-Box ' + sb + ' • Xray ' + xr);
}

function copySystemInfo() {
  if (!lastSystemInfo) return;
  const unknown = t('support.sysinfo.unknown');
  const text = [
    'Vxray — system info',
    'App version: ' + (lastSystemInfo.app_version || unknown),
    'OS: ' + lastSystemInfo.os_name + ' (' + lastSystemInfo.os_arch + ')',
    'Selected core: ' + (lastSystemInfo.core_type || 'auto'),
    'Sing-Box: ' + (lastSystemInfo.singbox_version || unknown),
    'Xray: ' + (lastSystemInfo.xray_version || unknown)
  ].join('\n');
  invoke('copy_to_clipboard', { text }).then(() => {
    const btn = document.getElementById('btn-copy-sysinfo');
    if (btn) {
      btn.textContent = t('support.sysinfo.copied');
      btn.dir = 'auto';
      setTimeout(() => { btn.textContent = t('support.sysinfo.copy'); }, 1600);
    }
  }).catch(e => console.error('clipboard write failed:', e));
}

// ===== Routing Preset Listeners =====

// Swaps which custom-rules list is on screen. Presentational only: it never invokes the
// core, never restarts the connection, and both panes keep their rules regardless of
// which is showing. The Proxy-Only toggle remains the single thing that changes routing.
// Buttons are matched on data-rtab rather than their label, because the label is
// translated and would break matching in any non-English language.
function switchRoutingTab(tabId) {
  document.querySelectorAll('.routing-tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.routing-pane').forEach(pane => pane.classList.remove('active'));
  document.querySelectorAll('.routing-tab-btn').forEach(btn => {
    if (btn.getAttribute('data-rtab') === tabId) btn.classList.add('active');
  });
  const pane = document.getElementById('routing-pane-' + tabId);
  if (pane) pane.classList.add('active');
  // A sub-pane only displays while it holds `active`, and switching sub-tabs takes that class
  // off the half being left. Without restoring the mode's remembered half here, the pane would
  // come up empty -- the app list a user had just filled in would look like it had vanished,
  // and would only come back after clicking the sub-tab they were already on.
  switchRoutingSubTab(tabId, routingSubTab[tabId] || 'domains');
  // Each mode describes itself; the paragraph above the tabs follows the selection.
  const desc = document.getElementById('routing-mode-desc');
  if (desc) {
    const key = tabId === 'proxy' ? 'routing.mode.proxy_only.desc' : 'routing.mode.bypass.desc';
    desc.dataset.i18n = key;
    desc.textContent = t(key);
    desc.dir = 'auto';
  }
}

// Sub-tabs live inside one mode and only ever select which half of that mode is showing.
// `routingSubTab` is remembered per mode, so leaving and coming back returns to the half
// you were on instead of always resetting to Domains.
const routingSubTab = { bypass: 'domains', proxy: 'domains' };

function switchRoutingSubTab(mode, subTab) {
  routingSubTab[mode] = subTab;
  document.querySelectorAll('.routing-subtab-btn[data-rsubfor="' + mode + '"]')
    .forEach(btn => btn.classList.toggle('active', btn.getAttribute('data-rsub') === subTab));
  // Only this mode's two halves are touched. Clearing every sub-pane on the page -- which a
  // bare querySelectorAll('.routing-subpane') does -- also strips the other mode's open half,
  // and nothing ever gave it back, so visiting Applications under one mode blanked the other
  // mode's pane until you re-clicked its sub-tab.
  ['domains', 'apps'].forEach(s => {
    const sub = document.getElementById('routing-sub-' + mode + '-' + s);
    if (sub) sub.classList.toggle('active', s === subTab);
  });
  if (subTab === 'apps') loadRecommendedApps(mode);
}

// Not every install has a recommended app, and the scan walks the registry, so it runs
// the first time either Applications half is opened rather than at startup.
const recommendedLoaded = { bypass: false, proxy: false };
let recommendedCache = null;
let recommendedScan = null;

// The scan is slow and its result does not depend on the mode, so one in-flight promise
// serves both halves. Rendering from a cache that is still null is what made the chips
// vanish: any rules refresh landing during the scan repainted them from an empty list and
// nothing ever put them back, so the Applications half looked broken until a restart.
//
// The previous launch's result is read from disk first so the pane paints immediately; the
// fresh scan then swaps in whatever has changed. Without the disk read the half is empty for
// the seconds the scan takes on every open.
function scanRecommendedApps() {
  if (recommendedScan) return recommendedScan;
  recommendedScan = invoke('cached_installed_apps')
    .catch(e => {
      console.error('Failed to read the cached app list:', e);
      return null;
    })
    .then(cached => {
      if (cached && cached.length) {
        recommendedCache = cached;
        repaintRecommended();
      }
    })
    .then(() => invoke('detect_installed_apps').catch(e => {
      console.error('Failed to detect installed apps:', e);
      return [];
    }))
    .then(apps => {
      recommendedCache = apps;
      repaintRecommended();
      return apps;
    });
  return recommendedScan;
}

// Paints whatever the scan has so far into the halves the user has already opened. A half
// that was never visited stays empty rather than flashing content into a hidden pane.
function repaintRecommended() {
  ['bypass', 'proxy'].forEach(mode => {
    if (!recommendedLoaded[mode]) return;
    const host = document.getElementById(mode + '-recommended');
    if (!host) return;
    if (recommendedCache) renderRecommendedInto(host, mode, recommendedCache);
    else renderRecommendedPlaceholder(host);
  });
}

function renderRecommendedPlaceholder(host) {
  host.innerHTML = '';
  const ph = document.createElement('span');
  ph.className = 'routing-recommended-label routing-scanning';
  ph.textContent = t('routing.apps.scanning');
  ph.dir = 'auto';
  host.appendChild(ph);
}

async function loadRecommendedApps(mode) {
  const host = document.getElementById(mode + '-recommended');
  if (!host) return;
  if (!recommendedLoaded[mode]) {
    recommendedLoaded[mode] = true;
    renderRecommendedPlaceholder(host);
    scanRecommendedApps();
    return;
  }
  // Coming back to a half that finished scanning while it was hidden.
  repaintRecommended();
}

// The scan's result does not depend on the mode, so both halves are primed once at startup
// rather than on first visit. Loading only the half a user happened to open first left the
// other one empty, which read as "proxy-only mode does not suggest any applications" -- the
// chips are there, they were simply never fetched for that half.
function primeRecommendedApps() {
  if (recommendedScan) return;
  ['bypass', 'proxy'].forEach(mode => {
    recommendedLoaded[mode] = true;
    const host = document.getElementById(mode + '-recommended');
    if (host) renderRecommendedPlaceholder(host);
  });
  scanRecommendedApps();
}

function renderRecommendedInto(host, mode, apps) {
  host.innerHTML = '';
  if (!apps.length) return;

  const label = document.createElement('span');
  label.className = 'routing-recommended-label';
  label.textContent = t('routing.apps.recommended');
  label.dir = 'auto';
  host.appendChild(label);

  // Already-added rules read as "Added" chips, so the recommendation does not offer the
  // same .exe twice.
  const existing = (window.__vxrayProcessRules || {})[mode] || [];

  apps.forEach(app => {
    const chip = document.createElement('button');
    chip.className = 'routing-rec-chip';
    chip.type = 'button';
    const isAdded = existing.some(p => sameExePath(p, app.exe_path));

    const initial = (app.name.trim()[0] || '?').toUpperCase();
    chip.innerHTML =
      '<span class="routing-rec-avatar" aria-hidden="true">' + escapeHtml(initial) + '</span>' +
      '<span class="routing-rec-name">' + escapeHtml(app.name) + '</span>' +
      '<span class="routing-rec-state">' + (isAdded ? t('routing.apps.added') : '+') + '</span>';
    chip.title = app.exe_path;
    if (isAdded) chip.classList.add('added');
    else chip.addEventListener('click', () => addProcessRule(mode, app.exe_path, chip));
    host.appendChild(chip);
  });
}

// The duplicate check only needs to recognise the same install twice, and the catalog
// stores full paths, so it compares those -- case and slash direction are the only things
// that differ between the same file written two ways.
function sameExePath(a, b) {
  return (a || '').toLowerCase().replace(/\//g, '\\') === (b || '').toLowerCase().replace(/\//g, '\\');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// The picker is the primary path; the text box next to it is the escape hatch for a path
// the catalog missed.
async function browseExecutable(mode) {
  try {
    const path = await invoke('browse_executable');
    if (!path) return; // cancel
    // The ids in index.html are "txt-bypass-exe" / "txt-proxy-exe". This used to look them up
    // without the "txt-" prefix, so the picked path was written to a null element and the
    // button did nothing at all.
    const el = document.getElementById('txt-' + mode + '-exe');
    if (el) el.value = path;
  } catch (e) {
    console.error('Failed to pick an executable:', e);
  }
}

function handleAddProcessRule(mode) {
  const inputId = 'txt-' + mode + '-exe';
  const el = document.getElementById(inputId);
  const raw = (el && el.value || '').trim();
  if (!raw) return;
  addProcessRule(mode, raw);
}

// Adding is an async round trip that restarts the adapter, so a second click before the first
// one settles used to fire a second sidecar alongside the first. The two then fought over the
// "Vxray" interface and the loser exited, which is the "the app crashes when I add an app"
// report -- the guard stops the second click rather than racing it.
let processRuleAddInFlight = false;

// Paints one app row before the backend round trip, so the list reacts the moment the user
// clicks instead of after the adapter restart settles. The markup mirrors
// renderProcessRulesInto; refreshRoutingRules replaces it with the persisted row once the save
// lands, and a failed save removes it again, so the optimistic row can never outlive the truth.
function paintPendingAppRow(mode, exePath) {
  const listEl = document.getElementById(mode + '-apps-list');
  if (!listEl) return null;
  // An empty list shows its placeholder; a pending row has to displace it or the two stack.
  const placeholder = listEl.querySelector('.routing-empty-hint');
  if (placeholder) placeholder.remove();

  const fileName = exePath.split('\\').pop().split('/').pop() || exePath;
  const initial = (fileName.trim()[0] || '?').toUpperCase();
  const item = document.createElement('div');
  item.className = 'routing-rule-item routing-app-item';
  item.dataset.pending = '1';
  item.innerHTML = `
    <div style="display: flex; align-items: center; gap: 10px; flex: 1; overflow: hidden;">
      <span class="routing-app-icon" aria-hidden="true">${escapeHtml(initial)}</span>
      <span style="display: flex; flex-direction: column; min-width: 0; flex: 1;">
        <span class="routing-rule-pattern routing-app-name">${escapeHtml(fileName)}</span>
        <span class="routing-app-path">${escapeHtml(exePath)}</span>
      </span>
    </div>
    <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
      <span class="routing-app-pending">${t('routing.apps.adding')}</span>
    </div>
  `;
  listEl.appendChild(item);
  return item;
}

function addProcessRule(mode, exePath, chip) {
  if (processRuleAddInFlight) return;
  // An .exe path is never a domain, so it must not go through cleanRoutingPattern --
  // that helper strips ports, paths and drive letters and would destroy the value.
  if (!/\.exe$/i.test(exePath)) {
    console.error('Refusing to add a non-executable process rule:', exePath);
    return;
  }
  processRuleAddInFlight = true;
  if (chip) chip.disabled = true;

  // The row appears now, and the status capsule shows the adapter restart the backend is about
  // to perform -- without either, "add" looks like it did nothing for the second or two the
  // reload takes, which is the "the app freezes and I cannot add another" report.
  const pendingRow = paintPendingAppRow(mode, exePath);
  const wasRunning = isRunning;
  if (wasRunning) updateSmartDash('processing');

  const rule = {
    id: 'rule_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    pattern: exePath,
    action: mode,           // "bypass" or "proxy" -- the pane it was added from
    kind: 'process',
    enabled: true,
  };
  invoke('add_routing_rule', { rule: rule }).then((reloaded) => {
    const el = document.getElementById('txt-' + mode + '-exe');
    if (el) el.value = '';
    if (chip) {
      chip.classList.add('added');
      const state = chip.querySelector('.routing-rec-state');
      if (state) state.textContent = t('routing.apps.added');
      chip.disabled = true;
    }
    refreshRoutingRules();
    // The adapter restart finished, so the capsule can leave its processing state. Restoring
    // here rather than waiting on the health poll is what keeps it from sitting on a spinner
    // after the tunnel is already back up.
    if (wasRunning) updateSmartDash('connected');
    // An application rule is pushed into the running TUN sidecar or core by the backend, which
    // restarts only the adapter. Do NOT reconnect here on top of it: connect keeps a live TUN
    // sidecar in place, so a reconnect would neither apply the rule nor help -- it would just
    // make adding an app as slow as switching servers.
    if (!reloaded && window.restartConnectionIfActive) window.restartConnectionIfActive();
  }).catch(e => {
    console.error(e);
    // The rule never landed, so hand the chip back to the user instead of leaving it stuck
    // disabled on a failure it cannot see.
    if (pendingRow) pendingRow.remove();
    if (chip) {
      chip.disabled = false;
      chip.classList.remove('added');
      const state = chip.querySelector('.routing-rec-state');
      if (state) state.textContent = '+';
    }
    if (wasRunning) updateSmartDash('connected');
  }).finally(() => {
    processRuleAddInFlight = false;
  });
}

function initRoutingPresets() {
  const iranToggle = document.getElementById('toggle-preset-iran');
  const lanToggle = document.getElementById('toggle-preset-lan');
  const adsToggle = document.getElementById('toggle-preset-ads');
  
  if (iranToggle) iranToggle.addEventListener('change', () => {
    invoke('update_routing_preset', { preset: 'bypass_iran', enabled: iranToggle.checked })
      .then((reloaded) => { if(!reloaded && window.restartConnectionIfActive) window.restartConnectionIfActive(); })
      .catch(e => console.error(e));
  });
  if (lanToggle) lanToggle.addEventListener('change', () => {
    invoke('update_routing_preset', { preset: 'bypass_lan', enabled: lanToggle.checked })
      .then((reloaded) => { if(!reloaded && window.restartConnectionIfActive) window.restartConnectionIfActive(); })
      .catch(e => console.error(e));
  });
  if (adsToggle) adsToggle.addEventListener('change', () => {
    invoke('update_routing_preset', { preset: 'block_ads', enabled: adsToggle.checked })
      .then((reloaded) => { if(!reloaded && window.restartConnectionIfActive) window.restartConnectionIfActive(); })
      .catch(e => console.error(e));
  });
  // The proxy-only control is the same small switch the TUN toggle is. A checkbox has already
  // flipped `.checked` by the time `change` fires, so a handler that re-reads it and compares it
  // against itself always bails out and the toggle silently does nothing -- the mode is never
  // written and the restart never runs. The three toggles above send `.checked` straight to the
  // invoke, so this one does too; a duplicate restart is already collapsed by the debounce in
  // restartConnectionIfActive.
  const proxyOnlyToggle = document.getElementById('toggle-preset-proxy-only');
  if (proxyOnlyToggle) {
    proxyOnlyToggle.addEventListener('change', async () => {
      const enabled = proxyOnlyToggle.checked;
      try {
        await invoke('update_routing_preset', { preset: 'proxy_only_mode', enabled });
        applyProxyOnlyMode(enabled);
        // Proxy-only flips TUN default route AND changes which process rules
        // matter, so the virtual adapter MUST fully restart.  Skip the 800 ms
        // debounce that restartConnectionIfActive uses -- go straight to the
        // reconnect so the user sees the switch happen immediately.
        if (isRunning && connectedServerLink) {
          const link = connectedServerLink;
          connectedServerLink = null;
          isRunning = false;
          isConnecting = false;
          refreshProcessRuleWarning();
          await connectToLink(link, true);
        }
      } catch (e) {
        console.error('Failed to toggle proxy-only mode:', e);
        proxyOnlyToggle.checked = !enabled;
      }
    });
  }

  // Load initial preset states
  invoke('get_routing_settings').then(data => {
    if (iranToggle) iranToggle.checked = !!data.bypass_iran;
    if (lanToggle) lanToggle.checked = !!data.bypass_lan;
    if (adsToggle) adsToggle.checked = !!data.block_ads;
    if (proxyOnlyToggle) {
      proxyOnlyToggle.checked = !!data.proxy_only_mode;
      applyProxyOnlyMode(!!data.proxy_only_mode);
    }
  }).catch(e => console.error('Failed to load routing presets:', e));
}

// Selecting a rule action goes through the dropdown markup, so setting it from code has
// to rebuild that same markup rather than just writing the hidden input.
function setRuleActionDropdown(value) {
  const actionSelect = document.getElementById('select-rule-action');
  const opt = document.querySelector('#action-dropdown .custom-dropdown-option[data-value="' + value + '"]');
  if (!actionSelect || !opt) return;
  const selected = document.getElementById('action-dropdown-selected');
  if (selected) selected.innerHTML = '<span class="dropdown-value">' + opt.innerHTML + '</span>';
  document.querySelectorAll('#action-dropdown .custom-dropdown-option').forEach(o => o.classList.toggle('active', o === opt));
  actionSelect.value = value;
}

// Proxy-only mode inverts the default route; it does not rewrite the rules. Both lists
// stay populated in the DOM either way -- the tabs only pick which is on screen, and the
// one whose default is not in force is dimmed, including its tab button -- so a user can
// fill the proxy list in before turning it on and never loses the bypass list by
// switching. Nothing here touches the connection; the caller restarts it if a restart is
// warranted.
function applyProxyOnlyMode(on) {
  const hint = document.getElementById('proxy-only-hint');
  if (hint) hint.classList.toggle('visible', on);

  const bypassSection = document.getElementById('routing-section-bypass');
  const proxySection = document.getElementById('routing-section-proxy');
  if (bypassSection) bypassSection.classList.toggle('mode-inactive', on);
  if (proxySection) proxySection.classList.toggle('mode-inactive', !on);

  // The Applications halves sit in the same panes and follow the same rule: a bypass app
  // rule emits "direct", which is already the default while Proxy-Only is on, so leaving
  // them at full opacity would imply they still have an effect.
  const bypassApps = document.getElementById('routing-sub-bypass-apps');
  const proxyApps = document.getElementById('routing-sub-proxy-apps');
  if (bypassApps) bypassApps.classList.toggle('mode-inactive', on);
  if (proxyApps) proxyApps.classList.toggle('mode-inactive', !on);

  // The dim alone does not say where to put the app, so the half that is out of force
  // explains itself. `hidden` keeps the note off the page in the mode where this list is the
  // one doing the work; the text itself follows the language pass like every other label.
  const bypassNote = document.getElementById('bypass-apps-mode-note');
  const proxyNote = document.getElementById('proxy-apps-mode-note');
  if (bypassNote) bypassNote.hidden = !on;
  if (proxyNote) proxyNote.hidden = on;

  // The lists now live on separate tabs, so the dim has to reach the tab bar too --
  // otherwise the mode is invisible until you open the other list.
  const bypassTab = document.querySelector('.routing-tab-btn[data-rtab="bypass"]');
  const proxyTab = document.querySelector('.routing-tab-btn[data-rtab="proxy"]');
  if (bypassTab) bypassTab.classList.toggle('mode-inactive', on);
  if (proxyTab) proxyTab.classList.toggle('mode-inactive', !on);

  // The pills are keyed so a language change re-renders them without our help.
  setPill(document.getElementById('bypass-mode-pill'), !on);
  setPill(document.getElementById('proxy-mode-pill'), on);
}

function setPill(pill, active) {
  if (!pill) return;
  const key = active ? 'routing.proxy_only.active' : 'routing.proxy_only.inactive';
  pill.classList.toggle('inactive', !active);
  pill.setAttribute('data-i18n', key);
  pill.textContent = t(key);
}

// ===== Settings Toggle Listeners =====
function initSettingsListeners() {

  const toggleBlurIp = document.getElementById('toggle-blur-ip');
  const ipAddress = document.getElementById('ip-address');
  if (toggleBlurIp && ipAddress) {
    const isBlur = localStorage.getItem('blur_ip') === 'true';
    toggleBlurIp.checked = isBlur;
    if (isBlur) ipAddress.classList.add('spoiler');
    toggleBlurIp.addEventListener('change', (e) => {
      localStorage.setItem('blur_ip', e.target.checked);
      if (e.target.checked) ipAddress.classList.add('spoiler');
      else ipAddress.classList.remove('spoiler');
    });
  }

  const autoStart = document.getElementById('toggle-auto-start');
  const startMin = document.getElementById('toggle-start-minimized');
  const autoUpdate = document.getElementById('toggle-auto-update-subs');
  const autoReconnect = document.getElementById('toggle-auto-reconnect');
  const livePing = document.getElementById('toggle-live-ping');
  const tlsFragment = document.getElementById('toggle-tls-fragment');
  const remoteDns = document.getElementById('input-remote-dns');
  const localDns = document.getElementById('input-local-dns');
  const coreSelect = document.getElementById('select-core');

  // Light theme. The whole palette is one html[data-theme] attribute -- the stylesheet
  // carries the inverted values -- so applying it is an attribute set, not a class swap.
  const lightThemeToggle = document.getElementById('toggle-light-theme');
  if (lightThemeToggle) {
    lightThemeToggle.addEventListener('change', (e) => {
      applyTheme(e.target.checked ? 'light' : 'dark');
      invoke('set_theme', { theme: e.target.checked ? 'light' : 'dark' })
        .catch((err) => console.error('Failed to save theme:', err));
    });
  }
  
  if (autoStart) autoStart.addEventListener('change', () => {
    invoke('set_auto_start', { enabled: autoStart.checked }).catch(e => console.error(e));
    // Enable/disable start minimized when auto start changes
    const minRow = document.getElementById('toggle-start-minimized');
    if (minRow) minRow.closest('.setting-item').style.opacity = autoStart.checked ? '1' : '0.4';
    if (minRow) minRow.closest('.setting-item').style.pointerEvents = autoStart.checked ? 'auto' : 'none';
  });
  if (startMin) startMin.addEventListener('change', () => {
    invoke('set_start_minimized', { enabled: startMin.checked }).catch(e => console.error(e));
  });
  if (autoUpdate) autoUpdate.addEventListener('change', () => {
    invoke('set_auto_update_subs', { enabled: autoUpdate.checked }).catch(e => console.error(e));
  });
  if (tlsFragment) tlsFragment.addEventListener('change', updateCoreSettings);
  
  const strictRoute = document.getElementById('toggle-strict-route');
  if (strictRoute) strictRoute.addEventListener('change', updateCoreSettings);

  // Custom Dropdown Logic
  const coreDropdown = document.getElementById('core-dropdown');
  const coreDropdownSelected = document.getElementById('core-dropdown-selected');
  const coreDropdownOptions = document.querySelectorAll('#core-dropdown .custom-dropdown-option');
  
  if (coreDropdown && coreDropdownSelected && coreSelect) {
    // Toggle dropdown
    coreDropdownSelected.addEventListener('click', (e) => {
      e.stopPropagation();
      coreDropdown.classList.toggle('open');
    });

    // Close when clicking outside
    document.addEventListener('click', () => {
      coreDropdown.classList.remove('open');
    });

    // Handle option click
    coreDropdownOptions.forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        const val = opt.getAttribute('data-value');

        // Copy the markup, not just text -- the option carries its own data-i18n hook,
        // so the selected label keeps translating after a language switch.
        coreDropdownSelected.innerHTML = opt.innerHTML;
        coreDropdownOptions.forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        
        // Update hidden input and trigger change
        coreSelect.value = val;
        coreDropdown.classList.remove('open');
        updateCoreSettings();
      });
    });
  }

  // Custom Dropdown Logic for Action
  const actionDropdown = document.getElementById('action-dropdown');
  const actionDropdownSelected = document.getElementById('action-dropdown-selected');
  const actionDropdownOptions = document.querySelectorAll('#action-dropdown .custom-dropdown-option');
  const actionSelect = document.getElementById('select-rule-action');

  if (actionDropdown && actionDropdownSelected && actionSelect) {
    actionDropdownSelected.addEventListener('click', (e) => {
      e.stopPropagation();
      actionDropdown.classList.toggle('open');
    });

    document.addEventListener('click', () => {
      actionDropdown.classList.remove('open');
    });

    actionDropdownOptions.forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        const val = opt.getAttribute('data-value');
        
        actionDropdownSelected.innerHTML = `<span class="dropdown-value">${opt.innerHTML}</span>`;
        actionDropdownOptions.forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        
        actionSelect.value = val;
        actionDropdown.classList.remove('open');
      });
    });
  }

  // Fallback native listener just in case
  if (coreSelect) coreSelect.addEventListener('change', updateCoreSettings);

  // Language dropdown
  const langDropdown = document.getElementById('language-dropdown');
  const langDropdownSelected = document.getElementById('language-dropdown-selected');
  const langSelect = document.getElementById('select-language');

  if (langDropdown && langDropdownSelected && langSelect) {
    langDropdownSelected.addEventListener('click', (e) => {
      e.stopPropagation();
      langDropdown.classList.toggle('open');
    });

    document.addEventListener('click', () => {
      langDropdown.classList.remove('open');
    });

    langDropdown.querySelectorAll('.custom-dropdown-option').forEach(opt => {
      opt.addEventListener('click', async (e) => {
        e.stopPropagation();
        const val = opt.getAttribute('data-value');

        langDropdownSelected.textContent = opt.textContent.trim();
        langDropdown.querySelectorAll('.custom-dropdown-option').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');

        langSelect.value = val;
        langDropdown.classList.remove('open');

        await changeLanguage(val);
      });
    });
  }

  let restartDebounceTimer = null;
  let restartAttempts = 0;

  // Changing a routing preset rewrites the core config, which only takes effect on
  // the next connect. The restart has to survive a connect that is already in
  // flight: connectToLink refuses to run two at once, so handing the request to it
  // while one is running got the request dropped on the floor -- the first connect
  // would then abort against the state this function had already cleared and leave
  // the app stuck on "Connecting".
  async function restartConnectionIfActive() {
    if (restartDebounceTimer) clearTimeout(restartDebounceTimer);
    restartAttempts = 0;
    restartDebounceTimer = setTimeout(restartConnectionNow, 800);
  }

  async function restartConnectionNow() {
    if (!isRunning || !connectedServerLink) return;

    const link = connectedServerLink;
    if (isConnectToLinkActive) {
      // A connect is still settling. Loop back around instead of giving up: a
      // dropped restart is exactly what strands the connection mid-switch.
      if (restartAttempts++ >= 10) {
        restartAttempts = 0;
        return;
      }
      restartDebounceTimer = setTimeout(restartConnectionNow, 400);
      return;
    }
    restartAttempts = 0;

    console.log('Routing/Core settings changed. Reconnecting automatically...');
    connectedServerLink = null; // Clean state for a fresh connectToLink
    isRunning = false;
    isConnecting = false;
    refreshProcessRuleWarning();
    await connectToLink(link, true);
  }

  // Export for global access by inline onclicks
  window.restartConnectionIfActive = restartConnectionIfActive;

  function updateCoreSettings() {
    const frag = tlsFragment ? tlsFragment.checked : false;
    const strict = strictRoute ? strictRoute.checked : false;
    const core = coreSelect ? coreSelect.value : 'auto';
    invoke('update_core_settings', { fragment: frag, strictRoute: strict, coreChoice: core })
      .then(() => restartConnectionIfActive())
      .catch(e => console.error(e));
  }
  if (autoReconnect) autoReconnect.addEventListener('change', () => {
    invoke('set_auto_reconnect', { enabled: autoReconnect.checked }).catch(e => console.error(e));
  });
    if (livePing) livePing.addEventListener('change', () => {
    invoke('set_live_ping_enabled', { enabled: livePing.checked }).catch(e => console.error(e));
    applyLivePingToggle();
  });
  // Duplicate listeners removed — updateCoreSettings already handles these via lines 1716/1721
  if (remoteDns) remoteDns.addEventListener('change', () => {
    const local = localDns ? localDns.value : 'local';
    // Resolvers are baked into the config at build time, so a change made while connected
    // silently kept using the old one. Every other control in this tab restarts the
    // connection for exactly this reason; these two were the only ones that did not.
    invoke('update_dns_settings', { remote: remoteDns.value, local: local })
      .then((reloaded) => { if(!reloaded && restartConnectionIfActive) restartConnectionIfActive(); })
      .catch(e => console.error(e));
  });
  if (localDns) localDns.addEventListener('change', () => {
    const remote = remoteDns ? remoteDns.value : 'https://8.8.8.8/dns-query';
    invoke('update_dns_settings', { remote: remote, local: localDns.value })
      .then((reloaded) => { if(!reloaded && restartConnectionIfActive) restartConnectionIfActive(); })
      .catch(e => console.error(e));
  });
}

// ===== Load Settings Values from Backend =====
async function loadSettingsValues() {
  try {
    const settings = await invoke('get_startup_settings');
    if (!settings) return;
    
    const setChecked = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
    setChecked('toggle-auto-start', settings.auto_start);
    setChecked('toggle-start-minimized', settings.start_minimized);
    setChecked('toggle-auto-update-subs', settings.auto_update_subs);
    setChecked('toggle-auto-reconnect', settings.auto_reconnect);
        setChecked('toggle-live-ping', settings.live_ping_enabled);
    applyLivePingToggle();
    
    // Disable start minimized if auto start is off
    const minItem = document.getElementById('toggle-start-minimized');
    if (minItem && !settings.auto_start) {
      minItem.closest('.setting-item').style.opacity = '0.4';
      minItem.closest('.setting-item').style.pointerEvents = 'none';
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
  
  // Load core settings (core_choice, tls_fragment, strict_route)
  try {
    const coreSettings = await invoke('get_core_settings');
    if (coreSettings) {
      const coreEl = document.getElementById('select-core');
      if (coreEl) {
        coreEl.value = coreSettings.core_choice || 'auto';
        
        // Update custom dropdown UI
        const coreDropdownSelected = document.getElementById('core-dropdown-selected');
        const options = document.querySelectorAll('#core-dropdown .custom-dropdown-option');
        options.forEach(opt => {
          if (opt.getAttribute('data-value') === coreEl.value) {
            opt.classList.add('active');
            // Copy the markup, not the text -- the option's data-i18n hook has to ride
            // along or the label stops translating after this load.
            if (coreDropdownSelected) coreDropdownSelected.innerHTML = opt.innerHTML;
          } else {
            opt.classList.remove('active');
          }
        });
      }
      
      const fragEl = document.getElementById('toggle-tls-fragment');
      if (fragEl) fragEl.checked = !!coreSettings.tls_fragment;
      const strictEl = document.getElementById('toggle-strict-route');
      if (strictEl) strictEl.checked = !!coreSettings.strict_route;
    }
  } catch (_) {}

  // Otherwise the inputs keep showing the hardcoded HTML default and silently
  // disagree with the resolver the core is actually using.
  try {
    const dns = await invoke('get_dns_settings');
    if (dns) {
      const rd = document.getElementById('input-remote-dns');
      if (rd) rd.value = dns.remote_dns || '';
      const ld = document.getElementById('input-local-dns');
      if (ld) ld.value = dns.local_dns || '';
    }
  } catch (_) {}
}

// ===== Statistics Modal =====
let statsModalInterval = null;
let currentStatsKey = null;
let currentStatsIsGroup = false;
let currentStatsGroupData = null;

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function openStatsModal(key, isGroup, title, groupData) {
  currentStatsKey = key;
  currentStatsIsGroup = isGroup;
  currentStatsGroupData = groupData;
  const modal = document.getElementById('stats-modal');
  const titleEl = document.getElementById('stats-modal-title');
  if (titleEl) titleEl.textContent = title || 'Statistics';
  
  // Show/hide traffic and expire cards for subscriptions
  const trafficCard = document.getElementById('stats-traffic-card');
  const expireCard = document.getElementById('stats-expire-card');
  if (isGroup && groupData) {
    if (groupData.total && trafficCard) {
      trafficCard.style.display = '';
      const used = (groupData.upload || 0) + (groupData.download || 0);
      const left = groupData.total - used;
      document.getElementById('stats-traffic-left').textContent = formatBytes(Math.max(0, left));
    }
    if (groupData.expire && expireCard) {
      expireCard.style.display = '';
      const now = Math.floor(Date.now() / 1000);
      const daysLeft = Math.max(0, Math.floor((groupData.expire - now) / 86400));
      document.getElementById('stats-days-left').textContent = daysLeft + ' days';
    }
  } else {
    if (trafficCard) trafficCard.style.display = 'none';
    if (expireCard) expireCard.style.display = 'none';
  }
  
  modal.style.display = 'flex';
  refreshStatsData();
  statsModalInterval = setInterval(refreshStatsData, 1000);
}

function closeStatsModal() {
  const modal = document.getElementById('stats-modal');
  modal.style.display = 'none';
  if (statsModalInterval) { clearInterval(statsModalInterval); statsModalInterval = null; }
  currentStatsKey = null;
}

// ===== Edit Server Modal =====
let currentEditServerGroup = null;
let currentEditServerLink = null;
let currentEditServerParsed = null;

function parseVpnLink(link) {
  if (link.startsWith('vmess://')) {
    try {
      let b64 = link.substring(8).replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const obj = JSON.parse(decodeURIComponent(escape(window.atob(b64))));
      return { type: 'vmess', remark: obj.ps || '', address: obj.add || '', port: obj.port || '', id: obj.id || '', sni: obj.sni || '', host: obj.host || '', orig: obj };
    } catch(e) {
      console.error('VMESS parse error:', e);
      return null;
    }
  }
  try {
    const idx = link.indexOf('://');
    if (idx === -1) return null;
    
    const type = link.substring(0, idx);
    let rest = link.substring(idx + 3);
    
    let remark = '';
    const hashIdx = rest.indexOf('#');
    if (hashIdx !== -1) {
        remark = decodeURIComponent(rest.substring(hashIdx + 1));
        rest = rest.substring(0, hashIdx);
    }
    
    let query = '';
    const queryIdx = rest.indexOf('?');
    if (queryIdx !== -1) {
        query = rest.substring(queryIdx + 1);
        rest = rest.substring(0, queryIdx);
    }
    
    let id = '';
    const atIdx = rest.indexOf('@');
    if (atIdx !== -1) {
        id = rest.substring(0, atIdx);
        rest = rest.substring(atIdx + 1);
    }
    
    let address = '';
    let port = '';
    const portIdx = rest.lastIndexOf(':');
    if (portIdx !== -1 && !rest.includes(']')) {
        address = rest.substring(0, portIdx);
        port = rest.substring(portIdx + 1);
    } else if (rest.includes(']:')) {
        const split = rest.split(']:');
        address = split[0] + ']';
        port = split[1];
    } else {
        address = rest;
    }
    
    const params = new URLSearchParams(query);
    const sni = params.get('sni') || '';
    const host = params.get('host') || '';
    
    return { type, remark, address, port, id, sni, host, params };
  } catch (e) {
    console.error('VPN parse error:', e);
    return null;
  }
}

function stringifyVpnLink(parsed) {
  if (parsed.type === 'vmess') {
    const obj = { ...parsed.orig, ps: parsed.remark, add: parsed.address, port: String(parsed.port), id: parsed.id, sni: parsed.sni, host: parsed.host };
    return 'vmess://' + window.btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
  }
  if (parsed.sni) parsed.params.set('sni', parsed.sni); else parsed.params.delete('sni');
  if (parsed.host) parsed.params.set('host', parsed.host); else parsed.params.delete('host');
  
  const qs = parsed.params.toString();
  const qStr = qs ? '?' + qs : '';
  const hashStr = parsed.remark ? '#' + encodeURIComponent(parsed.remark) : '';
  const idStr = parsed.id ? parsed.id + '@' : '';
  return `${parsed.type}://${idStr}${parsed.address}${parsed.port ? ':' + parsed.port : ''}${qStr}${hashStr}`;
}

function openEditServerModal(groupKey, link) {
  try {
    currentEditServerGroup = groupKey;
    currentEditServerLink = link;
    
    const parsed = parseVpnLink(link);
    if (!parsed) {
      alert(t('dialog.edit_link_unsupported'));
      return;
    }
    currentEditServerParsed = parsed;
    
    if (!document.getElementById('edit-server-modal')) {
      alert(t('dialog.dev_modal_missing'));
      return;
    }
    
    document.getElementById('edit-svr-remark').value = parsed.remark || '';
    document.getElementById('edit-svr-address').value = parsed.address || '';
    document.getElementById('edit-svr-port').value = parsed.port || '';
    document.getElementById('edit-svr-id').value = parsed.id || '';
    document.getElementById('edit-svr-sni').value = parsed.sni || '';
    document.getElementById('edit-svr-host').value = parsed.host || '';
    
    document.getElementById('edit-server-modal').style.display = 'flex';
  } catch (e) {
    alert(t('dialog.crash', null, {msg: e.message, stack: e.stack}));
  }
}

function closeEditServerModal() {
  const modal = document.getElementById('edit-server-modal');
  if (modal) modal.style.display = 'none';
}

async function saveServerEdits() {
  if (!currentEditServerParsed) return;
  
  const oldRemark = currentEditServerParsed.remark;
  let newRemark = document.getElementById('edit-svr-remark').value.trim();
  
  const oldFlag = extractFlagEmoji(oldRemark || '');
  const newFlag = extractFlagEmoji(newRemark);
  if (oldFlag && !newFlag) {
    newRemark = oldFlag + ' ' + newRemark;
  }
  
  currentEditServerParsed.remark = newRemark;
  currentEditServerParsed.address = document.getElementById('edit-svr-address').value.trim();
  currentEditServerParsed.port = document.getElementById('edit-svr-port').value.trim();
  currentEditServerParsed.id = document.getElementById('edit-svr-id').value.trim();
  currentEditServerParsed.sni = document.getElementById('edit-svr-sni').value.trim();
  currentEditServerParsed.host = document.getElementById('edit-svr-host').value.trim();
  
  const newLink = stringifyVpnLink(currentEditServerParsed);
  
  if (newLink === currentEditServerLink) {
    closeEditServerModal();
    return;
  }
  
  try {
    await invoke('edit_server', {
      group: currentEditServerGroup,
      oldLink: currentEditServerLink,
      newLink: newLink
    });
    
    // Update connected link if we were connected to it!
    if (connectedServerLink === currentEditServerLink) {
       connectedServerLink = newLink;
    }
    if (selectedServerLink === currentEditServerLink) {
       selectedServerLink = newLink;
    }
    
    log(t('log.server_updated'));
    closeEditServerModal();
    await refreshServerList(); // Refresh UI
  } catch (e) {
    log(t('log.edit_server_failed', null, {err: e}));
  }
}

// ===== Edit Subscription Modal =====
let currentEditSubKey = null;

function openEditSubModal(groupKey, groupData) {
  currentEditSubKey = groupKey;
  const modal = document.getElementById('edit-sub-modal');
  if (modal) modal.style.display = 'flex';

  const nameInput = document.getElementById('edit-sub-name');
  if (nameInput) nameInput.value = groupData.name || groupKey;
  
  const urlInput = document.getElementById('edit-sub-url');
  if (urlInput) urlInput.value = groupKey;

  const countEl = document.getElementById('edit-sub-server-count');
  if (countEl) {
    const c = (groupData.servers ? groupData.servers.length : groupData.servers_count) || 0;
    countEl.textContent = t('common.servers_n', null, { count: c, n: c });
  }

  const autoToggle = document.getElementById('edit-sub-auto-update');
  if (autoToggle) autoToggle.checked = groupData.auto_update !== false;

  const interval = groupData.update_interval || 24;
  const intervalInput = document.getElementById('edit-sub-interval');
  if (intervalInput) intervalInput.value = interval;

  selectIntervalChip(interval);

  // Populate Quota & Expiry in Edit Modal
  const trafficLeftEl = document.getElementById('edit-sub-traffic-left');
  if (trafficLeftEl) {
    if (groupData.total) {
      const used = (groupData.upload || 0) + (groupData.download || 0);
      const left = groupData.total - used;
      trafficLeftEl.textContent = formatBytes(Math.max(0, left));
    } else {
      trafficLeftEl.textContent = '-';
    }
  }

  const daysLeftEl = document.getElementById('edit-sub-days-left');
  if (daysLeftEl) {
    if (groupData.expire) {
      const now = Math.floor(Date.now() / 1000);
      const days = Math.max(0, Math.floor((groupData.expire - now) / 86400));
      daysLeftEl.textContent = days + ' days';
    } else {
      daysLeftEl.textContent = '-';
    }
  }

  // Populate Total Used, Average Ping & Render Daily Graph
  const updateModalStats = (stats) => {
    if (!stats) return;
    const totalEl = document.getElementById('edit-sub-total-used');
    if (totalEl) totalEl.textContent = formatBytes(stats.total_used || 0);

    const uploadEl = document.getElementById('edit-sub-total-upload');
    if (uploadEl) uploadEl.textContent = formatBytes(stats.total_upload || 0);

    const pingEl = document.getElementById('edit-sub-avg-ping');
    if (pingEl) {
      const pings = stats.ping_history || [];
      if (pings.length > 0) {
        pingEl.textContent = Math.round(pings.reduce((a, b) => a + b, 0) / pings.length) + ' ms';
      } else {
        pingEl.textContent = '- ms';
      }
    }
  };

  if (groupData.stats) {
    updateModalStats(groupData.stats);
  }
  invoke('get_item_stats', { isGroup: true, key: groupKey }).then(stats => {
    if (stats) updateModalStats(stats);
  }).catch(() => {});
}

function closeEditSubModal() {
  const modal = document.getElementById('edit-sub-modal');
  if (modal) modal.style.display = 'none';
  currentEditSubKey = null;
}

async function saveSubscriptionEdits() {
  if (!currentEditSubKey) return;
  const name = document.getElementById('edit-sub-name').value.trim();
  const new_url = document.getElementById('edit-sub-url').value.trim();
  const auto_update = document.getElementById('edit-sub-auto-update').checked;
  const update_interval = parseInt(document.getElementById('edit-sub-interval').value) || 24;
  
  const urlChanged = new_url && new_url !== currentEditSubKey;

  try {
    await invoke('edit_subscription', {
      url: currentEditSubKey,
      newUrl: urlChanged ? new_url : null,
      name,
      autoUpdate: auto_update,
      updateInterval: update_interval
    });
    closeEditSubModal();
    if (urlChanged) {
      // Sync fresh configs for the updated subscription URL in background
      invoke('update_subscription', { url: new_url }).catch(e => console.error(e));
    }
    await refreshServerList();
    await refreshSubscriptions();
  } catch (e) {
    log(t('log.save_sub_failed', null, {err: e}));
  }
}


async function refreshStatsData() {
  if (!currentStatsKey) return;
  try {
    let aggregatedStats = { total_used: 0, total_upload: 0, daily_usage: {}, ping_history: [] };

    if (currentStatsIsGroup) {
      const labelEl = document.querySelector('#stats-total-used').previousElementSibling;
      if (labelEl) labelEl.textContent = t('stats.total_in_client');

      const groupStats = await invoke('get_item_stats', { isGroup: true, key: currentStatsKey });
      const hasNativeGroupStats = groupStats && (groupStats.total_used > 0 || groupStats.total_upload > 0 || Object.keys(groupStats.daily_usage || {}).length > 0);

      if (hasNativeGroupStats) {
        aggregatedStats.total_used = groupStats.total_used || 0;
        aggregatedStats.total_upload = groupStats.total_upload || 0;
        aggregatedStats.daily_usage = groupStats.daily_usage || {};
      }

      if (currentStatsGroupData && currentStatsGroupData.servers) {
        let allPings = [];

        // Fetch stats concurrently to avoid blocking the UI thread for 100+ servers
        const statPromises = currentStatsGroupData.servers.map(server => {
          const lUrl = typeof server === 'string' ? server : server.link || server.url;
          return invoke('get_item_stats', { isGroup: false, key: lUrl }).catch(() => null);
        });
        const statResults = await Promise.all(statPromises);

        for (const s of statResults) {
          if (s) {
            if (s.ping_history) allPings.push(...s.ping_history);

            // Only aggregate traffic if we don't have native group stats (legacy fallback)
            if (!hasNativeGroupStats) {
              aggregatedStats.total_used += (s.total_used || 0);
              aggregatedStats.total_upload += (s.total_upload || 0);
              if (s.daily_usage) {
                for (const [date, bytes] of Object.entries(s.daily_usage)) {
                  aggregatedStats.daily_usage[date] = (aggregatedStats.daily_usage[date] || 0) + bytes;
                }
              }
            }
          }
        }
        aggregatedStats.ping_history = allPings;
      }
    } else {
      const labelEl = document.querySelector('#stats-total-used').previousElementSibling;
      if (labelEl) labelEl.textContent = t('stats.total_used');

      const stats = await invoke('get_item_stats', { isGroup: false, key: currentStatsKey });
      if (stats) aggregatedStats = stats;
    }

    // Check if never connected (all stats empty)
    const hasData = (aggregatedStats.total_used && aggregatedStats.total_used > 0) ||
                    (aggregatedStats.total_upload && aggregatedStats.total_upload > 0) ||
                    (aggregatedStats.daily_usage && Object.keys(aggregatedStats.daily_usage).length > 0) ||
                    (aggregatedStats.ping_history && aggregatedStats.ping_history.length > 0);

    if (!hasData) {
      document.getElementById('stats-total-used').textContent = t('stats.waiting_connection');
      document.getElementById('stats-total-upload').textContent = t('stats.waiting_connection');
      document.getElementById('stats-avg-ping').textContent = '- ms';
    } else {
      // Update total used
      document.getElementById('stats-total-used').textContent = formatBytes(aggregatedStats.total_used || 0);
      document.getElementById('stats-total-upload').textContent = formatBytes(aggregatedStats.total_upload || 0);
      
      // Update average ping
      const pings = aggregatedStats.ping_history || [];
      if (pings.length > 0) {
        const avg = Math.round(pings.reduce((a, b) => a + b, 0) / pings.length);
        document.getElementById('stats-avg-ping').textContent = avg + ' ms';
      } else {
        document.getElementById('stats-avg-ping').textContent = '- ms';
      }
    }
    
    // Draw graph
    drawStatsGraph(aggregatedStats.daily_usage || {}, aggregatedStats.ping_history || []);
  } catch (e) {
    console.error('Stats refresh error:', e);
  }
}

function renderDailyUsageGraph(canvas, dailyUsage) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Canvas painting cannot see CSS variables, so the theme's overlay and text tokens are
  // resolved here. Without this the gridlines and axis labels are drawn white on white in
  // the light theme and disappear along with them.
  const cssVar = (name, fallback) => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  };
  const grid = cssVar('--ov-006', 'rgba(255,255,255,0.06)');
  const axis = cssVar('--text-faint', '#888888');
  const dotFill = cssVar('--solid-inv', '#ffffff');
  const lineColor = 'rgba(74, 222, 128, 1)';
  
  let dates = Object.keys(dailyUsage || {}).sort();
  
  // Ensure we have at least 2 points so it's never just a dot
  if (dates.length === 1) {
    const [y, m, d] = dates[0].split('-').map(Number);
    const yesterday = new Date(y, m - 1, d - 1);
    const yStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth()+1).padStart(2,'0')}-${String(yesterday.getDate()).padStart(2,'0')}`;
    dailyUsage[yStr] = 0;
    dates.unshift(yStr);
  }
  
  const dpr = window.devicePixelRatio || 1;
  // Fix vertical stretch by reading actual CSS height
  const style = window.getComputedStyle(canvas);
  let w = parseFloat(style.width) || canvas.parentElement?.clientWidth || 670;
  let h = parseFloat(style.height) || 200;

  // Force CSS dimensions to prevent parent container from growing on high-DPI screens
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  
  if (dates.length === 0) {
    ctx.strokeStyle = grid;
    ctx.beginPath();
    ctx.moveTo(30, h - 25);
    ctx.lineTo(w - 30, h - 25);
    ctx.stroke();

    ctx.fillStyle = axis;
    ctx.font = '12px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t('stats.no_traffic_data'), w / 2, h / 2);
    return;
  }
  
  const usages = dates.map(d => dailyUsage[d]);
  const maxUsage = Math.max(...usages) * 1.1 || 1;
  
  const padBottom = 25;
  const padTop = 15;
  const padLeft = 60;
  const padRight = 20;
  
  const graphW = Math.max(10, w - padLeft - padRight);
  const graphH = Math.max(10, h - padBottom - padTop);
  
  // Draw grid & Y-axis labels
  ctx.strokeStyle = grid;
  ctx.fillStyle = axis;
  ctx.font = '10px Inter, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  
  const ySteps = 3;
  for (let i = 0; i <= ySteps; i++) {
    const yVal = maxUsage * (i / ySteps);
    const yPos = padTop + graphH - (graphH * (i / ySteps));
    ctx.beginPath();
    ctx.moveTo(padLeft, yPos);
    ctx.lineTo(padLeft + graphW, yPos);
    ctx.stroke();
    ctx.fillText(formatBytes(yVal), padLeft - 6, yPos);
  }
  
  // Draw Line Chart
  if (dates.length > 0) {
    ctx.beginPath();
    
    const stepX = graphW / (dates.length - 1);
    
    const points = dates.map((dateStr, i) => {
      const usage = usages[i];
      let px = padLeft + (i * stepX);
      const py = padTop + graphH - ((usage / maxUsage) * graphH);
      return { x: px, y: py };
    });
    
    // Gradient fill under the line
    const gradient = ctx.createLinearGradient(0, padTop, 0, padTop + graphH);
    gradient.addColorStop(0, 'rgba(74, 222, 128, 0.3)');
    gradient.addColorStop(1, 'rgba(74, 222, 128, 0.0)');
    
    ctx.beginPath();
    ctx.moveTo(points[0].x, padTop + graphH);
    for (const p of points) {
      ctx.lineTo(p.x, p.y);
    }
    ctx.lineTo(points[points.length - 1].x, padTop + graphH);
    ctx.fillStyle = gradient;
    ctx.fill();
    
    // The line itself
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (const p of points) {
      ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // Draw points and X-axis labels
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = axis;

    points.forEach((p, i) => {
      // Dot
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, 2 * Math.PI);
      ctx.fillStyle = dotFill;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = lineColor;
      ctx.stroke();

      // Label
      const [yr, mo, dy] = dates[i].split('-').map(Number);
      const dateObj = new Date(yr, mo - 1, dy);
      const label = dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

      // Only draw label if there's space (avoid crowding)
      if (stepX > 40 || i % Math.ceil(40 / stepX) === 0 || i === points.length - 1) {
        ctx.fillStyle = axis;
        ctx.fillText(label, p.x, padTop + graphH + 8);
      }
    });
  }
}

function drawStatsGraph(dailyUsage, pingHistory) {
  renderDailyUsageGraph(document.getElementById('stats-canvas'), dailyUsage);
}

// The backend reports an empty string when every enabled .exe rule will be honoured, or a
// stable code when one cannot be. The code indexes the strings in i18n-strings.js, so the
// copy stays translated and the backend never holds prose.
const PROCESS_RULE_REASONS = { link_forces_xray: 'routing.apps.rule_inert_xhttp' };

function refreshProcessRuleWarning() {
  const els = ['bypass-apps-rule-warning', 'proxy-apps-rule-warning']
    .map(id => document.getElementById(id))
    .filter(Boolean);
  const hide = () => els.forEach(el => {
    el.hidden = true;
    el.textContent = '';
    el.removeAttribute('data-i18n');
  });
  hide();
  // Nothing is connected, so no config is generated and no rule is being dropped.
  // This is the module-scoped binding, not a window property: app.js loads as a classic
  // script, so a top-level `let` is a global lexical binding and `window.connectedServerLink`
  // is permanently undefined -- which silently held this warning closed forever.
  if (!connectedServerLink) return;
  const link = connectedServerLink;
  invoke('process_rule_status', { link, tunMode: !!(tunToggle && tunToggle.checked) })
    .then(code => {
      const key = PROCESS_RULE_REASONS[code];
      if (!key) return;
      els.forEach(el => {
        // Carrying data-i18n lets the language pass re-translate this without our help,
        // the same way the mode pills do.
        el.setAttribute('data-i18n', key);
        el.textContent = t(key);
        el.hidden = false;
      });
    })
    .catch(e => console.error('process_rule_status failed:', e));
}

// ===== Routing Rules Display =====
async function refreshRoutingRules() {
  try {
    const result = await invoke('get_routing_rules');
    const rules = result.rules || result || [];

    const BYPASS_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 14 20 9 15 4"></polyline><path d="M4 20v-7a4 4 0 0 1 4-4h12"></path></svg>';
    const PROXY_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>';
    const BLOCK_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>';
    // Actions the backend understands. An unknown value is shown as-is rather than
    // collapsed to Bypass, so a future action never silently changes meaning.
    const KNOWN_ACTIONS = {
      bypass: { icon: BYPASS_ICON, label: t('routing.action.bypass') },
      proxy: { icon: PROXY_ICON, label: t('routing.action.proxy') },
      block: { icon: BLOCK_ICON, label: t('routing.action.block') },
    };

    // The list is split by action into the two sections the UI shows, so the mode
    // toggle and the rules a user sees always agree. Process rules go to the
    // Applications half of the same pane; they are a different engine concept and get
    // their own rendering with an icon and a file name instead of a bare pattern.
    const byAction = (action) => (Array.isArray(rules) ? rules : []).filter(r => r.action === action);
    const isProcess = (r) => (r.kind || 'domain') === 'process';
    const byKind = (action, kind) => byAction(action).filter(r => kind === 'process' ? isProcess(r) : !isProcess(r));

    renderRulesInto(byKind('bypass', 'domain'), 'bypass-rules-list', KNOWN_ACTIONS, 'bypass');
    renderRulesInto(byKind('proxy', 'domain'), 'proxy-rules-list', KNOWN_ACTIONS, 'proxy');
    renderRulesInto(byKind('block', 'domain'), 'block-rules-list', KNOWN_ACTIONS, 'block');
    renderProcessRulesInto(byKind('bypass', 'process'), 'bypass-apps-list', 'bypass');
    renderProcessRulesInto(byKind('proxy', 'process'), 'proxy-apps-list', 'proxy');

    // The recommended chips mark the ones already in the list, so publish the current set
    // before they re-render. Repainting is safe now -- a scan still in flight keeps its
    // placeholder instead of being wiped to empty.
    window.__vxrayProcessRules = {
      bypass: byKind('bypass', 'process').map(r => r.pattern),
      proxy: byKind('proxy', 'process').map(r => r.pattern),
    };
    repaintRecommended();

    const count = (action, kind) => byKind(action, kind).length;
    for (const [action, id] of [['bypass','bypass-count'], ['proxy','proxy-count'], ['block','block-count']]) {
      const el = document.getElementById(id);
      if (el) el.textContent = count(action, 'domain');
    }
    for (const [action, id] of [['bypass','bypass-apps-count'], ['proxy','proxy-apps-count']]) {
      const el = document.getElementById(id);
      if (el) el.textContent = count(action, 'process');
    }
    // Legacy block rules have no add-control anymore, so the section only shows up
    // if some are actually stored.
    const blockSection = document.getElementById('routing-section-block');
    if (blockSection) blockSection.style.display = count('block', 'domain') ? '' : 'none';

    // An .exe rule the connected server cannot carry is still listed and still enabled, so it
    // has to be flagged where it sits -- otherwise it reads as a toggle that does nothing.
    refreshProcessRuleWarning();
  } catch (e) {
    console.error('Failed to load routing rules:', e);
  }
}

function renderRulesInto(rules, listId, KNOWN_ACTIONS, action) {
  const listEl = document.getElementById(listId);
  if (!listEl) return;
  listEl.innerHTML = '';

  if (!rules.length) {
    const empty = document.createElement('div');
    empty.className = 'routing-empty-hint';
    empty.dataset.i18n = 'routing.empty.' + action;
    empty.textContent = t('routing.empty.' + action);
    empty.dir = 'auto';
    listEl.appendChild(empty);
    return;
  }

  rules.forEach(rule => {
    const item = document.createElement('div');
    item.className = 'routing-rule-item';
    const meta = KNOWN_ACTIONS[rule.action] || null;
    const actionHtml = meta
      ? `${meta.icon} ${meta.label}`
      : `${KNOWN_ACTIONS.block.icon} ${rule.action}`;
    const isEnabled = rule.enabled !== false; // Default to true if missing
    const patternStyle = isEnabled ? '' : 'opacity: 0.4; text-decoration: line-through;';

    item.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px; flex: 1; overflow: hidden;">
        <span class="routing-rule-pattern" style="${patternStyle}">${escapeHtml(rule.pattern)}</span>
        <span class="routing-rule-action ${rule.action}" style="${!isEnabled ? 'opacity: 0.4;' : ''}">${actionHtml}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
        <label class="toggle-switch" style="transform: scale(0.65); margin: 0;" title="${t('routing.rule.toggle')}">
          <input type="checkbox" onchange="handleToggleRoutingRule('${rule.id}', this.checked)" ${isEnabled ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
        <button class="routing-rule-delete" onclick="handleDeleteRoutingRule('${rule.id}')" title="${t('routing.rule.delete')}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
    `;
    listEl.appendChild(item);
  });
}

function renderProcessRulesInto(rules, listId, mode) {
  const listEl = document.getElementById(listId);
  if (!listEl) return;
  listEl.innerHTML = '';

  if (!rules.length) {
    const empty = document.createElement('div');
    empty.className = 'routing-empty-hint';
    empty.dataset.i18n = 'routing.apps.empty_' + mode;
    empty.textContent = t('routing.apps.empty_' + mode);
    empty.dir = 'auto';
    listEl.appendChild(empty);
    return;
  }

  rules.forEach(rule => {
    const item = document.createElement('div');
    item.className = 'routing-rule-item routing-app-item';
    const isEnabled = rule.enabled !== false;
    const patternStyle = isEnabled ? '' : 'opacity: 0.4; text-decoration: line-through;';

    // A full path is too long for the row, so show the file name and keep the path in
    // the title for anyone who needs to see where it came from.
    const fileName = rule.pattern.split('\\').pop().split('/').pop() || rule.pattern;
    const initial = (fileName.trim()[0] || '?').toUpperCase();

    item.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px; flex: 1; overflow: hidden;">
        <span class="routing-app-icon" style="${!isEnabled ? 'opacity: 0.4;' : ''}" aria-hidden="true">${escapeHtml(initial)}</span>
        <span style="display: flex; flex-direction: column; min-width: 0; flex: 1;">
          <span class="routing-rule-pattern routing-app-name" style="${patternStyle}" title="${escapeHtml(rule.pattern)}">${escapeHtml(fileName)}</span>
          <span class="routing-app-path">${escapeHtml(rule.pattern)}</span>
        </span>
      </div>
      <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
        <label class="toggle-switch" style="transform: scale(0.65); margin: 0;" title="${t('routing.rule.toggle')}">
          <input type="checkbox" onchange="handleToggleRoutingRule('${rule.id}', this.checked)" ${isEnabled ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
        <button class="routing-rule-delete" onclick="handleDeleteRoutingRule('${rule.id}')" title="${t('routing.rule.delete')}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
    `;
    listEl.appendChild(item);
  });
}

// A process rule toggle and a process rule delete restart the adapter through the same path
// adding one does, so they owe the user the same signal. Without it the switch looks dead for
// the second or two the reload takes, which reads as "the toggle does nothing".
async function handleToggleRoutingRule(id, enabled) {
  try {
    const reloaded = await invoke('toggle_routing_rule', { id: id, enabled: enabled });
    refreshRoutingRules();
    if (!reloaded && window.restartConnectionIfActive) await window.restartConnectionIfActive();
  } catch (e) {
    console.error('Failed to toggle routing rule:', e);
  }
}

async function handleDeleteRoutingRule(id) {
  try {
    const reloaded = await invoke('delete_routing_rule', { id: id });
    refreshRoutingRules();
    if (!reloaded && window.restartConnectionIfActive) await window.restartConnectionIfActive();
  } catch (e) {
    console.error(e);
  }
}


// ===== Subscription Collapse Memory =====
async function saveCollapsedGroupsToSettings() {
  try {
    localStorage.setItem('vxray_collapsed_groups', JSON.stringify(collapsedGroups));
  } catch (e) {}
}

function loadCollapsedGroupsFromSettings() {
  try {
    const saved = localStorage.getItem('vxray_collapsed_groups');
    if (saved) {
      const parsed = JSON.parse(saved);
      Object.assign(collapsedGroups, parsed);
    }
  } catch (e) {}
}

// ===== Auto-Update Timer =====
// Per-group due times, so the interval each subscription card advertises is the interval that
// actually refreshes it. A single hard-coded 4h tick used to service every group regardless of
// the 1h/4h/12h/24h/48h value the modal saved, which made the control and its badge promise
// behaviour the app never delivered.
const subDueTimes = new Map();
let autoUpdateTimer = null;

function scheduleNextSubscriptionSweep() {
  if (autoUpdateTimer) clearInterval(autoUpdateTimer);
  // A 10-minute sweep is the resolution floor: anything finer would hammer a provider for a
  // 1h subscription that is already due, and the stored intervals are all an hour or more.
  autoUpdateTimer = setInterval(refreshDueSubscriptions, 10 * 60 * 1000);
  // The first check runs immediately rather than after the whole interval, so a launch that
  // missed a scheduled refresh while closed does not wait an arbitrary extra 10 minutes.
  refreshDueSubscriptions();
}

async function refreshDueSubscriptions() {
  try {
    const settings = await invoke('get_startup_settings');
    if (!settings || !settings.auto_update_subs) return;

    const subsRaw = await invoke('get_subscriptions');
    const subs = typeof subsRaw === 'string' ? JSON.parse(subsRaw) : subsRaw;
    if (!Array.isArray(subs)) return;

    const now = Date.now();
    for (const sub of subs) {
      if (typeof sub === 'string') continue;
      if (sub.auto_update === false || !sub.url || sub.url === 'manual') continue;

      const hours = Number(sub.update_interval) > 0 ? Number(sub.update_interval) : 24;
      const due = subDueTimes.get(sub.url);
      if (due !== undefined && due > now) continue;

      subDueTimes.set(sub.url, now + hours * 60 * 60 * 1000);
      try {
        await invoke('update_subscription', { url: sub.url });
        await refreshServerList();
        await refreshSubscriptions();
      } catch (e) {
        console.error('Failed to auto-update ' + sub.url + ': ' + e);
      }
    }
  } catch (e) { console.error(e); }
}

// ===== Enhanced Init =====
document.addEventListener("DOMContentLoaded", () => {
  refreshSubscriptions();
  loadCollapsedGroupsFromSettings();
  initRoutingPresets();
  initSettingsListeners();
  loadSettingsValues();
  refreshRoutingRules();
  primeRecommendedApps();
  scheduleNextSubscriptionSweep();
});

// ===== Batch Import & Modal Logic =====
function openImportModal() {
  const modal = document.getElementById('import-modal');
  if (modal) modal.style.display = 'flex';
  
  const textarea = document.getElementById('txt-import-content');
  const banner = document.getElementById('import-status-banner');
  if (banner) {
    banner.style.display = 'none';
    banner.textContent = '';
  }
  
  if (textarea) {
    textarea.focus();
    updateImportPreview();
  }
}

function closeImportModal() {
  const modal = document.getElementById('import-modal');
  if (modal) modal.style.display = 'none';
  const banner = document.getElementById('import-status-banner');
  if (banner) banner.style.display = 'none';
}

function clearImportText() {
  const textarea = document.getElementById('txt-import-content');
  if (textarea) {
    textarea.value = '';
    textarea.focus();
  }
  updateImportPreview();
}

async function pasteFromClipboard() {
  try {
    let text = '';
    try {
      text = await invoke('read_from_clipboard');
    } catch (_) {
      text = await navigator.clipboard.readText();
    }
    if (text) {
      const textarea = document.getElementById('txt-import-content');
      if (textarea) {
        if (textarea.value.trim().length > 0) {
          textarea.value = textarea.value.trim() + '\n\n' + text.trim();
        } else {
          textarea.value = text.trim();
        }
        textarea.focus();
        updateImportPreview();
      }
    }
  } catch (err) {
    console.warn('Clipboard read error:', err);
  }
}

// A JSON array of complete Xray configs is a valid subscription body but contains no
// protocol:// token, so it would otherwise parse as zero servers. The conversion runs in Rust --
// it is the same code path a fetched subscription takes, so a paste and a download of the same
// content cannot diverge.
async function parseImportContent(rawText) {
  if (!rawText) return { servers: [], subscriptions: [] };
  let text = rawText.trim();

  // Try decoding base64 content if the block is pure base64 (e.g. copied from telegram)
  const compact = text.replace(/\s+/g, '');
  if (/^[A-Za-z0-9+/=]{40,}$/.test(compact)) {
    try {
      const decoded = atob(compact);
      if (decoded.includes('://')) {
        text = decoded;
      }
    } catch (e) {}
  }

  if (text.startsWith('[')) {
    try {
      const links = await invoke('xray_configs_to_links', { text });
      if (links.length) {
        return { servers: links, subscriptions: [] };
      }
    } catch (e) {}
  }

  const lines = text.split(/[\r\n]+/);
  const serverSet = new Set();
  const subSet = new Set();

  for (let line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    // Handle multiple tokens/links on a single line separated by whitespace
    const tokens = trimmedLine.split(/\s+/);
    for (const token of tokens) {
      const t = token.trim();
      if (!t) continue;

      const isProxy = PROXY_PREFIXES.some(p => t.toLowerCase().startsWith(p));
      if (isProxy) {
        serverSet.add(t);
      } else if (t.startsWith('http://') || t.startsWith('https://')) {
        subSet.add(t);
      }
    }
  }

  return {
    servers: Array.from(serverSet),
    subscriptions: Array.from(subSet)
  };
}

async function updateImportPreview() {
  const textarea = document.getElementById('txt-import-content');
  const badge = document.getElementById('import-preview-badge');
  const btn = document.getElementById('btn-do-import');
  if (!textarea || !badge || !btn) return;

  const { servers, subscriptions } = await parseImportContent(textarea.value);
  const total = servers.length + subscriptions.length;

  if (total === 0) {
    badge.className = 'import-preview-badge';
    badge.innerHTML = `<span>${t('import.waiting')}</span>`;
    btn.disabled = true;
    btn.innerHTML = `<span>${t('import.import')}</span>`;
  } else {
    badge.className = 'import-preview-badge has-items';
    const parts = [];
    if (servers.length > 0) parts.push(t('common.servers_n', null, {count: servers.length, n: servers.length}));
    if (subscriptions.length > 0) parts.push(t('common.subscriptions_n', null, {count: subscriptions.length, n: subscriptions.length}));
    badge.innerHTML = `<span>${t('import.recognized', null, {parts: parts.join(', ')})}</span>`;
    btn.disabled = false;
    btn.innerHTML = `<span>${t('import.import_count', null, {count: total, n: total})}</span>`;
  }
}

async function executeBatchImport() {
  const textarea = document.getElementById('txt-import-content');
  const btn = document.getElementById('btn-do-import');
  const banner = document.getElementById('import-status-banner');
  if (!textarea || !btn) return;

  const { servers, subscriptions } = await parseImportContent(textarea.value);
  const total = servers.length + subscriptions.length;
  if (total === 0) return;

  btn.disabled = true;
  btn.innerHTML = `<span>${t('import.importing')}</span>`;

  if (banner) {
    banner.style.display = 'flex';
    banner.style.background = 'var(--ov-008)';
    banner.style.color = 'var(--text-strong)';
    banner.style.border = '1px solid var(--ov-015)';
    banner.innerHTML = `<span>${t('import.processing', null, {n: total})}</span>`;
  }

  let importedServers = 0;
  let importedSubs = 0;
  const errors = [];

  try {
    // 1. Import manual servers in batch
    if (servers.length > 0) {
      try {
        importedServers = await invoke('add_servers', { links: servers });
      } catch (e) {
        console.error('Failed to add servers in batch, falling back to sequential:', e);
        for (const s of servers) {
          try {
            await invoke('add_server', { link: s });
            importedServers++;
          } catch (err) {
            errors.push(err);
          }
        }
      }
    }

    // 2. Import subscriptions and immediately update them
    if (subscriptions.length > 0) {
      for (const subUrl of subscriptions) {
        try {
          await invoke('add_subscription', { url: subUrl });
          await invoke('update_subscription', { url: subUrl });
          importedSubs++;
        } catch (e) {
          console.error(`Failed to add/update subscription ${subUrl}:`, e);
          errors.push(e);
        }
      }
    }

    // 3. Refresh UI
    await refreshServerList();
    await refreshSubscriptions();

    if (banner) {
      banner.style.background = 'rgba(74, 222, 128, 0.15)';
      banner.style.color = '#4ade80';
      banner.style.border = '1px solid rgba(74, 222, 128, 0.3)';
      const msgParts = [];
      if (importedServers > 0) msgParts.push(t('common.servers_n', null, {count: importedServers, n: importedServers}));
      if (importedSubs > 0) msgParts.push(t('common.subscriptions_n', null, {count: importedSubs, n: importedSubs}));
      banner.innerHTML = `<span>${t('import.success', null, {parts: msgParts.join(t('import.and'))})}</span>`;
    }

    // Auto-close after brief delay
    setTimeout(() => {
      closeImportModal();
      textarea.value = '';
      updateImportPreview();
      // If only subscriptions were added, switch to Subscriptions tab; otherwise Server tab
      if (importedServers > 0) {
        switchTab(0);
      } else if (importedSubs > 0) {
        switchTab(1);
      }
    }, 1200);

  } catch (err) {
    console.error('Batch import failed:', err);
    if (banner) {
      banner.style.background = 'rgba(248, 113, 113, 0.15)';
      banner.style.color = '#f87171';
      banner.style.border = '1px solid rgba(248, 113, 113, 0.3)';
      banner.innerHTML = `<span>${t('import.failed', null, {err})}</span>`;
    }
    btn.disabled = false;
    btn.innerHTML = `<span>${t('import.try_again')}</span>`;
  }
}

// ===== Window Exposures =====
window.switchSettingsTab = switchSettingsTab;
window.switchRoutingTab = switchRoutingTab;
window.switchRoutingSubTab = switchRoutingSubTab;
window.browseExecutable = browseExecutable;
window.handleAddProcessRule = handleAddProcessRule;
window.checkForUpdates = checkForUpdates;
window.startUpdateDownload = startUpdateDownload;
window.installDownloadedUpdate = installDownloadedUpdate;
window.copySystemInfo = copySystemInfo;
window.openSupportUrl = openSupportUrl;
window.closeStatsModal = closeStatsModal;
window.closeEditSubModal = closeEditSubModal;
window.saveSubscriptionEdits = saveSubscriptionEdits;
window.handleDeleteRoutingRule = handleDeleteRoutingRule;
window.openEditSubModal = openEditSubModal;
window.selectIntervalChip = selectIntervalChip;
window.copyCurrentEditUrl = copyCurrentEditUrl;
window.toggleCardStats = toggleCardStats;
window.updateSingleSubscriptionCard = updateSingleSubscriptionCard;
window.deleteSubscriptionFromTab = deleteSubscriptionFromTab;
window.updateAllSubscriptions = updateAllSubscriptions;
window.refreshSubscriptions = refreshSubscriptions;
window.openImportModal = openImportModal;
window.closeImportModal = closeImportModal;
window.clearImportText = clearImportText;
window.pasteFromClipboard = pasteFromClipboard;
window.updateImportPreview = updateImportPreview;
window.executeBatchImport = executeBatchImport;
window.handleGlobalPasteShortcut = handleGlobalPasteShortcut;
window.triggerPingTestShortcut = triggerPingTestShortcut;
window.triggerCopyShortcut = triggerCopyShortcut;
window.showServerCopiedFeedback = showServerCopiedFeedback;
window.closeEditServerModal = closeEditServerModal;
window.saveServerEdits = saveServerEdits;


// Rebuild everything that renders its own text, so a language switch takes effect
// immediately instead of waiting for the next data refresh.
window.addEventListener('vxray-language-changed', () => {
  updateSmartDash(_lastDashState, _lastDashPing);
  updateConnectBtnText();
  refreshServerList().catch(() => {});
  refreshSubscriptions().catch(() => {});
  refreshRoutingRules().catch(() => {});
  // No data-i18n hooks here -- the labels are assigned imperatively, so they need the
  // same re-render the other dynamic views already get.
  refreshStatsData().catch(() => {});
  // The version badge, the update card and the system row are all JS-rendered too.
  renderSupportVersion();
  renderUpdateCard();
  if (systemInfoLoaded) renderSystemInfo();
});

// ===== Help System =====
let _helpCurrentTopic = '';
let _helpCurrentLang = 'en';

const helpContent = HELP_CONTENT;

function showHelp(topic) {
  _helpCurrentTopic = topic;
  const content = helpContent[topic];
  if (!content) return;

  _helpCurrentLang = getCurrentLang();

  const modal = document.getElementById('help-modal');
  modal.style.display = 'flex';

  renderHelpContent(content, _helpCurrentLang);
  
  // Update lang buttons
  document.querySelectorAll('.help-lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === _helpCurrentLang);
  });
}

function switchHelpLang(lang) {
  _helpCurrentLang = lang;
  const content = helpContent[_helpCurrentTopic];
  if (!content) return;
  
  renderHelpContent(content, lang);
  
  document.querySelectorAll('.help-lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });
}

function renderHelpContent(content, lang) {
  const body = document.getElementById('help-modal-body');
  const data = content[lang] || content['en'];
  const isRTL = lang === 'fa' || lang === 'ar';
  
  body.innerHTML = `
    <div class="${isRTL ? 'help-rtl' : ''}">
      <div class="help-title">${data.title}</div>
      ${data.body}
    </div>
  `;
}

function closeHelp() {
  document.getElementById('help-modal').style.display = 'none';
}

// Close help modal on backdrop click
document.addEventListener('click', (e) => {
  const modal = document.getElementById('help-modal');
  if (e.target === modal) {
    closeHelp();
  }
});

// Close help modal on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const modal = document.getElementById('help-modal');
    if (modal && modal.style.display !== 'none') {
      closeHelp();
    }
  }
});

window.showHelp = showHelp;
window.switchHelpLang = switchHelpLang;
window.closeHelp = closeHelp;

// -----------------------------------------
// SPEED TEST MODULE
// -----------------------------------------

let stActive = false;
let stAbortController = null;
// Bumped at the start of every run, so the retire-UI timer chain in `finally` can tell its own
// run from a later one that has already re-shown the gauge.
let stUiGeneration = 0;

async function startSpeedTest() {
  const btnGo = document.getElementById('st-btn-go-large');
  const btnStop = document.getElementById('st-btn-stop');
  const gaugeArea = document.getElementById('st-gauge-area');
  const resultsArea = document.getElementById('st-results');

  if (stActive) {
    if (stAbortController) {
      stAbortController.abort();
      stAbortController = null;
    }
    return;
  }
  
  stActive = true;
  stUiGeneration++;
  stAbortController = new AbortController();
  const signal = stAbortController.signal;
  
  // Transition UI: Hide GO, Show Gauge & STOP
  btnGo.style.opacity = '0';
  btnGo.style.pointerEvents = 'none';
  
  setTimeout(() => {
      btnGo.style.display = 'none';
      gaugeArea.style.display = 'flex';
      btnStop.style.display = 'block';
      setTimeout(() => {
          gaugeArea.style.opacity = '1';
          resultsArea.style.opacity = '1';
      }, 50);
  }, 300);

  document.getElementById('st-val-ping').textContent = '---';
  document.getElementById('st-val-download').textContent = '---';
  document.getElementById('st-val-upload').textContent = '---';
  setGauge(0);
  
  // Cloudflare endpoints
  let dlUrl = 'https://speed.cloudflare.com/__down?bytes=500000000'; // 500MB to guarantee 5s on Gigabit
  let ulUrl = 'https://speed.cloudflare.com/__up';

  // A domestic endpoint for the not-yet-connected ping. Measuring latency against a
  // host inside Iran is what makes the number read as a local RTT; the previous
  // google.com/generate_204 probe also tripped CORS from the webview and reported
  // "Error". no-cors sidesteps that -- we only need the round trip, not the body.
  const irPingUrl = 'https://www.aparat.com/favicon.ico';

  async function iranPing(signal) {
    const t0 = performance.now();
    await fetch(`${irPingUrl}?_=${Date.now()}`, { cache: 'no-store', mode: 'no-cors', signal });
    return Math.round(performance.now() - t0);
  }

  try {
    let pingMs;

    if (isRunning && connectedServerLink) {
        try {
            const rawLat = await invoke('get_live_ping', { link: connectedServerLink });
            pingMs = typeof rawLat === 'number' ? rawLat : parseInt(rawLat);
        } catch (_) {
            pingMs = 'Error';
        }
    } else {
        // Not connected: measure the round trip to a domestic Iranian host so the
        // reading reflects the local network rather than an overseas CDN.
        try {
            pingMs = await iranPing(signal);
        } catch (e) {
            if (e.name === 'AbortError') throw e;
            pingMs = 'Error';
        }
    }
    
    document.getElementById('st-val-ping').textContent = (typeof pingMs === 'number' ? pingMs + ' ms' : pingMs);
    
    // Download Test (5 seconds)
    const dlStart = performance.now();
    let receivedLength = 0;
    try {
      const response = await fetch(dlUrl, { cache: 'no-store', signal });
      const reader = response.body.getReader();
      
      while(true) {
        const {done, value} = await reader.read();
        if (done) break;
        receivedLength += value.length;
        
        const currentMs = performance.now() - dlStart;
        if (currentMs > 100) {
            const speedMbps = ((receivedLength / (currentMs / 1000)) * 8) / 1000000;
            setGauge(speedMbps);
            document.getElementById('st-val-download').textContent = speedMbps.toFixed(2);
        }
        
        // Stop exactly after 8 seconds
        if (currentMs >= 8000) {
            reader.cancel();
            break;
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') throw e;
    }
    
    if (signal.aborted) throw new Error('Aborted');
    
    await new Promise(r => setTimeout(r, 1000));
    if (signal.aborted) throw new Error('Aborted');
    setGauge(0);
    
    // Upload Test (7 seconds)
    const ulStart = performance.now();
    const dummyData = new Uint8Array(200000000); // 200MB payload to guarantee 7s on Gigabit
    
    // For upload, we simulate progress by sending multiple smaller chunks, or since we can't track XHR upload progress easily with fetch, we'll just send a large payload and track time. 
    // Actually, `fetch` doesn't support upload progress. Let's use XMLHttpRequest to track upload progress properly.
    await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', ulUrl, true);
        
        // Handle abort
        signal.addEventListener('abort', () => {
            xhr.abort();
            reject(new Error('Aborted'));
        });
        
        xhr.upload.onprogress = (e) => {
            const currentMs = performance.now() - ulStart;
            if (currentMs > 100) {
                const speedMbps = ((e.loaded / (currentMs / 1000)) * 8) / 1000000;
                setGauge(speedMbps);
                document.getElementById('st-val-upload').textContent = speedMbps.toFixed(2);
            }
            // Abort exactly after 8 seconds
            if (currentMs >= 8000) {
                xhr.abort();
                resolve();
            }
        };
        
        xhr.onload = () => resolve();
        xhr.onerror = () => reject(new Error('Network Error'));
        
        xhr.send(dummyData);
    });
  } catch (e) {
    if (e.name === 'AbortError' || e.message === 'Aborted') {
      log(t('log.stopped_by_user'));
    } else {
      log(t('log.speedtest_failed', null, {err: e}));
    }
    setGauge(0);
  } finally {
    stActive = false;
    stAbortController = null;

    // Reset gauge to zero visually
    setGauge(0);
    document.getElementById('st-speed-value').textContent = '0.00';

    // A run that ended while another is starting must not retire its UI. The timers below hold
    // direct references to the shared gauge and buttons, so firing mid-run hides the gauge and
    // re-shows GO while the new test is still measuring, and nothing in the new run repaints
    // them. A generation count makes the chain a no-op for any run but its own; the GO click
    // that starts a new one bumps it first.
    const myGeneration = stUiGeneration;
    setTimeout(() => {
        if (myGeneration !== stUiGeneration) return;
        gaugeArea.style.opacity = '0';
        btnStop.style.display = 'none';

        setTimeout(() => {
            if (myGeneration !== stUiGeneration) return;
            gaugeArea.style.display = 'none';
            btnGo.style.display = 'block';
            setTimeout(() => {
                if (myGeneration !== stUiGeneration) return;
                btnGo.style.opacity = '1';
                btnGo.style.pointerEvents = 'auto';
            }, 50);
        }, 500);
    }, 1500); // Wait 1.5 seconds so user can see it hit 0 before vanishing
  }
}

function setGauge(mbps) {
  const maxMbps = 100;
  const val = Math.min(mbps, maxMbps);
  const pct = val / maxMbps;
  const offset = 251 - (251 * pct);
  const elFill = document.getElementById('st-gauge-fill');
  if (elFill) elFill.style.strokeDashoffset = offset;
  
  const deg = -90 + (180 * pct);
  const elNeedle = document.getElementById('st-gauge-needle');
  if (elNeedle) elNeedle.style.transform = 'rotate(' + deg + 'deg)';
  
  const elVal = document.getElementById('st-speed-value');
  if (elVal) elVal.textContent = mbps.toFixed(2);
}

















