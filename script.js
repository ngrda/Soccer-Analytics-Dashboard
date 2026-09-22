/* =========================================================
   SOCCER DASHBOARD
   There is no sample data: everything comes from the CSV or
   PDF the user uploads.

   Tab structure:
     OVERVIEW | INSIGHTS
========================================================= */


/* =========================================================
   CONFIG
========================================================= */

const POS_COLOR = { GK:"#6f9bd1", D:"#83a888", MF:"#cda868", F:"#bd8494", "?":"#8b93a3" };
const YEAR_LABEL = { Fr:"Freshman", So:"Sophomore", Jr:"Junior", Sr:"Senior", Gr:"Graduate", "?":"Unknown" };


/* =========================================================
   STATE
========================================================= */

let players = [];          // per-player stats (offense)
let rosterPlayers = [];    // metadata loaded separately from the Roster PDF
let goalkeepers = [];       // per-goalkeeper stats, PDF only
let teamRecord = null;      // {overall,home,away,neutral,conf}, PDF only
let opponent = null;        // aggregated opponent totals, PDF only
let teamName = "Team";

let teamGoals = 0;
let teamAssists = 0;
let teamShots = 0;
let teamSOG = 0;
let matchesPlayed = 0;

let selected = null;        // currently selected player (roster click)
let activeTab = "overview";

// Chart instances — declared up front so build*() can destroy() safely.
let chartScorers = null;
let chartEff = null;
let chartCompare = null;
let chartShotsGoals = null;
let chartModal = null; // chart inside the "see all players" modal


/* =========================================================
   RESIZEOBSERVER POLYFILL
   Some embedded viewers don't include it, and Chart.js needs it.
========================================================= */

if(typeof window.ResizeObserver === "undefined"){
  window.ResizeObserver = class {
    constructor(cb){ this.cb = cb; }
    observe(el){
      this._interval = setInterval(() => {
        this.cb([{ target: el, contentRect: el.getBoundingClientRect() }]);
      }, 300);
    }
    unobserve(){ clearInterval(this._interval); }
    disconnect(){ clearInterval(this._interval); }
  };
}


/* =========================================================
   CHART.JS DEFAULTS
========================================================= */

try{
  Chart.defaults.font.family = "Inter, sans-serif";
  Chart.defaults.color = "#8b93a3";
}catch(err){
  console.error("Chart.js is not available:", err);
}

function baseGrid(){
  return { color:"#262c39", drawTicks:false };
}

// Adjusts the real height of a horizontal bar chart's container
// based on how many categories it has: this way a single player
// isn't left with a ton of empty space, and eight players aren't
// squeezed into a fixed height.
function setBarChartHeight(canvasId, count){
  const canvas = document.getElementById(canvasId);
  const wrap = canvas ? canvas.closest(".chart-wrap") : null;
  if(!wrap) return;
  const px = Math.max(150, Math.min(320, count * 40 + 50));
  wrap.style.height = `${px}px`;
}

function posColor(pos){
  return POS_COLOR[pos] || POS_COLOR["?"];
}


/* =========================================================
   HELPERS: NUMBERS / TEXT
========================================================= */

