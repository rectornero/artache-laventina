# Artache Laventina

A kind lavender butler for Nero's household. See README.md for how it is built, run and tested (`npm test`).
This is the restart of 2026-10-25 ("Lavender after the frost"). The first Laventina (repo `rectornero/laventina`) is a parts bin: carry ideas over by hand, never its schedules, database or push code.

## Cost safety: rule one, before every feature
On 2026-10-23 the first Laventina got an every-minute job that kept a paid database awake day and night and drained the Netlify credits shared by all of Nero's sites (about €5 to recover). Nero's policy now: **no costs**. In practice:
- **Nothing runs on its own.** No scheduled functions, background functions, edge functions, timers, polling or push. Code runs only when a person opens the page, taps something, or Claude calls the link. `test/cost-guard.test.mjs` enforces this.
- **Nothing bills while idle.** Data lives in Netlify Blobs (no always-on compute). No Netlify Database, no Postgres, no AI calls from Netlify (no AI Gateway, no API keys). Claude reaches Laventina through the MCP link, on Nero's own Claude plan.
- **No bell.** Nero ruled it out on 2026-10-25 (it is a cost). Reminders are calendar files the phone rings by itself.
- **Budget: 50 credits a month.** The app counts its own calls (`meter` in `public/js/laventina.mjs`), warns at 80% and rests at 100% until the 1st. Reads are counted in memory and written with the next change, so a read never costs a write.
- **Deploys cost 15 credits each.** `netlify.toml` only builds production when the commit message says `[deploy]`. Test on branch deploys and Deploy Previews (free). Ask Nero before any `[deploy]`, and batch changes: at most about one a week.
- **Price it before you ship it.** Any new function, dependency, or anything that could run more often needs a monthly estimate (compute and database 10 credits per GB-hour, web requests 2 per 10,000, bandwidth 20 per GB, production deploy 15), written in the PR and told to Nero.
- **See it live, not just in tests.** After a change that touches cost, read the function logs and Netlify usage within minutes of the deploy. (The first Laventina's fix passed its tests and failed live: a Blobs store kept at module level expired. Open the store per request, as `lib/blobs.mjs` does.)
- **One keeper.** Only one thread changes the running app at a time.

## Look
Night is the main mode (near-black, soft lavender, warm yellow candle glows); day is an opt-in in the pantry. The butler is the lavender sprig at the top: it sways, glows while it thinks, and bows when it speaks. All movement is CSS and honours reduced motion. Input is one sentence or a tap, never a form.

## Artache
This studio tracks its work in Artache. The `artache` MCP tools talk to it.
- No `artache` tools in this session (cloud sessions)? Use the same API over HTTPS with the `ARTACHE_TOKEN` environment variable: `curl -sS https://artache.netlify.app/api/v1/inbox?project=owner/repo -H "Authorization: Bearer $ARTACHE_TOKEN"` for the inbox, and POST JSON (`project`, `kind`, `title`, `body`, `url`, `brief_id`) to `/api/v1/posts` for updates. Briefs: POST `/api/v1/briefs/<id>` with `status`; replies: POST `/api/v1/replies`.
- At the start of a session, call `artache_inbox` with this project's Artache name to see briefs and studio replies. Briefs come first: accept one with `artache_update_brief` before starting, say what blocks you in a reply, and mark it done with a `result_url` when finished. Answer studio replies with `artache_reply`.
- After meaningful progress (a feature or fix merged, a release or deploy, a milestone, a decision, or a question the team must answer), post one update with `artache_post_update` (with `brief_id` when it delivers a brief).
- Write the title for someone who didn't see the session (under 100 characters). In the body: what changed, why it matters, what's next. Add a `url` to the PR, deploy or doc when there is one.
- Use kind `release` for something shipped, `milestone` for a big step, `question` when you need a human decision, `note` for context, `update` otherwise.
- Don't post for trivial edits, failed attempts or work in progress with nothing to show. One update per meaningful result; check `artache_recent_updates` if unsure whether it was already posted.
- When you create or publish a platform, article or other work, record it with `artache_upsert_work` and a stable `key` like "owner/repo:article-slug", so later changes update the same item.
- There is no deploy hook in this repo, so a production deploy does not post itself: post one `release` update after a `[deploy]` lands. Never print or commit an Artache token.

### Artache: this project
Artache project name: `rectornero/laventina` (use exactly this as `project`, even though the code now lives in `rectornero/artache-laventina`).
Important here: a module finished (upkeep, projects, money and papers); the deploy hook going live; household feedback that changes the plan; push notification or sign-in problems; a data model change.
Never post: household members' names, addresses, money amounts or documents.
At the end of each session, ask: did anything here change what Nero would decide or plan? Post only if yes.
