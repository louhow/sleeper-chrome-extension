# Agent notes: Sleeper Chrome Extension

MV3 Chrome extension that fills in what Sleeper's website leaves out, across sports, using the same APIs as Sleeper's own apps. Today: NBA and NFL Team, Matchup and League tabs and Optimize lineup, NBA waivers, and the Premier League (EPL) page.
User-facing docs: `README.md` (feature list, install, privacy), `docs/DETAILS.md` (NBA and NFL: features, API calls, tests) and `docs/EPL.md` (Premier League).

## Workflow

- Commit and push to `main` after each finished, tested change (remote: `github.com/louhow/sleeper-chrome-extension`, public).
- Never add Claude as author or co-author on commits.
- Keep the README's Features list in sync: any change that adds, removes or renames a user-visible feature updates that list (one short line per feature) in the same commit, along with the matching section of `docs/DETAILS.md` or `docs/EPL.md`.
- Before committing, run `npm test` (unit) and `npm run test:e2e` (headless Chromium); both must pass with no page errors.
- Look at the screenshots in `test-results/` after UI changes; layout and spacing matter.
- Browser testing is headless only (Playwright). The user's real Chrome is for reading live data with their session, not for testing.
- Writes against the live league (bids, lineup, taxi, IR) only with the user's go-ahead; tell them exactly what is left to undo.
- npm registry is `registry.npmjs.org` (see `.npmrc`); no work registries.
- One-off analysis (league data pulls, scoring studies, scripts and their outputs) goes in `analysis/<topic>/`, which is gitignored. The repo is public and the data names league members, so none of it is ever committed, quoted in docs or used in tests. `analysis/scoring-2026/` holds the 2025-season scoring study: run its Python scripts from that folder with `python3 -I`.

## Layout

- Where things go: `src/` holds what every sport shares; `src/nba/`, `src/nfl/` and `src/epl/` hold one sport each. In a sport folder, `<feature>-view.js` renders (pure state -> HTML) and `<feature>.js` controls it (data, saves, events), one word per feature (`panel`, `matchup`, `league`, `waivers`, `optimize`, `card`, `players`, `what-if`, `nav`). A file's namespace is its path in camelCase: `src/ui.js` is `SNP.ui`, `src/nba/card-view.js` is `SNP.nbaCardView`, `src/epl/team-view.js` is `SEP.teamView`.
- `manifest.json`: three content-script entries at `document_start` on `sleeper.com`. The first (`globalThis.SNP`) loads `src/`'s shared files, then each sport's views, controllers and `session.js`, then `content.js`; the second is `page-hook.js` alone, in the page's MAIN world; the last is `src/epl/` (`globalThis.SEP`).
- Shared, in `src/`:
  - `model.js`: pure rules (schedule, game state, Lock-In, lineup/taxi/IR moves, where a lineup saves (`lineupOnLeg`), the league median (`medianOn`, `leagueMedian`, `medianStanding`), when to read a week's stats again during games (`nextLiveRead`), best lineup for every sport via one Hungarian-algorithm solver (`solveLineup`, given the sport's slot rules), waivers, win probability, the Players tab's week strip, picks, Last 5 and admin deltas, NFL games and points). `scoring.js`: fantasy points from a stat line. Both unit tested.
  - `ui.js`: render helpers and widgets every view uses (team cards and sides, matchup pairs, the league median's banner and medallions (`medianBanner`, `medal`), pickers, toolbar and shell, the API calls tab, the log-back-in message, the optimize dialog's frame).
  - `api.js` (the client and its call log), `loaders.js` (players, rosters, me, legs, scores query, score tiers), `shared.js` (stylesheet loader, shadow hosts, `hideSleeper`, notices, keyboard, missing images and `state.failedAvatars`, page storage, arrow-key team order).
  - `chat.js`: Sleeper's chat on every page, its emoji reaction rows opened as an overlay (no layout shift) with who reacted shown whole.
  - `content.js`: the entry. Routing (one session per league, kept across its tabs) and the admin switch.
  - `bridge.js`: every `snp:*` message between the content scripts and the page's own world; `page-hook.js` carries a copy (Chrome injects a file once per frame, so one file can't serve both worlds) and `test/unit/bridge.test.js` keeps it identical. `ask` / `answer` (sync, `<name>-request` then `<name>`), `call` / `answerLater` (async, with an echoed `id`, e.g. NFL saves), `tell` / `on` (one-way). The protocol is written down there; never hand-roll a listener pair.
  - `base.css`, then `panel.css`: the styles, inlined into each shadow root (`shared.stylesheet`). `base.css` holds the design tokens and every rule the NBA/NFL and Premier League panels draw alike (buttons, notices, dialog chrome, bid form and claims, matchup rows, the API calls tab); `panel.css` the rest, position colors per sport. A rule goes in `base.css` only when it is identical in both panels.