function num(value){
  if(value === undefined || value === null) return 0;
  const cleaned = String(value).trim().replace(/'/g,"").replace(/%/g,"");
  if(cleaned === "" || cleaned === "-") return 0;
  const result = parseFloat(cleaned);
  return Number.isFinite(result) ? result : 0;
}

function cleanText(value){
  if(value === undefined || value === null) return "";
  return String(value).replace(/\s+/g," ").trim();
}

function normalizeYear(value){
  const year = cleanText(value).replace(/\./g,"");
  return year || "?";
}

function pct(value){
  return `${(value * 100).toFixed(1)}%`;
}

function fmtRecord(r){
  if(!r) return "—";
  return r.t ? `${r.w}-${r.l}-${r.t}` : `${r.w}-${r.l}`;
}

// "319:12" (minutes:seconds, can exceed 60) -> 319.2 decimal minutes.
function minutesToDecimal(value){
  const match = cleanText(value).match(/^(\d+):(\d{2})$/);
  if(!match) return 0;
  return Number(match[1]) + Number(match[2]) / 60;
}

function fmtPct01(value){
  // value already comes as a fraction (0.417) from the PDF -> ".417"
  if(!Number.isFinite(value)) return "—";
  return value.toFixed(3).replace(/^0/, "");
}

function parseRecordPart(value){
  const match = cleanText(value).match(/^(\d+)-(\d+)(?:-(\d+))?$/);
  if(!match) return null;
  return { w: Number(match[1]), l: Number(match[2]), t: match[3] ? Number(match[3]) : 0 };
}


/* =========================================================
   PARSE PLAIN CSV
   Columns: # Name Yr Pos gp gs g/g a/g pts/g
   (This format does NOT include shots, SOG, record, or goalkeeping.)
========================================================= */

function parseTeamCSV(text){
  const parsed = Papa.parse(text, {
    header:true,
    skipEmptyLines:true,
    transformHeader: h => h.trim()
  });

  if(parsed.errors && parsed.errors.length){
    console.warn("CSV warnings:", parsed.errors);
  }

  const rows = parsed.data;
  if(!rows.length) throw new Error("The CSV is empty.");

  const requiredColumns = ["Name","Yr","Pos","gp","g/g","a/g"];
  const columns = Object.keys(rows[0]);
  const missing = requiredColumns.filter(c => !columns.includes(c));
  if(missing.length) throw new Error("Missing columns: " + missing.join(", "));

  const raw = rows
    .filter(row => cleanText(row.Name))
    .map(row => {
      const gp = num(row["gp"]);
      const gpg = num(row["g/g"]);
      const apg = num(row["a/g"]);
      const ptsPerGame = num(row["pts/g"]);
      const goals = Math.round(gp * gpg);
      const assists = Math.round(gp * apg);
      const points = goals * 2 + assists;

      return {
        num: cleanText(row["#"]),
        name: cleanText(row["Name"]),
        yr: normalizeYear(row["Yr"]),
        pos: cleanText(row["Pos"]) || "?",
        gp, gs: num(row["gs"]),
        gpg, apg, ptsPerGame,
        goals, assists, points,
        // Not available in the plain CSV:
        sh: undefined, sog: undefined
      };
    });

  if(!raw.length) throw new Error("No players found in the CSV.");
  return raw;
}


/* =========================================================
   PDF STAT SHEET PARSER
   PrestoSports/Sidearm "Print Version" format:

   Record: 2-2   Home: 0-1   Away: 2-1   Neutral: 0-0   Conf: 0-1

   #  Player           GP GS G A PTS SH  SH%  SOG SOG% PK-ATT GW
   19 Heidi Klatt..... 4  3  5 0 10  12 .417  9  .750  0-0     0
   Total ................ 4 -  15 8 38  93 .161 54  .581  3-4    3
   Opponents ............ 4 -  7  8  22 27 .259 13  .481  3-5    2

   GOALKEEPING (SHUTOUTS)
   1 Alexis Porter ..... 319:12 5 1.41 5 .... 1
========================================================= */

async function loadPdfLines(arrayBuffer){
  if(typeof pdfjsLib === "undefined"){
    throw new Error("Could not load the PDF reader (pdf.js). Check your internet connection.");
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const lines = [];

  for(let pageNum = 1; pageNum <= pdf.numPages; pageNum++){
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    // We group the text "items" by vertical position (y) to
    // reconstruct lines, then sort each one by x.
    const rows = new Map();
    content.items.forEach(item => {
      const y = Math.round(item.transform[5]);
      if(!rows.has(y)) rows.set(y, []);
      rows.get(y).push(item);
    });

    const sortedY = [...rows.keys()].sort((a,b) => b - a);
    sortedY.forEach(y => {
      const lineText = rows.get(y)
        .sort((a,b) => a.transform[4] - b.transform[4])
        .map(item => item.str)
        .join(" ")
        .replace(/\s+/g," ")
        .trim();
      if(lineText) lines.push(lineText);
    });
  }

  return lines;
}

function cleanName(nameTokens){
  let name = cleanText(nameTokens.join(" "))
    .replace(/\.+$/,"" )
    .replace(/\.{2,}/g," ")
    .replace(/\s+/g," ")
    .trim();

  // Some athletics PDFs use custom fonts that pdf.js can decode badly.
  // In the current Graceland roster, "Wissal Rafik" may be extracted as
  // "Wissal Ra9k" even though the visible PDF says Rafik.
  const pdfNameFixes = {
    "wissal ra9k": "Wissal Rafik"
  };
  return pdfNameFixes[name.toLowerCase()] || name;
}

function getTeamNameFromFile(filename){
  const base = String(filename || "")
    .replace(/\.(pdf|csv)$/i, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Example:
  // 2026-27 Women's Soccer Statistics - Grand View - Heart of America...
  // -> Grand View
  const statsMatch = base.match(/Soccer\s+Statistics\s*-\s*([^-]+?)(?:\s*-\s*|$)/i);
  if(statsMatch && statsMatch[1]) return statsMatch[1].trim();

  // Fallback for similarly named athletics reports.
  const parts = base.split(/\s+-\s+/).map(p => p.trim()).filter(Boolean);
  if(parts.length >= 2) return parts[1];

  return base || "Team";
}

// Standard offense table row: id + name + 11 numeric
// columns (GP GS G A PTS SH SH% SOG SOG% PK-ATT GW).
function parseOffenseTokens(tokens){
  const statTokens = tokens.slice(-11);
  const nameTokens = tokens.slice(1, tokens.length - 11);
  const [gp, gs, g, a, pts, sh, shPct, sog, sogPct, pkAtt, gw] = statTokens;
  return {
    name: cleanName(nameTokens),
    gp: num(gp), gs: num(gs),
    goals: num(g), assists: num(a), points: num(pts),
    sh: num(sh), shPct: num(shPct),
    sog: num(sog), sogPct: num(sogPct),
    gw: num(gw)
  };
}

// Totals row (Total / Opponents): same shape as the offense row,
// but without a jersey number at the start ("Total ... 11 columns").
function parseTotalsTokens(tokens, label){
  const statTokens = tokens.slice(-11);
  const [gp, gs, g, a, pts, sh, shPct, sog, sogPct, pkAtt, gw] = statTokens;
  return {
    label,
    gp: num(gp), goals: num(g), assists: num(a), points: num(pts),
    sh: num(sh), shPct: num(shPct), sog: num(sog), sogPct: num(sogPct)
  };
}

// Goalkeeping row: name + MIN (mm:ss) + GA + GAA + SAVES + ... + SHO.
// The exact column order varies between reports, so the minutes
// token is located and what follows is interpreted by type
// (integer vs decimal) instead of by fixed position.
function parseGoalkeepingLine(line){
  const tokens = line.trim().split(/\s+/);
  const minIdx = tokens.findIndex(t => /^\d{1,3}:\d{2}$/.test(t));
  if(minIdx < 1) return null;

  let nameTokens = tokens.slice(0, minIdx);
  if(/^\d{1,2}$/.test(nameTokens[0])) nameTokens = nameTokens.slice(1);
  const name = cleanName(nameTokens);
  if(!name) return null;

  const min = tokens[minIdx];
  const rest = tokens.slice(minIdx + 1);

  const ga = rest.length ? num(rest[0]) : 0;

  const gaaToken = rest.find(t => /^\d+\.\d{1,2}$/.test(t));
  const gaa = gaaToken ? num(gaaToken) : 0;

  const pureInts = rest.slice(1).filter(t => /^\d+$/.test(t));
  const saves = pureInts.length ? num(pureInts[0]) : 0;
  const shutouts = pureInts.length ? num(pureInts[pureInts.length - 1]) : 0;

  return { name, min, ga, gaa, saves, shutouts };
}

function parsePDFStats(lines){
  /* 1. RECORD LINE */
  const recordLine = lines.find(line => /Record:/i.test(line));
  let record = null;

  if(recordLine){
    const overall = recordLine.match(/Record:\s*([\d]+-[\d]+(?:-[\d]+)?)/i);
    const home = recordLine.match(/Home:\s*([\d]+-[\d]+(?:-[\d]+)?)/i);
    const away = recordLine.match(/Away:\s*([\d]+-[\d]+(?:-[\d]+)?)/i);
    const neutral = recordLine.match(/Neutral:\s*([\d]+-[\d]+(?:-[\d]+)?)/i);
    const conf = recordLine.match(/Conf(?:erence)?:\s*([\d]+-[\d]+(?:-[\d]+)?)/i);

    record = {
      overall: overall ? parseRecordPart(overall[1]) : null,
      home: home ? parseRecordPart(home[1]) : null,
      away: away ? parseRecordPart(away[1]) : null,
      neutral: neutral ? parseRecordPart(neutral[1]) : null,
      conf: conf ? parseRecordPart(conf[1]) : null
    };
  }

  /* 2. OFFENSE TABLE + TOTALS + GOALKEEPING */
  let section = null;
  const offenseRows = [];
  const goalkeepingRows = [];
  let totalRow = null;
  let opponentRow = null;

  lines.forEach(line => {
    if(/PK-ATT/i.test(line)){ section = "offense"; return; }
    if(/SHUTOUTS/i.test(line)){ section = "goalkeeping"; return; }

    const tokens = line.trim().split(/\s+/);

    if(section === "offense"){
      if(/^Total\b/i.test(line)){
        if(tokens.length >= 11) totalRow = parseTotalsTokens(tokens, "Total");
        return;
      }
      if(/^Opponents\b/i.test(line)){
        if(tokens.length >= 11) opponentRow = parseTotalsTokens(tokens, "Opponents");
        section = null;
        return;
      }

      // id + at least 1 name word + 11 stat columns
      if(tokens.length < 13) return;
      if(!/^\d{1,2}$/.test(tokens[0])) return;

      const row = parseOffenseTokens(tokens);
      if(!row.name) return;

      offenseRows.push({
        num: tokens[0],
        name: row.name,
        yr: "?",
        pos: "?",
        gp: row.gp, gs: row.gs,
        goals: row.goals, assists: row.assists, points: row.points,
        sh: row.sh, shPct: row.shPct, sog: row.sog, sogPct: row.sogPct, gw: row.gw
      });

      return;
    }

    if(section === "goalkeeping"){
      if(/^Total\b/i.test(line) || /^Opponents\b/i.test(line)){
        section = null;
        return;
      }
      const gk = parseGoalkeepingLine(line);
      if(gk) goalkeepingRows.push(gk);
    }
  });

  if(!offenseRows.length){
    throw new Error(
      "Could not recognize the player table in the PDF. " +
      "Make sure you upload the 'Print Version' of the statistics report."
    );
  }

  return {
    record,
    players: offenseRows,
    goalkeepers: goalkeepingRows,
    totals: totalRow,
    opponent: opponentRow
  };
}


/* =========================================================
   ROSTER PDF PARSER
   Reads the season roster/statistics page with columns:
   # NAME YR POS GP GS G A PTS SH SH% SOG SOG% YC RC PK GW
   Only #, name, year and position are used here. Coach's View
   remains the source for dashboard statistics.
========================================================= */
function parseRosterPDF(lines){
  const roster = [];
  let inFieldPlayers = false;

  // FORMAT 1 — team athletics page: # NAME YR POS GP GS G A PTS ...
  lines.forEach(line => {
    if(/^Field Players$/i.test(line)){ inFieldPlayers = true; return; }
    if(!inFieldPlayers) return;
    if(/^Totals\b/i.test(line) || /^Opponent\b/i.test(line) || /^Download roster/i.test(line)){
      inFieldPlayers = false;
      return;
    }

    const tokens = line.trim().split(/\s+/);
    if(tokens.length < 6 || !/^\d{1,2}$/.test(tokens[0])) return;

    let yrIdx = -1;
    for(let i=2; i<tokens.length-1; i++){
      if(/^(Fr|So|Jr|Sr|Gr)$/i.test(tokens[i]) && /^(GK|D|DEF|MF|M|F)$/i.test(tokens[i+1])){
        yrIdx = i;
        break;
      }
    }
    if(yrIdx < 0) return;

    const name = cleanName(tokens.slice(1, yrIdx));
    if(!name) return;
    const statTokens = tokens.slice(yrIdx + 2);
    const rosterNum = value => {
      if(value === undefined || value === "-" || value === "—") return 0;
      const n = Number(String(value).replace(/[^0-9.-]/g, ""));
      return Number.isFinite(n) ? n : 0;
    };

    roster.push({
      num: tokens[0], name, yr: normalizeYear(tokens[yrIdx]),
      pos: tokens[yrIdx + 1].toUpperCase(),
      gp: rosterNum(statTokens[0]), points: rosterNum(statTokens[4])
    });
  });

  if(roster.length) return roster;

  // FORMAT 2 — Heart conference Lineup PDF (Grand View, etc.).
  // PDF.js can extract the table in two blocks: first YR/POS/stats,
  // then #/NAME. Pair both blocks by their displayed row order.
  const statRows = [];
  const nameRows = [];
  const statRe = /^(Fr|So|Jr|Sr|Gr)\s+(GK|D|DEF|MF|M|F)\s+(-|\d+)\s+(-|\d+)\s+(-|\d*\.?\d+)\s+(-|\d*\.?\d+)\s+(-|\d*\.?\d+)$/i;
  const nameRe = /^(\d{1,2})\s+(.+?)$/;

  lines.forEach(rawLine => {
    const line = cleanText(rawLine);
    const sm = line.match(statRe);
    if(sm){
      const gp = sm[3] === '-' ? 0 : Number(sm[3]);
      const gpg = sm[5] === '-' ? 0 : Number(sm[5]);
      const apg = sm[6] === '-' ? 0 : Number(sm[6]);
      statRows.push({
        yr: normalizeYear(sm[1]), pos: sm[2].toUpperCase(), gp,
        goals: Math.round(gp * gpg), assists: Math.round(gp * apg)
      });
      return;
    }
    const nm = line.match(nameRe);
    if(nm && /[A-Za-z]/.test(nm[2]) && !/^(2026|2027)$/.test(nm[1])){
      nameRows.push({num:nm[1], name:cleanText(nm[2])});
    }
  });

  // Ignore unrelated numbered text; the roster blocks should have equal length.
  if(statRows.length && nameRows.length){
    const count = Math.min(statRows.length, nameRows.length);
    for(let i=0; i<count; i++){
      const st = statRows[i], nm = nameRows[i];
      roster.push({
        num:nm.num, name:nm.name, yr:st.yr, pos:st.pos,
        gp:st.gp, points:(st.goals * 2) + st.assists
      });
    }
  }

  if(!roster.length){
    throw new Error("Could not recognize the roster in this PDF. Upload the Season / Field Players or Lineup / Scoring PDF.");
  }
  return roster;
}

function parseRosterCSV(text){
  const parsed = Papa.parse(text, { header:true, skipEmptyLines:true, transformHeader:h => h.trim() });
  if(parsed.errors && parsed.errors.length) console.warn("Roster CSV warnings:", parsed.errors);
  const rows = parsed.data || [];
  const roster = rows.filter(row => cleanText(row.Name)).map(row => {
    const gp = num(row.gp);
    const gpg = num(row["g/g"]);
    const apg = num(row["a/g"]);
    const ptsPerGame = num(row["pts/g"]);
    return {
      num: cleanText(row["#"]),
      name: cleanText(row.Name),
      yr: normalizeYear(row.Yr),
      pos: cleanText(row.Pos).toUpperCase() || "?",
      gp,
      points: gp * ptsPerGame,
      goals: Math.round(gp * gpg),
      assists: Math.round(gp * apg)
    };
  });
  if(!roster.length) throw new Error("Could not recognize players in the Roster CSV.");
  return roster;
}

function playerNameKey(value){
  return cleanText(value)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function mergeRosterIntoStats(raw){
  if(!rosterPlayers.length) return raw;
  const byName = new Map(rosterPlayers.map(p => [playerNameKey(p.name), p]));
  return raw.map(p => {
    const r = byName.get(playerNameKey(p.name));
    return r ? { ...p, num:r.num, yr:r.yr, pos:r.pos } : p;
  });
}

function renderRosterOnly(){
  if(players.length){
    players = mergeRosterIntoStats(players);
    rebuildDashboard();
    return;
  }

  const list = document.getElementById("roster-list");
  const query = cleanText(document.getElementById("roster-search").value).toLowerCase();
  const filtered = query ? rosterPlayers.filter(p => p.name.toLowerCase().includes(query)) : rosterPlayers;
  const visible = [...filtered].sort((a,b) =>
    (b.points || 0) - (a.points || 0) ||
    (b.gp || 0) - (a.gp || 0) ||
    a.name.localeCompare(b.name)
  );
  list.innerHTML = visible.length ? visible.map(p => `
    <div class="player-row">
      <span class="num">#${p.num || "—"}</span>
      <span class="pos-dot" style="background:${posColor(p.pos)}"></span>
      <span class="info">
        <div class="name">${p.name}</div>
        <div class="meta">${p.yr} · ${p.pos} · ${p.gp || 0} GP</div>
      </span>
      <span class="pts" title="Points">${p.points || 0}</span>
    </div>`).join("") : `<div class="roster-empty">No players match "${query}".</div>`;
}

function handleRosterFile(file){
  if(!file) return;
  const status = document.getElementById("file-status");
  const reader = new FileReader();
  const isCSV = /\.csv$/i.test(file.name) || file.type === "text/csv";

  reader.onload = async function(){
    try{
      if(isCSV){
        rosterPlayers = parseRosterCSV(reader.result);
      }else{
        const lines = await loadPdfLines(reader.result);
        rosterPlayers = parseRosterPDF(lines);
      }
      if(players.length) players = mergeRosterIntoStats(players);
      renderRosterOnly();
      status.classList.remove("error");
      status.classList.add("loaded");
      status.textContent = `Roster: ${rosterPlayers.length} players`;
      document.getElementById("modal-error").textContent = "";
      document.getElementById("upload-modal").classList.add("hidden");
    }catch(error){
      failLoad(error, status, {});
    }
  };
  reader.onerror = () => failLoad(new Error("Could not read the Roster."), status, {});
  if(isCSV) reader.readAsText(file);
  else reader.readAsArrayBuffer(file);
}

/* =========================================================
   COMPUTE TEAM DATA
========================================================= */

function computeFromRaw(raw, meta = {}){
  players = raw.map(player => {
    const gpg = player.gpg !== undefined ? player.gpg : (player.gp > 0 ? player.goals / player.gp : 0);
    const apg = player.apg !== undefined ? player.apg : (player.gp > 0 ? player.assists / player.gp : 0);
    const ptsPerGame = player.ptsPerGame !== undefined ? player.ptsPerGame : (player.gp > 0 ? player.points / player.gp : 0);
    const accuracy = player.sh ? player.sog / player.sh : 0;

    return { ...player, gpg, apg, ptsPerGame, accuracy };
  });

  teamRecord = meta.record || null;
  goalkeepers = meta.goalkeepers || [];
  opponent = meta.opponent || null;

  // Order: points, then goals, then alphabetical.
  players.sort((a,b) => b.points - a.points || b.gp - a.gp || a.name.localeCompare(b.name));

  teamGoals = players.reduce((t,p) => t + p.goals, 0);
  teamAssists = players.reduce((t,p) => t + p.assists, 0);
  teamShots = players.reduce((t,p) => t + (p.sh || 0), 0);
  teamSOG = players.reduce((t,p) => t + (p.sog || 0), 0);

  matchesPlayed = players.length ? Math.max(...players.map(p => p.gp)) : 0;

  selected = null;
}

function hasShotsData(){
  return players.some(p => p.sh !== undefined);
}

function hasOpponentData(){
  return !!opponent;
}

function hasGoalkeepingData(){
  return goalkeepers.length > 0;
}


/* =========================================================
   FILE HANDLER
   - .csv  -> parseTeamCSV()  (per-player stats, no record)
   - .pdf  -> parsePDFStats() ("Print Version" report)
========================================================= */

function finishLoad(raw, meta, file, status, callbacks){

  teamName = getTeamNameFromFile(file.name);
  const compareTitle = document.querySelector("#tab-overview .panel h3");
if(compareTitle){
  compareTitle.textContent = `${teamName} vs Opponents`;
}

  raw = mergeRosterIntoStats(raw);
  computeFromRaw(raw, meta);

  document.getElementById("empty-state").classList.add("hidden");
  document.getElementById("dashboard").classList.add("visible");

  rebuildDashboard();

  status.classList.remove("error");
  status.classList.add("loaded");
  status.textContent = `${players.length} players`;

  const titleEl = document.querySelector(".brand h1");

  if(titleEl){
    titleEl.textContent = teamName;
  }

  document.title = `${teamName} — Analytics`;

  document.getElementById("upload-modal").classList.add("hidden");

  if(callbacks.onSuccess) callbacks.onSuccess();
}

function failLoad(error, status, callbacks){
  console.error(error);
  status.classList.remove("loaded");
  status.classList.add("error");
  status.textContent = "Error reading file";

  document.getElementById("modal-error").textContent = error.message;

  if(callbacks.onError) callbacks.onError(error);
}

function handleStatsFile(file, callbacks = {}){
  if(!file) return;

  const status = document.getElementById("file-status");
  const isPDF = /\.pdf$/i.test(file.name);
  const reader = new FileReader();

  reader.onerror = function(){
    status.classList.add("error");
    status.textContent = "Could not read the file.";
  };

  if(isPDF){
    reader.onload = async function(){
      try{
        const lines = await loadPdfLines(reader.result);
        const { record, players: raw, goalkeepers: gks, opponent: opp } = parsePDFStats(lines);
        finishLoad(raw, { record, goalkeepers: gks, opponent: opp }, file, status, callbacks);
      }catch(error){
        failLoad(error, status, callbacks);
      }
    };
    reader.readAsArrayBuffer(file);
    return;
  }

  reader.onload = function(){
    try{
      const raw = parseTeamCSV(reader.result);
      finishLoad(raw, {}, file, status, callbacks);
    }catch(error){
      failLoad(error, status, callbacks);
    }
  };
  reader.readAsText(file);
}


/* =========================================================
   UPLOAD INPUTS
========================================================= */

const coachUploadInputs = [
  document.getElementById("csvInput"),
  document.getElementById("csvInputModal"),
  document.getElementById("csvInputEmpty")
];

coachUploadInputs.forEach(input => {
  input.addEventListener("change", event => {
    const file = event.target.files[0];
    if(file){
      document.getElementById("modal-error").textContent = "";
      handleStatsFile(file);
    }
    event.target.value = "";
  });
});

const rosterUploadInputs = [
  document.getElementById("rosterInput"),
  document.getElementById("rosterInputModal"),
  document.getElementById("rosterInputEmpty")
];

rosterUploadInputs.forEach(input => {
  input.addEventListener("change", event => {
    const file = event.target.files[0];
    if(file) handleRosterFile(file);
    event.target.value = "";
  });
});


/* =========================================================
   TABS
========================================================= */

const TAB_BUILDERS = {
  overview: renderOverviewTab,
  insights: renderInsightsTab
};

function switchTab(name){
  if(!TAB_BUILDERS[name]) return;
  activeTab = name;

  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === name);
  });

  document.querySelectorAll(".tab-panel").forEach(panel => {
    panel.classList.toggle("active", panel.id === `tab-${name}`);
  });

  if(players.length) TAB_BUILDERS[name]();
}

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});


