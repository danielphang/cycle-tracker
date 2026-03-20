/* ═══════════════════════════════════════════════════════════════════
   Cycle Intelligence — app.js
   Pure React.createElement (no JSX, no build step, no Babel)
   Compat: no arrow fns, no **, var in functions, catch(err)
   ═══════════════════════════════════════════════════════════════════ */

var useState     = React.useState;
var useEffect    = React.useEffect;
var useMemo      = React.useMemo;
var useRef       = React.useRef;
var useCallback  = React.useCallback;
var h            = React.createElement;

var ComposedChart     = Recharts.ComposedChart;
var Line              = Recharts.Line;
var Area              = Recharts.Area;
var XAxis             = Recharts.XAxis;
var YAxis             = Recharts.YAxis;
var CartesianGrid     = Recharts.CartesianGrid;
var RTooltip          = Recharts.Tooltip;
var ResponsiveContainer = Recharts.ResponsiveContainer;
var ReferenceLine     = Recharts.ReferenceLine;
var Scatter           = Recharts.Scatter;

/* ── Mobile Detection ──────────────────────────────────────────── */

function useIsMobile(breakpoint) {
  var bp = breakpoint || 768;
  var _m = useState(typeof window !== "undefined" && window.innerWidth <= bp);
  var mobile = _m[0]; var setMobile = _m[1];
  useEffect(function() {
    function onResize() { setMobile(window.innerWidth <= bp); }
    window.addEventListener("resize", onResize);
    return function() { window.removeEventListener("resize", onResize); };
  }, [bp]);
  return mobile;
}

/* ── Hormonal Model ─────────────────────────────────────────────── */

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

/* ── Fit Scoring ────────────────────────────────────────────────── */

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

/* ── NLP Parser ─────────────────────────────────────────────────── */

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
  var remainder = lower;
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

/* ── Chart Data ─────────────────────────────────────────────────── */

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
      fitScore: fs, fitLabel: ft ? ft.label : null, fitColor: ft ? ft.color : null
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
  if (score>=2)  return "\u{1F604}";
  if (score===1) return "\u{1F642}";
  if (score===0) return "\u{1F610}";
  if (score===-1) return "\u{1F641}";
  return "\u{1F621}";
}

/* ── Sub Components ─────────────────────────────────────────────── */

function MoodDot(props) {
  var cx = props.cx, cy = props.cy, payload = props.payload;
  if (!payload || payload.moodScore === null) return null;
  var fs = payload.fitScore || 0;
  var rO = 5, dash = undefined, col = "#4caf50";
  if (fs < 0.45)      { rO = 9; dash = "3 2"; col = "#ef5350"; }
  else if (fs < 0.75) { rO = 7; col = "#ffa726"; }
  return h("g", null,
    h("circle", { cx:cx, cy:cy, r:rO, fill:"none", stroke:col, strokeWidth:1.5, strokeDasharray:dash }),
    h("circle", { cx:cx, cy:cy, r:4, fill:"#ffa726", stroke:"#1a1a2e", strokeWidth:1 })
  );
}

