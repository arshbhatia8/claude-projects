// Builds two copies of the app from the same source:
//   dist/artifact/index.html  → one self-contained page published as the claude.ai artifact
//                               (data in the artifact database; the scheduled search writes there)
//   dist/pages/               → static site for GitHub Pages at /claude-projects/jobhunt/
//                               (data in this browser's storage)
// The build refuses to finish if a check fails (secrets, external hosts, missing pieces).
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');
let sha = 'dev';
try { sha = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim(); } catch { /* not a checkout */ }
const stamp = `${sha} · ${new Date().toISOString().slice(0, 10)}`;
const css = readFileSync(join(root, 'src/ui/styles.css'), 'utf8');
const FONTS = 'https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,600&family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap';
const ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%23ff6a00'/%3E%3Cstop offset='1' stop-color='%23ffb020'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='32' height='32' rx='8' fill='url(%23g)'/%3E%3Cpath d='M17.5 5 8 18h7l-1.5 9L24 14h-7z' fill='%231a0d00'/%3E%3C/svg%3E";

async function bundle(target) {
  const r = await build({
    entryPoints: [join(root, 'src/ui/app.js')], bundle: true, format: 'iife', minify: true, write: false, target: ['es2020', 'safari15'],
    define: { __TARGET__: JSON.stringify(target), __BUILD__: JSON.stringify(stamp) }, legalComments: 'none',
  });
  return r.outputFiles[0].text;
}

function check(name, text) {
  const problems = [];
  const secret = /(GOCSPX-[\w-]{10,}|AIza[\w-]{30,}|ya29\.[\w-]{20,}|ghp_[A-Za-z0-9]{30,}|sk-ant-[\w-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY)/;
  if (secret.test(text)) problems.push(`${name}: looks like it contains a credential`);
  const hosts = [...text.matchAll(/(?:src|href)=["'](https?:\/\/[^"']+)/g)].map((m) => m[1]).filter((u) => !/^https:\/\/fonts\.(googleapis|gstatic)\.com(\/|$)/.test(u));
  if (hosts.length) problems.push(`${name}: loads from an unexpected host: ${hosts.join(', ')}`);
  if (/\bfetch\(|XMLHttpRequest/.test(text)) problems.push(`${name}: makes network requests`);
  return problems;
}

async function main() {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'artifact'), { recursive: true });
  mkdirSync(join(out, 'pages'), { recursive: true });
  const problems = [];

  // Artifact: the page content only; the artifact host adds doctype/head/body.
  const js = (await bundle('artifact')).replace(/<\/script/gi, '<\\/script');
  const artifact = `<title>JobHunt Command Center</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="jobhunt-build" content="${stamp}">
<link rel="icon" href="${ICON}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="${FONTS}">
<style>
${css}
</style>
<script>try{document.documentElement.setAttribute('data-app-theme','dark')}catch(e){}</script>
<div id="app"><div class="boot"><div class="card"><div class="spinner"></div><div>Loading your job search…</div></div></div></div>
<script>
${js}
</script>
`;
  writeFileSync(join(out, 'artifact/index.html'), artifact);
  problems.push(...check('artifact/index.html', artifact));

  // GitHub Pages: a normal document with a strict security policy.
  const pjs = await bundle('pages');
  writeFileSync(join(out, 'pages/app.js'), pjs);
  writeFileSync(join(out, 'pages/styles.css'), css);
  const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'";
  const page = `<!doctype html>
<html lang="en-IN" data-app-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#0b0a09">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="JobHunt">
<meta name="jobhunt-build" content="${stamp}">
<title>JobHunt Command Center</title>
<link rel="icon" href="${ICON}">
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="styles.css">
<script defer src="app.js"></script>
</head>
<body>
<div id="app"><div class="boot"><div class="card"><div class="spinner"></div><div>Loading your job search…</div></div></div></div>
<noscript>JobHunt needs JavaScript.</noscript>
</body>
</html>
`;
  writeFileSync(join(out, 'pages/index.html'), page);
  writeFileSync(join(out, 'pages/.nojekyll'), '');
  for (const f of ['index.html', 'app.js', 'styles.css']) problems.push(...check('pages/' + f, readFileSync(join(out, 'pages', f), 'utf8')));
  const size = statSync(join(out, 'artifact/index.html')).size;
  if (size > 15 * 1024 * 1024) problems.push('artifact page is over the 16 MB limit');
  if (problems.length) { console.error('Build checks failed:\n  - ' + problems.join('\n  - ')); rmSync(out, { recursive: true, force: true }); process.exit(1); }
  const n = readdirSync(join(out, 'pages')).length;
  console.log(`Built dist/artifact/index.html (${(size / 1024).toFixed(0)} KB) and dist/pages (${n} files) · ${stamp}. All checks passed.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
