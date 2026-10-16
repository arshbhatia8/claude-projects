# JobHunt Command Center

A private, single-user job-search system. Jobs arrive from a scheduled search, hiring emails are read from Gmail (read-only), and the application tracker updates itself. Dashboard, tracker (table + Kanban), tasks, calendar and reports all run on one database.

**Use it at:** https://claude.ai/artifact/G6md5QeG6c4BiENgqbqHwt (sign in to claude.ai; works in the Claude app and Safari on iPhone).
A browser-only copy without automation is at https://arshbhatia8.github.io/claude-projects/jobhunt/.

## How the automation works

```
JobHunt – Job discovery (scheduled, 9:28 PM IST)      JobHunt – Gmail sync (scheduled, 8:54 AM / 1:54 PM / 6:54 PM IST)
  public job boards, Indeed/Dice/ZipRecruiter            Gmail connector, read tools only
  → writes jobs + a run record                           → writes one "mail event" per hiring email + a run record
                         \                                /
                          ▼                              ▼
                 the tracker's database (claude.ai artifact db)
                          │
                          ▼
        Tracker engine (runs inside the page, automatically, whenever new data arrives)
          • matches each email to an application or job → status, applied date, assessment deadline,
            interview date/time, history entry with the Gmail message id, tasks
          • merges certain duplicate jobs; creates up to 5 "review this match" tasks a day
          • anything uncertain → Gmail Updates → "Needs your review"
```

- **Scheduled tasks run while your browser is closed.** They are Claude scheduled tasks on Anthropic's servers, included in your Claude plan with no extra billing.
- **Status changes from those emails are applied the next time the page is open on any device.** This happens automatically within seconds; there's nothing to click. The engine is deterministic code inside the page, so there is one set of rules. A scheduled task cannot run that code, which is why it doesn't edit applications itself.
- **The page also reads Gmail itself when open.** It does this every 30 minutes, only after you press *Connect Gmail* once, and through the same connector with the same two read tools.

### Gmail access

| What | Detail |
|---|---|
| Connection | Your existing claude.ai **Gmail connector** (OAuth by Google; claude.ai holds the token, this code never sees it) |
| Tools the page may call | `search_threads`, `get_thread` only (declared in the artifact; anything else is refused by claude.ai) |
| Tools the scheduled task uses | `search_threads`, `get_thread`, `get_message` (by its instructions) |
| Google scope of the connector | Set by Anthropic's connector. Public reports list `gmail.readonly` + `gmail.compose` ([report](https://claudeissues.com/issue/53835-claude-ai-gmail-mcp-connector-requests-insufficient-oauth-scopes-cannot-read-ema)). This project cannot narrow that grant; it only ever calls read tools. |
| Search | hiring keywords + `after:<last sync − 1 day>`, excluding Promotions, Social, Sent and Chats. Oldest first; if a run hits its cap the sync point is not advanced, so the next run continues where it stopped. |
| Stored per email | sender, date, subject, ≤240-char snippet, what it meant, what was done. A ≤2,000-char excerpt is kept only until processed (or reviewed), then deleted. |
| Disconnect | Page: Gmail Updates → *Turn off for this page*. Everywhere: claude.ai → Settings → Connectors → Gmail → Disconnect; Google Account → Security → Third-party connections. |
| Delete email data | Gmail Updates → *Delete email data* (removes all email records and subjects from histories; applications, jobs and tasks stay) |

Why not a separate Google OAuth app with only `gmail.readonly`? Its token would have to be stored by a backend, which means another account (for example Cloudflare). Also, in Google's *Testing* mode the refresh token expires every 7 days, which breaks unattended sync. Publishing such an app needs Google's verification for restricted scopes.