- `src/nba/`: `session.js` is the league's session (data loading, saves, events, the panel's hosts). Every league starts there, since its sport is known only once it loads: an NFL one hands over to `nfl/session.js`, other sports stay hidden. `week.js` loads and adds up a week (players, matchups, games, projections and stats; each team's totals, `side`; the league median), for the session and the sidebar alike. Views and controllers: `panel-view.js` (shell and Team tab), `matchup-view.js` (Matchup and League tabs), `waivers` (bid dialog and pending claims), `optimize` (Optimize lineup), `card` (player card), `what-if-view.js` (the corner What-if scoring control), `players.js` (answers page-hook for the Players tab), `nav` (your matchup under each NBA league in Sleeper's sidebar, in Sleeper's own markup; content.js runs it on every page, page-hook marks the links via `snp:nav-leagues`, and the open league's session feeds it its numbers).
- `src/nfl/`: `session.js` wires `panel` (its own Team and Matchup tabs over Sleeper's, hidden as soon as the league is known to be NFL), `optimize` (OPTIMIZE button and dialog), `league` (League tab cards over Sleeper's, which stay hidden while page-hook reads their live numbers via `snp:nfl-league`) and `players.js` (Last 5). `ui.js`: slot badges, headshots and injury tags both NFL views draw. The panel and dialog keep separate state; a save notice shows in the tab when it's on screen, else in the dialog's layer.
- How the panels sit in Sleeper's page: a shadow root replaces Sleeper's "not yet available" placeholder (on the League tab, the week's matchups go on top of Sleeper's `.league-tab-container`); dialogs render in a separate page-level host. Sleeper's own content is hidden with `shared.hideSleeper` (an html-attribute-gated stylesheet), never inline styles. `html[data-snp-league-sport]` is set for every sport; `src/epl/content.js` waits on it.
- `src/page-hook.js`: remembers each league's last tab (`localStorage` `snp:league-page:<league>`, any sport) and opens it from Sleeper's sidebar through Sleeper's router; reads React props off Sleeper's W/ADD buttons and Players/Trend player rows, and hands clicks to the extension via `snp:player-action` / `snp:player-card`, only for leagues the extension marked NBA (`html[data-snp-nba-league]`). For NFL it reads the Team tab's lineup from Sleeper's Team component (`snp:nfl-lineup`) and saves through that component's own `updateMatchupLeg` (`snp:nfl-lineup-save`, async). Players-tab columns go in once the extension says `snp:players-ready`. On the NFL Players tab it adds the Last 5 column (`snp:recent-weeks`), the team picker and team lines. On the NBA Players tab it opens on your last view (`localStorage` `snp:players-view:<league>`, else Projection for the current week) and adds columns to Sleeper's table component: a week's day-by-day strip with scores (`snp:week-schedule`), a team picker driving Sleeper's own owner filter (`filterByUser`), team avatars on owner lines; in Stats, the week's Avg (with GP) / Best / Worst switch (`snp:week-games`) and the Shooting +/- toggle's dimmed shot-volume columns; with admin on, `adminFPTS` and `adminDelta` (`snp:admin-scores`).
- `src/epl/`: the Premier League panel (Match, Team, Players, League tabs, player card), mounted only for `clubsoccer:epl` leagues. `content.js` is its entry and session, `*-view.js` render, and `model.js`, `scoring.js` and `ui.js` are its own rules and helpers. Its own `panel.css` loads after `src/base.css`. It reads off `SNP` wherever the rule or helper is the same for every sport (the API client, `model`, `ui`, `loaders`, `shared.flasher` and `shared.stylesheet`) and never changes it; `SEP.model` and `SEP.ui` pass on the core rules and helpers EPL uses as they are, so its views read one namespace per layer. Unit tested (`test/unit/epl-*.test.js`); the e2e suite only checks it never mounts on an NBA page. `test/epl/harness.html` is a stand-in page for looking at it, served on port 50030 (see `docs/EPL.md`).
- `test/unit` (node:test, `TZ=America/New_York`; a view's tests are named after it, e.g. `nba-card-view.test.js`; `load.js`'s `loadSnp` runs the first content-script entry in a VM, `loadSep` the EPL one too), `test/e2e/panel.test.js` (stand-in Sleeper pages, live public API, mocked authenticated GraphQL). Each e2e run also writes `test-results/e2e.tap`; read it when a run fails intermittently.

