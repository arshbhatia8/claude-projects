# JobHunt Command Center

A private, single-user command center for a job search: jobs found by a scheduled Claude search, a searchable job database with match scores, an application tracker (table + Kanban), tasks and follow-ups, a calendar, reports, and backup/restore. Dark theme with orange accents, built for laptop and iPhone.

| Copy | URL | Where data lives | Receives the scheduled search automatically? |
|---|---|---|---|
| **Main** (use this one) | https://claude.ai/artifact/G6md5QeG6c4BiENgqbqHwt | The artifact's private database on claude.ai: one copy shared by your laptop and iPhone | **Yes.** The *Job Search – Evening* scheduled task writes to the same `jobs` collection |
| Fallback | https://arshbhatia8.github.io/claude-projects/jobhunt/ | This browser only (localStorage) | No. Import files or restore a backup |

The main copy is the existing **PM Job Tracker** artifact, rebuilt in place. Its database (80 jobs at the time of the upgrade) was not touched by the upgrade, and the scheduled task keeps working unchanged.

## Free services audit

| Component | Service | Free for this use? | Limits | Free fallback |
|---|---|---|---|---|
| Hosting (main) | claude.ai Artifact | Yes, included in the Claude plan already in use. No billing, card or domain | Private to the owner; needs a claude.ai sign-in | GitHub Pages copy |
| Database | Artifact `db` capability | Yes | 25,000 documents per artifact, 256 KiB per document | Browser localStorage + JSON backups |
| Job data integration | Existing scheduled task → same `jobs` collection | Yes | Runs on the task's schedule (currently once a day, 9:28 PM IST); its sources are the task's (LinkedIn via Chrome, Indeed/Dice/ZipRecruiter connectors, web) | CSV / JSON / pasted Markdown-table import, manual entry |
| Scheduled synchronisation | Claude scheduled tasks | Yes | Minimum interval is hourly; a run that needs Chrome is skipped when that device is offline | Manual import |
| Hosting (fallback) | GitHub Pages (public repo) | Yes | 1 GB site, ~100 GB/month soft bandwidth; static only: no backend, secrets or scheduled jobs | Run locally with `npm start` |
| UI and charts | Plain JavaScript, hand-written SVG charts; esbuild (MIT) at build time only | Yes | none | none |
| Fonts | Google Fonts (Geist, Bricolage Grotesque) | Yes | none | System fonts (declared fallbacks) |

No API keys, OAuth secrets or tokens exist anywhere in this project. The build fails if it finds a credential pattern.

## How data is organised

| Collection | Written by | Contents |
|---|---|---|
| `jobs` | Scheduled task, imports, “Add job” | Discovery facts: title, company, location, experience, CTC, posting date, discovery date (`foundOn`), link, source, search match %, Gmail-applied status |
| `jobMeta` | You (the app) | Favourite, shortlist + reason, priority, reviewed / not relevant, notes, verification status, extra sources, change history |
| `applications` | You | Stage, applied date, resume version, documents, recruiter, referral, interviews, assessments, follow-up date, compensation, notes, next action, timestamped history |
| `tasks` | You | Title, description, linked job/application, priority, due date/time, status, category, notes, created/completed timestamps |
| `imports` | Imports | One record per import with counts and errors |
| `settings/main` | You | Target roles, locations, work modes, experience, skills, match weights, defaults, theme |

The scheduled task only writes `jobs`, so a search run can never overwrite your notes, shortlist, applications or tasks. When you track an application the app sets the job's `status: "Applied", statusSource: "You"`, which the task's prompt already promises never to overwrite.

## Using it