/* =========================================================
   REBUILD EVERYTHING (runs when a new file is loaded)
========================================================= */

function safeBuild(fn, label){
  try{ fn(); }
  catch(err){ console.error(`Error drawing ${label}:`, err); }
}

function rebuildDashboard(){
  renderRoster();
  safeBuild(() => TAB_BUILDERS[activeTab](), activeTab);
}


/* =========================================================
   ROSTER (sidebar, shared between tabs)
========================================================= */

function renderRoster(){
  const list = document.getElementById("roster-list");

  if(!players.length){
    if(rosterPlayers.length){ renderRosterOnly(); return; }
    list.innerHTML = `<div class="roster-empty">Insert Roster PDF or CSV to load the team roster.</div>`;
    return;
  }

  const query = cleanText(document.getElementById("roster-search").value).toLowerCase();
  const filtered = query ? players.filter(p => p.name.toLowerCase().includes(query)) : players;
  const visible = [...filtered].sort((a,b) =>
    b.points - a.points ||
    b.gp - a.gp ||
    a.name.localeCompare(b.name)
  );

  if(!visible.length){
    list.innerHTML = `<div class="roster-empty">No players match "${query}".</div>`;
    return;
  }

  list.innerHTML = visible.map(player => {
    const index = players.indexOf(player);
    return `
    <div class="player-row ${selected && selected.name === player.name ? "active" : ""}" data-index="${index}">
      <span class="num">#${player.num || "—"}</span>
      <span class="pos-dot" style="background:${posColor(player.pos)}"></span>
      <span class="info">
        <div class="name">${player.name}</div>
        <div class="meta">${player.yr} · ${player.pos} · ${player.gp} GP</div>
      </span>
      <span class="pts">${player.points}</span>
    </div>
  `;
  }).join("");

  list.querySelectorAll(".player-row").forEach(row => {
    row.addEventListener("click", function(){
      const index = Number(this.dataset.index);
      selected = players[index];
      renderRoster();
      openPlayerModal(selected);
    });
  });
}

