# Details

How the extension works: what it shows, the Sleeper API calls it makes, and how to run the tests.

## What it shows

### Team

- Team card: avatar, record, this week's points, Lock-In projection, opponent.
  Points are Sleeper's running total, added up from your lineup as Sleeper does (each starter's locked game, else their latest finished one), because the public matchup Sleeper serves is cached for minutes and lags a lineup change. Sleeper's leg points, or a commissioner's custom points, win when set.
- Starters, bench, injured reserve and taxi squad, each player with a Monday-Sunday strip of games: projected points (actual once played), opponent, tip-off time.
- Each game cell shows where the game stands under Lock-In:

  | State | Looks like |
  | --- | --- |
  | Locked in | Bright gold frame around its score's color, gold padlock and "Final" |
  | Finished, can still be locked (a starter who was starting at tip-off, before their next tip-off) | Bright teal outline, open padlock |
  | Finished, may be lockable (the extension didn't see your lineup at tip-off) | Dashed teal outline, open padlock |
  | Finished, too late to lock, played on your bench, or a bench player's | Faded, no outline |
  | Live | Red outline, "Live" |
  | Today, still to tip off | Bright outline, bold time |
  | Later in the week | Quiet outline, projection muted |

- A game played is tinted, muted, by its score's color (see [Score colors](#score-colors)); a locked one is filled bright in that color inside its gold frame.
- The points column shows a locked-in score once, boxed like its day cell (the same height, its score's color in a gold frame, a padlock under the score), in yellow, so it reads apart from a score still in play.
- Lock-In from the strip, on your own lineup in season: hovering a lockable game asks "Lock?"; clicking it asks to confirm in the cell ("Lock 30.95?" Yes / No, Esc cancels), and Yes saves the lock (`update_matchup_leg`, as on the Matchup tab).
- Lock-In needs the player starting when the game tipped off and never benched since. Sleeper's own wording (in its app's strings): "Player was not in starting lineup OR was moved to bench since game began". A game played on the bench can't be locked after moving them in, nor one whose player was benched and started again.
  Sleeper keeps no lineup history, so the extension remembers your lineups as it reads them, in the browser's extension storage: the current week only (earlier weeks are deleted), at most 100 lineup changes.
  It reads your leg on each load and after each save, plus once 5 minutes after each tip-off time of your players' games (games tipping off together share the read), only while the tab is visible; a read missed while it was hidden happens when it comes back, if the game is still on. Reads are never closer than a minute apart.
  Sleeper won't move a player whose game is on, so a lineup seen in the two hours after tip-off settles it; so does the same lineup seen before and after.
  A game it saw them starting for is lockable; one it saw them benched for isn't; anything else is a maybe, still lockable from the strip, with a title saying it depends on whether they started.
  Optimize only recommends locks it's sure of; a maybe shows in its row ("lockable if started"), and benching that player says "May drop lock-in".
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

- Rows: one per starting slot, in your lineup's order, so changes read against the lineup you know. They're compact so a full lineup fits on screen without scrolling.
  - A change leads with who comes in (name in blue), so the Starting column reads as the new lineup top to bottom; who they replace sits beside them in the Replaces column, faded, with an Apply button.
    The player going out says where and why ("To bench · no game Sat · 31.91/g") and, when they have a finished game that could still be locked, the score they drop ("Drops lock-in 16.50 Wed vs GSW").
    The one coming in says where from and their next game ("From bench · Sat @ CHI 7:00pm").
    Their headshots carry substitution marks, as soccer apps show them: a green arrow up coming in, a red arrow down going out (the NFL dialog too).
    Its two options are spelled out: "Apply change", and, when the one going out has a finished game that could still be locked, "Lock current", which keeps them in the lineup and locks it (its tooltip names the score, and says when it depends on them having started); the dialog stays open on the plan around the lock.
  - A finished game worth locking shows its score, the open value and when the window closes, with a Lock button.
  - A slot that stays is dimmed and says why: "No change", "Locked" (with the locked score), "Playing" or "Empty".
- Applying one row saves just that slot and keeps the dialog open on the plan from the new lineup, with a note saying what saved.
  When moves tie slots together (the player coming in leaves another starting slot, or the one going out takes one), they apply together, and the button says which ("with SF").
  Lock saves only that lock, on the lineup as it stands.

- It picks for the next day of games, since Lock-In lineups can change daily: a starter with no game that day can sit for someone who plays, and come back for their next game.
  Run it again each game day.
- Worth: a player's projection for that day (0 with no game). Out games project 0, so injuries count.
- Open value: what leaving a starter's slot open is worth, from their projections for the games left.
  A lock shuts the slot for the rest of the week, to the bench too, so a player the best lineup leaves on the bench who fits the slot counts when they're worth more ("open 31.91 with L. Dončić").
  The week's last game counts unless an earlier one gets locked, and a game is worth locking when it beats what the games after it are worth.
  Each game's points are taken to spread about 35% of the projection either way (a normal distribution), so two games left are worth more than either alone.
- A starter with a finished game that can still be locked, scoring more than the open value, is worth that score.
- A starter with no games left is worth their final game's score: with no lock, the week's final game counts, so kept, their slot scores it (unless the extension knows they played it on the bench). So a starter who's done for the week isn't benched for a smaller projection.
- Lock in: such a starter is recommended for locking when the best lineup keeps them and they have a game left (with none, the last game counts anyway).
  Each recommendation shows the score, the open value and when the window closes (their next tip-off).
  "Keep open" leaves it out and keeps the player in the lineup, so the score can still be locked later; the rest of the plan is worked out again. "Lock instead" brings it back.
  A player being locked keeps their slot, and the lineup is worked out around them.
- Starters whose finished game can be locked but isn't worth it yet show the score and the open value in their row ("16.50 Wed vs MIL · open 31.91"), with no action.
- Slots no one can fill that day go to the players with the most projected points per game left this week.
- Lineup: tries every way to fit the movable players into the starting slots and keeps the highest total, so scarce slots go to the players who can only fill them. Ties keep the most players where they are, then put players in their most specific slot.
- Locked-in players and players in a game right now stay put.
- Losses: benching a starter whose finished game was worth locking (or green) gives that score up (bench players can't lock in). The row turns yellow ("Drops lock-in 12.42 Tue vs OKC") with a yellow note at the top; Apply still works.
- Green scores (see [Score colors](#score-colors)): giving one up turns the row red, explains it at the top, and keeps that row's Apply and Apply all ("Apply all and lose N pts") disabled until you tick "Bench … anyway".
- Scores in the dialog are colored by tier, like the game log.
- Every apply works the plan out again first; if a game tipped off meanwhile and the plan changed, it shows the new plan instead of saving.
- Apply all: with locks, the lineup and the locks save together in one `update_matchup_leg` (the button says "Lock in N games and apply all"); locks are final.
  Without, the lineup saves in one `update_matchup_leg` (in season) or `roster_update_starters`, leaving Lock-In picks untouched.
- The top of the dialog shows the starters' projected points for that day now and after the changes; each row shows that day's projection and points per game left.
- The dialog's "How it picks" label sums these rules up in a few lines on hover or focus.
- Clicking a player in the dialog opens their player card over it; closing the card returns to the dialog.

### Score colors

Every fantasy score the extension colors (day cells, game logs, the Players tab's marks, Optimize) is green, yellow or red by the league's own games, not fixed numbers:

- The samples: the games the league's starters played in the weeks just finished (latest first), scored with the league's settings. Early in a season, last season's weeks (`previous_league_id`) fill in, rescored with this season's settings.
- The lines: the top third of those games is green, the bottom third red, the rest yellow.
- How many: weeks are added until there are at least 300 games (NFL: and 40 at every position), at most 8 weeks.
- NFL: each position gets its own thirds (a tight end's 10 is a good game, a quarterback's isn't); NBA leagues pool everyone, as Sleeper's app does.
- Worked out once a week per league (kept in the extension's storage until a week finishes or the scoring changes), from `/v1/league/<id>/matchups/<week>` (who started) and `/stats/<sport>/<season>/<week>` (their games).
- What-if scoring doesn't move the lines: they stay the league's.

Why thirds: Sleeper's apps use fixed numbers, and the thirds land on them for leagues scored the way Sleeper assumed.

| Where | Sleeper's numbers | Thirds of a real league's starters |
| --- | --- | --- |
| NBA, every game (mobile app score log) | 15 / 24 | 16.5 / 24.0 |
| NFL QB, half-PPR (web game log, standard and PPR only) | 13 / 19 | 13.1 / 20.6 |
| NFL RB | 8-10 / 13-14 | 7.1 / 14.7 |
| NFL WR | 8-10 / 13-15 | 6.0 / 12.3 |
| NFL TE | 5-6 / 8-9 | 4.3 / 10.5 |

Sleeper's web player card colors only standard and full-PPR points (`pts_std`, `pts_ppr`), so a half-PPR or custom league's fantasy points get no color there; thirds work for any scoring.

### Matchup

- Both teams side by side: points, projection, win probability, record and standings rank, and how many starters are yet to play.
- Each starter against the opposing starter in the same slot, then bench, IR and taxi.
- Per player: the game that matters for Lock-In (the locked game, the one that can be locked, or the next one), its points or projection, and team logos for the week's games.
- Lock-In for your own starters: once a game ends, `LOCK-IN` stays open until that player's next game starts, if they were starting when it tipped off (see the Team tab). Locking is final, so it asks to confirm.
- Team totals are Sleeper's running total, added up from the leg's lineup as on the Team tab.
- The projection is added up the same way: each starter's locked game, else the final game of their week, played or projected. Sleeper's own leg projection (`proj_points`) is set before the week and never moves, so it isn't used. Where Sleeper's total counts what the extension can't see (logged out, locks are unknown), the projection moves by the same amount.
- While a game of the current week is on, its stats, projections and games are read again every 90 seconds (only while the tab is visible and on the Team, Matchup or League tab), as on NFL; otherwise a minute after the next tip-off.
- Switching leagues in the sidebar (any sport) opens each league on the tab you were last on in it, where Sleeper would open its League tab; the last tab per league is kept in the page's storage. A league you haven't been on yet opens where Sleeper sends it, except an NBA league from a Matchup tab, which opens on its Matchup tab.

### Team picker

- The toolbar's team picker shows every team with its avatar, name and owner, A to Z (yours marked "you"); the pick is kept for next time.
- While you're looking at someone else's team, a "My team" button beside it goes back to yours in one click.
- The arrow up and down keys go through every team in the picker's order, yours included, and stop at the first and the last (not while typing).
- On the Matchup tab the picker picks a matchup instead: the week's matchups, both teams each with its avatar and name (yours first, then A to Z), the team shown on the left; "My matchup" goes back to yours, and the arrow keys go through the matchups and stop at the ends.
- On the Matchup tab, and on the League tab's matchups, a team's avatar, owner or name opens it on the Team tab (just for now: the picker's choice stays).

### League

- Above Sleeper's own League tab content (which stays), the week's matchups, every one in the league, yours first and framed: each is the Matchup tab's header for that pair (avatars, scores, win chance, record and rank, starters yet to play, projection), with the same week picker.
- The cards are a compact take on that header, so a 14-team league's 7 matchups fit in the tab without scrolling.
- Clicking a matchup opens it on the Matchup tab, that team on the left, through Sleeper's own MATCHUP tab; clicking a team's avatar, owner or name opens that team on the Team tab.

### League median

In a league that plays the median (`settings.league_average_match`), every regular-season week each team also plays the league's median score: the top half of the league wins it, an extra win.
Sleeper's website doesn't show it; the extension does, on NBA and NFL alike.

- At the top of the League tab, as in Sleeper's app: "League Median" with its score so far (– before any team has points), its projection, and how many teams win it ("Top 7 of 14 win").
- Every team over the median now wears an M medallion on its avatar, on the League tab's matchups and the Matchup tab's, so you can see at a glance who is winning it.
  It's outlined while the team is over, solid once it's likely to stay over (a 75% or better chance of finishing over, by the same win formula as the matchups, against the median's score and projection), and gold and lit once it's won (every game of the week settled). Hovering it gives the chance.
- The median is the middle of every team's score that week (the mean of the middle two for an even count); a team without points yet counts as 0. The projection is the middle of every team's projection.
- Not in the playoffs (from `playoff_week_start`), and not at all in a league without the median.
- On NFL's League tab the numbers are Sleeper's own, read off its cards, and the week is the one Sleeper's week picker shows.

### Sidebar

Sleeper's left sidebar shows an NFL league's matchup under its name (both team names, then each side's points and projection) but an NBA league only its format ("2026 14-Team Dynasty Standard").
The extension gives every NBA league there the same lines for your matchup this week, in Sleeper's own markup, so they look exactly like the NFL ones (the format line makes way).

- The numbers are the Matchup tab's: points so far (– until there are any) and projection, added up the same way.
- The league you're on gives its own numbers, so the sidebar always matches its tabs.
  Any other NBA league is loaded once for the sidebar (the league, its rosters and users, the week's matchups, projections, stats and games, and your matchup legs), then again only after a game has tipped off since, at most every 10 minutes while the tab is visible.
- Logged out, or without a team in the league, the sidebar stays as Sleeper has it.

Win probability is Sleeper's own formula, ported from its web app: each side is a normal distribution centred on its projection, narrowing as the score approaches it.
Once both sides are settled (score equals projection) the score decides it, and a tie is 50% each, where Sleeper's formula gives 0% to both.
Rank comes from `roster_standings`; before any games are played, it falls back to the standings order (record, points, then waiver order), which is what Sleeper shows then.

### Players tab

Sleeper's own NBA Players table, with these additions:

- No layout shift: the table stays hidden (its space kept) until the view you had is restored and loaded and the added columns, their sizes and the week's data are in, then shows once. Other sports show right away; after 5 seconds it shows whatever happens.

- It opens on the view you last had on, per league: Projection or Stats, the season or week, Avg / Best / Worst, Shooting and the team picked (kept in the page's storage).
  A week that was the current one comes back as the current one, so when a new week starts it opens on that; any other week, or the season, comes back as it was.
  The first time, it opens on Projection for the current week (Sleeper's own current week).
  It loads the view the way Sleeper's own dropdowns do.
- Sleeper's week dropdown reads the week shown: on its own it shows the season ("2026") on load even with a week picked, because its option values are numbers and the value it starts with is a string.
- Week: with a week picked (Projection or Stats, not the season), a column after FPTS (and GP) with a mark a day, Monday to Sunday, from each team's schedule.
  A game played wears its score's color (see [Score colors](#score-colors); dim gray when they didn't play); in the game log's muted tones; bright red is a game on now, light gray one still to play, faint no game.
  Hovering a mark shows a card: the game, its score (or tip-off time), and how many games are left; sorting by the column sorts by games left.
  The schedule is the week's GraphQL `scores` (already loaded for the Team tab's week, else one query per week); the scores come from the week's stat rows, which Best and Worst already load.
- Team picker: beside Find player, every league team with its avatar and name (All teams first); picking one narrows the list to that team's players through Sleeper's own owner filter (the one in its filter section), so the Week strip scans a whole roster. With a team picked, arrow up and down go through the teams, stopping at the first and the last (not while typing in Find player). Ticking Free agents lets the pick go. It's remembered with the rest of the view.
- With more columns than Sleeper's 9 they narrow to fit, the labels center, and each value sits right under its label (Sleeper's own rows only line up at its 60px width); the name area gets 12px more.
- Rostered players' owner line shows the team's avatar (or initial) and team name, in place of Sleeper's arrow and username.
- Shooting: a small + at the end of the column header (−, filled, while on), in Stats only, off until pressed: FGM, FGA, 3PA, FTM and FTA at the end of the table. It stays out of Sleeper's filter row, which has no room to spare.
  They don't score in the league, so they're dimmed.
  Sleeper's stats already carry them; they go into its table component as stat keys, so they sort from their headers like its own columns.
- Avg / Best / Worst: in Stats with a week picked (not the season), a switch in the table's top-left corner, centered on the header labels' text. The pick stays when you switch to Projection and back.
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
- Game logs per season (tabs): projected and actual fantasy points with the league's scoring, minutes, box score and shooting, shaded like Sleeper's tables. Fantasy points are colored by [score tier](#score-colors). The current season lists upcoming games with projections.
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
The value is Sleeper's FPTS plus the changed settings scored on their own (`snp:admin-scores`, answered by the extension), so it never drifts from Sleeper's number; the rank shifts come back with it (`model.adminDeltas`, through `model.rankShift`).

### NFL: Team and Matchup tabs

The extension's own Team and Matchup tabs take the place of Sleeper's, laid out like the NBA ones.
Sleeper's own tab stays on the page, hidden: its Team component saves lineups and feeds Optimize lineup.
The ⇄ button shows Sleeper's tab instead (remembered in the page's storage), and "⇄ Compact view" beside Sleeper's tab row comes back.

- Team: the team card (avatar, record, opponent, points, live projection, week picker), then starters slot by slot, bench (by position), IR and taxi.
  Points read – until a starter's game kicks off, as on NBA; IR and taxi keep a row per league slot, open ones included, so the page holds its shape.
  Each row: slot, headshot, name, position and team, injury, start and rostered %; the game (opponent, kickoff, or the clock and score while it's on, or the final), the stat line; points, in their [score color](#score-colors) once the game is over, and the projection.
- Any team from the picker (A to Z, with avatars), remembered for next time; the arrow keys go through them (just for now, as on NBA) and stop at the ends. The picker's menu closes on a click anywhere else.
- Sleeper's own tab is hidden as soon as the league is known to be NFL, and ours stays blank until its first load is in, as on the NBA tabs, so nothing shifts.
- Your own lineup, for the week Sleeper's Team tab shows: tap a slot badge, then one of the highlighted players. Players whose game has kicked off stay put, as Sleeper locks them. Saves go through Sleeper's own Team component (`updateMatchupLeg`), as Optimize's do.
- Optimize lineup sits in the toolbar, as on the NBA Team tab, and opens the same dialog.
- A player's name or headshot (Team and Matchup tabs) opens Sleeper's own player card, the one its Players tab shows.
  Sleeper builds that card in its own handlers (the Team component's `_onClickPlayerNews`, a Matchup row's click) and hands it to `openModal`; page-hook runs one of them with `openModal` caught, then opens the card it got for the player asked for.
  A Matchup row knows only that matchup's players, so the extension sends the player's name, position and team along; Sleeper's card loads the rest.
- On the Matchup tab, a team's avatar, owner or name opens it on the Team tab (just for now: the picker's choice stays), as on NBA.
- Live games show Sleeper's RZ mark when the player's team has the ball inside the 20.
- Matchup: the League tab's matchup card on top (avatars, scores, win chance and bar, record, projection), then both lineups slot by slot, bench, IR and taxi (as many rows as the league has slots). The picker picks a matchup (both teams), as on the NBA Matchup tab.
- Points are Sleeper's stats scored with the league's settings; the live projection is what's scored plus the projection for the game time left. Win chance is Sleeper's own formula (see the League tab).
- The data: `/v1/league/<id>/matchups/<week>` (logged in, `matchup_legs`) for who's starting, `/projections/nfl/<season>/<week>` and `/stats/nfl/<season>/<week>` for players, projections and points, GraphQL `scores` for each game, `/players/nfl/research/...` for start and rostered %.
  While a game of the current week is on, stats and games are read again every 90 seconds (only while the tab is visible); otherwise once the next kickoff comes.

### NFL: League tab

- The week's matchups drawn as the NBA League tab draws them (yours first and framed; avatars, owners, team names, scores, win chance and bar, record, projection), in place of Sleeper's own cards.
- The numbers are Sleeper's own: its cards stay on the page, hidden, and the extension reads them as they update during games, so they always match the rest of Sleeper.
- Clicking a matchup opens it the way Sleeper's own card does. Sleeper's week picker and the rest of the tab (standings, activity) stay as they are.
- In a league that plays the median, its banner comes first and every team over it wears a medallion (see League median).

### NFL: Chopped leagues

A chopped league (Sleeper's "guillotine", `settings.type` 3) eliminates its lowest scoring team each week and drops that roster to waivers.
Sleeper's web app has no Matchup tab for one and its standings are all 0-0, so the League tab shows what Sleeper's app shows instead, in place of the standings (Recent Activity stays below):

- Your team: its rank among the teams still alive ("3rd of 12"), points per week played, FAAB left, points and projection, and its safe chance with a bar. A chopped team says "Chopped · wk 6" instead.
- Chopping Block, for the week on now: every team still alive, worst first, ranked by live projection, under Sleeper's app's headers: the last team in the Chop zone, the three above it in Danger, the rest Safe. Each shows its safe chance, starters played ("7/8"), points and projection. A team opens on the Team tab.
- Safe % is the chance of not finishing the week last: each team's final score is a normal distribution around its live projection, as in Sleeper's win chance (tighter as its score nears the projection), and a team's chance of being last is summed over every score it could finish on. Once every game is over, the score decides it.
- Graveyard: every chopped team, latest first, with the week, FAAB left and points per week played.
- The week's numbers are the NFL Team tab's (the same loads), read again during games while the League tab is on screen.
- On the Team tab, the team card shows what Sleeper's app shows in place of the record (always 0-0) and opponent (there is none): points per week played and FAAB left ("110.55 avg fpts · $61 faab"), then, for the week on now, the safe chance and its bar. A chopped team's card says "Chopped · wk 6".
- On the Players tab, a red axe after a player's name marks each player the latest chop dropped who no one has picked up since, as Sleeper's app marks them (hover: "Chopped in week 6: on waivers"). Who that is comes from Sleeper's own Players panel, the list its Chopped filter shows, so it costs no extra calls.

### NFL: Players tab

Sleeper's own NFL Players table, with these additions (the same hooks as the NBA Players tab):

- Last 5: a column after FPTS with a mark a week for the last five weeks played, through the week picked (the season: through the current week).
  The week on now counts once a game in it has kicked off; before that, the five weeks before it.
  A week played wears its score's color by the league's scoring and the player's position (see [Score colors](#score-colors)); gray when they didn't play, faint for a bye, bright red for a game on now, light gray for one still to come.
  Hovering a mark shows the week, the opponent (from Sleeper's own schedule) and the score, with points per game over those weeks; sorting by the column sorts by that.
  The scores come from `/stats/nfl/<season>/<week>` (finished weeks once per page load, the week on now every two minutes at most) and, for the week on now, GraphQL `scores` for where each game stands.
- Sleeper's group headers (Fantasy, Rushing, Receiving, Passing) move with the columns, centered over their own.
- Sleeper's red-zone mark (RZ) sits at the end of the game line: Sleeper's own styles drop it onto a line of its own, the width of the name area, which spills out of the row.
  Team lines take Sleeper's 12px (the NFL rows have a game line too), so a rostered player's four lines fit the row.
- The team picker and team lines of the NBA Players tab: every league team with its avatar, narrowing the list to one team through Sleeper's owner filter, arrow keys through the teams (stopping at the ends), and each rostered player's team avatar and name.
- The view you last had on comes back, as on the NBA Players tab.

### NFL: Optimize lineup

**Optimize lineup** sits in the compact Team tab's toolbar; on Sleeper's own Team tab (⇄) it's an **OPTIMIZE** button left of Sleeper's WAIVER and TRADE buttons (it reuses their classes, so it looks like them).
It opens the same dialog as the NBA version, with no warnings to tick through: one row per starting slot in lineup order, a change leading with who comes in beside who they replace, each with an Apply button (slots tied together apply together; the dialog stays open on what's left), slots that stay dimmed ("No change", "Started"), and Apply all.

- Worth: Sleeper's projection for this week's game, scored with the league's settings (the same number the Team tab shows). A bye week or a player ruled Out (Out, IR, PUP, Sus, NA) is worth 0.
- Lineup: the same solver as NBA, with Sleeper's NFL slot rules (FLEX takes RB/WR/TE, WRRB_FLEX RB/WR, REC_FLEX WR/TE, SUPER_FLEX QB/RB/WR/TE, IDP_FLEX DL/LB/DB, every other slot its own position). Ties keep the most players where they are.
- Players whose team has kicked off stay put, as Sleeper locks them.
- Questionable and Doubtful players can start; when one moves into the lineup their row is flagged ("Questionable: check the news") with a note at the top.
- Every apply works the plan out again first, then saves through Sleeper's own Team component (`updateMatchupLeg` once the draft is done until the league is complete, `roster_update_starters` otherwise, as its `_updateRoster` does: `model.lineupOnLeg`, which the NBA saves follow too), so Sleeper's screen updates as if you'd made the swaps.
- A player's name or headshot in the dialog opens Sleeper's own player card, as on the compact tabs.
- The save notice shows in the compact tab when it's on screen, else under the dialog's layer; never both.

How it hooks in: `src/page-hook.js` reads the lineup from Sleeper's Team component props (slots and starters as shown, roster, players, `hasTeamPlayedMap`) and each row's projection (`proj` stats and `scoringSettings`), and answers the extension's `snp:nfl-lineup` ask synchronously.

### Chat reactions

Sleeper's chat (any page) keeps every emoji option in a message's reaction row, the unused ones at width 0, and widens them all while the row is hovered.
That moves the emoji under the cursor (an option before it opens up) and makes the message a line or two taller; the chat, pinned to its bottom, then scrolls by that much once the names popup re-renders it.
The popup itself sits inside its message, which clips it, and cuts names at 64px.

- An open row is an overlay instead: from where it sits, the emoji already picked first and where they were, the rest in rows below, over whatever is under the message (the next message), which keeps its height. Nothing on the page moves and the chat never scrolls.
- The chat's last message has no room below in the chat, so its rows are pinned to the screen there and go on below, over the box you type in; only without room in the window either do they go above.
- It stays open while Sleeper itself shows every option (for a moment after the cursor leaves an emoji, with or without names). Let go then, Sleeper's own wide row would come back in place under the cursor and open it again, over and over.
- Widths change at once and only the pop-in animates, so closing doesn't reflow either.
- Who reacted shows above the emoji, outside the message, as wide as the names.
- It's all one stylesheet switched on by `data-snp-chat` on `<html>`, plus a hover handler that holds the row's height while it's open (`src/chat.js`).

### How the extension and page-hook talk

`src/page-hook.js` runs in the page's own world (only there can it read React props); the rest runs in the extension's.
They share only the DOM, so every message is a `CustomEvent` on `document`, named `snp:*`, with JSON in `detail`.
Both sides use the same small helper, `src/bridge.js`.
Chrome injects a file once per frame, so `page-hook.js` carries a copy of its code, and `test/unit/bridge.test.js` fails if the two differ:

| Helper | How | Used for |
| --- | --- | --- |
| `ask` / `answer` | `<name>-request`, answered with `<name>` before `dispatchEvent` returns | `snp:nfl-lineup`, `snp:nfl-league`, `snp:nav-leagues`, `snp:week-games`, `snp:week-schedule`, `snp:recent-weeks`, `snp:admin-scores` |
| `call` / `answerLater` | the request carries an `id` the answer echoes, so concurrent calls never take each other's answer | `snp:nfl-lineup-save` |
| `tell` / `on` | one-way | `snp:player-action`, `snp:player-card`, `snp:nfl-player-card`, `snp:nfl-league-open`, `snp:admin-scoring`, `snp:players-ready`, `snp:week-games-ready` |

`snp:nav-leagues` marks each sidebar league link with its league id and sport (`data-snp-league`, `data-snp-sport`) and lists them.
`snp:players-ready` says the extension has a league's Players-tab data (NBA or NFL); page-hook adds no columns before it.
`snp:week-games-ready` says a week the extension was loading is in, so page-hook asks again.

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
- `matchup_legs(league_id, round)`: the week's saved lineup, Sleeper's own points and Lock-In picks (`starters_games`, shown with a lock).
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
