// Checks translation files against the texts the site uses (site/lang/es.js is complete: the browser test checks it
// against the page and the code): every text translated, none left over, the same {placeholders} and the same HTML
// tags in the same order. Run by tests/test_coach.js; by hand:
//   node tests/lang_check.js fr it de      (or no codes: every file in site/lang)
const fs = require("fs"), path = require("path");
const dir = path.join(__dirname, "..", "site", "lang");
const languages = () => fs.readdirSync(dir).filter(f => f.endsWith(".js")).map(f => f.replace(/\.js$/, ""));
const vars = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(",");
const tags = s => [...s.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)].map(m => m[0]).join("");
function check(code) {
  const ref = require(path.join(dir, "es.js")), t = require(path.join(dir, `${code}.js`)), problems = [];
  for (const k of Object.keys(ref)) {
    if (!(k in t)) { problems.push(`missing: ${k.slice(0, 80)}`); continue; }
    if (vars(k) !== vars(t[k])) problems.push(`placeholders differ: ${k.slice(0, 60)} -> ${t[k].slice(0, 60)}`);
    if (tags(k) !== tags(t[k])) problems.push(`tags differ: ${k.slice(0, 60)} -> ${t[k].slice(0, 60)}`);
    if (!t[k].trim()) problems.push(`empty: ${k.slice(0, 60)}`);
  }
  for (const k of Object.keys(t)) if (!(k in ref)) problems.push(`not used: ${k.slice(0, 80)}`);
  return problems;
}
module.exports = { languages, check };
if (require.main === module) {
  const codes = process.argv.slice(2).length ? process.argv.slice(2) : languages().filter(c => c !== "es");
  let bad = 0;
  for (const code of codes) {
    const p = check(code);
    console.log(`${code}: ${Object.keys(require(path.join(dir, `${code}.js`))).length} texts, ${p.length ? p.length + " problems" : "ok"}`);
    p.slice(0, 40).forEach(x => console.log("  " + x));
    bad += p.length;
  }
  process.exit(bad ? 1 : 0);
}
