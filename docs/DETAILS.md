# Details

How the extension works: what it shows, the Sleeper API calls it makes, and how to run the tests.

## What it shows

### Team

- Team card: avatar, record, this week's points, Lock-In projection, opponent.
- Starters, bench, injured reserve and taxi squad, each player with a Monday-Sunday strip of games: projected points (actual once played), opponent, tip-off time.
- Each game cell shows where the game stands under Lock-In:

  | State | Looks like |
  | --- | --- |
  | Locked in | Filled yellow, closed padlock |
  | Finished, can still be locked (a starter, before their next tip-off) | Bright teal outline, open padlock |
  | Finished, too late to lock (or a bench player's) | Faded, no outline |
  | Live | Red outline, "Live" |
  | Today, still to tip off | Bright outline, bold time |
  | Later in the week | Quiet outline, projection muted |

- The points column marks a locked-in score with a padlock, in yellow, so it reads apart from a score still in play.
- Lock-In from the strip, on your own lineup in season: hovering a lockable game asks "Lock?"; clicking it asks to confirm in the cell ("Lock 30.95?" Yes / No, Esc cancels), and Yes saves the lock (`update_matchup_leg`, as on the Matchup tab).
- Rostered and start percentages, as the mobile app shows them (rounded up, for the league's type).
- Draft picks held, including picks acquired by trade.
- Lineup swaps on your own roster: tap a slot badge, then one of the highlighted players (G takes PG/SG, F takes SF/PF, UTIL and bench take anyone).
- Taxi moves on your own roster, following the league's taxi settings (see below). Only badges with a legal move are clickable.
- IR moves on your own roster: players whose injury status the league allows (`reserve_allow_out`, `_dtd`, `_dnr` and so on; IR and PUP always) can go onto IR from the bench or the lineup, or trade places with an IR player. Coming off IR into an open spot needs room on the active roster.

#### Taxi rules

These are ported from Sleeper's web app and match its help article:

- Eligibility: with `taxi_allow_vets`, players with `years_exp <= taxi_years` (0 = no limit); otherwise rookies only.
- Moving onto taxi (from the bench or a starting slot, or trading places with a taxi player) is allowed until `taxi_deadline`: through that preseason week, or with 4, until the first regular-season game tips off; 0 means no deadline.
- After the deadline taxi is one-way: a taxi player can only move into an open bench spot, which needs room on the active roster (one player per roster position).
- Taxi is a roster setting, not a weekly one, so it's edited from the current week.

The projection follows Lock-In rules: an unlocked player scores their final game of the week, so that game's projection is the default.

#### Optimize lineup

The Team tab's **Optimize lineup** button (your own team, a week you can still edit) proposes the best starting lineup and the finished games worth locking in, and shows all of it in a dialog before anything saves.
Nothing is written until you apply a row or press Apply all; Cancel, ✕, the backdrop or Esc leave the rest as it was.

- Rows: one per starting slot, in your lineup's order, so changes read against the lineup you know.
  - A change shows who goes out ("To bench" or "To SF") faded, over who comes in ("From bench · Sun vs MEM 9:00pm"), with an Apply button.
  - A finished game worth locking shows its score, the open value and when the window closes, with a Lock button.
  - A slot that stays is dimmed and says why: "No change", "Locked" (with the locked score), "Playing" or "Empty".
- Applying one row saves just that slot and keeps the dialog open on the plan from the new lineup, with a note saying what saved.
  When moves tie slots together (the player coming in leaves another starting slot, or the one going out takes one), they apply together, and the button says which ("with SF").
  Lock saves only that lock, on the lineup as it stands.

- It picks for the next day of games, since Lock-In lineups can change daily: a starter with no game that day can sit for someone who plays, and come back for their next game.
  Run it again each game day.
- Worth: a player's projection for that day (0 with no game). Out games project 0, so injuries count.
- Open value: what leaving a starter's slot open is worth, from their projections for the games left.
  The week's last game counts unless an earlier one gets locked, and a game is worth locking when it beats what the games after it are worth.
  Each game's points are taken to spread about 35% of the projection either way (a normal distribution), so two games left are worth more than either alone.
- A starter with a finished game that can still be locked, scoring more than the open value, is worth that score.
- Lock in: such a starter is recommended for locking when the best lineup keeps them and they have a game left (with none, the last game counts anyway).
  Each recommendation shows the score, the open value and when the window closes (their next tip-off).
  "Keep open" leaves it out and keeps the player in the lineup, so the score can still be locked later; the rest of the plan is worked out again. "Lock instead" brings it back.
  A player being locked keeps their slot, and the lineup is worked out around them.
- Starters whose finished game can be locked but isn't worth it yet show the score and the open value in their row ("16.50 Wed vs MIL · open 31.91"), with no action.
- Slots no one can fill that day go to the players with the most projected points per game left this week.
- Lineup: tries every way to fit the movable players into the starting slots and keeps the highest total, so scarce slots go to the players who can only fill them. Ties keep the most players where they are, then put players in their most specific slot.
- Locked-in players and players in a game right now stay put.
- Losses: benching a starter whose finished game was worth locking (or green) gives that score up (bench players can't lock in). The row turns yellow ("Can't lock 12.42 · Tue vs OKC") with a yellow note at the top; Apply still works.
- Green scores (24+): giving one up turns the row red, explains it at the top, and keeps that row's Apply and Apply all ("Apply all and lose N pts") disabled until you tick "Bench … anyway".
- Scores in the dialog are colored by tier, like the game log.
- Every apply works the plan out again first; if a game tipped off meanwhile and the plan changed, it shows the new plan instead of saving.
- Apply all: with locks, the lineup and the locks save together in one `update_matchup_leg` (the button says "Lock in N games and apply all"); locks are final.
  Without, the lineup saves in one `update_matchup_leg` (in season) or `roster_update_starters`, leaving Lock-In picks untouched.
- The top of the dialog shows the starters' projected points for that day now and after the changes; each row shows that day's projection and points per game left.
- The dialog's "How it picks" label sums these rules up in a few lines on hover or focus.
- Clicking a player in the dialog opens their player card over it; closing the card returns to the dialog.

### Matchup

- Both teams side by side: points, projection, win probability, record and standings rank, and how many starters are yet to play.
- Each starter against the opposing starter in the same slot, then bench, IR and taxi.
- Per player: the game that matters for Lock-In (the locked game, the one that can be locked, or the next one), its points or projection, and team logos for the week's games.
- Lock-In for your own starters: once a game ends, `LOCK-IN` stays open until that player's next game starts. Locking is final, so it asks to confirm.
- Switching leagues in the sidebar from any Matchup tab opens an NBA league on its Matchup tab, where Sleeper would open its League tab.

Win probability is Sleeper's own formula, ported from its web app: each side is a normal distribution centred on its projection, narrowing as the score approaches it.
Rank comes from `roster_standings`; before any games are played, it falls back to the standings order (record, points, then waiver order), which is what Sleeper shows then.

### Players tab

Sleeper's own NBA Players table, with these additions:

- It opens on Projection for the current week (Sleeper's own current week), once per league per visit; what you pick after that sticks.
  It loads the week the way Sleeper's own week dropdown does.
- Sleeper's week dropdown reads the week shown: on its own it shows the season ("2026") on load even with a week picked, because its option values are numbers and the value it starts with is a string.
- Shot volume, in Stats (not Projection, where they'd mean nothing): FGM and FGA after PTS, 3PA after 3PM, FTM and FTA at the end.
  They don't score in the league, so they're dimmed.
  Sleeper's stats already carry them; they go into its table component as stat keys, so they sort from their headers like its own columns.
- Avg / Best / Worst: in Stats with a week picked (not the season), a switch in the table's top-left corner.
  Avg is Sleeper's own numbers, each player's average over the week's games, plus a GP column (games played, after FPTS); Sleeper's week stats are per game and carry no count.
  Best and Worst show each player's single best or worst game that week, by the league's scoring, in whole numbers (minutes rounded; fantasy points keep a half when they score one); games a player sat out don't count.
  The per-game stats come from `/stats/nba/<season>/<week>`, once per week per page load.
  Switching keeps the column you sorted by and re-sorts by the new numbers.
- Sorting in Stats follows the numbers on screen: Sleeper keeps sorting by the projection there (not a column in Stats), so that sort, or one on a column that goes away (GP in Best or Worst), becomes FPTS.
  Sleeper prints every stat with one decimal (after dividing by games played), so GP and the picked games' numbers are drawn over its cells.
- The columns narrow to fit the header's room after its corner, so the table never scrolls sideways (15 columns at 37px; 17 with the admin pair at 32px).
  Each column also has Sleeper's 2px margin on both sides.

### Player card

Clicking a player's name or headshot on the Team or Matchup tab, or a player on the Players or Trend tab (instead of Sleeper's own NBA card), opens a card laid out like Sleeper's NFL player card:

- Hero in team colors: owner, age, height, weight, experience, college, and rankings (position and overall rank from the latest season with stats, plus rostered and started %).
- Game logs per season (tabs): projected and actual fantasy points with the league's scoring, minutes, box score and shooting, shaded like Sleeper's tables. Fantasy points are colored like the mobile app's score log: green 24+, yellow 15+, red below (thresholds observed in the app, not from the API). The current season lists upcoming games with projections.
- Career: one row per season with fantasy points, position rank, per-game averages and shooting.
- Transaction history in this league (logged in), latest news, and the team's depth chart.

### What-if scoring

What-if scoring is an admin tool, hidden by default.
Open any Sleeper page with `?snp-admin=1` once (for example `sleeper.com/leagues/<id>/players?snp-admin=1`) to turn it on, and with `?snp-admin=0` to turn it off.
Sleeper's own navigation drops the query string, so the choice is saved for the whole browser and every page, league, reload and tab follows it; saved what-if values stay put while it's off.

A **Scoring** control sits in the page's top-right corner on the Team, Matchup and Players tabs and over the extension's dialogs, to try other scoring settings without touching the league.

- Open it to edit any value: the league's scored stats first, in Sleeper's order and wording, then the rest behind "Show more". Changed rows show the league's value, and clicking it puts that one back.
- Values apply as they're typed, and the page switches to what-if scoring.
- Collapsed, it's a switch between League and What-if (with the number of changes). What-if stays off until a value changes.
- Reset to league puts every value back and turns what-if off.
- The values and the switch are remembered per league in the browser (`chrome.storage.local`); nothing is sent to Sleeper.

While what-if is on, it's hard to miss:

- The switch is purple, and the Team tab, Matchup tab and player card show a purple banner listing the changes, with a button back to league scoring.
- Every fantasy number it changes (day cells, weekly points, team totals, Matchup rows, the card's projections) turns purple, and dialogs get a purple frame.
- Sleeper's own totals (`points`, `proj_points`, `players_points`) are scored with the league's settings, so they're set aside and added up from Lock-In rules instead.
- Lock-In and Optimize lineup are off, since they act on real points: a lock is final, and Optimize picks with the league's scoring.

The player card's game log gets the same pair: **Fpts** with the league's scoring and **adminFPTS** with the what-if values (switched on or not), both in score-tier colors; Proj follows the League/What-if switch.

On the Players tab, an **adminFPTS** column sits right after Sleeper's FPTS (league scoring) and always uses the what-if values, switched on or not.
It matches FPTS until a value changes, then turns purple.
Next to it, **adminDelta** shows how many places adminFPTS moves each player compared with FPTS, within the list on screen (after Sleeper's position, search and owned filters), so filtering to centers ranks centers against each other.
Under the badge are both places, "#13→#42" (rank by FPTS, then by adminFPTS), to check a shift at a glance.
It reads "+3" on green for a riser and "−2" on red for a faller, deeper the bigger the move relative to the biggest one in the list; ties share a rank, so nobody moves until a value changes.
Click any of the three headers to sort by it, as with Sleeper's other columns (adminDelta puts the biggest risers first); a thin teal bar marks the sorted column.
Sleeper shows every stat per game but stores (and sorts) season stats as totals, so adminFPTS is stored per game and adminDelta ranks per game: both sort and rank by the number on screen.
How it hooks in: `src/page-hook.js` adds `adminFPTS` and `adminDelta` to the stat keys and per-player stats of Sleeper's own table component, so Sleeper renders and sorts them.
Sleeper's rows only fit 9 stat columns at 60px, so with these two every column narrows to 54px, the name area keeps Sleeper's 118px (rows with an owner line would otherwise be wider), and the headers wrap onto two lines, keeping each value under its header.
Sleeper prints every stat with one decimal, so adminDelta's cell gets a badge on top; the list on screen is read from Sleeper's list component (`players`).
The value is Sleeper's FPTS plus the changed settings scored on their own (`snp:admin-score-request`, answered by the extension), so it never drifts from Sleeper's number; the rank shifts come back with it (`model.rankShift`).

### NFL: Optimize lineup

Sleeper's web app already runs NFL leagues, so the extension adds only one thing there: an **OPTIMIZE** button on your own Team tab, left of Sleeper's WAIVER and TRADE buttons (it reuses their classes, so it looks like them).
It opens the same kind of confirmation dialog as the NBA version, with no warnings to tick through:

- Worth: Sleeper's projection for this week's game, scored with the league's settings (the same number the Team tab shows). A bye week or a player ruled Out (Out, IR, PUP, Sus, NA) is worth 0.
- Lineup: the same solver as NBA, with Sleeper's NFL slot rules (FLEX takes RB/WR/TE, WRRB_FLEX RB/WR, REC_FLEX WR/TE, SUPER_FLEX QB/RB/WR/TE, IDP_FLEX DL/LB/DB, every other slot its own position). Ties keep the most players where they are.
- Players whose team has kicked off stay put, as Sleeper locks them.
- Questionable and Doubtful players can start; when one moves into the lineup their row is highlighted with a note to check the news.
- Apply works the plan out again first, then saves through Sleeper's own Team component (`updateMatchupLeg` in season, `roster_update_starters` before it, as its `_updateRoster` does), so Sleeper's screen updates as if you'd made the swaps.

How it hooks in: `src/page-hook.js` reads the lineup from Sleeper's Team component props (slots and starters as shown, roster, players, `hasTeamPlayedMap`) and each row's projection (`proj` stats and `scoringSettings`), and answers the extension's `snp:nfl-lineup-request` synchronously.

### Waivers

Sleeper's web Players tab lists NBA players with their waiver (W) or ADD buttons, but answers every click with "Player Actions not yet available on web for NBA fantasy".
The extension takes over those two buttons and opens the same dialog Sleeper's web app uses for NFL:

- Waiver players get "Make Waiver Bid" with the FAAB budget left (or "Make Waiver Claim" without FAAB); free agents get "Add Player", which adds right away.
- When the roster is full, a drop is required; only dropping an active player opens a spot, and IR players are left out of the list, as in Sleeper's dialog.
- Bids must be whole dollars, at least `waiver_bid_min` and at most the budget left.
- The Team tab's Waivers button lists pending claims in processing order (bid, then priority), where a bid can be changed or the claim canceled.

How it hooks in: `src/page-hook.js` runs in the page's own world, because only there can it read the button's React props (`playerId` and Sleeper's computed `waiverStatus`).
It only acts on pages of a league the extension has confirmed is NBA, and hands the click to the extension as a DOM event, so Sleeper's own handler never runs.
Which players are on waivers, and until when, is Sleeper's own calculation; the extension doesn't recompute it.

## Logged-in features

When the page has a Sleeper session, the extension reads its token from `localStorage.token` and sends it as the `Authorization` header, the same way Sleeper's web app does.
The token is never stored, logged or shown; authenticated calls are tagged `auth` in the API log.
It enables:

- `league_rosters(league_id)`: rosters straight from Sleeper. The public `/rosters` endpoint is cached at the CDN for up to ~10 minutes, so after a save it can show (and a follow-up move could build on) the old roster.
- `me`: which roster is yours (swaps are only offered there, for the current and future weeks).
- `matchup_legs(league_id, round)`: the week's saved lineup, Sleeper's own projection (`proj_points`) and Lock-In picks (`starters_games`, shown with a lock).
- `update_matchup_leg(...)` during the season, `roster_update_starters(...)` outside it: saving a swap.
- `update_matchup_leg(..., starters_games: $starters_games)`: Lock-In. The variable is the week's full player -> game map as JSON, with the new lock added.
- `roster_update_taxi(league_id, roster_id, taxi)`: taxi moves. Saved before any starter change, like Sleeper's web app.
- `roster_update_reserve(league_id, roster_id, reserve)`: IR moves. A starter going to IR is first saved out of the lineup, then IR, then the final lineup, so no save has a player both starting and on IR.
- `submit_waiver_claim(league_id, k_adds, v_adds, k_drops, v_drops, k_settings: ["waiver_bid"], v_settings: [bid])`: a waiver claim, as Sleeper's web app sends it for NFL. Adds and drops map player ids to the roster id.
- `league_create_transaction(league_id, type: "free_agent", k_adds, v_adds, k_drops, v_drops)`: a free-agent add.
- `league_transactions_filtered(league_id, roster_id_filters, type_filters: ["waiver"], status_filters: ["pending"])`: pending claims.
- `update_waiver_claim(league_id, transaction_id, leg, k_settings, v_settings)` and `cancel_waiver_claim(league_id, leg, transaction_id)`: changing a bid and canceling a claim.

If Sleeper turns the session down (a 401 or 403 on any logged-in call; a stale token can do this while Sleeper's own pages still work), the Team and Matchup tabs show only "Log back in to Sleeper" with how to fix it.
The logged-out fallbacks (public rosters, no Lock-In picks) would otherwise show wrong numbers.
The API log stays available, and once the page holds a new token (after logging back in) a reload or refresh loads normally.

## API calls

| Call | Used for |
| --- | --- |
| `GET /v1/league/<id>` | Name, sport check, slot order, scoring, reserve/taxi slot counts, draft rounds, league type |
| `GET /v1/league/<id>/users`, `/rosters` | Team names, avatars, players, starters, taxi, IR, record |
| `GET /v1/league/<id>/winners_bracket` | Last week of the season |
| `GET /v1/league/<id>/traded_picks`, `/drafts` | Draft picks held |
| `GET /v1/league/<id>/matchups/<week>` | Weekly starters, points, opponent |
| `GET /v1/state/nba` | Current week |
| `GET /v1/players/nba` | Names, teams, positions, injuries (~2.5 MB, cached 12h in `chrome.storage.local`) |
| `GET /projections/nba/<season>/<week>` | Per-game projected stats, scored with the league's settings |
| `GET /stats/nba/<season>/<week>` | Per-game actual stats (Team and Matchup tabs; the Players tab's GP, Best and Worst) |
| `GET /players/nba/research/<type>/<season>/<week>?league_type=` | Rostered and start percentages |
| `GET /players/nba/<id>`, `/stats/nba/player/<id>?season=&grouping=week`, `/projections/nba/player/<id>?...`, `/players/nba/<team>/depth_chart` | Player card: bio, game logs, career, depth chart |
| `POST sleeper.com/graphql` `get_player_news`, `league_transactions_by_player` | Player card: latest news, transaction history |
| `POST sleeper.com/graphql` `scores(...)` | Game times and home/away |
| `POST sleeper.com/graphql` `roster_standings(...)` | Standings rank |
| `POST sleeper.com/graphql` `me`, `matchup_legs`, `update_matchup_leg`, `roster_update_starters`, `roster_update_taxi`, `roster_update_reserve` | Logged-in lineup data, swaps, Lock-In, taxi and IR (see above) |
| `POST sleeper.com/graphql` `submit_waiver_claim`, `league_create_transaction`, `league_transactions_filtered`, `update_waiver_claim`, `cancel_waiver_claim` | Waiver bids, free-agent adds and pending claims (see above) |

## Tests

```sh
npm install
npm test          # unit tests: scoring, data model, rendering
npm run test:e2e  # headless Chromium with the extension loaded
```

Logged-out visitors get redirected away from league pages, so the e2e test serves a stand-in page that mirrors the empty Team tab's markup, and keeps public API calls live.
Authenticated GraphQL calls are answered by a mock in the test, so tests never change a real lineup or place a real bid.
The waiver tests use a stand-in Players tab whose W and ADD buttons carry React-style props, plus a document listener standing in for Sleeper's own handler, which must never fire.
The Lock-In test fakes a mid-week state (each team's first game finished, projections standing in for stats, every later game moved to still come), since nothing is lockable before games are played.
Screenshots land in `test-results/`.