document.getElementById("roster-search").addEventListener("input", renderRoster);


/* =========================================================
   PLAYER PROFILE MODAL

   Not all players have the same kind of useful data:
   - Goalkeepers (appear in the goalkeeping table) -> minutes,
     GAA, SV%, shutouts.
   - Field players with attempted shots -> G-A-PTS,
     SH/SH%, SOG/SOG%, GW.
   - Field players with no shots -> only appearances/starts,
     without forcing shot columns to 0.
========================================================= */

function findGoalkeeperData(player){
  return goalkeepers.find(gk => gk.name === player.name) || null;
}

function profileHeaderHTML(player, extraChip){
  const gpgs = player.gs !== undefined
    ? `${player.gp} GP · ${player.gs} GS`
    : `${player.gp} GP`;

  return `
    <div class="profile-head">
      <div class="profile-num">${player.num || "—"}</div>
      <div>
        <div class="profile-name">${player.name}</div>
        <div class="profile-meta">
          <span class="profile-pos-chip">
            <span class="pos-dot" style="background:${posColor(player.pos)}"></span>
            ${player.pos === "?" ? "" : player.pos}
          </span>
          <span class="profile-chip">${YEAR_LABEL[player.yr] || player.yr}</span>
          <span class="profile-chip">${gpgs}</span>
          ${extraChip || ""}
        </div>
      </div>
    </div>
  `;
}

