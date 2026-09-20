# Team Analytics · NAIA Soccer Dashboard (client-side, Chart.js + PapaParse)

A self-hosted analytics dashboard for an NAIA soccer team. You drag in
two files — the team's **Roster** and its **Coach's View** season
stats — and it turns them into an interactive web report: scoring
leaders, team vs. opponent production, shots-to-goals efficiency, a
searchable roster with player profiles, and auto-generated insights.
No database, no backend processing — everything is parsed and
calculated live in the browser.

**🔗 Live demo:** [https://soccer-analytics-dashboard.onrender.com](https://soccer-analytics-dashboard.onrender.com)

This is a static HTML/CSS/JS template. Nothing is hardcoded or bundled
in: the CSV or PDF files you upload are read and parsed entirely
client-side with PapaParse (CSV) and pdf.js (PDF), and every chart,
KPI, and roster entry is recalculated on the spot with plain
JavaScript — nothing is sent to a server.

## Run

Just open the link: **[https://soccer-analytics-dashboard.onrender.com](https://soccer-analytics-dashboard.onrender.com)**

Or run it locally:

```bash
python3 app.py        # serves on http://localhost:8000 and opens it in your browser
# or, to use a different port:
python3 app.py 5500
```

Then open the page and drag in your team's files (see **Add your
data** below). You can also open `index.html` directly in a browser,
though some browsers restrict local file access for CSV/PDF reads, so
the small Python server is the more reliable option.

## Add your data

The dashboard doesn't ship with any bundled team data — you upload it
yourself, straight from the browser:

1. Open the app. You'll see two upload buttons: **Insert Roster** and
   **Insert Coach's View**.
2. Get both files from the team's official stats page. NAIA teams are
   almost always hosted on **PrestoSports/Sidearm**
   (`https://<conference>.prestosports.com/sports/msoc/<season>/teams/<school>`),
   which every conference (Heart of America, KCAC, etc.) uses the same
   layout for:
   - **Roster** — jersey number, name, class year (Fr/So/Jr/Sr/Gr),
     and position for every player. Use the CSV export if the site
     offers one; otherwise upload the Roster PDF directly.
   - **Coach's View** — the season statistics table's **"Print
     Version"** link. This is the richest source: per-player games,
     goals, assists, points, shots, shot %, shots on goal, plus team
     record, opponent totals, and goalkeeper stats.
3. Upload them in either order, and mix formats freely (e.g. Roster as
   PDF, Coach's View as CSV) — the app merges the two by matching
   player names.
4. Each file is parsed and validated the moment you drop it. If a CSV
   is missing a required column, or a PDF's table can't be recognized,
   you get a plain-English error and nothing on the page changes.
5. From then on every chart, KPI, and the roster sidebar read straight
   from what you loaded. To update it, just upload a new file — no
   reload needed, everything recalculates instantly.

### CSV format — the details that matter

If you'd rather build a plain CSV yourself (e.g. by copying a stats
table into a spreadsheet) instead of using the site's PDF, both files
follow the same rules:

- **Header row required**, comma-separated, with the exact column
  names below (case-sensitive).
- **Roster CSV** needs: `#`, `Name`, `Yr`, `Pos`. Optional but
  recommended: `gp`, `g/g`, `a/g`, `pts/g` (used to fill in per-player
  points if the Coach's View file doesn't cover every player).
- **Coach's View CSV** needs: `Name`, `Yr`, `Pos`, `gp`, `g/g`, `a/g`.
  Optional: `#`, `gs`, `pts/g`.
- **`g/g` and `a/g` are per-game averages** (goals/game, assists/game),
  not season totals — the app multiplies them by `gp` (games played)
  and rounds to get season goals/assists. This matches exactly how
  PrestoSports stat pages report them.
- **Plain CSV has no shots data.** Without a `sh`, `sog`, team record,
  or opponent columns, the "Shots vs. goals" and "Team vs. Opponents"
  panels will have less to show — only the **PDF Print Version**
  includes those.
- **Blank/missing cells default to 0** for numeric columns, and a
  missing `Pos` defaults to `?` — you don't need to clean those out by
  hand.
- **Player names must match between the two files** (case- and
  accent-insensitive) for the Roster and Coach's View data to merge
  into one profile per player.

## Structure

```
.
├── index.html
├── styles.css
├── script.js
├── app.py
└── vendor/
    ├── chart.umd.js
    └── papaparse.min.js
```

- `index.html` loads Chart.js and PapaParse from `vendor/chart.umd.js`
  and `vendor/papaparse.min.js` — rename `chart_umd.js` →
  `chart.umd.js` and `papaparse_min.js` → `papaparse.min.js` if you're
  setting the repo up from scratch. PDF parsing (`pdf.js`) is loaded
  from a CDN, so uploading a PDF requires an internet connection.
- `app.py` is only for local testing — it's a zero-dependency static
  file server. It isn't used when deployed on Render; Render serves
  the static files directly.
- All state lives in the browser tab. Nothing is written to disk and
  nothing persists between page reloads — uploading a fresh file is
  the only way to change what's shown.

## Deploying to Render

1. Push the repo (including the renamed `vendor/` files) to GitHub.
2. On [render.com](https://render.com), click **New → Static Site**
   and connect the repo.
3. **Build Command:** leave empty. **Publish Directory:** `.`
4. Click **Create Static Site**. Render gives you a URL like
   `https://<your-app>.onrender.com` — update the **Live demo** link
   at the top of this file with it.
