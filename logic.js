/* ═══════════════════════════════════════════════════════════════════
   Cycle Intelligence — logic.js
   Shared logic for frontend and unit tests.
   Pure JavaScript (Compatibility: no arrow fns, no **, var instead of const/let)
   ═══════════════════════════════════════════════════════════════════ */

var MOOD_WORDS = {
  "-3": ["screaming","yelling","furious","raging","explosive","meltdown","terrible","awful","horrible","blew up"],
  "-2": ["angry","mad","irritable","upset","cranky","moody","snappy","frustrated","annoyed","agitated","hostile","short-tempered","pissed","bad mood","bad","overreacted","overreaction","scolded","snapped","fight","fought","argument","conflict"],
  "-1": ["sensitive","emotional","tearful","withdrawn","quiet","off"],
  "3":  ["amazing","incredible","fantastic","ecstatic"],
  "2":  ["happy","cheerful","great","calm","patient","loving","affectionate","sweet","playful","energetic","bubbly","good mood","good","nice","pleasant","warm"],
  "1":  ["fine","okay","ok","normal","stable","decent","alright"]
};

var FILLER_WORDS = ["on","wife","was","is","seems","seemed","has been","she","her","my","the","very","really","super","extremely","quite","pretty","somewhat","a bit","kind of","kinda","sort of","sorta"];
var MONTH_NAMES = ["january","february","march","april","may","june","july","august","september","october","november","december"];
var MONTH_ABBR  = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];

function calcHormones(day, cycleLen) {
  var t = day / cycleLen;
  var est = 20
    + 60 * Math.exp(-Math.pow((t - 0.46) / 0.06, 2))
    + 25 * Math.exp(-Math.pow((t - 0.72) / 0.12, 2))
    - 15 * Math.exp(-Math.pow((t - 0.55) / 0.04, 2));
  var prog = 5 + 80 * Math.exp(-Math.pow((t - 0.75) / 0.12, 2));
  var lh   = 8 + 90 * Math.exp(-Math.pow((t - 0.48) / 0.025, 2));
  var fsh  = 15
    + 35 * Math.exp(-Math.pow((t - 0.12) / 0.08, 2))
    + 25 * Math.exp(-Math.pow((t - 0.48) / 0.03, 2));
  return {
    estrogen:     Math.max(0, Math.min(100, est)),
    progesterone: Math.max(0, Math.min(100, prog)),
    lh:           Math.max(0, Math.min(100, lh)),
    fsh:          Math.max(0, Math.min(100, fsh))
  };
}

function getPhase(day, cycleLen, periodLen) {
  var t = day / cycleLen;
  if (day <= periodLen)  return { name: "Menstruation", color: "#c2185b" };
  if (t <= 0.45)         return { name: "Follicular",   color: "#7b1fa2" };
  if (t <= 0.55)         return { name: "Ovulation",    color: "#ff6f00" };
  return                        { name: "Luteal",       color: "#00695c" };
}

function phaseProfile(name) {
  var map = {
    Menstruation: { range: [-2,0],  avg: -1.0, patience: 25, energy: 20, tip: "Not the time for difficult topics" },
    Follicular:   { range: [0,2],   avg:  1.2, patience: 75, energy: 70, tip: "Good window for important conversations" },
    Ovulation:    { range: [1,3],   avg:  2.0, patience: 90, energy: 95, tip: "Best time for big talks and date nights" },
    Luteal:       { range: [-3,1],  avg: -0.8, patience: 30, energy: 35, tip: "Tread carefully, save confrontations" }
  };
  return map[name] || map.Follicular;
}

function fitScore(score, phaseName, t, pLenRatio) {
  var prof = phaseProfile(phaseName);
  var lo = prof.range[0], hi = prof.range[1];
  var rng;
  if (score >= lo && score <= hi) { rng = 1; }
  else { var d = Math.min(Math.abs(score - lo), Math.abs(score - hi)); rng = Math.max(0, 1 - d / 3); }
  var dir;
  if (score === 0) dir = 1;
  else if (score < 0 && (phaseName === "Luteal" || phaseName === "Menstruation")) dir = 1;
  else if (score > 0 && (phaseName === "Follicular" || phaseName === "Ovulation")) dir = 1;
  else dir = 0.15;
  var nb = Math.min(Math.abs(t - pLenRatio), Math.abs(t - 0.45), Math.abs(t - 0.55), Math.abs(t), Math.abs(t - 1));
  var conf = nb <= 0.04 ? 0.5 : 0.8;
  return Math.max(0, Math.min(1, rng * 0.4 + dir * 0.45 + conf * 0.15));
}

function fitTier(s) {
  if (s >= 0.75) return { label: "Hormonal fit",      color: "#4caf50" };
  if (s >= 0.45) return { label: "Partial fit",       color: "#ffa726" };
  return                { label: "Doesn't fit model", color: "#ef5350" };
}

