// The texts the website translates (site/i18n.js), for tests/test_ui.js and to write a translation:
//   node tests/i18n_keys.js            prints them, one JSON string per line
// From the code: the first argument of every tr("…") in site/app.js and site/coach.js (always a plain string, so it can be read here).
// From the page: every element of site/index.html marked data-t, read by the browser test (keysOnPage).
const fs = require("fs"), path = require("path");
const I18N = require("../site/i18n.js");

// a string in "", '' or ``
const LIT = String.raw`"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\`[^\`]*\``;
const CODE = ["app.js", "coach.js"].map(f => path.join(__dirname, "..", "site", f));
const source = () => CODE.map(f => fs.readFileSync(f, "utf8")).join("\n");
function keysInCode() {
  const src = source(), keys = [];
  // tr( then a string in "", '' or `` (no ${…} inside: placeholders are {name})
  // and coach.js's tip("kind", "…"), which passes its text to tr
  const re = new RegExp(`\\b(?:tr\\(|tip\\(\\s*"\\w+",)\\s*(${LIT})`, "g");
  for (const m of src.matchAll(re)) {
    const lit = m[1];
    if (lit.startsWith("`") && lit.includes("${")) throw new Error(`tr() with \${} in ${lit.slice(0, 60)}: use {name} placeholders`);
    const text = lit.startsWith("`") ? lit.slice(1, -1) : JSON.parse(lit.startsWith("'") ? `"${lit.slice(1, -1).replace(/"/g, '\\"')}"` : lit);
    keys.push(I18N.split(text).key);
  }
  return [...new Set(keys)];
}
// every tr( call in the code must start with a plain string
function nonLiteralCalls() {
  const src = source();
  const calls = [...src.matchAll(/\btr\(\s*([^"'`\s])/g), ...src.matchAll(/\btip\(\s*"\w+",\s*([^"'`\s])/g)];
  return calls.map(m => src.slice(m.index, m.index + 60)).filter(c => !c.startsWith("tr(text, vars)")); // tip() itself
}
// in the browser: the keys of the page's data-t elements, as I18N read them when the page loaded
const keysOnPage = () => I18N.pageKeys;

module.exports = { keysInCode, nonLiteralCalls, keysOnPage };
if (require.main === module) for (const k of keysInCode()) console.log(JSON.stringify(k));