- **New jobs** appear in *Discover Jobs* after each scheduled run (live, no refresh needed if the page is open). The badge counts unreviewed jobs.
- **Review**: open a job for its details, provenance labels (*from the listing* / *from your scheduled search* / *estimate*), the match-score breakdown, possible duplicates and history. Mark it reviewed, favourite, shortlisted (with a reason), not relevant, or set *Listing status* (Unverified → Verified open / Possibly expired / Closed).
- **Track**: “Track” creates an application. Stages after *Ready to Apply* require the date you actually applied; opening a link never marks anything applied. Jobs where the search found a Gmail confirmation show *Applied (not tracked)* and are offered (not added) on the dashboard.
- **Suggestions**: moving to Applied, adding an interview or an assessment offers follow-up / prep / thank-you tasks with checkboxes. Nothing is created unless you confirm.
- **Import** (Import Jobs): upload or paste CSV, JSON or the Markdown tables from a search notification. You get column matching, a preview with *new / update / already here / repeat in file / possible duplicate / invalid* per row, then a summary. Re-importing is idempotent.
- **Back up**: Settings → *Back up everything (JSON)*. Restore offers *Merge* (adds missing records; newer wins; histories combined; notes never emptied; nothing deleted) or *Replace* (type REPLACE). *Delete all data* requires typing DELETE. CSV exports exist for jobs, applications, tasks and a weekly summary (Reports).

### Match score
0–100, the weighted average of the factors a listing has data for: role alignment, required skills, experience fit, location & work mode, compensation, posting freshness, seniority fit, and the scheduled search's own resume-based score. Factors with no data (e.g. salary not disclosed) are left out, not counted as zero. Weights are in Settings. A score is an estimate of relevance, never proof a job is open.

### Freshness labels
*Newly discovered* (found ≤2 days ago, not reviewed), *Recently verified* (you confirmed it open in the last 7 days), *Unverified* / *Needs verification*, *Possibly expired* (posted >30 days ago and not re-checked; it may still be open), *Deadline in Nd*, *Deadline passed*. Only you can mark a job *Closed*.

### Duplicates
Same listing URL (LinkedIn/Indeed ids normalised), same requisition ID at the same company, or same company + title + city → treated as the same job (imports update it, never touching your data). Anything less certain, such as a different city, a near-identical title, or a different listing id on the same site, is flagged for review in Discover and never merged automatically. Merging keeps one record, hides the other, keeps its link as an extra source and moves applications and tasks.

## Development

```bash
cd jobhunt
npm install        # esbuild only
npm test           # 31 unit tests (node:test)
npm run build      # dist/artifact/index.html + dist/pages/ (refuses to build if a check fails)
npm run e2e        # 79 browser checks in headless Chromium (desktop, iPhone 393×852, artifact-db stand-in)
npm start          # serves dist/pages at http://localhost:4100
```

```
jobhunt/
  src/core/   util, schema (model + parsers), dedupe, matching, freshness, importer, model, metrics,
              suggestions, actions (all writes), store (live cache + artifact-db/localStorage adapters), backup
  src/ui/     app (shell, routing, search), dom, charts, forms, detail (drawers), styles.css
  src/ui/views/ dashboard, discover, shortlist, tracker, tasks, calendar, reports, import, settings
  scripts/build.mjs   test/*.test.js   test/e2e/run.mjs
```

**Publishing:** the artifact is updated by publishing `dist/artifact/index.html` to the artifact URL (declares the `db` and `downloads` capabilities). The fallback copy is the contents of `dist/pages/` committed under `jobhunt/` on the `gh-pages` branch, next to Spendly.

## Known limitations

- The main copy needs you to be signed in to claude.ai (Claude app or Safari). Signed out, it shows a notice and stores nothing.
- The live claude.ai page was not clicked through by an automated browser (that needs your signed-in session). The same build was tested end to end against a stand-in implementing the database API, and the real database was read back after publishing.
- Safari/WebKit was not available for testing; tests ran in Chromium at iPhone 15 size.
- The GitHub Pages copy cannot receive the scheduled search: a static site has no database the task can write to. Data there is per-browser, and Safari may clear site data for sites you haven't visited in 7 days. Use the main copy, or back up often.
- Salary comparison across currencies uses the approximate rates in Settings, which you maintain. Nothing fetches live rates or job pages.
- The scheduled task stores no description or skills for most jobs, so the *Required skills* factor usually has no data and is left out.