function ChartTip(props) {
  if (!props.active || !props.payload || !props.payload.length) return null;
  var d = props.payload[0].payload;
  return h("div", { style:{background:"#1a1a2e",border:"1px solid #555",padding:14,borderRadius:10,color:"#e0e0e0",minWidth:220,fontSize:13} },
    h("p", {style:{margin:"0 0 6px",fontWeight:"bold"}}, d.disp+" ", h("span",{style:{color:d.phaseColor}},"("+d.phase+")")),
    h("div", {style:{display:"flex",gap:12,marginBottom:4}},
      h("span",null, h("span",{style:{color:"#f06292"}},"Est:")," "+Math.round(d.estrogen)+"%"),
      h("span",null, h("span",{style:{color:"#ce93d8"}},"Prog:")," "+Math.round(d.progesterone)+"%")
    ),
    h("div", {style:{display:"flex",gap:12,borderBottom:"1px solid rgba(255,255,255,0.1)",paddingBottom:8,marginBottom:8}},
      h("span",null, h("span",{style:{color:"#ffb74d"}},"LH:")," "+Math.round(d.lh)+"%"),
      h("span",null, h("span",{style:{color:"#81d4fa"}},"FSH:")," "+Math.round(d.fsh)+"%")
    ),
    d.moodScore !== null && h("div", {style:{background:"rgba(255,255,255,0.05)",padding:8,borderRadius:6}},
      h("div",null, h("strong",null,"Logged: "), emoji(d.moodScore)+" "+(d.moodScore>0?"+"+d.moodScore:d.moodScore)),
      h("div",{style:{fontSize:12,fontStyle:"italic",marginTop:4,wordBreak:"break-word"}}, '"'+(d.moodLabel||"")+'"'),
      d.fitScore !== null && h("div",{style:{marginTop:6,color:d.fitColor,fontWeight:"bold"}}, d.fitLabel+" ("+Math.round(d.fitScore*100)+"%)")
    )
  );
}

function PhaseBar(props) {
  var cLen = props.cycleLength || 27;
  var pLen = props.periodLength || 5;
  var todayPhase = props.todayPhase;
  var segs = [
    { name:"Menstruation", w: Math.max(0,(pLen/cLen)*100), color:"#c2185b" },
    { name:"Follicular",   w: Math.max(0,((cLen*0.45-pLen)/cLen)*100), color:"#7b1fa2" },
    { name:"Ovulation",    w: 10, color:"#ff6f00" },
    { name:"Luteal",       w: 45, color:"#00695c" }
  ];
  return h("div", {style:{display:"flex",width:"100%",height:32,borderRadius:16,overflow:"hidden",marginTop:20}},
    segs.map(function(s,i) {
      return h("div", {key:i, style:{width:s.w+"%",background:s.color,display:"flex",alignItems:"center",justifyContent:"center",position:"relative",transition:"width .3s"}},
        h("span",{style:{fontSize:10,color:"#fff",fontWeight:700,whiteSpace:"nowrap"}}, s.w>12?s.name:s.name.charAt(0)),
        todayPhase===s.name && h("div",{className:"tri-pulse"})
      );
    })
  );
}

/* ── Hormonal Chart (reusable) ──────────────────────────────────── */
function HormoneChart(props) {
  var chart = props.data;
  var todayDisp = props.todayDisp;
  var chartH = props.height || 260;
  var gIdE = props.gIdE || "eG";
  var gIdP = props.gIdP || "pG";
  var showLabel = props.showTodayLabel;
  var mob = props.mobile;

  return h("div", {style:{width:"100%",height:chartH}},
    h(ResponsiveContainer, {width:"100%",height:"100%"},
      h(ComposedChart, {data:chart, margin:mob?{top:6,right:10,bottom:16,left:0}:{top:10,right:30,bottom:20,left:10}},
        h("defs", null,
          h("linearGradient",{id:gIdE,x1:0,y1:0,x2:0,y2:1},
            h("stop",{offset:"0%",stopColor:"#f06292",stopOpacity:0.25}),
            h("stop",{offset:"100%",stopColor:"#f06292",stopOpacity:0})
          ),
          h("linearGradient",{id:gIdP,x1:0,y1:0,x2:0,y2:1},
            h("stop",{offset:"0%",stopColor:"#ce93d8",stopOpacity:0.25}),
            h("stop",{offset:"100%",stopColor:"#ce93d8",stopOpacity:0})
          )
        ),
        h(CartesianGrid, {strokeDasharray:"3 3",stroke:"rgba(255,255,255,0.05)",vertical:false}),
        h(XAxis, {dataKey:"disp",stroke:"#666",fontSize:11,tickMargin:8,minTickGap:30}),
        h(YAxis, {domain:[0,100],stroke:"#666",fontSize:11}),
        h(RTooltip, {content: h(ChartTip)}),
        h(ReferenceLine, {x:todayDisp,stroke:"#eee",strokeDasharray:"5 5",
          label: showLabel ? {position:"top",value:"Today",fill:"#eee",fontSize:11} : undefined}),
        h(Area, {type:"monotone",dataKey:"estrogen",fill:"url(#"+gIdE+")",stroke:"none"}),
        h(Area, {type:"monotone",dataKey:"progesterone",fill:"url(#"+gIdP+")",stroke:"none"}),
        h(Line, {type:"monotone",dataKey:"estrogen",stroke:"#f06292",strokeWidth:2.5,dot:false,isAnimationActive:false}),
        h(Line, {type:"monotone",dataKey:"progesterone",stroke:"#ce93d8",strokeWidth:2.5,dot:false,isAnimationActive:false}),
        h(Line, {type:"monotone",dataKey:"lh",stroke:"#ffb74d",strokeWidth:1.5,strokeDasharray:"4 4",dot:false,isAnimationActive:false}),
        h(Line, {type:"monotone",dataKey:"fsh",stroke:"#81d4fa",strokeWidth:1.5,strokeDasharray:"4 4",dot:false,isAnimationActive:false})
      )
    )
  );
}