function buildGoalkeeperProfile(player, gk){
  const totalMinutes = goalkeepers.reduce((t, g) => t + minutesToDecimal(g.min), 0);
  const playerMinutes = minutesToDecimal(gk.min);
  const minutesPct = totalMinutes > 0 ? (playerMinutes / totalMinutes) * 100 : 0;
  const svPct = (gk.saves + gk.ga) > 0 ? gk.saves / (gk.saves + gk.ga) : null;

  const startsChip = `<span class="profile-chip accent">Starting goalkeeper</span>`;

  return `
    ${profileHeaderHTML(player, minutesPct >= 50 ? startsChip : "")}

    <div class="profile-section-label">Minutes played</div>
    <div class="profile-bar-row">
      <div class="profile-bar-labels">
        <span>${gk.min} min played</span>
        <span class="val">${minutesPct.toFixed(0)}% of team</span>
      </div>
      <div class="profile-bar-track">
        <div class="profile-bar-fill" style="width:${Math.min(100, minutesPct)}%"></div>
      </div>
    </div>

    <div class="profile-section-label" style="margin-top:18px;">Goalkeeping performance</div>
    <div class="profile-stats cols-4">
      <div class="profile-stat">
        <div class="label">GA</div>
        <div class="value">${gk.ga}</div>
      </div>
      <div class="profile-stat highlight">
        <div class="label">GAA</div>
        <div class="value">${gk.gaa.toFixed(2)}</div>
      </div>
      <div class="profile-stat">
        <div class="label">Saves</div>
        <div class="value">${gk.saves}</div>
      </div>
      <div class="profile-stat">
        <div class="label">SV%</div>
        <div class="value">${svPct !== null ? fmtPct01(svPct) : "—"}</div>
      </div>
    </div>

    ${gk.shutouts > 0 ? `<div class="profile-gw-badge">🧤 ${gk.shutouts} shutout${gk.shutouts > 1 ? "s" : ""}</div>` : ""}
  `;
}