function isoDate(d) {
  if (!d || isNaN(d.getTime())) return null;
  var y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  return y + "-" + (m < 10 ? "0" + m : m) + "-" + (day < 10 ? "0" + day : day);
}

function fmtDate(iso) {
  if (!iso) return "";
  var p = iso.split("-");
  var mo = MONTH_ABBR[parseInt(p[1],10) - 1] || p[1];
  return mo.charAt(0).toUpperCase() + mo.slice(1) + " " + parseInt(p[2],10);
}

function extractDate(text) {
  var now = new Date(); now.setHours(0,0,0,0);
  var lower = text.toLowerCase().trim();
  var d = new Date(now.getTime());
  var dowNames = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
  var dowMatch = lower.match(/(?:last\s+|this past\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (dowMatch) {
    var target = dowNames.indexOf(dowMatch[1]);
    var cur = d.getDay();
    var diff = ((cur - target) + 7) % 7;
    if (diff === 0) diff = 7;
    d.setDate(d.getDate() - diff);
    return { date: isoDate(d), remainder: lower.replace(dowMatch[0], "") };
  }
  if (/\bday before yesterday\b/.test(lower)) { d.setDate(d.getDate()-2); return { date: isoDate(d), remainder: lower.replace("day before yesterday","") }; }
  if (/\byesterday\b/.test(lower))            { d.setDate(d.getDate()-1); return { date: isoDate(d), remainder: lower.replace("yesterday","") }; }
  if (/\btoday\b/.test(lower))                { return { date: isoDate(d), remainder: lower.replace("today","") }; }
  var agoM = lower.match(/(\d+)\s*(day|week)s?\s*ago/);
  if (agoM) { var n = parseInt(agoM[1],10); if (agoM[2]==="week") n*=7; d.setDate(d.getDate()-n); return { date: isoDate(d), remainder: lower.replace(agoM[0],"") }; }
  if (/\blast week\b/.test(lower)) { d.setDate(d.getDate()-7); return { date: isoDate(d), remainder: lower.replace("last week","") }; }
  var isoM = lower.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoM) { return { date: isoM[0], remainder: lower.replace(isoM[0],"") }; }
  var mdM = lower.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:[,\s]+(\d{2,4}))?\b/);
  if (mdM) {
    var mi = MONTH_NAMES.indexOf(mdM[1]); if (mi===-1) mi = MONTH_ABBR.indexOf(mdM[1]);
    var yr = mdM[3] ? parseInt(mdM[3],10) : now.getFullYear(); if (yr<100) yr+=2000;
    var pd = new Date(yr, mi, parseInt(mdM[2],10)); if (pd>now && !mdM[3]) pd.setFullYear(yr-1);
    return { date: isoDate(pd), remainder: lower.replace(mdM[0],"") };
  }
  var dmM = lower.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\.?(?:[,\s]+(\d{2,4}))?\b/);
  if (dmM) {
    var mi2 = MONTH_NAMES.indexOf(dmM[2]); if (mi2===-1) mi2 = MONTH_ABBR.indexOf(dmM[2]);
    var yr2 = dmM[3] ? parseInt(dmM[3],10) : now.getFullYear(); if (yr2<100) yr2+=2000;
    var pd2 = new Date(yr2, mi2, parseInt(dmM[1],10)); if (pd2>now && !dmM[3]) pd2.setFullYear(yr2-1);
    return { date: isoDate(pd2), remainder: lower.replace(dmM[0],"") };
  }
  var slM = lower.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (slM) {
    var sy = slM[3] ? parseInt(slM[3],10) : now.getFullYear(); if (sy<100) sy+=2000;
    var sp = new Date(sy, parseInt(slM[1],10)-1, parseInt(slM[2],10)); if (sp>now && !slM[3]) sp.setFullYear(sy-1);
    return { date: isoDate(sp), remainder: lower.replace(slM[0],"") };
  }
  return { date: isoDate(now), remainder: lower };
}

function classifyMood(text) {
  var stripped = text;
  for (var i=0; i<FILLER_WORDS.length; i++) {
    stripped = stripped.replace(new RegExp("\\b" + FILLER_WORDS[i] + "\\b", "gi"), " ");
  }
  stripped = stripped.replace(/\s+/g," ").trim();
  var bestScore = null, bestWord = null, maxLen = 0;
  var keys = Object.keys(MOOD_WORDS);
  for (var k=0; k<keys.length; k++) {
    var sc = parseInt(keys[k],10);
    var words = MOOD_WORDS[keys[k]];
    for (var w=0; w<words.length; w++) {
      if (stripped.indexOf(words[w]) !== -1 && words[w].length > maxLen) {
        maxLen = words[w].length; bestWord = words[w]; bestScore = sc;
      }
    }
  }
  return bestScore !== null ? { score: bestScore, word: bestWord } : null;
}