function HormoneLegend() {
  return h("div", {style:{display:"flex",gap:"6px 16px",justifyContent:"center",flexWrap:"wrap",fontSize:12,paddingBottom:6}},
    h("span",{style:{color:"#f06292",fontWeight:700}},"\u2014 Estrogen"),
    h("span",{style:{color:"#ce93d8",fontWeight:700}},"\u2014 Progesterone"),
    h("span",{style:{color:"#ffb74d",fontWeight:700}},"- - LH"),
    h("span",{style:{color:"#81d4fa",fontWeight:700}},"- - FSH")
  );
}

/* ═════════════════════════════════════════════════════════════════
   Main App
   ═════════════════════════════════════════════════════════════════ */

function App() {
  var _s  = useState(null);        var data    = _s[0]; var setData    = _s[1];
  var _t  = useState("Dashboard"); var tab     = _t[0]; var setTab     = _t[1];
  var _i  = useState("");          var inp     = _i[0]; var setInp     = _i[1];
  var _ts = useState([]);          var toasts  = _ts[0]; var setToasts = _ts[1];
  var _lp = useState(false);       var isParsing = _lp[0]; var setIsParsing = _lp[1];
  var _lr = useState(null);        var llmResult = _lr[0]; var setLlmResult = _lr[1];
  var idRef = useRef(0);
  var mobile = useIsMobile();

  function toast(type, msg) {
    var id = ++idRef.current;
    setToasts(function(prev) { return prev.concat([{id:id,type:type,msg:msg}]); });
    setTimeout(function() { setToasts(function(prev) { return prev.filter(function(t){return t.id!==id;}); }); }, 4000);
  }

  function refresh() {
    fetch("/api/data")
      .then(function(r){return r.json();})
      .then(function(d){setData(d);})
      .catch(function(err){console.error("load err",err);});
  }

  useEffect(function(){ refresh(); }, []);

  function fetchParse(text) {
    if (!text || text.trim().length < 3) return Promise.resolve(null);
    setIsParsing(true);
    return fetch("/api/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text })
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      setIsParsing(false);
      if (d.parsed && d.parsed.understood && d.parsed.entries && d.parsed.entries.length > 0) {
        setLlmResult(d.parsed);
        return d.parsed;
      }
      return null;
    })
    .catch(function(err) {
      console.error("parse err", err);
      setIsParsing(false);
      return null;
    });
  }

  var localPreview = useMemo(function(){ return parseInput(inp); }, [inp]);
  var preview = useMemo(function() {
    if (llmResult && llmResult.understood && llmResult.entries && llmResult.entries.length > 0) {
      if (llmResult.entries.length === 1) {
        var e = llmResult.entries[0];
        return { valid: true, type: e.type, date: e.date, score: e.score, word: e.summary, summary: e.summary, label: e.original_text || inp };
      }
      return { valid: true, type: "multiple", entries: llmResult.entries };
    }
    return localPreview;
  }, [llmResult, localPreview, inp]);

  var chart = useMemo(function(){
    if (!data) return [];
    return mobile ? generateChart(data, 30, 60) : generateChart(data);
  }, [data, mobile]);

  var todayPt = useMemo(function(){
    for (var i=0; i<chart.length; i++) { if (chart[i].isToday) return chart[i]; }
    var fallback = mobile ? 30 : 45;
    return chart[fallback] || null;
  }, [chart, mobile]);

  var windows = useMemo(function(){ return upcomingWindows(chart); }, [chart]);

  var chartMap = useMemo(function(){
    var m = {};
    for (var i=0; i<chart.length; i++) m[chart[i].date] = chart[i];
    return m;
  }, [chart]);

  var confidence = useMemo(function(){
    if (!data||!data.moodEntries) return {avg:0,n:0,hormonal:0,partial:0,situational:0,outliers:[]};
    var total=0,n=0,hh=0,pp=0,ss=0,outs=[];
    for (var i=0; i<data.moodEntries.length; i++) {
      var e = data.moodEntries[i];
      var pt = chartMap[e.date];
      if (pt && pt.fitScore !== null) {
        n++; total+=pt.fitScore;
        if (pt.fitScore>=0.75) hh++;
        else if (pt.fitScore>=0.45) pp++;
        else { ss++; outs.push({entry:e,pt:pt}); }
      }
    }
    outs.sort(function(a,b){return b.entry.date<a.entry.date?-1:1;});
    return {avg: n>0?total/n:0, n:n, hormonal:hh, partial:pp, situational:ss, outliers:outs.slice(0,3)};
  }, [data, chartMap]);

  /* ── Handlers ─────────────────────────────────────────────── */
  function doLog(resolvedPreview) {
    var p = resolvedPreview || preview;
    if (!p.valid) return;

    var entries = [];
    if (p.type === "multiple") {
      entries = p.entries;
    } else {
      entries = [p];
    }

    entries.forEach(function(entry) {
      if (entry.type === "period") {
        fetch("/api/period", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({date:entry.date}) })
          .then(function(r){return r.json();})
          .then(function(d){setData(d); toast("success","Logged period start: "+fmtDate(entry.date));})
          .catch(function(err){toast("error","Save failed");});
      } else if (entry.type === "mood") {
        var lbl = entry.label || entry.summary || inp.trim();
        fetch("/api/mood", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({date:entry.date,score:entry.score,label:lbl}) })
          .then(function(){refresh(); toast("success","Logged mood ("+(entry.score>0?"+":"")+entry.score+") for "+fmtDate(entry.date));})
          .catch(function(err){toast("error","Save failed");});
      }
    });

    setInp("");
    setLlmResult(null);
  }

  function handleLog() {
    if (isParsing) return;
    var text = inp.trim();
    if (!text) return;

    // If we already have an LLM result, use it directly
    if (llmResult && llmResult.understood && llmResult.entries && llmResult.entries.length > 0) {
      doLog(preview);
      return;
    }

    // Otherwise, fire LLM parse then log
    fetchParse(text).then(function(parsed) {
      if (parsed && parsed.entries && parsed.entries.length > 0) {
        // Build preview from LLM result and log
        var llmPreview;
        if (parsed.entries.length === 1) {
          var e = parsed.entries[0];
          llmPreview = { valid: true, type: e.type, date: e.date, score: e.score, word: e.summary, summary: e.summary, label: e.original_text || text };
        } else {
          llmPreview = { valid: true, type: "multiple", entries: parsed.entries };
        }
        doLog(llmPreview);
      } else {
        // Fall back to local parser
        var local = parseInput(text);
        if (local.valid) {
          doLog(local);
        } else {
          toast("error", "Could not understand input. Try a mood word or \"period started\".");
        }
      }
    });
  }

  function handleDeletePeriod(dateStr) {
    fetch("/api/period/delete", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({date:dateStr}) })
      .then(function(r){return r.json();})
      .then(function(d){setData(d); toast("info","Removed period date");})
      .catch(function(err){toast("error","Delete failed");});
  }

  // Loading
  if (!data || !todayPt) {
    return h("div", {style:{display:"flex",justifyContent:"center",alignItems:"center",height:"100vh",color:"#aaa",fontSize:18}}, "Loading Cycle Intelligence\u2026");
  }

  var todayProf = phaseProfile(todayPt.phase);

  /* ── Build UI ─────────────────────────────────────────────── */
  return h("div", {style:{padding:mobile?"12px 10px 40px":"20px 20px 60px",maxWidth:920,margin:"0 auto"}},

    // Toasts
    h("div",{className:"toast-wrap"},
      toasts.map(function(t){
        var bg = t.type==="success"?"#2e7d32": t.type==="error"?"#c62828":"#1565c0";
        return h("div",{key:t.id,className:"toast",style:{background:bg}}, t.msg);
      })
    ),

    // Header
    h("h1",{className:"serif",style:{textAlign:"center",fontSize:mobile?26:38,marginBottom:4,letterSpacing:0.5}},"Cycle Intelligence"),
    h("p",{style:{textAlign:"center",color:"#888",marginBottom:mobile?16:28,fontSize:mobile?13:14}},"Hormonal pattern analysis for relationship well-being"),

    // Tabs
    h("div",{style:{display:"flex",gap:mobile?6:10,justifyContent:"center",marginBottom:mobile?16:24}},
      ["Dashboard","Hormones","History"].map(function(t){
        return h("button",{key:t,className:"tab-btn"+(tab===t?" active":""),onClick:function(){setTab(t);}},t);
      })
    ),

    // ─── Status Card ────────────────────────────────────────
    h("div",{className:"card"},
      h("h2",{className:"serif",style:{marginBottom:6,fontSize:22}}, "Day "+todayPt.dayInCycle+" of "+(data.cycleLength||27)),
      h("div",{style:{display:"flex",alignItems:"center",gap:12,marginBottom:12}},
        h("span",{style:{padding:"5px 14px",background:todayPt.phaseColor,borderRadius:16,fontSize:13,fontWeight:700}}, todayPt.phase+" Phase")
      ),
      h("p",{style:{fontStyle:"italic",color:"#bbb",marginBottom:12,fontSize:15}}, "\u201C"+todayProf.tip+"\u201D"),
      h("div",{style:{display:mobile?"grid":"flex",gridTemplateColumns:mobile?"1fr 1fr":undefined,gap:mobile?"8px 12px":24,flexWrap:"wrap"}},
        h("span",{className:"stat"},"Patience: ",h("strong",null,todayProf.patience+"%")),
        h("span",{className:"stat"},"Energy: ",h("strong",null,todayProf.energy+"%")),
        h("span",{className:"stat"},"Estrogen: ",h("strong",null,Math.round(todayPt.estrogen)+"%")),
        h("span",{className:"stat"},"Progesterone: ",h("strong",null,Math.round(todayPt.progesterone)+"%"))
      )
    ),

    // ─── Upcoming Windows ───────────────────────────────────
    windows.length > 0 && h("div",{style:{marginBottom:20}},
      h("h3",{className:"serif",style:{marginBottom:10}},"Upcoming Conversation Windows"),
      h("div",{style:{display:"flex",flexDirection:mobile?"column":"row",gap:12,overflowX:mobile?"visible":"auto",paddingBottom:8}},
        windows.map(function(w,i){
          return h("div",{key:i,style:{background:"rgba(255,255,255,0.04)",minWidth:mobile?0:190,borderRadius:12,padding:mobile?12:14,borderLeft:"4px solid "+w.color,flexShrink:0}},
            h("div",{style:{color:w.color,fontWeight:700,marginBottom:4,fontSize:14}},w.type),
            h("div",{style:{fontSize:13}}, fmtDate(w.start)+" \u2013 "+fmtDate(w.end)),
            h("div",{style:{fontSize:11,color:"#888",marginTop:4}},w.phase)
          );
        })
      )
    ),

    // ─── Model Confidence ───────────────────────────────────
    h("div",{className:"card"},
      h("h3",{className:"serif",style:{marginBottom:10}},"Model Confidence"),
      h("div",{style:{display:"flex",flexDirection:mobile?"column":"row",alignItems:mobile?"flex-start":"center",gap:mobile?10:20}},
        h("div",{style:{fontSize:mobile?36:44,fontWeight:700,color:fitTier(confidence.avg).color}},
          confidence.n>0 ? Math.round(confidence.avg*100)+"%" : "N/A"
        ),
        h("div",null,
          h("div",{style:{fontWeight:700,fontSize:mobile?14:16,marginBottom:4}}, fitTier(confidence.avg).label),
          h("div",{style:{fontSize:mobile?12:13,color:"#aaa"}}, confidence.hormonal+" Hormonal \u00B7 "+confidence.partial+" Partial \u00B7 "+confidence.situational+" Situational")
        )
      ),
      confidence.outliers.length>0 && h("div",{style:{marginTop:14,paddingTop:14,borderTop:"1px solid rgba(255,255,255,0.08)"}},
        h("div",{style:{fontSize:12,fontWeight:700,color:"#ef5350",marginBottom:8}},"Notable Outliers"),
        confidence.outliers.map(function(o,i){
          return h("div",{key:i,style:{background:"rgba(0,0,0,0.2)",padding:10,borderRadius:8,marginBottom:6,fontSize:13}},
            h("strong",{style:{color:"#ddd"}}, fmtDate(o.entry.date)+": "),
            '"'+o.entry.label+'" (',
            h("span",{style:{color:"#ef5350"}},o.pt.phase),
            " phase \u2014 likely situational)"
          );
        })
      )
    ),

    // ─── Input Area ─────────────────────────────────────────
    h("div",{className:"card"},
      h("h3",{className:"serif",style:{marginBottom:10}},"Log Observation"),
      h("div",{style:{display:"flex",flexDirection:mobile?"column":"row",gap:10}},
        h("input",{
          type:"text",value:inp,
          onChange:function(e){setInp(e.target.value);},
          onKeyDown:function(e){if(e.key==="Enter")handleLog();},
          placeholder:mobile?"e.g. \"she was irritable\" or \"period today\"":"e.g. \"yesterday she was really irritable\" or \"got my period today\"",
          style:{flex:1,padding:mobile?"10px 12px":"12px 14px",borderRadius:10,border:"1px solid rgba(255,255,255,0.15)",background:"rgba(0,0,0,0.25)",color:"#fff",fontSize:mobile?14:15}
        }),
        h("button",{
          disabled:isParsing || !inp.trim(), onClick:handleLog,
          style:{padding:mobile?"10px 0":"12px 24px",borderRadius:10,border:"none",background:"#7b1fa2",color:"#fff",fontWeight:700,opacity:(!isParsing && inp.trim())?1:0.4,cursor:(!isParsing && inp.trim())?"pointer":"not-allowed",transition:"opacity .2s",width:mobile?"100%":undefined}
        }, isParsing ? "..." : "Log")
      ),
      inp && h("div",{style:{marginTop:10,fontSize:13,display:"flex",alignItems:"center",gap:8,color:preview.valid?"#4caf50":"#888"}},
        h("span",null, isParsing ? "\u23F3" : (preview.valid?"\u2705":"\u{1F4AD}")),
        isParsing && h("span",null,"Parsing with Gemini..."),
        !isParsing && preview.type==="multiple" && h("span",null,"Multiple events detected: " + preview.entries.length + " entries."),
        !isParsing && preview.type==="period" && h("span",null,"Period start detected \u2192 "+fmtDate(preview.date)),
        !isParsing && preview.type==="mood" && h("span",null, "Mood: \""+(preview.word || preview.summary)+"\" ("+(preview.score>0?"+":"")+preview.score+") \u2192 "+fmtDate(preview.date)),
        !isParsing && !preview.valid && h("span",null,"Press Enter or click Log to parse with Gemini")
      )
    ),

    // ═══════════════════════════════════════════════════════════
    //  DASHBOARD
    // ═══════════════════════════════════════════════════════════
    tab==="Dashboard" && h("div",null,
      h("div",{className:"card",style:{paddingRight:0}},
        h("h3",{className:"serif",style:{marginBottom:10,paddingRight:20}},"Mood Trajectory"),
        h("div",{style:{width:"100%",height:mobile?260:340}},
          h(ResponsiveContainer,{width:"100%",height:"100%"},
            h(ComposedChart,{data:chart,margin:mobile?{top:10,right:10,bottom:16,left:0}:{top:20,right:30,bottom:20,left:10}},
              h("defs",null,
                h("linearGradient",{id:"moodG",x1:0,y1:0,x2:0,y2:1},
                  h("stop",{offset:"0%",stopColor:"#4caf50",stopOpacity:0.35}),
                  h("stop",{offset:"50%",stopColor:"#e0e0e0",stopOpacity:0.03}),
                  h("stop",{offset:"100%",stopColor:"#ef5350",stopOpacity:0.35})
                )
              ),
              h(CartesianGrid,{strokeDasharray:"3 3",stroke:"rgba(255,255,255,0.05)",vertical:false}),
              h(XAxis,{dataKey:"disp",stroke:"#666",fontSize:11,tickMargin:8,minTickGap:30}),
              h(YAxis,{domain:[-3,3],stroke:"#666",fontSize:11,ticks:[-3,-2,-1,0,1,2,3]}),
              h(RTooltip,{content:h(ChartTip)}),
              h(ReferenceLine,{x:todayPt.disp,stroke:"#eee",strokeDasharray:"5 5",label:{position:"top",value:"Today",fill:"#eee",fontSize:11}}),
              h(Area,{type:"monotone",dataKey:"predMood",fill:"url(#moodG)",stroke:"none"}),
              h(Line,{type:"monotone",dataKey:"predMood",stroke:"#78909c",strokeWidth:2,strokeDasharray:"5 5",dot:false,isAnimationActive:false}),
              h(Scatter,{dataKey:"moodScore",shape:MoodDot,isAnimationActive:false})
            )
          )
        )
      ),
      h("div",{className:"card",style:{paddingRight:0}},
        h("h3",{className:"serif",style:{marginBottom:10,paddingRight:20}},"Hormonal Indicators"),
        h(HormoneChart,{data:chart,todayDisp:todayPt.disp,height:mobile?200:240,gIdE:"eG1",gIdP:"pG1",mobile:mobile}),
        h(HormoneLegend)
      ),
      h(PhaseBar,{cycleLength:data.cycleLength,periodLength:data.periodLength,todayPhase:todayPt.phase})
    ),

    // ═══════════════════════════════════════════════════════════
    //  HORMONES
    // ═══════════════════════════════════════════════════════════
    tab==="Hormones" && h("div",null,
      h("div",{className:"card",style:{paddingRight:0}},
        h("h3",{className:"serif",style:{marginBottom:10,paddingRight:20}},"Hormonal Trajectories"),
        h(HormoneChart,{data:chart,todayDisp:todayPt.disp,height:mobile?280:380,gIdE:"eG2",gIdP:"pG2",showTodayLabel:true,mobile:mobile}),
        h(HormoneLegend)
      ),
      h("h3",{className:"serif",style:{marginBottom:10}},"Phase Guide"),
      h("div",{style:{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))",gap:12,marginBottom:16}},
        ["Menstruation","Follicular","Ovulation","Luteal"].map(function(pn){
          var pp = phaseProfile(pn);
          var cols = {Menstruation:"#c2185b",Follicular:"#7b1fa2",Ovulation:"#ff6f00",Luteal:"#00695c"};
          return h("div",{key:pn,style:{background:"rgba(255,255,255,0.04)",borderRadius:12,padding:16,borderTop:"4px solid "+cols[pn]}},
            h("h4",{style:{margin:"0 0 8px",color:cols[pn]}},pn),
            h("div",{style:{fontSize:13,color:"#aaa",marginBottom:10}},pp.tip),
            h("div",{style:{display:"flex",justifyContent:"space-between",fontSize:12,borderTop:"1px solid rgba(255,255,255,0.08)",paddingTop:8}},
              h("span",null,"Patience: ",h("strong",null,pp.patience+"%")),
              h("span",null,"Energy: ",h("strong",null,pp.energy+"%"))
            )
          );
        })
      ),
      h(PhaseBar,{cycleLength:data.cycleLength,periodLength:data.periodLength,todayPhase:todayPt.phase})
    ),

    // ═══════════════════════════════════════════════════════════
    //  HISTORY
    // ═══════════════════════════════════════════════════════════
    tab==="History" && h("div",null,
      h("div",{className:"card"},
        h("div",{style:{display:"flex",flexDirection:mobile?"column":"row",justifyContent:"space-between",alignItems:mobile?"flex-start":"center",gap:mobile?4:0,marginBottom:12}},
          h("h3",{className:"serif",style:{margin:0,fontSize:mobile?16:undefined}},"Cycle Length: "+(data.cycleLength||27)+" days"),
          h("span",{style:{fontSize:12,color:"#888"}},"computed from period history")
        ),
        h("h4",{style:{color:"#c2185b",margin:"0 0 10px"}},"Period Start Dates"),
        h("div",{style:{display:"flex",flexWrap:"wrap",gap:8}},
          (data.periodDays||[]).slice().sort().reverse().map(function(pd){
            return h("div",{key:pd,style:{display:"flex",alignItems:"center",gap:6,background:"rgba(194,24,91,0.15)",padding:"6px 14px",borderRadius:20,fontSize:13,border:"1px solid rgba(194,24,91,0.3)"}},
              h("span",null,"\u{1FA78} "+fmtDate(pd)),
              h("button",{onClick:function(){handleDeletePeriod(pd);},style:{background:"none",border:"none",color:"#c2185b",cursor:"pointer",fontWeight:700,fontSize:14,padding:0,marginLeft:4}},"\u00D7")
            );
          })
        )
      ),
      h("h3",{className:"serif",style:{marginBottom:10}},"Mood Log"),
      (data.moodEntries||[]).slice().sort(function(a,b){return b.date<a.date?-1:1;}).map(function(e,i){
        var pt = chartMap[e.date];
        var ft2 = pt && pt.fitScore!==null ? fitTier(pt.fitScore) : null;
        return h("div",{key:i,className:"card",style:{margin:"0 0 12px",display:"flex",gap:mobile?10:14,alignItems:"flex-start"}},
          h("div",{style:{fontSize:mobile?22:28,background:"rgba(0,0,0,0.3)",width:mobile?38:48,height:mobile?38:48,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}, emoji(e.score)),
          h("div",{style:{flex:1,minWidth:0}},
            h("div",{style:{display:"flex",justifyContent:"space-between",marginBottom:4}},
              h("span",{style:{fontWeight:700}}, fmtDate(e.date)+" ",
                pt && h("span",{style:{color:pt.phaseColor,fontWeight:400,fontSize:13}},"("+pt.phase+")")
              ),
              h("span",{style:{fontWeight:700,color:e.score>0?"#4caf50":"#ef5350"}}, e.score>0?"+"+e.score:e.score)
            ),
            h("p",{style:{margin:"0 0 8px",fontSize:14,color:"#ccc",wordBreak:"break-word"}}, '"'+e.label+'"'),
            ft2 && h("span",{style:{display:"inline-block",padding:"4px 10px",borderRadius:6,border:"1px solid "+ft2.color,fontSize:12,color:ft2.color,fontWeight:600}},
              ft2.label+" ("+Math.round(pt.fitScore*100)+"%)"
            )
          )
        );
      }),
      h(PhaseBar,{cycleLength:data.cycleLength,periodLength:data.periodLength,todayPhase:todayPt.phase})
    )
  );
}
