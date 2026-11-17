// Languages. The website (and so the app, which shows it) is written in English; other languages are a list of
// translations keyed by the English text (site/lang/es.js). The language is chosen on the Settings tab: Automatic (the
// phone's or browser's language, if we have it) by default. Run in the browser before coach.js and app.js.
//
// tr("English text {name}", { name }) gives the text in the chosen language. The key is the text with its whitespace
// collapsed and the attributes taken out of its HTML tags (so links and their addresses stay out of the translations):
// '<a href="x">Privacy</a>' is looked up as "<a>Privacy</a>", and the translation's tags get the attributes back in the
// same order. Elements in index.html marked data-t are translated the same way when the page loads.
// A text with no translation stays in English and is listed in I18N.missing (the tests check it's empty).
const I18N = (() => {
  const LANGS = { en: "English", es: "Español" };
  const TABLES = { es: typeof I18N_ES !== "undefined" ? I18N_ES : {} };
  const STORE = "lang";
  let pref = "auto";
  try { pref = localStorage.getItem(STORE) || "auto"; } catch (err) { /* no storage: automatic */ }
  if (pref !== "auto" && !LANGS[pref]) pref = "auto";
  const wanted = () => (typeof navigator !== "undefined" && (navigator.languages?.length ? navigator.languages : [navigator.language])) || [];
  const automatic = () => {
    for (const l of wanted()) {
      const code = String(l || "").toLowerCase().split("-")[0];
      if (LANGS[code]) return code;
    }
    return "en";
  };
  const lang = pref === "auto" ? automatic() : pref;
  // dates and numbers: the phone's own variant of the language if it has one (es-MX, en-AU), else the language
  const locale = wanted().find(l => String(l).toLowerCase().split("-")[0] === lang) || lang;
  const missing = [];

  const TAG = /<([a-zA-Z][a-zA-Z0-9]*)(\s[^>]*?)?(\/?)>/g;
  // the lookup key, and the attributes taken out of its tags, in order
  function split(text) {
    const attrs = [];
    const key = String(text).replace(TAG, (m, tag, a, self) => { attrs.push(a || ""); return `<${tag}${self}>`; })
      .replace(/\s+/g, " ").trim();
    return { key, attrs };
  }
  function lookup(text) {
    const { key, attrs } = split(text);
    if (lang === "en") return key;
    const table = TABLES[lang], out = table[key];
    if (out === undefined) {
      if (!missing.includes(key)) missing.push(key);
      return key;
    }
    let i = 0;
    return out.replace(TAG, (m, tag, a, self) => `<${tag}${attrs[i++] || ""}${self}>`);
  }
  function t(text, vars) {
    let s = text === "" ? "" : lookup(text);
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
    return s;
  }
  // the page's own text, marked data-t in index.html
  const pageKeys = []; // what was looked up, for the tests
  function translatePage(root = document) {
    document.documentElement.lang = lang;
    root.querySelectorAll("[data-t]").forEach(el => {
      const placeholder = el.hasAttribute("placeholder"), text = placeholder ? el.placeholder : el.innerHTML;
      pageKeys.push(split(text).key);
      if (lang === "en") return;
      if (placeholder) el.placeholder = t(text);
      else el.innerHTML = t(text);
    });
  }
  function setPref(p) {
    try {
      if (p === "auto") localStorage.removeItem(STORE);
      else localStorage.setItem(STORE, p);
    } catch (err) { /* not kept */ }
  }
  return { t, lang, pref, locale, LANGS, automatic, setPref, translatePage, missing, split, pageKeys };
})();
const tr = I18N.t;

if (typeof module !== "undefined") module.exports = I18N;