function buildFieldWithShotsProfile(player){
  const startedAll = player.gs !== undefined && player.gp > 0 && player.gs === player.gp;

  return `
    ${profileHeaderHTML(player, startedAll ? `<span class="profile-chip accent">Regular starter</span>` : "")}

    <div class="profile-section-label">Production</div>
    <div class="profile-stats">
      <div class="profile-stat highlight">
        <div class="label">Goals</div>
        <div class="value">${player.goals}</div>
      </div>
      <div class="profile-stat">
        <div class="label">Assists</div>
        <div class="value">${player.assists}</div>
      </div>
      <div class="profile-stat">
        <div class="label">Points</div>
        <div class="value">${player.points}</div>
      </div>
    </div>

    <div class="profile-section-label">Shot volume vs. efficiency</div>
    <div class="profile-bar-row">
      <div class="profile-bar-labels">
        <span>Shots (SH)</span>
        <span class="val">${player.sh} · ${player.shPct !== undefined ? fmtPct01(player.shPct) : "—"} conversion</span>
      </div>
      <div class="profile-bar-track">
        <div class="profile-bar-fill" style="width:${Math.min(100, (player.shPct || 0) * 100)}%"></div>
      </div>
    </div>
    ${player.sog !== undefined ? `
    <div class="profile-bar-row">
      <div class="profile-bar-labels">
        <span>Shots on goal (SOG)</span>
        <span class="val">${player.sog} · ${player.sogPct !== undefined ? fmtPct01(player.sogPct) : "—"} of total</span>
      </div>
      <div class="profile-bar-track">
        <div class="profile-bar-fill" style="width:${Math.min(100, (player.sogPct || 0) * 100)}%"></div>
      </div>
    </div>` : ""}

    ${player.gw > 0 ? `<div class="profile-gw-badge">⚽ ${player.gw} game-winning goal${player.gw > 1 ? "s" : ""} (GW)</div>` : ""}
  `;
}

function buildFieldNoShotsProfile(player){
  const started = player.gs !== undefined ? player.gs : 0;
  const startedNote = started > 0
    ? `Started ${started} of ${player.gp} game${player.gp === 1 ? "" : "s"}.`
    : `No starts this season — appeared in ${player.gp} of the team’s games.`;

  return `
    ${profileHeaderHTML(player)}
    <div class="profile-note">
      ${startedNote}<br>
      No shots or offensive production (G/A) recorded yet this season.
    </div>
  `;
}

function buildPlayerProfileHTML(player){
  const gk = findGoalkeeperData(player);
  if(gk) return buildGoalkeeperProfile(player, gk);

  const hasShots = player.sh !== undefined && player.sh > 0;
  if(hasShots) return buildFieldWithShotsProfile(player);

  return buildFieldNoShotsProfile(player);
}

function openPlayerModal(player){
  if(!player) return;
  document.getElementById("player-modal-body").innerHTML = buildPlayerProfileHTML(player);
  document.getElementById("player-modal").classList.remove("hidden");
}

function closePlayerModal(){
  document.getElementById("player-modal").classList.add("hidden");
}

document.getElementById("player-modal-close").addEventListener("click", closePlayerModal);
document.getElementById("player-modal").addEventListener("click", e => {
  if(e.target.id === "player-modal") closePlayerModal();
});
document.addEventListener("keydown", e => {
  if(e.key === "Escape") closePlayerModal();
});


/* =========================================================
   OVERVIEW TAB
   Team KPIs + comparison vs opponents + quick highlights
========================================================= */

function renderOverviewTab(){
  renderOverviewKPIs();
  safeBuild(buildCompareChart, "chartCompare");
  safeBuild(buildScorers, "chartScorers");
  safeBuild(buildShotsGoals, "chartShotsGoals");
  safeBuild(buildEff, "chartEff");

  const shotsPanel = document.getElementById("panel-shots-goals");
  // NOTE: "" (not "block") so we don't override the .panel's display:flex —
  // with "block" the panel lost its internal flex layout and that broke
  // the height of the whole grid row, forcing a scroll on the page.
  shotsPanel.style.display = hasShotsData() ? "" : "none";
}

function renderOverviewKPIs(){
  const container = document.getElementById("overview-kpis");
  if(!players.length){ container.innerHTML = ""; return; }

  const overall = fmtRecord(teamRecord && teamRecord.overall);
  const oppGoals = opponent ? opponent.goals : null;
  const gd = oppGoals !== null ? teamGoals - oppGoals : null;

  const cards = [
    { label:"Record", value: overall, accent:true },
    { label:"Goals for", value: teamGoals },
    { label:"Goals against", value: oppGoals !== null ? oppGoals : "—" },
    { label:"Goal diff.", value: gd !== null ? (gd > 0 ? `+${gd}` : gd) : "—" }
  ];

  if(hasShotsData()){
    cards.push({ label:"Shots", value: teamShots });
    cards.push({ label:"Shots on goal", value: teamSOG });
  }else{
    cards.push({ label:"Matches played", value: matchesPlayed });
    cards.push({ label:"Assists", value: teamAssists });
  }

  container.innerHTML = cards.map(kpi => `
    <div class="kpi ${kpi.accent ? "accent" : ""}">
      <div class="label">${kpi.label}</div>
      <div class="value">${kpi.value}</div>
    </div>
  `).join("");
}

function buildCompareChart(){
  if(chartCompare !== null){ chartCompare.destroy(); chartCompare = null; }

  const canvas = document.getElementById("chartCompare");
  const note = document.getElementById("compare-note");

  if(!hasOpponentData()){
    canvas.style.display = "none";
    note.style.display = "block";
    note.textContent = "Upload the report's \"Print Version\" PDF to see the comparison against opponents.";
    return;
  }

  canvas.style.display = "block";
  note.style.display = "none";

  const metrics = ["Goals","Shots","Shots on Goal"];
  const teamValues = [teamGoals, teamShots, teamSOG];
  const oppValues = [opponent.goals, opponent.sh, opponent.sog];

  chartCompare = new Chart(canvas, {
    type:"bar",
    data:{
      labels: metrics,
      datasets:[
  {
    label:"Opponents",
    data:oppValues,
    backgroundColor:"#5c637688",
    borderColor:"#8b93a3",
    borderWidth:1.5,
    borderRadius:6,
    borderSkipped:false,
    maxBarThickness:56
  },
  {
    label:teamName,
    data:teamValues,
    backgroundColor:"#6f9bd1",
    borderRadius:6,
    borderSkipped:false,
    maxBarThickness:56
  }
]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      layout:{ padding:{ top:6 } },
      plugins:{
        legend:{ position:"top", align:"end", labels:{ boxWidth:10, boxHeight:10, padding:16 } },
        tooltip:{ padding:10, cornerRadius:6 }
      },
      scales:{
        x:{ grid:{ display:false }, ticks:{ font:{ size:12 } } },
        y:{ beginAtZero:true, grid: baseGrid(), ticks:{ precision:0 } }
      }
    }
  });
}


/* =========================================================
   TEAM TAB
   Goal contributions, shots vs goals, squad breakdowns
========================================================= */

/* buildScorers, buildShotsGoals, buildPos, buildClass, buildEff se
   definen abajo y ahora se invocan desde renderOverviewTab(). */

