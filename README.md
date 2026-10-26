# Sleeper Chrome Extension (unofficial)

> [!WARNING]
> **This is an UNOFFICIAL extension.**
> It is not made, endorsed or supported by Sleeper, and is not affiliated with Sleeper in any way.
> It uses the same endpoints as Sleeper's own apps, which can change or break without notice.
> For help with Sleeper itself, contact Sleeper; for this extension, open an issue here.

Chrome extension (MV3) that fills in what Sleeper's website leaves out, across sports.

## Privacy

Everything runs locally in your browser.
There is no server: the extension only talks to Sleeper, the same way Sleeper's own site does.
It calls `api.sleeper.app` and `sleeper.com` for league data, and loads player headshots, team logos and avatars from Sleeper's image CDN (`sleepercdn.com`).
No data is sent to the author or any third party, we never see your data.

## Install

1. Clone the repo: `git clone https://github.com/louhow/sleeper-chrome-extension.git`
2. Open `chrome://extensions` and turn on Developer mode.
3. Click "Load unpacked" and pick the cloned directory.
4. Visit your league on `https://sleeper.com` while logged in (for NBA, the `/team` or `/matchup` tab).

To update, `git pull`, hit the reload icon on the extension card, and refresh the Sleeper tab.

## Features

**NBA**
- Team tab: roster, weekly game strips that show what's locked, still lockable (only games the player started) or past locking, tinted by score (lock right from the cell), projections, lineup swaps, taxi and IR moves, draft picks.
- Matchup tab: both lineups slot by slot, win probability, Lock-In status.
- League tab: every matchup of the week, styled like the Matchup tab; click one to open it, or a team to see its roster.
- League median, in leagues that play one: the week's median score (now and projected) at the top of the League tab, and a medallion on every team over it now, solid once it's likely to stay over and gold once it's won.
- Points and projections follow the games: the week's stats are read again while a game is on.
- Sidebar: each NBA league shows your matchup this week under its name (both teams, points and projections), as Sleeper does for NFL.
- Team picker: every team with its avatar, A to Z, a "My team" shortcut, and team links from the Matchup and League tabs; on the Matchup tab it picks a matchup (both teams).
- Optimize lineup: recommends which finished games to lock in and the best starters for the next day of games, slot by slot in your lineup's order; apply one row or all of them.
- Waiver bids and free-agent adds from Sleeper's own W and ADD buttons, plus your pending claims.
- Players tab: remembers your last view; a week strip per player (games played in their score's color, games left, scores on hover); a team picker to scan any roster; team avatars on rostered players; in Stats, a week's Avg (with games played) / Best / Worst game and an optional Shooting group (FGM, FGA, 3PA, FTM, FTA).
- Player card: bio, game logs, career, news, transaction history.
- Admin tools (off unless `?snp-admin=1`): what-if scoring on the Team and Matchup tabs and player card, adminFPTS and adminDelta columns on the Players tab.

**NFL**
- Team tab, compact like the NBA one: a row per player (game, live clock and score, stat line, start and rostered %, points in their score color), any team from the picker, lineup swaps from the slot badges, Optimize lineup in the toolbar. Sleeper's own tab is a click away (⇄). A player's name opens Sleeper's player card.
- Matchup tab: the League tab's matchup card on top (a team opens on the Team tab), both lineups slot by slot with the game and box score under each player, muted as on Sleeper's own tab; the picker picks a matchup.
- Optimize lineup, slot by slot like the NBA one; apply one row or all of them.
- League tab matchups drawn like the NBA ones, with Sleeper's own live numbers.
- League median on the League tab and medallions on the Matchup and League tabs, as on NBA.
- Chopped leagues:
  - League tab: the Chopping Block as Sleeper's app shows it (your safe %, every team in the chop zone, danger or safe) and the Graveyard, with halos and devil's horns.
  - Team tab: avg points, FAAB and safe % on the team card.
  - Players tab: a red axe on each chopped player still on waivers; the Chopped filter shows only those, as the app does.
- Players tab: a Last 5 column (the last five weeks played, a mark each in its score's color, scores on hover; sorts by points per game), a team picker, team avatars on rostered players.

**Premier League (EPL)**
- Match, Team, Players and League tabs in place of Sleeper's "not supported on web yet" page.
- Lineup swaps with formations, IR moves, Optimize lineup.
- Free-agent adds, waiver bids and drops.
- Player card with next match, projections, game log, career and history.

**All sports**
- Score colors (green, yellow, red) from the league's own games: the thirds of its starters' recent scores, per position in NFL.
- Each league opens on the tab you were last on in it when you switch leagues in the sidebar.
- Settings: the gear in Sleeper's sidebar opens the extension's settings (a switch for the NFL pages and tools, so Sleeper's own show instead), with Sleeper's account settings a button away.
- Chat: hovering a message's emoji reactions no longer shifts the chat around, and who reacted shows in full.
- API tab: a log of every call the extension makes, with status, timing, size and a JSON preview.

Details: [docs/DETAILS.md](docs/DETAILS.md) (NBA and NFL) and [docs/EPL.md](docs/EPL.md) (Premier League).

## License

[MIT](LICENSE)