### Status rules (conservative)
- Stages only move forward (Applied → Assessment → Interview → Offer); a rejection or offer can end any active application.
- If you changed a post-application stage by hand **after** the email arrived (e.g. Withdrawn), your change wins and the email is only noted.
- An email about an application that is already Rejected/Withdrawn/Closed/Offer is flagged, not applied.
- No company, several matching applications, or low confidence (default <60%) → flagged for review.
- Recruiter outreach, job alerts, newsletters, OTP/passcode mails, "complete your application" nudges and promotions never count as applications.
- Digest emails (e.g. Naukri/LinkedIn "your applications" summaries) create one application per listed role when the roles can be read; otherwise they go to review.
- Level words matter: "Product Manager" and "Associate Product Manager" at the same company are different applications.
- Every processed email is recorded once (Gmail message id), so re-syncing never duplicates events, history or tasks.
- Dates (assessment deadlines, interview times) are recorded only when the email states one; a list of options records nothing.

### Tasks created automatically
Follow-up after a confirmed application (your follow-up rule, default 7 days, marked *suggested*). Assessment (due on the stated deadline, marked *confirmed*). Interview prep and thank-you note (when the date is stated). Reply to an information request. Review the offer. "Review new match" for the best new jobs (≤5 open, ≤5 per day). Open auto tasks close when an application is rejected. Turn this off in Settings → Automation.

## Free-services audit

| Component | Service | Free here? | Limits | Fallback |
|---|---|---|---|---|
| Hosting + database | claude.ai artifact with `db` | Yes, part of your Claude plan | 25,000 docs, 256 KiB each; private to you | JSON backup; browser-only copy |
| Job discovery | Claude scheduled task: Indeed/Dice/ZipRecruiter connectors, public Greenhouse/Lever/Ashby job-board APIs, public search results | Yes | Uses your plan's usage; no logins, no browser cookies, skips sites that block automation | Manual import (Automation → Exceptions) |
| Gmail | claude.ai Gmail connector | Yes | Read tools only by design; scope note above | none needed |
| Scheduling | Claude scheduled tasks | Yes | Hourly minimum; a failed run is retried at the next slot | Page-side Gmail sync when open |
| UI | Plain JS, own SVG charts, esbuild (MIT) at build time | Yes | none | none |

There are no API keys, secrets or billing anywhere. The build refuses to finish if it finds a credential pattern. If a connector or quota fails, the run records the error, the page shows it under Automation, and nothing is charged.

## Data

| Collection | Written by | Contents |
|---|---|---|
| `jobs` | discovery task, manual import/add | listing facts |
| `jobMeta` | you / engine | notes, shortlist, flags, merge info, history |
| `applications` | you / engine | stage, dates, interviews, assessments, history (with Gmail message ids) |
| `tasks` | you / engine | to-dos; auto tasks have deterministic ids |
| `mailEvents` | Gmail sync (task or page), engine | one per hiring-related email |
| `runs`, `system` | tasks, page | automation health, last sync, schedule |
| `settings` | you | roles, locations, weights, automation options |

Back up from Settings (JSON); CSV exports for jobs, applications and tasks.

## Development

```bash
cd jobhunt
npm install && npm test      # 53 unit tests
npm run build                # dist/artifact/index.html + dist/pages/
npm run e2e                  # 101 browser checks (desktop, iPhone 393 px, artifact + Gmail stand-ins)
```

Key files: `src/core/mail.js` (email classifier), `src/core/engine.js` (status rules), `src/core/automation.js` (Gmail sync, engine runner), `src/ui/runtime.js` (in-page automation).

## Known limitations

- Status updates from background-synced emails appear when the page is next opened, not while all your devices are closed (the scheduled task stores the emails and notifies you).
- The scheduled tasks can technically use every connector attached to them (Drive, Calendar, etc. were attached when they were first created; this organisation doesn't allow changing a task's connectors from here). Their instructions forbid using anything but Gmail (sync) or the job connectors (discovery). To remove the extra connectors, edit the tasks in claude.ai → Scheduled tasks.
- The previous LinkedIn-in-Chrome search is paused (it used your signed-in browser). Re-enable it in claude.ai if you want it back.
- Public job sources only: LinkedIn and Naukri listings appear only when they surface in public search results.
- The live claude.ai page was exercised by you (the engine ran there); automated browser tests used stand-ins for the database and Gmail connector. Safari/WebKit was not available for testing.