function isPeriodEntry(text) {
  return /(period\s*start|period\s+(came|arrived|began|today|yesterday)|got\s+(her|my)\s+period|menstruat|day\s*1\s*of\s*(cycle|period))/i.test(text);
}

function parseInput(raw) {
  if (!raw || !raw.trim()) return { valid: false, type: null };
  var ext = extractDate(raw);
  if (isPeriodEntry(ext.remainder)) return { valid: true, type: "period", date: ext.date };
  var mood = classifyMood(ext.remainder);
  if (mood) return { valid: true, type: "mood", date: ext.date, score: mood.score, word: mood.word, label: raw.trim() };
  return { valid: false, type: "unknown" };
}

function generateChart(state, lookback, totalDays) {
  var cLen = state.cycleLength || 27;
  var pLen = state.periodLength || 5;
  var lpd = new Date(state.lastPeriodStart); lpd.setHours(0,0,0,0);
  var today = new Date(); today.setHours(0,0,0,0);
  var lb = lookback || 45;
  var td = totalDays || 90;
  var base = new Date(today); base.setDate(base.getDate() - lb);
  var entryMap = {};
  if (state.moodEntries) {
    for (var e=0; e<state.moodEntries.length; e++) entryMap[state.moodEntries[e].date] = state.moodEntries[e];
  }
  var pts = [];
  for (var i=0; i<td; i++) {
    var dd = new Date(base); dd.setDate(base.getDate() + i);
    var daysSince = Math.floor((dd.getTime() - lpd.getTime()) / 86400000);
    var dic = ((daysSince % cLen) + cLen) % cLen;
    if (dic === 0 && daysSince > 0) dic = cLen;
    var t = dic / cLen;
    var hm = calcHormones(dic, cLen);
    var ph = getPhase(dic, cLen, pLen);
    var pp = phaseProfile(ph.name);
    var ds = isoDate(dd);
    var isT = isoDate(today) === ds;
    var me = entryMap[ds] || null;
    var fs = null, ft = null;
    if (me) { fs = fitScore(me.score, ph.name, t, pLen/cLen); ft = fitTier(fs); }
    pts.push({
      date: ds, disp: (dd.getMonth()+1)+"/"+dd.getDate(), dayInCycle: dic,
      estrogen: hm.estrogen, progesterone: hm.progesterone, lh: hm.lh, fsh: hm.fsh,
      phase: ph.name, phaseColor: ph.color,
      predMood: pp.avg, patience: pp.patience, energy: pp.energy,
      isPred: dd.getTime() > today.getTime(), isToday: isT,
      moodScore: me ? me.score : null, moodLabel: me ? me.label : null,
      fitScore: fs, fitLabel: ft ? ft.label : null, fitColor: ft ? ft.color : null,
      moodRange: me ? [pp.avg, me.score] : null,
      delta: me ? me.delta : null
    });
  }
  return pts;
}

function upcomingWindows(chart) {
  var wins = [], cur = null;
  for (var i=0; i<chart.length; i++) {
    var p = chart[i];
    if (!p.isPred) continue;
    var tp = (p.phase==="Luteal"||p.phase==="Menstruation") ? "Sensitive" : "Resilient";
    if (!cur) { cur = {type:tp, start:p.date, end:p.date, phase:p.phase, color: tp==="Sensitive"?"#ef5350":"#4caf50"}; }
    else if (cur.type===tp && cur.phase===p.phase) { cur.end = p.date; }
    else { wins.push(cur); cur = {type:tp, start:p.date, end:p.date, phase:p.phase, color: tp==="Sensitive"?"#ef5350":"#4caf50"}; }
  }
  if (cur) wins.push(cur);
  return wins.slice(0,6);
}

function emoji(score) {
  if (score===null||score===undefined) return "";
  if (score>=2)  return "\u1F604";
  if (score===1) return "\u1F642";
  if (score===0) return "\u1F610";
  if (score===-1) return "\u1F641";
  return "\u1F621";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    MOOD_WORDS: MOOD_WORDS,
    FILLER_WORDS: FILLER_WORDS,
    calcHormones: calcHormones,
    getPhase: getPhase,
    phaseProfile: phaseProfile,
    fitScore: fitScore,
    fitTier: fitTier,
    isoDate: isoDate,
    fmtDate: fmtDate,
    extractDate: extractDate,
    classifyMood: classifyMood,
    isPeriodEntry: isPeriodEntry,
    parseInput: parseInput,
    generateChart: generateChart,
    upcomingWindows: upcomingWindows,
    emoji: emoji
  };
}