## Conventions and gotchas

- Read league rules from the API (`league.settings`, `scoring_settings`); never hardcode them.
- What-if scoring and the adminFPTS/adminDelta columns are admin tools, off unless `?snp-admin=1` was seen (saved in `chrome.storage.local`, key `admin`).
- Color a score with `model.scoreTier(points, state.tiers, position)`, never fixed numbers: the tiers come from the league's own games (`loadTiers` in `loaders.js`).
- Score fantasy points with `ui.scoringOf(state)`, never `league.scoring_settings` directly, so what-if scoring reaches them. Sleeper's own totals use league scoring; set them aside when `ui.whatIfOn(state)`.
- Port behavior from Sleeper's own web bundle when it exists (mutation shapes, eligibility, dialog wording) instead of inventing it.
- Logged-in calls send `localStorage.token` as `Authorization`; never log or render it.
- Public `/v1/league/<id>/rosters` is CDN-cached for minutes; when logged in read rosters via GraphQL `league_rosters`.
- In season, lineups live on the week's matchup leg (`update_matchup_leg`); outside it, `roster_update_starters`.
- Lock-In: a finished game can be locked only if the player was starting when it tipped off and hasn't been benched since (Sleeper's app string: "Player was not in starting lineup OR was moved to bench since game began"); the check runs in Sleeper's mobile app, not anything the web API exposes. Sleeper's API keeps no lineup history (`subs` is empty, nothing in the schema), so the extension records your lineups as it reads legs (`lineups:<league>:<week>` in `chrome.storage.local`, current week only, see `model.startedAt`); without a record a game is only a maybe. Extra leg reads are timed to tip-offs (`model.nextTipRead`), never a polling timer: keep Sleeper's APIs from seeing us hammer them.
- Sleeper's running total counts each starter's locked game, else their latest finished one. The public `/matchups/<week>` lags minutes behind a lineup change, so with a leg the totals are added up from its lineup.
- Save order: taxi before starters; a starter going to IR leaves the lineup, then IR saves, then the final lineup.
- Nothing renders until the first league + week load is done, so the user never sees a half-built panel or Sleeper's placeholder.
- Writing style: no em-dashes; one sentence per line in long Markdown.

## Debugging

When debugging broken behavior, use these diagnostics - reach for them by judgment, not as a required sequence. Two are worth defaulting to: the contrast check in Rule 2 and verify-the-fix in Rule 8, because both catch a false "done" cheaply.

**1. Understand the System.** Learn how the thing is supposed to work before you touch it.

**2. Make It Fail By Contrast.** Reproduce the failure next to a passing baseline that differs by exactly the suspected cause. Don't be tricked into thinking you have reproduced a failure when you haven't established the baseline working.

**3. Quit Thinking and Look.** Observe the actual failure instead of theorizing about it.

**4. Divide and Conquer.** Narrow the search by halving it, working upstream from the known-bad output.

**5. Change One Thing at a Time.** While hunting or fixing, vary a single factor per attempt.

**6. Check the Plug.** Question the obvious assumptions first.

**7. Get a Fresh View.** When truly stuck and searching online, obtain a new angle by stating the symptoms rather than previous theories.

**8. If You Didn't Fix It, It Ain't Fixed.** Confirm the fix actually fixed it, because failures never leave on their own.

**9. Fix the Bug, Then Propose the Refactor.** Stay scoped to the bug; surface adjacent architectural improvements after it is fixed, not during.
