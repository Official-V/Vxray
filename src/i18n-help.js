// Help / tip copy. This is shown in the "?" modal next to a setting, so the tone is
// deliberately plain and direct -- a short explanation of what the option does and when
// you'd want it, not a feature brochure.
//
// Every topic must carry all five languages. Persian renders RTL (see renderHelpContent).

const HELP_CONTENT = {
  "tls_fragment": {
    "en": {
      "title": "TLS Fragmentation",
      "body": "<p>Splits the first packets of a TLS connection into small pieces before they reach the firewall. DPI systems look for a complete handshake in a single packet; when it arrives in fragments, the signature no longer matches and the connection slips through.</p><p>Works on the <strong>Xray</strong> core. Connections handled by Sing-Box ignore this option.</p>"
    },
    "fa": {
      "title": "قطعه‌قطعه کردن TLS",
      "body": "<p>اولین بسته‌های اتصال TLS رو قبل از رسیدن به فایروال تیکه تیکه می‌کنه. سیستم فیلترینگ تو یه بسته به دنبال یه هندشیک کامل می‌گرده؛ وقتی بسته‌ها تکه‌تکه میرسن، اثرشون گم میشه و اتصال از فیلتر رد میشه.</p><p>فقط روی هسته <strong>Xray</strong> کار می‌کنه. اتصالاتی که با Sing-Box باز میشن این گزینه رو نگه نمی‌دارن.</p>"
    },
    "ru": {
      "title": "Фрагментация TLS",
      "body": "<p>Разбивает первые пакеты TLS-соединения на мелкие части до того, как они достигнут файрвола. Системы DPI ожидают полный handshake в одном пакете — в виде фрагментов сигнатура не совпадает, и соединение проходит.</p><p>Работает на ядре <strong>Xray</strong>. Для соединений через Sing-Box этот параметр игнорируется.</p>"
    },
    "zh": {
      "title": "TLS 分片",
      "body": "<p>在 TLS 连接的初始数据包抵达防火墙之前，将其拆分为多个小包。DPI 系统会试图在单个数据包中匹配完整的握手特征；数据包分片到达后特征不再匹配，连接便得以通过。</p><p>仅在 <strong>Xray</strong> 内核上有效。由 Sing-Box 处理的连接会忽略此选项。</p>"
    },
    "tr": {
      "title": "TLS Parçalama",
      "body": "<p>Bir TLS bağlantısının ilk paketlerini güvenlik duvarına ulaşmadan önce küçük parçalara böler. DPI sistemleri tek pakette tam bir el sıkışma arar; parçalar halinde geldiğinde imza eşleşmez ve bağlantı geçer.</p><p>Yalnızca <strong>Xray</strong> çekirdeğinde çalışır. Sing-Box ile kurulan bağlantılar bu seçeneği yok sayar.</p>"
    }
  },

  "auto_start": {
    "en": {
      "title": "Start with Windows",
      "body": "<p>Launches Vxray in the background as soon as you sign in to Windows, so your connection is ready before you need it.</p>"
    },
    "fa": {
      "title": "اجرا همراه با ویندوز",
      "body": "<p>به محض اینکه وارد ویندوز میشی، Vxray رو تو پس‌زمینه باز می‌کنه تا اتصال وصل‌باشه قبل از اینکه بهش نیاز پیدا کنی.</p>"
    },
    "ru": {
      "title": "Запуск с Windows",
      "body": "<p>Запускает Vxray в фоновом режиме, как только вы входите в Windows, — соединение готово ещё до того, как оно понадобится.</p>"
    },
    "zh": {
      "title": "开机自启",
      "body": "<p>在您登录 Windows 后立即于后台启动 Vxray，让连接在您需要之前就已就绪。</p>"
    },
    "tr": {
      "title": "Windows ile Başla",
      "body": "<p>Windows'a girer girmez Vxray'i arka planda başlatır, böylece bağlantı ihtiyacınız olmadan önce hazır olur.</p>"
    }
  },

  "start_minimized": {
    "en": {
      "title": "Start Minimized",
      "body": "<p>Only applies when Vxray starts automatically with Windows. Keeps it in the system tray instead of opening a window — nothing pops up on your screen at login.</p>"
    },
    "fa": {
      "title": "شروع به صورت پنهان",
      "body": "<p>فقط وقتی Vxray خودکار با ویندوز باز میشه اعمال میشه. برنامه به جای باز کردن پنجره، کنار ساعت مخفی می‌مونه و موقع ورود به ویندوز هیچی روی صفحه ظاهر نمیشه.</p>"
    },
    "ru": {
      "title": "Запуск свёрнутым",
      "body": "<p>Действует только при автозапуске Vxray вместе с Windows. Прячется в системный трей вместо того, чтобы открывать окно, — при входе в систему ничего не появляется.</p>"
    },
    "zh": {
      "title": "启动后最小化",
      "body": "<p>仅在 Vxray 随 Windows 自启动时生效。程序会停留在系统托盘而不弹出窗口——登录时不会在屏幕上显示任何内容。</p>"
    },
    "tr": {
      "title": "Küçük Başlat",
      "body": "<p>Yalnızca Vxray Windows ile otomatik başladığında geçerlidir. Pencere açmak yerine programı sistem tepsisinde tutar; oturum açtığınızda ekranda hiçbir şey belirmez.</p>"
    }
  },

  "auto_update_subs": {
    "en": {
      "title": "Update Subscriptions on Startup",
      "body": "<p>Refreshes every subscription once when Vxray launches, so the server list is current. Providers rotate nodes regularly; without this you may be staring at servers that no longer exist.</p>"
    },
    "fa": {
      "title": "بروزرسانی اشتراک‌ها هنگام اجرا",
      "body": "<p>وقتی Vxray باز میشه، همه‌ی اشتراک‌ها رو یه بار بروزرسانی می‌کنه تا لیست سرورها تازه بمونه. ارائه‌دهنده‌ها معمولاً سرورهاشون رو عوض می‌کنن؛ بدون این گزینه ممکنه به سرورهایی نگاه کنی که دیگه وجود ندارن.</p>"
    },
    "ru": {
      "title": "Обновление подписок при запуске",
      "body": "<p>Обновляет все подписки при запуске Vxray, чтобы список серверов оставался актуальным. Провайдеры регулярно меняют узлы; без этого можно смотреть на серверы, которых уже не существует.</p>"
    },
    "zh": {
      "title": "启动时更新订阅",
      "body": "<p>在 Vxray 启动时刷新一次全部订阅，确保服务器列表是最新的。服务商经常更换节点，若不刷新，您看到的可能是已经失效的服务器。</p>"
    },
    "tr": {
      "title": "Başlangıçta Abonelik Güncelleme",
      "body": "<p>Vxray başlatıldığında tüm abonelikleri bir kez yeniler, böylece sunucu listesi güncel kalır. Sağlayıcılar düğümleri sık sık değiştirir; bu kapalıyken var olmayan sunuculara bakıyor olabilirsiniz.</p>"
    }
  },

  "auto_reconnect": {
    "en": {
      "title": "Auto Reconnect",
      "body": "<p>If the connection drops, or you close and reopen Vxray, it quietly reconnects to the last server you used and restores the mode you were in (System Proxy or TUN).</p>"
    },
    "fa": {
      "title": "اتصال مجدد خودکار",
      "body": "<p>اگر ارتباط قطع بشه، یا Vxray رو ببندی و دوباره باز کنی، برنامه خودش به آخرین سروری که داشتی وصل میشه و حالت قبلی (پروکسی سیستم یا TUN) رو هم برمی‌گردونه.</p>"
    },
    "ru": {
      "title": "Автопереподключение",
      "body": "<p>Если соединение разорвалось или вы закрыли и открыли Vxray, он автоматически переподключится к последнему серверу и восстановит режим, в котором вы были (системный прокси или TUN).</p>"
    },
    "zh": {
      "title": "自动重连",
      "body": "<p>当连接断开，或您关闭又重新打开 Vxray 时，程序会自动重新连接上一次使用的服务器，并恢复您原先所处的模式（系统代理或 TUN）。</p>"
    },
    "tr": {
      "title": "Otomatik Yeniden Bağlanma",
      "body": "<p>Bağlantı koparsa veya Vxray'ı kapatıp tekrar açarsanız, en son kullandığınız sunucuya sessizce yeniden bağlanır ve bulunduğunuz kipi (Sistem Proxy veya TUN) geri yükler.</p>"
    }
  },

  "live_ping": {
    "en": {
      "title": "Live Ping Indicator",
      "body": "<p>Shows your current latency to the server on the status bar while you're connected. Useful for telling a slow server from a broken one before you start blaming your ISP.</p>"
    },
    "fa": {
      "title": "نمایشگر پینگ زنده",
      "body": "<p>وقتی وصلی، تاخیر تا سرور رو تو نوار وضعیت نشون میده. خوبیش اینه که می‌تونی ببینی سرورکه کنده یا کلاً سوخته، قبل از اینکه تقصیر رو گردن اینترنت خودت بندازی.</p>"
    },
    "ru": {
      "title": "Индикатор пинга в реальном времени",
      "body": "<p>Показывает текущую задержку до сервера в строке состояния во время подключения. Полезно, чтобы отличить медленный сервер от неработающего, пока вы не начали винить провайдера.</p>"
    },
    "zh": {
      "title": "实时延迟指示器",
      "body": "<p>连接时在状态栏显示您到服务器的当前延迟。在您开始责怪运营商之前，它有助于分辨服务器是慢还是彻底不可用。</p>"
    },
    "tr": {
      "title": "Canlı Ping Göstergesi",
      "body": "<p>Bağlıyken durum çubuğunda sunucuya olan anlık gecikmenizi gösterir. Yavaş bir sunucu ile bozuk bir sunucuyu ayırt etmek için işe yarar — suçu internet sağlayıcınıza atmadan önce.</p>"
    }
  },

  "quick_connect": {
    "en": {
      "title": "Connecting to a Server",
      "body": "<p><strong>Single click</strong> selects a server. <strong>Double-click</strong> connects to it right away — or switches to it immediately if you're already connected somewhere else. Double-clicking the server you're on disconnects it, just like the Connect button does.</p><p>The icons on the right of each row open stats, a single-server ping test, the copyable link, the editor and delete.</p>"
    },
    "fa": {
      "title": "اتصال به سرور",
      "body": "<p><strong>کلیک تکی</strong> یه سرور رو انتخاب می‌کنه. <strong>دوبار کلیک</strong> مستقیم وصلت می‌کنه — یا اگر از قبل به سرور دیگه‌ای وصلی، سریع به این یکی سوییچ می‌کنه. دوبار کلیک روی همون سروری که وصلی، قطعش می‌کنه، دقیقاً مثل دکمه‌ی اتصال.</p><p>آیکون‌های سمت راست هر ردیف: آمار، پینگ تک‌سرور، کپی لینک، ویرایش و حذف.</p>"
    },
    "ru": {
      "title": "Подключение к серверу",
      "body": "<p><strong>Одиночный щелчок</strong> выбирает сервер. <strong>Двойной щелчок</strong> подключается к нему сразу — или мгновенно переключается, если вы уже подключены к другому серверу. Двойной щелчок по серверу, на котором вы сейчас, разрывает подключение — так же, как кнопка подключения.</p><p>Значки справа в строке открывают статистику, проверку задержки одного сервера, копирование ссылки, редактирование и удаление.</p>"
    },
    "zh": {
      "title": "连接服务器",
      "body": "<p><strong>单击</strong>选中服务器。<strong>双击</strong>立即连接——如果当前已连接到别的服务器，则会立即切换。双击正在使用的服务器会断开连接，与“连接”按钮的行为一致。</p><p>每行右侧的图标依次打开统计、单机延迟测试、可复制的链接、编辑和删除。</p>"
    },
    "tr": {
      "title": "Bir Sunucuya Bağlanma",
      "body": "<p><strong>Tek tıklama</strong> bir sunucu seçer. <strong>Çift tıklama</strong> hemen bağlanır — veya zaten başka bir sunucuya bağlıysanız anında ona geçer. Üzerinde olduğunuz sunucuya çift tıklamak bağlantıyı keser; tıpkı Bağlan düğmesinin yaptığı gibi.</p><p>Her satırın sağındaki simgeler istatistikleri, tek sunucu gecikme testini, kopyalanabilir bağlantıyı, düzenlemeyi ve silmeyi açar.</p>"
    }
  },

  "routing": {
    "en": {
      "title": "Routing Rules",
      "body": "<p>Routing rules decide which of your apps' traffic goes through the VPN and which doesn't. Anything you don't list is decided by the mode.</p><p><strong>The three switches above</strong> are ready-made lists: <strong>Bypass Iran</strong> sends Iranian sites and IP ranges direct, <strong>Bypass LAN</strong> keeps your modem, printer and home network devices out of the tunnel, and <strong>Block Ads</strong> cuts known ad and tracking domains off before a page can load them.</p><p><strong>The two modes</strong> — the switch on the right of the tab bar — decide what happens to everything else. <strong>Bypass Mode</strong> is the default: everything goes through the VPN except your Bypass List. <strong>Proxy-Only Mode</strong> flips it — your whole PC uses the normal local internet and only the sites in your Proxy List go through the VPN. One rule for the blocked site, and your bank, games and everything else keep running at full local speed.</p><p><strong>Custom Rules — Domains &amp; IPs:</strong> enter domains (like <code>example.com</code>) or IP ranges (like <code>192.168.1.0/24</code>), separated by commas, then pick an action:</p><ol><li><strong>Proxy</strong> — force that site through the VPN.</li><li><strong>Bypass</strong> — send it over your normal internet instead. Recommended for Iranian banking apps and online games, where you want local speeds.</li><li><strong>Block</strong> — cut it off entirely. Handy for trackers and ad domains.</li></ol><p>Every rule you add is applied on the next connection, which Vxray starts for you — there's no need to disconnect and reconnect by hand.</p><p><strong>One domain is rarely the whole site.</strong> Most sites load their pieces from several domains, so adding only the main one leaves things half-broken — Discord needs <code>discord.com</code> and <code>discord.gg</code> together.</p><p><strong>Custom Rules — Applications:</strong> routing per program, so one app can use the VPN while the rest of Windows doesn't. It needs <strong>TUN mode</strong> — a system proxy only reaches browsers — and not every app honours it: some anti-cheat clients and Microsoft Store apps bring their own networking and ignore the rule. In Proxy-Only mode the whole machine uses the local internet and only these applications go through the VPN.</p>"
    },
    "fa": {
      "title": "قوانین مسیریابی",
      "body": "<p>قوانین مسیریابی مشخص می‌کنن کدوم ترافیک از فیلترشکن رد بشه و کدوم مستقیم بره. چیزایی که لیست نمی‌کنی رو حالتِ فعال تصمیم می‌گیره.</p><p><strong>سه تا کلید بالای صفحه</strong> لیست‌های آماده‌ان: <strong>دور زدن سایت‌های ایرانی</strong> سایت‌ها و آی‌پی‌های ایرانی رو مستقیم می‌فرسته، <strong>دور زدن شبکه‌ی محلی</strong> مودم، پرینتر و لوازم شبکه‌ی خونه رو از تونل بیرون نگه می‌داره، و <strong>مسدودسازی تبلیغات</strong> دامنه‌های معروف تبلیغاتی و ردیاب رو قبل از لود شدن صفحه قطع می‌کنه.</p><p><strong>دو حالتِ لیست‌ها</strong> — که با کلید سمت راستِ نوار تب‌ها عوض می‌شن — تصمیم می‌گیرن با بقیه‌ چیزا چیکار بشه. <strong>حالت عبور</strong> پیش‌فرضه: همه‌چیز از فیلترشکن رد می‌شه به جز سایت‌های لیست عبور. <strong>حالت فقط پروکسی</strong> برعکسه — کل سیستم از اینترنت معمولی و محلی خودت استفاده می‌کنه و فقط سایت‌های لیست پروکسی از فیلترشکن می‌رن. برای یه سایت مسدودشده همون یه قانون کافیه و سایت بانکی، بازی‌ها و بقیه‌ برنامه‌ها همون سرعت محلی قبلی رو نگه می‌دارن.</p><p><strong>قوانین شخصی — دامنه‌ها و آی‌پی‌ها:</strong> دامنه (مثل <code>example.com</code>) یا بازه‌ی آی‌پی (مثل <code>192.168.1.0/24</code>) رو با کاما از هم جدا کن و بعد یه عمل رو انتخاب کن:</p><ol><li><strong>پروکسی</strong> — اون سایت اجباری از فیلترشکن رد بشه.</li><li><strong>عبور</strong> — از اینترنت عادی خودت بره. برای اپلیکیشن‌های بانکی ایرانی و بازی‌های آنلاین پیشنهاد میشه، چون سرعت محلی رو نگه می‌داره.</li><li><strong>مسدود کردن</strong> — کلاً قطع دسترسی. برای ردیاب‌ها و دامنه‌های تبلیغاتی بدرد می‌خوره.</li></ol><p>هر قانونی که اضافه کنی روی اتصالِ بعدی اعمال می‌شه و خودِ Vxray همون اتصال رو برقرار می‌کنه — لازم نیست دستی قطع و وصل کنی.</p><p><strong>یه دامنه معمولاً کل سایت نیست.</strong> بیشتر سایت‌ها قسمت‌هاشون رو از چند تا دامنه بارگذاری می‌کنن، پس فقط دامنه‌ی اصلی رو اضافه کنی سایت نصفه‌کاره لود می‌شه — مثلاً دیسکورد رو باید هم <code>discord.com</code> و هم <code>discord.gg</code> اضافه کنی تا درست کار کنه.</p><p><strong>قوانین شخصی — برنامه‌ها:</strong> مسیریابی برای تک‌تک برنامه‌ها، تا مثلاً یه برنامه از فیلترشکن رد بشه و بقیه‌ ویندوز مستقیم بمونه. به <strong>حالت TUN</strong> نیاز داره (پروکسی سیستمی فقط مرورگرها رو می‌گیره) و متأسفانه همه‌ی برنامه‌ها بهش پایبند نیستن — بعضی از آنتی‌چیت‌ها و برنامه‌های مایکروسافت استور شبکه‌ی خودشون رو دارن و قانون رو نادیده می‌گیرن. تو حالت فقط پروکسی هم کل ویندوز از اینترنت محلی استفاده می‌کنه و فقط این برنامه‌ها از فیلترشکن می‌رن.</p>"
    },
    "ru": {
      "title": "Правила маршрутизации",
      "body": "<p>Правила маршрутизации определяют, какой трафик идёт через VPN, а какой — напрямую. Всё, что вы не внесли в списки, решает включённый режим.</p><p><strong>Три переключателя выше</strong> — это готовые списки: <strong>Обход иранских сайтов</strong> отправляет иранские сайты и IP-диапазоны напрямую, <strong>Обход локальной сети</strong> держит модем, принтер и сетевые устройства дома вне туннеля, а <strong>Блокировка рекламы</strong> отрезает рекламные и трекинговые домены до того, как страница их загрузит.</p><p><strong>Два режима</strong> — переключатель справа на панели вкладок — определяют, что происходит со всем остальным. <strong>Режим обхода</strong> включён по умолчанию: всё идёт через VPN, кроме списка обхода. <strong>Режим «только прокси»</strong> всё переворачивает — весь компьютер использует обычный локальный интернет, и только сайты из списка прокси идут через VPN. Одно правило для заблокированного сайта, а банк, игры и всё остальное остаются на вашем подключении с полной локальной скоростью.</p><p><strong>Свои правила — домены и IP:</strong> введите домены (например, <code>example.com</code>) или IP-диапазоны (например, <code>192.168.1.0/24</code>) через запятую и выберите действие:</p><ol><li><strong>Прокси</strong> — принудительно направить сайт через VPN.</li><li><strong>Обход</strong> — отправить напрямую через обычный интернет. Рекомендуется для иранских банковских приложений и онлайн-игр, где важна локальная скорость.</li><li><strong>Блокировать</strong> — полностью отрезать доступ. Удобно для трекеров и рекламных доменов.</li></ol><p>Каждое правило применяется на следующем подключении, которое Vxray устанавливает сам — вручную переподключаться не нужно.</p><p><strong>Один домен обычно не равен целому сайту.</strong> Большинство сайтов грузит свои части с нескольких доменов, поэтому добавление только основного оставляет страницу наполовину сломанной — Discord требует и <code>discord.com</code>, и <code>discord.gg</code> вместе.</p><p><strong>Свои правила — приложения:</strong> маршрутизация по программам, чтобы одно приложение могло идти через VPN, а остальная Windows — напрямую. Требует <strong>режим TUN</strong> (системный прокси покрывает только браузеры), и не каждое приложение его слушается: некоторые античиты и приложения из Microsoft Store используют собственный сетевой стек и игнорируют правило. В режиме «только прокси» весь компьютер сидит на локальном интернете, и только эти приложения идут через VPN.</p>"
    },
    "zh": {
      "title": "路由规则",
      "body": "<p>路由规则决定您的哪些流量经过 VPN、哪些直连。未列入规则的流量，由当前模式决定。</p><p><strong>上方的三个开关</strong>是现成的列表：<strong>绕过伊朗网站</strong>让伊朗网站和 IP 段直连，<strong>绕过局域网</strong>让调制解调器、打印机和家庭网络设备不走隧道，<strong>屏蔽广告</strong>则在页面加载前就切断广告与追踪域名。</p><p><strong>两种模式</strong>（用标签栏右侧的开关切换）决定其余流量怎么走。<strong>绕过模式</strong>是默认：除绕过列表外全部走 VPN。<strong>仅代理模式</strong>则相反——整台电脑使用普通的本地网络，只有代理列表中的网站走 VPN。给被屏蔽的网站加一条规则，银行应用、游戏和其它一切都留在您自己的网络上，保持完整的本地速度。</p><p><strong>自定义规则 —— 域名与 IP：</strong>输入域名（如 <code>example.com</code>）或 IP 段（如 <code>192.168.1.0/24</code>），以逗号分隔，然后选择一个操作：</p><ol><li><strong>代理</strong> —— 强制该网站走 VPN。</li><li><strong>绕过</strong> —— 改由普通网络直连。推荐用于伊朗银行应用和网络游戏，以保持本地速度。</li><li><strong>屏蔽</strong> —— 完全切断访问，适合追踪器和广告域名。</li></ol><p>您添加的每条规则都会在下一次连接时生效，而 Vxray 会自动发起该连接——无需手动断开再重连。</p><p><strong>一个域名通常不等于整个网站。</strong> 大多数网站会从多个域名加载各自的组成部分，因此只添加主域名往往会让页面半残——Discord 需要同时添加 <strong>discord.com</strong> 和 <strong>discord.gg</strong>。</p><p><strong>自定义规则 —— 应用程序：</strong>按程序路由，让某个程序走 VPN 而 Windows 其余部分直连。它需要 <strong>TUN 模式</strong>（系统代理只能覆盖浏览器），并且并非所有程序都会遵守：一些反作弊客户端和 Microsoft Store 应用自带网络栈，会忽略规则。在仅代理模式下，整台电脑使用本地网络，只有这些程序走 VPN。</p>"
    },
    "tr": {
      "title": "Yönlendirme Kuralları",
      "body": "<p>Yönlendirme kuralları, uygulamalarınızın hangi trafiğinin VPN'den geçip hangisinin geçmeyeceğini belirler. Listelemediğiniz diğer her şeyi etkin mod belirler.</p><p><strong>Yukarıdaki üç anahtar</strong> hazır listelerdir: <strong>İran Sitelerini Atlama</strong> İran sitelerini ve IP aralıklarını doğrudan gönderir, <strong>Yerel Ağı Atlama</strong> modem, yazıcı ve akıllı ev cihazlarınızı tünelin dışında tutar, <strong>Reklamları Engelle</strong> ise bilinen reklam ve takip alan adlarını sayfa yüklemeden önce keser.</p><p><strong>İki mod</strong> — sekme çubuğunun sağındaki düğme — kalan her şeyin ne olacağını belirler. <strong>Atlama Modu</strong> varsayılandır: Atlama listeniz hariç her şey VPN'den geçer. <strong>Yalnızca Vekil Modu</strong> bunu tersine çevirir — bilgisayarınızın tamamı normal yerel interneti kullanır ve yalnızca Vekil listenizdeki siteler VPN'den geçer. Engelli site için tek bir kural eklersiniz; banka uygulamaları, oyunlar ve gerisi tam yerel hızda kendi bağlantınızda kalır.</p><p><strong>Özel Kurallar — Alan Adları ve IP'ler:</strong> alan adlarını (örn. <code>example.com</code>) veya IP aralıklarını (örn. <code>192.168.1.0/24</code>) virgülle ayırarak girin, sonra bir eylem seçin:</p><ol><li><strong>Vekil</strong> — o siteyi zorunlu olarak VPN'den geçir.</li><li><strong>Atla</strong> — normal internetiniz üzerinden gönder. İran bankacılık uygulamaları ve çevrimiçi oyunlar için önerilir; yerel hızı korur.</li><li><strong>Engelle</strong> — erişimi tamamen kes. Takipçiler ve reklam alan adları için kullanışlıdır.</li></ol><p>Eklediğiniz her kural, Vxray'ın kendisinin kurduğu bir sonraki bağlantıda uygulanır — elle kesip yeniden bağlanmanız gerekmez.</p><p><strong>Tek bir alan adı genellikle tüm site değildir.</strong> Çoğu site parçalarını birkaç farklı alan adından yükler, bu yüzden yalnızca ana alan adını eklemek sayfayı yarım bırakır — Discord için <code>discord.com</code> ve <code>discord.gg</code> birlikte gerekir.</p><p><strong>Özel Kurallar — Uygulamalar:</strong> program bazında yönlendirme; örneğin tek bir uygulama VPN'i kullanırken Windows'un geri kalanı kullanmaz. <strong>TUN modunu</strong> gerektirir (sistem vekil sunucusu yalnızca tarayıcıları kapsar) ve her uygulama buna uymaz: bazı anti-cheat istemcileri ve Microsoft Store uygulamaları kendi ağ yığınını kullanır ve kuralı yok sayar. Yalnızca Vekil modunda bilgisayarın tamamı yerel interneti kullanır ve yalnızca bu uygulamalar VPN'den geçer.</p>"
    }
  },

  "subscriptions": {
    "en": {
      "title": "Subscriptions",
      "body": "<p>A subscription is a link from your provider that contains a whole list of servers. Add it once and Vxray keeps the server list for it.</p><p><strong>Auto-update</strong> — edit a subscription to set how often it refreshes (e.g. every 12 hours).</p><p><strong>Statistics</strong> — tap the delay or traffic row on a subscription card to see usage charts, average latency and days remaining.</p>"
    },
    "fa": {
      "title": "اشتراک‌ها",
      "body": "<p>اشتراک یه لینک از طرف ارائه‌دهنده‌ست که یه لیست کامل از سرورها توشه. یه بار اضافه‌اش کن و Vxray لیست سرورهاش رو برات نگه می‌داره.</p><p><strong>بروزرسانی خودکار</strong> — با ویرایش یه اشتراک می‌تونی مشخص کنی هر چند ساعت یه بار بروزرسانی بشه (مثلاً هر ۱۲ ساعت).</p><p><strong>آمار</strong> — روی ردیف تاخیر یا ترافیکِ کارت اشتراک بزن تا نمودار مصرف، میانگین پینگ و روزهای باقیمونده رو ببینی.</p>"
    },
    "ru": {
      "title": "Подписки",
      "body": "<p>Подписка — это ссылка от вашего провайдера, содержащая целый список серверов. Добавьте её один раз, и Vxray будет хранить список серверов.</p><p><strong>Автообновление</strong> — откройте подписку, чтобы задать частоту обновления (например, каждые 12 часов).</p><p><strong>Статистика</strong> — нажмите на строку задержки или трафика на карточке подписки, чтобы увидеть графики использования, среднюю задержку и оставшиеся дни.</p>"
    },
    "zh": {
      "title": "订阅",
      "body": "<p>订阅是服务商提供的一个链接，其中包含一整个服务器列表。只需添加一次，Vxray 就会保留其服务器列表。</p><p><strong>自动更新</strong> —— 打开订阅编辑，可设置刷新频率（例如每 12 小时一次）。</p><p><strong>统计信息</strong> —— 点击订阅卡片上的延迟或流量行，即可查看用量图表、平均延迟和剩余天数。</p>"
    },
    "tr": {
      "title": "Abonelikler",
      "body": "<p>Abonelik, sağlayıcınızdan aldığınız ve içinde tam bir sunucu listesi bulunan bir bağlantıdır. Bir kez ekleyin, Vxray sunucu listesini tutar.</p><p><strong>Otomatik güncelleme</strong> — bir aboneliği düzenleyerek ne sıklıkla yenileneceğini ayarlayın (örn. her 12 saatte bir).</p><p><strong>İstatistikler</strong> — abonelik kartındaki gecikme veya trafik satırına dokunarak kullanım grafiklerini, ortalama gecikmeyi ve kalan günleri görün.</p>"
    }
  },

  "bypass_iran": {
    "en": {
      "title": "Bypass Iran Sites",
      "body": "<p>Sends traffic to Iranian websites and IP ranges over your direct connection instead of the VPN. Local banking apps and domestic sites load much faster, and some of them refuse to work through a foreign IP at all.</p>"
    },
    "fa": {
      "title": "دور زدن سایت‌های ایرانی",
      "body": "<p>ترافیک سایت‌ها و آی‌پی‌های ایرانی رو از اینترنت مستقیم خودت می‌فرسته به جای فیلترشکن. اپلیکیشن‌های بانکی و سایت‌های داخلی خیلی سریع‌تر باز میشن و بعضی‌شون اصلاً با آی‌پی خارجی کار نمی‌کنن.</p>"
    },
    "ru": {
      "title": "Обход иранских сайтов",
      "body": "<p>Направляет трафик к иранским сайтам и IP-диапазонам через прямое подключение, а не через VPN. Иранские банковские приложения и местные сайты загружаются намного быстрее, а некоторые вообще не работают через зарубежный IP.</p>"
    },
    "zh": {
      "title": "绕过伊朗网站",
      "body": "<p>将访问伊朗网站和 IP 段的流量改由您的直连网络发送，而非经过 VPN。伊朗本地银行应用和国内网站加载会快得多，而且有些根本拒绝通过境外 IP 访问。</p>"
    },
    "tr": {
      "title": "İran Sitelerini Atlama",
      "body": "<p>İran sitelerine ve IP aralıklarına giden trafiği VPN yerine doğrudan bağlantınız üzerinden gönderir. İran bankacılık uygulamaları ve yerel siteler çok daha hızlı yüklenir; bazıları yabancı bir IP üzerinden hiç çalışmaz.</p>"
    }
  },

  "bypass_lan": {
    "en": {
      "title": "Bypass LAN",
      "body": "<p>Keeps traffic to your local network — addresses like <code>192.168.x.x</code> — out of the VPN tunnel, so your modem, printer, NAS and smart-home devices stay reachable while Vxray is running.</p>"
    },
    "fa": {
      "title": "دور زدن شبکه محلی (LAN)",
      "body": "<p>ترافیک شبکه‌ی محلی — آدرس‌هایی مثل <code>192.168.x.x</code> — رو از تونل فیلترشکن بیرون نگه می‌داره، تا مودم، پرینتر، هارد شبکه و لوازم هوشمند خونه وقتی Vxray روشنه همچنان در دسترس بمونن.</p>"
    },
    "ru": {
      "title": "Обход локальной сети",
      "body": "<p>Держит трафик вашей локальной сети — адреса вроде <code>192.168.x.x</code> — вне туннеля VPN, так что модем, принтер, NAS и устройства умного дома остаются доступны, пока Vxray запущен.</p>"
    },
    "zh": {
      "title": "绕过局域网",
      "body": "<p>将发往本地局域网（如 <code>192.168.x.x</code>）的流量保持在 VPN 隧道之外，这样在 Vxray 运行期间，您的调制解调器、打印机、NAS 和智能家居设备仍可正常访问。</p>"
    },
    "tr": {
      "title": "Yerel Ağı (LAN) Atlama",
      "body": "<p>Yerel ağınıza — <code>192.168.x.x</code> gibi adreslere — giden trafiği VPN tünelinin dışında tutar; böylece modem, yazıcı, NAS ve akıllı ev cihazları Vxray çalışırken ulaşılabilir kalır.</p>"
    }
  },

  "block_ads": {
    "en": {
      "title": "Block Ads",
      "body": "<p>Blocks known advertising and tracking domains at the network level, so they're stopped before any page loads them. Pages open a little faster and the ads never even start.</p>"
    },
    "fa": {
      "title": "مسدودسازی تبلیغات",
      "body": "<p>دامنه‌های معروف تبلیغاتی و ردیاب رو تو سطح شبکه مسدود می‌کنه، قبل از اینکه صفحه‌ای لودشون کنه. صفحات یه کم سریع‌تر باز میشن و تبلیغات اصلاً شروع نمیشن.</p>"
    },
    "ru": {
      "title": "Блокировка рекламы",
      "body": "<p>Блокирует известные рекламные и трекинговые домены на сетевом уровне, ещё до того, как страница их загрузит. Страницы открываются чуть быстрее, а реклама даже не успевает начаться.</p>"
    },
    "zh": {
      "title": "屏蔽广告",
      "body": "<p>在网络层面拦截已知的广告与追踪域名，在任何页面加载它们之前就先行切断。网页打开会略快一些，广告根本来不及出现。</p>"
    },
    "tr": {
      "title": "Reklamları Engelle",
      "body": "<p>Bilinen reklam ve takip alan adlarını ağ seviyesinde engeller; herhangi bir sayfa yüklemeden önce durdurur. Sayfalar biraz daha hızlı açılır ve reklamlar hiç başlamaz.</p>"
    }
  },

  "proxy_only": {
    "en": {
      "title": "Proxy Only Mode",
      "body": "<p>Flips the default route. Normally everything goes through the VPN and your rules mark the exceptions; with this on, everything goes direct and only the sites in your <strong>Proxy List</strong> use the VPN.</p><p>Use it when you want the VPN for a handful of sites and your own connection everywhere else — one rule for the blocked site, and your bank, games and everything else keep running at full local speed.</p><p><strong>One domain is rarely the whole site.</strong> Most sites load their pieces from several domains, so adding only the main one leaves things half-broken. Discord is the classic case: you need <strong>discord.com</strong> and <strong>discord.gg</strong> together, or the app never fully loads.</p><p><strong>Block</strong> rules still apply. A <strong>Bypass</strong> rule does nothing here, because direct is already the default — which is why that list is hidden until you switch back.</p>"
    },
    "fa": {
      "title": "حالت فقط پروکسی",
      "body": "<p>مسیر پیش‌فرض رو برعکس می‌کنه. تو حالت عادی همه‌چیز از فیلترشکن رد میشه و قوانین شما استثناها رو مشخص می‌کنن؛ وقتی این گزینه روشنه، همه‌چیز مستقیم میره و فقط سایت‌های <strong>لیست پروکسی</strong> از فیلترشکن استفاده می‌کنن.</p><p>وقتی فیلترشکن رو فقط برای چند تا سایت خاص می‌خواید و بقیه‌ی کارهاتون با اینترنت خودتون باشه، این حالت به درد می‌خوره — یه قانون برای سایت مسدودشده، و سایت بانکی، بازی‌ها و بقیه‌ی برنامه‌ها همون سرعت محلی قبلی رو نگه می‌دارن.</p><p><strong>یه دامنه معمولاً کل سایت نیست.</strong> بیشتر سایت‌ها قسمت‌هاشون رو از چند تا دامنه مختلف بارگذاری می‌کنن، پس اضافه کردنِ فقط دامنه‌ی اصلی باعث میشه سایت نصفه‌کاره لود بشه. دیسکورد مثال بارزشه: باید <strong>discord.com</strong> و <strong>discord.gg</strong> رو با هم اضافه کنی، وگرنه اپ هیچ‌وقت کامل باز نمی‌شه.</p><p>قوانین <strong>مسدود کردن</strong> هنوز هم اعمال میشن. قانون <strong>عبور</strong> تو این حالت کاری انجام نمیده، چون مستقیم بودن از قبل پیش‌فرضه؛ به همین خاطر لیست عبور تو این حالت مخفی میشه.</p>"
    },
    "ru": {
      "title": "Режим «только прокси»",
      "body": "<p>Меняет маршрут по умолчанию. Обычно всё идёт через VPN, а правила задают исключения; с этой настройкой всё идёт напрямую, и только сайты, отмеченные действием <strong>Прокси</strong>, используют VPN.</p><p>Удобно, когда VPN нужен для пары сайтов, а везде остальном хватает своего подключения: одно правило для заблокированного сайта — и банк, игры и всё остальное работают на полной локальной скорости.</p><p><strong>Одного домена обычно мало.</strong> Большинство сайтов грузит свои части с нескольких доменов, поэтому добавление только основного оставляет страницу наполовину сломанной. Discord — классический пример: нужно добавить <strong>discord.com</strong> и <strong>discord.gg</strong> вместе, иначе приложение полностью не загрузится.</p><p>Правила <strong>Обход</strong> и <strong>Блокировать</strong> продолжают действовать, так что их можно свободно совмещать.</p>"
    },
    "zh": {
      "title": "仅代理模式",
      "body": "<p>翻转默认路由。通常所有流量都经过 VPN，由规则来标记例外；开启此选项后，所有流量都改为直连，只有您以 <strong>代理</strong> 操作列出的网站才走 VPN。</p><p>适合“只为了让少数被屏蔽的网站走 VPN、其余都用自己的网络”的需求——加一条规则给被屏蔽的站点，银行应用、游戏和其它一切就都能保持原本的本地速度。</p><p><strong>一个域名通常不等于整个网站。</strong> 大多数网站会从多个域名加载各自的组成部分，因此只添加主域名往往会让页面半残。Discord 就是典型的例子：必须同时添加 <strong>discord.com</strong> 和 <strong>discord.gg</strong>，否则应用永远无法完整加载。</p><p>已设为 <strong>绕过</strong> 或 <strong>屏蔽</strong> 的规则依然生效，因此可以自由混用。</p>"
    },
    "tr": {
      "title": "Yalnızca Vekil Sunucu Modu",
      "body": "<p>Varsayılan yönü tersine çevirir. Normalde her şey VPN'den geçer ve kurallar istisnaları belirler; bu seçenek açıkken her şey doğrudan gider ve yalnızca <strong>Proxy</strong> eylemiyle işaretlediğiniz siteler VPN kullanır.</p><p>VPN'i birkaç site için isteyip geri kalan her şeyde kendi bağlantınızı kullanmak istediğinizde işe yarar: engelli site için tek kural eklersiniz; banka uygulamaları, oyunlar ve gerisi tam yerel hızda çalışmaya devam eder.</p><p><strong>Tek bir alan adı genellikle tüm site değildir.</strong> Çoğu site parçalarını birkaç farklı alan adından yükler, bu yüzden yalnızca ana alan adını eklemek sayfayı yarım bırakır. Discord bunun klasik örneğidir: <strong>discord.com</strong> ve <strong>discord.gg</strong>'nin ikisini birden eklemeniz gerekir, yoksa uygulama hiçbir zaman tam yüklenmez.</p><p><strong>Atla</strong> veya <strong>Engelle</strong> olarak ayarladığınız kurallar yine uygulanır, bu yüzden bunları özgürce bir arada kullanabilirsiniz.</p>"
    }
  },

  "strict_route": {
    "en": {
      "title": "Strict Route",
      "body": "<p>In TUN mode this forces <strong>all</strong> of your apps' traffic into the tunnel, so nothing can quietly reach the internet on its own and expose your real IP. Turn it off only if a specific app stops working while TUN is on.</p><p>It is off by default, because that is the setting that works on every machine. The tunnel server and the DNS resolvers are excluded from the filter either way, so the connection never feeds on itself no matter which position you leave this in.</p>"
    },
    "fa": {
      "title": "مسیریابی سخت‌گیرانه",
      "body": "<p>تو حالت TUN، <strong>همه</strong> ترافیک برنامه‌ها رو میندازه تو تونل، تا هیچ برنامه‌ای نتونه خودش مستقیم بره اینترنت و آی‌پی واقعیت رو لو بده. فقط اگه برنامه‌ی خاصی تو حالت TUN از کار افتاد، خاموشش کن.</p><p>پیش‌فرضش خاموزه، چون تنظیمیه که روی هر سیستمی جواب میده. آی‌پی سرور تونل و دی‌ان‌اس‌ها تو هر دو حالت از فیلتر مستثنی هستن، پس خود اتصال هیچ‌وقت تو خودش گیر نمیکنه، مهم نیست این تنظیم رو رو چه حالتی بذاری.</p>"
    },
    "ru": {
      "title": "Строгая маршрутизация",
      "body": "<p>В режиме TUN принудительно направляет <strong>весь</strong> трафик ваших приложений в туннель, поэтому ничто не сможет тихо выйти в интернет и раскрыть ваш реальный IP. Отключайте только если конкретное приложение перестало работать при включённом TUN.</p><p>По умолчанию он выключен — это настройка, которая работает на любой машине. Адрес туннельного сервера и DNS-резолверы исключены из фильтра в любом случае, поэтому само подключение никогда не зацикливается само на себе, в каком бы положении ни был этот переключатель.</p>"
    },
    "zh": {
      "title": "严格路由",
      "body": "<p>在 TUN 模式下，强制将您<strong>全部</strong>应用的流量送入隧道，任何程序都无法自行悄悄联网而暴露您的真实 IP。仅当某个应用在 TUN 开启时无法正常使用时才需关闭。</p><p>默认为关闭，因为这是在任何机器上都能正常工作的设置。隧道服务器地址与 DNS 解析器无论如何都已从过滤器中排除，因此无论此开关处于哪个位置，连接本身都不会自我回环。</p>"
    },
    "tr": {
      "title": "Katı Yönlendirme",
      "body": "<p>TUN modunda uygulamalarınızın <strong>tüm</strong> trafiğini tünele zorlar; böylece hiçbir şey tek başına internete çıkıp gerçek IP'nizi ifşa edemez. Yalnızca TUN açıkken belirli bir uygulama çalışmazsa kapatın.</p><p>Varsayılan olarak kapalıdır, çünkü her makinede çalışan ayar budur. Tünel sunucusu ve DNS çözümleyicileri filtreden her iki durumda da hariç tutulur, bu yüzden bağlantı bu anahtarı hangi konumda bırakırsanız bırakın asla kendi içine döngüye girmez.</p>"
    }
  },

  "remote_dns": {
    "en": {
      "title": "Remote Secure DNS",
      "body": "<p>The DNS server used to look up domain names <em>inside</em> the VPN tunnel, so your provider can't see which sites you're asking about. Enter a DoH address, for example <code>https://8.8.8.8/dns-query</code>.</p><p>Note: <code>1.1.1.1</code> is blocked by some Iranian ISPs, so it's not a good default here.</p>"
    },
    "fa": {
      "title": "دی‌ان‌اس امن خارجی",
      "body": "<p>سرور دی‌ان‌اسی که برای پیدا کردن آدرس سایت‌ها <em>داخل</em> خود تونل استفاده میشه، تا ارائه‌دهنده‌ی اینترنتت نتونه ببینه دنبال کدوم سایتا می‌گردی. یه آدرس DoH وارد کن، مثلاً <code>https://8.8.8.8/dns-query</code>.</p><p>نکته: <code>1.1.1.1</code> رو بعضی از شرکت‌های اینترنتی ایران مسدود کردن، واسه همین پیش‌فرض خوبی نیست.</p>"
    },
    "ru": {
      "title": "Удалённый защищённый DNS",
      "body": "<p>DNS-сервер, который используется для поиска доменов <em>внутри</em> туннеля VPN, поэтому провайдер не видит, к каким сайтам вы обращаетесь. Введите адрес DoH, например <code>https://8.8.8.8/dns-query</code>.</p><p>Примечание: <code>1.1.1.1</code> блокируется некоторыми иранскими провайдерами, поэтому не годится в качестве значения по умолчанию.</p>"
    },
    "zh": {
      "title": "远程安全 DNS",
      "body": "<p>用于在 VPN 隧道<em>内部</em>解析域名的 DNS 服务器，这样您的运营商就无法看到您在查询哪些网站。请填写 DoH 地址，例如 <code>https://8.8.8.8/dns-query</code>。</p><p>注意：<code>1.1.1.1</code> 被部分伊朗运营商封锁，因此不适合作为默认值。</p>"
    },
    "tr": {
      "title": "Uzak Güvenli DNS",
      "body": "<p>Alan adlarını VPN tünelinin <em>içinde</em> çözmek için kullanılan DNS sunucusudur; böylece sağlayıcınız hangi sitelere baktığınızı göremez. Bir DoH adresi girin, örn. <code>https://8.8.8.8/dns-query</code>.</p><p>Not: <code>1.1.1.1</code> bazı İranlı ISS'ler tarafından engellendiği için burada iyi bir varsayılan değildir.</p>"
    }
  },

  "local_dns": {
    "en": {
      "title": "Direct Local DNS",
      "body": "<p>The DNS used for traffic that <em>bypasses</em> the VPN — the sites you connect to directly. The default <code>local</code> means your Windows DNS. Change it only if your provider's DNS is unreliable.</p>"
    },
    "fa": {
      "title": "دی‌ان‌اس محلی مستقیم",
      "body": "<p>دی‌ان‌اسی که برای ترافیکِ <em>عبور کرده</em> از فیلترشکن استفاده میشه — یعنی سایتایی که مستقیم وصل میشی. مقدار پیش‌فرض <code>local</code> یعنی دی‌ان‌اس خود ویندوز. فقط اگه دی‌ان‌اس ارائه‌دهنده‌ی اینترنتیت خرابه عوضش کن.</p>"
    },
    "ru": {
      "title": "Локальный DNS напрямую",
      "body": "<p>DNS для трафика, который <em>обходит</em> VPN, — сайтов, к которым вы подключаетесь напрямую. Значение по умолчанию <code>local</code> означает системный DNS Windows. Меняйте только если DNS провайдера ненадёжен.</p>"
    },
    "zh": {
      "title": "直连本地 DNS",
      "body": "<p>用于<em>绕过</em> VPN 的流量（即您直连访问的网站）的 DNS。默认值 <code>local</code> 表示使用 Windows 的系统 DNS。仅在运营商 DNS 不可靠时才需要更改。</p>"
    },
    "tr": {
      "title": "Doğrudan Yerel DNS",
      "body": "<p>VPN'i <em>atlayan</em> trafik — yani doğrudan bağlandığınız siteler — için kullanılan DNS'tir. Varsayılan <code>local</code>, Windows DNS'iniz anlamına gelir. Yalnızca sağlayıcınızın DNS'i güvenilmezse değiştirin.</p>"
    }
  },

  "core_selection": {
    "en": {
      "title": "Core Selection",
      "body": "<p>Vxray can run either of two proxy engines:</p><p><strong>Auto</strong> — picks the right engine for each node on its own. This is what most people want.</p><p><strong>Sing-Box</strong> — fast and modern; the default for most protocols.</p><p><strong>Xray</strong> — needed for TLS fragmentation and some XHTTP setups.</p>"
    },
    "fa": {
      "title": "انتخاب هسته",
      "body": "<p>Vxray می‌تونه با یکی از این دو تا موتور پروکسی کار کنه:</p><p><strong>خودکار</strong> — برای هر سرور، موتور مناسب رو خودش تشخیص می‌ده. همین بیشتر درده.</p><p><strong>Sing-Box</strong> — سریع و مدرن؛ برای بیشتر پروتکل‌ها پیش‌فرضه.</p><p><strong>Xray</strong> — برای قطعه‌قطعه کردن TLS و بعضی تنظیمات XHTTP لازمه.</p>"
    },
    "ru": {
      "title": "Выбор ядра",
      "body": "<p>Vxray может работать на одном из двух движков прокси:</p><p><strong>Авто</strong> — для каждого узла самостоятельно подбирает подходящий движок. Это то, что нужно большинству.</p><p><strong>Sing-Box</strong> — быстрый и современный; по умолчанию для большинства протоколов.</p><p><strong>Xray</strong> — нужен для фрагментации TLS и некоторых настроек XHTTP.</p>"
    },
    "zh": {
      "title": "内核选择",
      "body": "<p>Vxray 可以运行以下两种代理引擎之一：</p><p><strong>自动</strong> —— 为每个节点自动挑选合适的引擎，这也是大多数用户想要的。</p><p><strong>Sing-Box</strong> —— 快速且现代，是多数协议的默认选择。</p><p><strong>Xray</strong> —— TLS 分片和部分 XHTTP 配置需要它。</p>"
    },
    "tr": {
      "title": "Çekirdek Seçimi",
      "body": "<p>Vxray iki proxy motorundan biriyle çalışabilir:</p><p><strong>Otomatik</strong> — her düğüm için doğru motoru kendisi seçer. Çoğu kişinin istediği budur.</p><p><strong>Sing-Box</strong> — hızlı ve modern; çoğu protokol için varsayılandır.</p><p><strong>Xray</strong> — TLS parçalama ve bazı XHTTP kurulumları için gerekir.</p>"
    }
  }
};
