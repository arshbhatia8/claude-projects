// Builds the static site into dist/ and refuses to produce it if a check fails.
//   node scripts/build.mjs            → dist/ for https://arshbhatia8.github.io/claude-projects/
//   BASE_PATH=/other/ node scripts/build.mjs
import { readFileSync, writeFileSync, rmSync, cpSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve, extname } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'public');
const out = join(root, 'dist');
const BASE = process.env.BASE_PATH || '/claude-projects/';

const files = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : [p];
});

/** Static checks shared by the build and the test-suite. Returns a list of problems. */
export function checkSite(dir) {
  const problems = [];
  const all = files(dir);
  const html = readFileSync(join(dir, 'index.html'), 'utf8');

  // 1. Every asset reference in the page is relative, or one of the allowed external hosts.
  const allowed = /^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|accounts\.google\.com|console\.cloud\.google\.com)(\/|$)/;
  for (const m of html.matchAll(/\s(?:src|href)="([^"]+)"/g)) {
    const url = m[1];
    if (url.startsWith('#') || url.startsWith('data:')) continue;
    if (/^https?:/.test(url)) { if (!allowed.test(url)) problems.push(`index.html: unexpected external URL ${url}`); continue; }
    if (url.startsWith('/')) { problems.push(`index.html: root-absolute path ${url} breaks under ${BASE}`); continue; }
    if (!existsSync(join(dir, url.split(/[?#]/)[0]))) problems.push(`index.html: missing file ${url}`);
  }
  if (!/http-equiv="Content-Security-Policy"/.test(html)) problems.push('index.html: Content-Security-Policy meta missing');
  if (!/name="viewport" content="width=device-width, initial-scale=1/.test(html) || /user-scalable=no|maximum-scale=1\b/.test(html)) {
    problems.push('index.html: viewport must be width=device-width, initial-scale=1 without zoom restrictions');
  }

  // 2. Every ES-module import resolves to a file that will be published.
  for (const f of all.filter((p) => p.endsWith('.js'))) {
    const code = readFileSync(f, 'utf8');
    for (const m of code.matchAll(/(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const spec = m[1] || m[2];
      if (!spec.startsWith('./') && !spec.startsWith('../')) { problems.push(`${relative(dir, f)}: non-relative import "${spec}"`); continue; }
      if (!existsSync(resolve(dirname(f), spec))) problems.push(`${relative(dir, f)}: import "${spec}" not found`);
    }
    if (/fetch\(\s*['"]\//.test(code)) problems.push(`${relative(dir, f)}: root-absolute fetch()`);
  }

  // 3. Nothing secret or private is published.
  const secret = /(GOCSPX-[\w-]{10,}|AIza[\w-]{30,}|ya29\.[\w-]{20,}|ghp_[A-Za-z0-9]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY|\d{6,}-[a-z0-9]{20,}\.apps\.googleusercontent\.com)/;
  for (const f of all) {
    const ext = extname(f);
    if (['.db', '.sqlite', '.env', '.pem', '.key'].includes(ext) || /(^|\/)\.env/.test(f)) problems.push(`sensitive file ${relative(dir, f)}`);
    if (['.js', '.html', '.css', '.json', '.txt'].includes(ext) && secret.test(readFileSync(f, 'utf8'))) problems.push(`${relative(dir, f)}: looks like it contains a credential`);
  }
  return problems;
}

function build() {
  rmSync(out, { recursive: true, force: true });
  cpSync(src, out, { recursive: true });
  let sha = 'dev';
  try { sha = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim(); } catch { /* not a git checkout */ }
  const stamp = `${sha} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  const indexPath = join(out, 'index.html');
  writeFileSync(indexPath, readFileSync(indexPath, 'utf8').replace('<title>Spendly</title>', `<meta name="spendly-build" content="${stamp}" />\n  <title>Spendly</title>`));
  // Unknown paths under the site (e.g. /claude-projects/quick) land back in the app.
  writeFileSync(join(out, '404.html'), `<!doctype html>
<html lang="en-IN"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" /><title>Spendly</title>
<meta http-equiv="refresh" content="0; url=${BASE}" />
<script src="${BASE}js/redirect-404.js"></script></head>
<body style="background:#070d09;color:#edf7ef;font-family:system-ui;padding:24px">Opening <a style="color:#7cf097" href="${BASE}">Spendly</a>…</body></html>
`);
  writeFileSync(join(out, 'js', 'redirect-404.js'), `// Sends /claude-projects/<screen> to /claude-projects/#<screen>.
(function () {
  var base = ${JSON.stringify(BASE)};
  var rest = location.pathname.indexOf(base) === 0 ? location.pathname.slice(base.length) : '';
  var screen = rest.split('/')[0];
  var known = ['dashboard', 'transactions', 'quick', 'gmail', 'assets', 'accounts', 'liabilities', 'goals', 'reports', 'settings'];
  location.replace(base + (known.indexOf(screen) >= 0 ? '#' + screen : ''));
})();
`);
  const problems = checkSite(out);
  if (problems.length) {
    console.error('Build checks failed:\n  - ' + problems.join('\n  - '));
    rmSync(out, { recursive: true, force: true });
    process.exit(1);
  }
  console.log(`Built ${files(out).length} files into dist/ for ${BASE} (${stamp}). All checks passed.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) build();