function buildScorers(){
  if(chartScorers !== null){ chartScorers.destroy(); chartScorers = null; }
  const hint = document.getElementById("scorers-toggle");
  if(!players.length) return;

  const all = [...players].filter(p => p.points > 0).sort((a,b) => b.points - a.points);
  if(!all.length){ hint.textContent = ""; hint.className = "tab-hint"; return; }

  const top = all.slice(0, 5);

  setBarChartHeight("chartScorers", top.length);

  hint.className = "tab-hint clickable";
  hint.textContent = all.length > 5
    ? `Showing top 5 · click chart to see all ${all.length} players, bigger`
    : "Click chart to see it bigger";

  const canvas = document.getElementById("chartScorers");
  canvas.style.cursor = "pointer";

  chartScorers = new Chart(canvas, {
    type:"bar",
    data:{
      labels: top.map(p => p.name),
      datasets:[
        { label:"Goals", data: top.map(p => p.goals), backgroundColor:"#6f9bd1", stack:"ga", borderRadius:4, borderSkipped:false },
        { label:"Assists", data: top.map(p => p.assists), backgroundColor:"#cda868", stack:"ga", borderRadius:4, borderSkipped:false }
      ]
    },
    options:{
      indexAxis:"y",
      responsive:true,
      maintainAspectRatio:false,
      layout:{ padding:{ right:10 } },
      barPercentage:0.6,
      categoryPercentage:0.7,
      maxBarThickness:30,
      onClick: () => openChartModal("scorers"),
      plugins:{
        legend:{ position:"top", align:"end", labels:{ boxWidth:10, boxHeight:10, padding:16 } },
        tooltip:{ padding:10, cornerRadius:6 }
      },
      scales:{
        x:{ beginAtZero:true, stacked:true, grid: baseGrid(), ticks:{ precision:0 } },
        y:{ stacked:true, grid:{ display:false }, ticks:{ font:{ size:12 } } }
      }
    }
  });
}

function buildShotsGoals(){
  if(chartShotsGoals !== null){ chartShotsGoals.destroy(); chartShotsGoals = null; }
  const hint = document.getElementById("shots-goals-toggle");
  if(!hasShotsData()){ hint.textContent = ""; hint.className = "tab-hint"; return; }

  // Horizontal bars (like "Top goal contributions") instead of vertical
  // bars with rotated names: with many players the labels got
  // cut off and the bars became tiny.
  const all = [...players].filter(p => p.sh > 0).sort((a,b) => b.sh - a.sh);
  if(!all.length){ hint.textContent = ""; hint.className = "tab-hint"; return; }

  const top = all.slice(0, 5);

  setBarChartHeight("chartShotsGoals", top.length);

  hint.className = "tab-hint clickable";
  hint.textContent = all.length > 5
    ? `Showing top 5 · click chart to see all ${all.length} players, bigger`
    : "Click chart to see it bigger";

  const canvas = document.getElementById("chartShotsGoals");
  canvas.style.cursor = "pointer";

  chartShotsGoals = new Chart(canvas, {
    type:"bar",
    data:{
      labels: top.map(p => p.name),
      datasets:[
        { label:"Shots", data: top.map(p => p.sh), backgroundColor:"#5c637688", borderRadius:4, borderSkipped:false },
        { label:"Goals", data: top.map(p => p.goals), backgroundColor:"#bd8494", borderRadius:4, borderSkipped:false }
      ]
    },
    options:{
      indexAxis:"y",
      responsive:true,
      maintainAspectRatio:false,
      layout:{ padding:{ right:10 } },
      barPercentage:0.6,
      categoryPercentage:0.7,
      maxBarThickness:30,
      onClick: () => openChartModal("shotsGoals"),
      plugins:{
        legend:{ position:"top", align:"end", labels:{ boxWidth:10, boxHeight:10, padding:16 } },
        tooltip:{ padding:10, cornerRadius:6 }
      },
      scales:{
        x:{ beginAtZero:true, grid: baseGrid(), ticks:{ precision:0 } },
        y:{ grid:{ display:false }, ticks:{ font:{ size:12 } } }
      }
    }
  });
}


/* =========================================================
   EXPANDED CHART MODAL

   Opens when clicking "Top goal contributions" or
   "Shots vs goals" when there are more than 5 players with data:
   shows the full chart with all of them.
========================================================= */

const CHART_MODAL_CONFIG = {
  scorers:{
    title:"Top goal contributions",
    sub:"Goals and assists produced this season",
    getData(){
      return [...players].filter(p => p.points > 0).sort((a,b) => b.points - a.points);
    },
    datasets: top => [
      { label:"Goals", data: top.map(p => p.goals), backgroundColor:"#6f9bd1", stack:"ga", borderRadius:4, borderSkipped:false },
      { label:"Assists", data: top.map(p => p.assists), backgroundColor:"#cda868", stack:"ga", borderRadius:4, borderSkipped:false }
    ],
    stacked:true
  },
  shotsGoals:{
    title:"Shots vs goals",
    sub:"Shooting volume compared with conversion",
    getData(){
      return [...players].filter(p => p.sh > 0).sort((a,b) => b.sh - a.sh);
    },
    datasets: top => [
      { label:"Shots", data: top.map(p => p.sh), backgroundColor:"#5c637688", borderRadius:4, borderSkipped:false },
      { label:"Goals", data: top.map(p => p.goals), backgroundColor:"#bd8494", borderRadius:4, borderSkipped:false }
    ],
    stacked:false
  }
};

function openChartModal(kind){
  const config = CHART_MODAL_CONFIG[kind];
  if(!config) return;

  const all = config.getData();
  if(!all.length) return;

  document.getElementById("chart-modal-title").textContent = config.title;
  document.getElementById("chart-modal-sub").textContent =
    `${config.sub} · ${all.length} players`;

  const wrap = document.getElementById("chart-modal-wrap");

  // Shots vs goals: everything fits on screen without scrolling.
  // The other charts keep a normal size.
  if(kind === "shotsGoals"){
    wrap.style.height = "68vh";
  } else {
    wrap.style.height = `${Math.max(420, all.length * 42 + 50)}px`;
  }

  if(chartModal !== null){
    chartModal.destroy();
    chartModal = null;
  }

  chartModal = new Chart(
    document.getElementById("chartModalCanvas"),
    {
      type:"bar",

      data:{
        labels: all.map(p => p.name),
        datasets: config.datasets(all)
      },

      options:{
        indexAxis:"y",
        responsive:true,
        maintainAspectRatio:false,

        layout:{
          padding:{
            right:12,
            top:2,
            bottom:2
          }
        },

        // More compact so they all fit
        barPercentage: kind === "shotsGoals" ? 0.48 : 0.7,
        categoryPercentage: kind === "shotsGoals" ? 0.62 : 0.8,
        maxBarThickness: kind === "shotsGoals" ? 22 : 34,

        plugins:{
          legend:{
            position:"top",
            align:"end",
            labels:{
              boxWidth:9,
              boxHeight:9,
              padding:10,
              font:{
                size:9
              }
            }
          },

          tooltip:{
            padding:10,
            cornerRadius:6,
            titleFont:{ size:12 },
            bodyFont:{ size:11 }
          }
        },

        scales:{
          x:{
            beginAtZero:true,
            stacked:config.stacked,
            grid:baseGrid(),
            ticks:{
              precision:0,
              font:{ size:9 }
            }
          },

          y:{
            stacked:config.stacked,
            grid:{
              display:false
            },
            ticks:{
              font:{
                size: kind === "shotsGoals" ? 9 : 10
              }
            }
          }
        }
      }
    }
  );

  document
    .getElementById("chart-modal")
    .classList.remove("hidden");
}

