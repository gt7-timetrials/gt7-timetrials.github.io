// The texts the website translates (site/i18n.js), for tests/test_ui.js and to write a translation:
//   node tests/i18n_keys.js            prints them, one JSON string per line
// From the code: the first argument of every tr("…") in site/app.js (always a plain string, so it can be read here).
// From the page: every element of site/index.html marked data-t, read by the browser test (keysOnPage).
const fs = require("fs"), path = require("path");
const I18N = require("../site/i18n.js");

function keysInCode(file = path.join(__dirname, "..", "site", "app.js")) {
  const src = fs.readFileSync(file, "utf8"), keys = [];
  // tr( then a string in "", '' or `` (no ${…} inside: placeholders are {name})
  const re = /\btr\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`)/g;
  for (const m of src.matchAll(re)) {
    const lit = m[1];
    if (lit.startsWith("`") && lit.includes("${")) throw new Error(`tr() with \${} in ${lit.slice(0, 60)}: use {name} placeholders`);
    const text = lit.startsWith("`") ? lit.slice(1, -1) : JSON.parse(lit.startsWith("'") ? `"${lit.slice(1, -1).replace(/"/g, '\\"')}"` : lit);
    keys.push(I18N.split(text).key);
  }
  return [...new Set(keys)];
}
// every tr( call in the code must start with a plain string
function nonLiteralCalls(file = path.join(__dirname, "..", "site", "app.js")) {
  const src = fs.readFileSync(file, "utf8");
  return [...src.matchAll(/\btr\(\s*([^"'`\s])/g)].map(m => src.slice(m.index, m.index + 60));
}
// in the browser: the keys of the page's data-t elements, as I18N read them when the page loaded
const keysOnPage = () => I18N.pageKeys;

module.exports = { keysInCode, nonLiteralCalls, keysOnPage };
if (require.main === module) for (const k of keysInCode()) console.log(JSON.stringify(k));
