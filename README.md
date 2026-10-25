# Artache Laventina

A kind lavender butler for the household. It greets you with a short brief instead of a list, watches the last day of every coupon, and keeps the story of the household's stepping stones: small losses turned into lessons. It started with a €7 coupon (chapter one) and a frost of Netlify credits (chapter two).

## How it is built
- `public/`: the page. Plain HTML, CSS and ES modules, no build step. `public/js/laventina.mjs` is the butler's heart (pure functions: the brief, coupons, the story, the meter, calendar files), shared by the page, the API and the Claude link.
- `netlify/functions/api.mjs` (`/api/*`) and `netlify/functions/mcp.mjs` (`/mcp/<link>`): run only when called, rate limited. Logic in `lib/server.mjs`.
- Data: one JSON document per household in Netlify Blobs (`lib/blobs.mjs`), with conditional writes so two people can change things at once.
- Sign-in: the first person to open a new site starts the household; after that, starting is closed and others join with a one-time invite link from the pantry (the ⋯ menu). Each device keeps its own key.
- Claude: make a link in the pantry and add it in claude.ai as a custom connector. Tools: `laventina_brief`, `laventina_add_coupon`, `laventina_close_coupon`, `laventina_story`, `laventina_add_stepping_stone`, `laventina_set_lesson`.
- Reminders: the Calendar button downloads an event that rings the evening before a coupon's last day.

## What it costs
Nothing while nobody uses it. Each visit or tap is about 0.001 credits (one short function call), so a busy month of two people is around 1 to 3 credits. The app stops itself at 50 credits a month. Production deploys (15 credits) only happen on commits that say `[deploy]`. Read `CLAUDE.md` before adding anything.

## Run and test
- `npm install`, then `npm test`.
- `node dev/server.mjs` and open http://localhost:8888 (data in memory).
