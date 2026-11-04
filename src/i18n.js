// ===== Internationalization =====
//
// Language strings are keyed by a dot path and looked up through t(). The DOM side is
// driven by data-i18n / data-i18n-placeholder attributes, so applyLanguage() can re-skin
// the whole static page without each view knowing about translations.
//
// Persian is RTL. Direction is applied to text containers only -- never to the page or
// to a flex/grid parent -- because direction on a layout parent reverses the visual
// order of its children. Users asked that the interface layout stay fixed and only the
// text change, so RTL is a text-level concern here.

const SUPPORTED_LANGUAGES = ['en', 'fa', 'ru', 'zh', 'tr'];

let currentLang = 'en';

// A string may carry a "singular|plural" pair; pass { count } to pick. Languages that
// do not mark the distinction just omit the pipe.
function t(key, lang, params) {
  const entry = I18N_STRINGS[key];
  if (!entry) return key;
  let s = entry[lang || currentLang] || entry['en'] || key;

  if (params) {
    if (typeof params.count === 'number' && s.includes('|')) {
      const bar = s.indexOf('|');
      s = params.count === 1 ? s.slice(0, bar) : s.slice(bar + 1);
    }
    for (const k in params) {
      if (k === 'count') continue;
      // A Rust command that fails with a message the user can act on reports it as
      // "i18n:<key>" or "i18n:<key>|<detail>", so the wording is looked up here rather
      // than hardcoded in English on the backend. The detail half is whatever the OS or
      // the core itself reported and has no translation, so it is substituted as-is.
      s = s.split(`{${k}}`).join(trParam(params[k]));
    }
  }
  return s;
}

function trParam(v) {
  if (!isTagged(v)) return v;
  return resolveTagged(v);
}

function isTagged(v) {
  return typeof v === 'string' && v.startsWith('i18n:');
}

function resolveTagged(v) {
  const [key, detail] = v.slice(5).split('|', 2);
  if (!I18N_STRINGS[key]) return detail === undefined ? key : detail;
  return detail === undefined ? t(key) : t(key, null, { err: detail });
}

function getCurrentLang() {
  return currentLang;
}

function isRTL(lang) {
  return (lang || currentLang) === 'fa';
}

// Reading order is a property of the text, not of the box around it: Persian and
// English write in opposite directions, so a translated string has to resolve its
// own. dir="auto" derives it from the first strong character of the content, which
// is what places a trailing "..." on the left for Persian and on the right for
// English. It is only ever applied to a pure text leaf -- handing it to a flex or
// grid parent would reverse that parent's children, which is a layout change rather
// than a language change.
function setTextDirection(el) {
  if (el.children.length === 0) el.dir = 'auto';
}

// Replaces every statically-marked node. Dynamic views that build their own markup read
// t() at build time and must re-render themselves via the event below.
function applyLanguage(lang) {
  if (!SUPPORTED_LANGUAGES.includes(lang)) lang = 'en';
  currentLang = lang;

  document.documentElement.lang = lang;
  // WebView2 / Chromium auto-infers direction:rtl from lang="fa", which flips
  // every flexbox and grid in the page. The layout must stay LTR; individual
  // text nodes get dir="auto" from setTextDirection() so Persian reads right.
  document.documentElement.dir = 'ltr';

  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.getAttribute('data-i18n'));
    setTextDirection(el);
  });
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    el.innerHTML = t(el.getAttribute('data-i18n-html'));
    setTextDirection(el);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.getAttribute('data-i18n-title'));
  });

  window.dispatchEvent(new CustomEvent('vxray-language-changed', { detail: { lang } }));
}

// Defined lazily so load order relative to app.js does not matter.
function tauriInvoke(cmd, args) {
  return window.__TAURI__.core.invoke(cmd, args);
}

async function initLanguage() {
  let lang = 'en';
  try {
    lang = await tauriInvoke('get_language') || 'en';
  } catch (_) {}
  applyLanguage(lang);
}

async function changeLanguage(lang) {
  if (!SUPPORTED_LANGUAGES.includes(lang) || lang === currentLang) return;
  applyLanguage(lang);
  try {
    await tauriInvoke('set_language', { language: lang });
  } catch (e) {
    console.error(e);
  }
}

// Mirrors the label shown in the settings dropdown.
function languageDisplayName(lang) {
  return {
    en: 'English',
    fa: 'فارسی',
    ru: 'Русский',
    zh: '中文',
    tr: 'Türkçe'
  }[lang] || 'English';
}

window.t = t;
window.getCurrentLang = getCurrentLang;
window.isRTL = isRTL;
window.applyLanguage = applyLanguage;
window.changeLanguage = changeLanguage;
window.languageDisplayName = languageDisplayName;
window.SUPPORTED_LANGUAGES = SUPPORTED_LANGUAGES;
window.tauriInvoke = tauriInvoke;
window.isTaggedError = isTagged;
window.resolveTaggedError = resolveTagged;