function closeChartModal(){
  document.getElementById("chart-modal").classList.add("hidden");
  if(chartModal !== null){ chartModal.destroy(); chartModal = null; }
}

document.getElementById("chart-modal-close").addEventListener("click", closeChartModal);
document.getElementById("chart-modal").addEventListener("click", e => {
  if(e.target.id === "chart-modal") closeChartModal();
});
document.addEventListener("keydown", e => {
  if(e.key === "Escape") closeChartModal();
});


function buildEff(){
  if(chartEff !== null){ chartEff.destroy(); chartEff = null; }
  if(!players.length) return;

  // We only show players who genuinely contribute offensive information:
  // at least 1 goal or 1 assist. Max 7 so the chart stays legible.
  // Prioritized by points and, in a tie, by games played.
  const efficiencyPlayers = players
    .filter(p => p.gp > 0 && (p.goals > 0 || p.assists > 0))
    .sort((a,b) => (b.points - a.points) || (b.gp - a.gp) || a.name.localeCompare(b.name))
    .slice(0, 7);

  if(!efficiencyPlayers.length) return;

  const positions = [...new Set(efficiencyPlayers.map(p => p.pos))];
  const datasets = positions.map(position => ({
    label: position,
    data: efficiencyPlayers.filter(p => p.pos === position).map(p => ({
      x: p.gpg,
      y: p.apg,
      r: 7,
      name: p.name,
      goals: p.goals,
      assists: p.assists,
      gp: p.gp,
      points: p.points
    })),
    backgroundColor: posColor(position) + "b0",
    borderColor: posColor(position),
    borderWidth:1.5
  }));

  const maxGpg = Math.max(0.1, ...efficiencyPlayers.map(p => p.gpg));
  const maxApg = Math.max(0.1, ...efficiencyPlayers.map(p => p.apg));

  chartEff = new Chart(document.getElementById("chartEff"), {
    type:"bubble",
    data:{ datasets },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      layout:{ padding:{ top:14, right:18, bottom:4, left:4 } },
      plugins:{
        legend:{ display:false },
        tooltip:{
          padding:10,
          cornerRadius:6,
          callbacks:{
            title: ctx => ctx[0].raw.name,
            label: ctx => {
              const p = ctx.raw;
              return [`${p.goals} goals`, `${p.assists} assists`, `${p.gp} games`, `${p.points} points`, `${p.x.toFixed(2)} G/G`, `${p.y.toFixed(2)} A/G`];
            }
          }
        }
      },
      scales:{
        x:{ min: -maxGpg * 0.08, suggestedMax: maxGpg * 1.2, title:{ display:true, text:"Goals / game" }, grid: baseGrid() },
        y:{ min: -maxApg * 0.1, suggestedMax: maxApg * 1.2, title:{ display:true, text:"Assists / game" }, grid: baseGrid() }
      }
    }
  });
}


/* =========================================================
   INSIGHTS TAB
   Phrases generated automatically from the data.
========================================================= */

function buildInsights(){
  if(!players.length) return [];

  const insights = [];

  if(hasOpponentData()){
    const shotRatio = opponent.sh > 0 ? teamShots / opponent.sh : null;
    if(shotRatio){
      insights.push({
        tag:"ATTACK",
        text:`${teamName} has taken ${shotRatio.toFixed(1)}× ${shotRatio >= 1 ? "more" : "as many"} shots than its opponents (${teamShots} vs ${opponent.sh}).`
      });
    }

    const teamFinish = teamShots > 0 ? teamGoals / teamShots : 0;
    const oppFinish = opponent.sh > 0 ? opponent.goals / opponent.sh : 0;
    insights.push({
      tag:"FINISHING",
      text:`${teamName} converts ${pct(teamFinish)} of its shots, compared with ${pct(oppFinish)} for opponents.`
    });
  }

  const topScorer = [...players].sort((a,b) => b.goals - a.goals)[0];
  if(topScorer && topScorer.goals > 0){
    const shotsNote = topScorer.sh ? ` from ${topScorer.sh} shots` : "";
    insights.push({ tag:"TOP SCORER", text:`${topScorer.name} — ${topScorer.goals} goals${shotsNote}.` });
  }

  const topCreator = [...players].sort((a,b) => b.assists - a.assists)[0];
  if(topCreator && topCreator.assists > 0){
    insights.push({ tag:"CREATOR", text:`${topCreator.name} — ${topCreator.assists} assists.` });
  }

  const teamGP = teamRecord && teamRecord.overall
    ? (teamRecord.overall.w + teamRecord.overall.l + teamRecord.overall.t)
    : Math.max(0, ...players.map(p => p.gp || 0));
  if(teamGP > 0){
    const teamGPG = teamGoals / teamGP;
    insights.push({ tag:"TEAM", text:`${teamName} averages ${teamGPG.toFixed(2)} goals per game.` });
  }

  if(hasShotsData()){
    const mostEfficient = [...players]
      .filter(p => p.sh >= 4)
      .sort((a,b) => (b.goals / b.sh) - (a.goals / a.sh))[0];
    if(mostEfficient){
      insights.push({ tag:"EFFICIENCY", text:`${mostEfficient.name} converts ${pct(mostEfficient.goals / mostEfficient.sh)} of her shots into goals.` });
    }
  }

  if(hasGoalkeepingData()){
    const topGK = [...goalkeepers].sort((a,b) => b.saves - a.saves)[0];
    if(topGK){
      insights.push({ tag:"GOALKEEPING", text:`${topGK.name} — ${topGK.saves} saves, ${topGK.ga} goals allowed, ${topGK.gaa.toFixed(2)} GAA.` });
    }
  }

  return insights;
}

function renderInsightsTab(){
  const container = document.getElementById("insights-list");
  const insights = buildInsights();

  if(!insights.length){
    container.innerHTML = `<div class="profile-empty">Upload more data (PDF recommended) to generate insights.</div>`;
    return;
  }

  container.innerHTML = insights.map(item => `
    <div class="insight-card">
      <span class="insight-tag">${item.tag}</span>
      <p>${item.text}</p>
    </div>
  `).join("");
}


/* =========================================================
   INITIAL STATE — no default data.
========================================================= */

renderRoster();
