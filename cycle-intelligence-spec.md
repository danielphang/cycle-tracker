# Cycle Intelligence — Full Application Spec

## Overview

A single-file React JSX application (`.jsx`) that models a woman's menstrual cycle, maps hormonal trajectories, tracks observed mood incidents, scores how well each observation fits the hormonal model (to avoid overfitting), and predicts upcoming "safe" vs "sensitive" conversation windows. Data persists across sessions via `window.storage` key-value API.

**Stack:** React (hooks only), Recharts, `window.storage` for persistence. Single file, no build step. No localStorage/sessionStorage. No arrow functions (compatibility). No `**` operator — use `Math.pow()`. No emoji characters in SVG elements — use Unicode escapes or helper functions. All `catch` blocks must have a parameter. Use `var` declarations inside functions for maximum compatibility.

**Design:** Dark theme. Background gradient `#0d0d1a → #1a1a2e → #16213e`. Fonts: Playfair Display (headings), DM Sans (body) via Google Fonts link. Color-coded by cycle phase. Cards with `rgba(255,255,255,0.03)` background, `1px solid rgba(255,255,255,0.06)` border, 16px border-radius.

---

## Data Model

### Persistent State (stored as JSON under key `"cycle-tracker-v3"`)

```
{
  lastPeriodStart: "YYYY-MM-DD",     // Most recent period start date
  cycleLength: number,                // Calculated average cycle length in days (default 27)
  periodLength: number,               // Days of menstruation (default 5)
  moodEntries: [                      // Array of mood observations
    {
      date: "YYYY-MM-DD",
      score: number,                  // -3 to +3 (see Mood Scoring below)
      label: string                   // Human-readable description
    }
  ],
  periodDays: ["YYYY-MM-DD", ...]    // All logged period start dates (sorted)
}
```

### Seed Data (pre-loaded on first run)

```
lastPeriodStart: "2026-03-04"
cycleLength: 27
periodLength: 5
moodEntries:
  - 2026-02-01, score -2, "high irritability — scolded for mentioning credit card churning, escalated to screaming"
  - 2026-02-14, score -2, "fight over Valentine's Day weekend"
  - 2026-02-15, score -2, "fight continued (Valentine's weekend)"
  - 2026-02-28, score -2, "overreaction to missed text message"
  - 2026-03-05, score -2, "high sensitivity, very low frustration threshold"
  - 2026-03-07, score -2, "irritable"
periodDays: ["2026-02-05", "2026-03-04"]
```

### Storage Logic

- On mount: load from `window.storage.get("cycle-tracker-v3")`. Only overwrite seed data if saved data has `moodEntries.length > 0`.
- On every state change (after initial load): save to `window.storage.set("cycle-tracker-v3", JSON.stringify(data))`.
- All storage calls wrapped in try/catch. Failures logged but don't crash the app.

---

## Hormonal Model

### Four Hormones (normalized 0–100%)

All modeled as Gaussian curves over normalized cycle position `t = dayInCycle / cycleLength`:

**Estrogen:**
```
20 + 60 * exp(-((t - 0.46) / 0.06)^2)     // primary peak at ovulation
   + 25 * exp(-((t - 0.72) / 0.12)^2)      // secondary luteal rise
   - 15 * exp(-((t - 0.55) / 0.04)^2)      // post-ovulation dip
```

**Progesterone:**
```
5 + 80 * exp(-((t - 0.75) / 0.12)^2)       // peaks mid-luteal
```

**LH (Luteinizing Hormone):**
```
8 + 90 * exp(-((t - 0.48) / 0.025)^2)      // sharp spike at ovulation
```

**FSH (Follicle-Stimulating Hormone):**
```
15 + 35 * exp(-((t - 0.12) / 0.08)^2)      // early follicular rise
   + 25 * exp(-((t - 0.48) / 0.03)^2)      // small ovulation peak
```

All values clamped to `[0, 100]`.

### Phase Determination

Given `dayInCycle` and `cycleLength`:

| Phase | Condition | Color |
|-------|-----------|-------|
| Menstruation | `dayInCycle <= periodLength` | `#c2185b` |
| Follicular | `t <= 0.45` | `#7b1fa2` |
| Ovulation | `t <= 0.55` | `#ff6f00` |
| Luteal | `t > 0.55` | `#00695c` |

### Phase Mood Profiles

| Phase | Mood Range | Avg Mood | Patience | Energy | Conversation Tip |
|-------|-----------|----------|----------|--------|-----------------|
| Menstruation | [-2, 0] | -1.0 | 25% | 20% | Not the time for difficult topics |
| Follicular | [0, +2] | +1.2 | 75% | 70% | Good window for important conversations |
| Ovulation | [+1, +3] | +2.0 | 90% | 95% | Best time for big talks and date nights |
| Luteal | [-3, +1] | -0.8 | 30% | 35% | Tread carefully, save confrontations |

---

## Hormonal Fit Scoring

Each logged mood observation gets a fit score (0–1) indicating how well it matches the expected hormonal phase. This prevents overfitting — not every bad mood is PMS.

### Scoring Formula

Three weighted components:

1. **Range Score (40%):** Does the mood score fall within the phase's expected `moodRange`?
   - Inside range → 1.0
   - Outside → `max(0, 1 - distance / 3)`

2. **Direction Score (45%):** Does the mood polarity match what the phase predicts?
   - Bad mood during luteal/menstruation → 1.0
   - Good mood during follicular/ovulation → 1.0
   - Neutral → 1.0
   - Mismatch → 0.15

3. **Phase Confidence (15%):** How deep into the phase is the observation?
   - Near a phase boundary (within 4% of transition point) → 0.5
   - Solidly within phase → 0.8

`finalScore = rangeScore * 0.4 + dirScore * 0.45 + phaseConf * 0.15` (clamped to [0, 1])

### Fit Tiers

| Score | Label | Color | Meaning |
|-------|-------|-------|---------|
| >= 0.75 | "Hormonal fit" | `#4caf50` (green) | Aligns with expected phase patterns |
| >= 0.45 | "Partial fit" | `#ffa726` (amber) | Some hormonal contribution, but mixed |
| < 0.45 | "Doesn't fit model" | `#ef5350` (red) | Likely situational, not cycle-driven |

---

## Smart Input Parser

The input system parses natural language into structured mood/period entries. It has three components that run in sequence.

### 1. Date Extraction (`extractDate`)

Scans the input string for a date expression, extracts it, and returns `{ date: "YYYY-MM-DD", remainder: "text without the date" }`. If no date found, defaults to today.

**Supported date formats:**

| Format | Examples |
|--------|---------|
| Relative | `today`, `yesterday`, `3 days ago`, `2 weeks ago`, `last week`, `day before yesterday` |
| Day of week | `monday`, `last tuesday`, `on friday`, `this past wednesday` |
| Month-Day | `March 5`, `Mar 5th`, `march 5`, `Mar 5, 2026` |
| Day-Month | `5 March`, `5th of February`, `15 Feb 2026` |
| ISO | `2026-03-05` |
| US slash | `3/5`, `03/05/2026`, `3/5/26` |
| EU dot | `05.03.2026` |

**Smart year handling:** If no year is specified and the parsed date is in the future, it rolls back to the previous year.

**Two-digit years:** `< 100` adds 2000.

### 2. Mood Classification (`classifyMood`)

Searches the remainder text for mood words. Multi-word phrases matched first (sorted by length descending). Returns the highest-intensity match.

**Bad mood words:**

| Intensity -3 | Intensity -2 | Intensity -1 |
|--------------|--------------|--------------|
| screaming, yelling, furious, raging, explosive, meltdown, terrible, awful, horrible, blew up | angry, mad, irritable, upset, cranky, moody, snappy, frustrated, annoyed, agitated, hostile, short-tempered, pissed, bad mood, bad, overreacted, overreaction, scolded, snapped, fight, fought, argument, conflict | sensitive, emotional, tearful, withdrawn, quiet, off |

**Good mood words:**

| Intensity +3 | Intensity +2 | Intensity +1 |
|--------------|--------------|--------------|
| amazing, incredible, fantastic, ecstatic | happy, cheerful, great, calm, patient, loving, affectionate, sweet, playful, energetic, bubbly, good mood, good, nice, pleasant, warm | fine, okay, ok, normal, stable, decent, alright |

### 3. Period Detection

Triggers before mood classification if any of these patterns match:
- `period` + `start*`
- `period` + `began|came|arrived|today|yesterday`
- `got her/my period`
- `menstruat*`
- `day 1 of cycle/period`

### 4. Live Preview

A `useMemo` that runs `parseInput` on every keystroke and renders a preview row below the input showing:
- Parsed type (period vs mood)
- Resolved date (formatted as "Mar 5" etc.)
- Detected mood word and intensity tier
- Checkmark (valid) or X (invalid)
- The Log button dims (opacity 0.5) when parse is invalid

### Filler word stripping

Before mood classification, these words are stripped from the remainder: `on, wife, was, is, seems, seemed, has been, she, her, my, the, very, really, super, extremely, quite, pretty, somewhat, a bit, kind of, kinda, sort of, sorta`

---

## Chart System

### Chart Data Generation

Generates 90 data points: 45 days in the past + 45 days into the future from today. Each point contains:

```
{
  date, dayInCycle, estrogen, progesterone, lh, fsh,
  phase, predictedMood, patience, energy,
  isPrediction (boolean — true if date > today),
  isToday (boolean),
  moodEntry (score or null), moodLabel (string or null),
  fitScore, fitLabel, fitExplanation, fitColor, fitIcon (all null if no mood entry)
}
```

**Cycle position calculation:** `dayInCycle = ((daysSinceLastPeriod % cycleLength) + cycleLength) % cycleLength`. If result is 0 and daysSince > 0, use cycleLength instead.

### Chart 1: Mood Trajectory (Dashboard tab)

- **Type:** Recharts `ComposedChart`
- **Y-axis:** -3 to +3 (mood scale)
- **Background fill:** Gradient area under `predictedMood` line (green top → grey middle → red bottom)
- **Predicted mood line:** Grey dashed line (`#78909c`, strokeDasharray "5 5")
- **Logged mood dots:** Custom SVG `MoodDot` component:
  - Inner circle: r=4, fill `#ffa726`, stroke `#1a1a2e`
  - Outer ring: radius and style vary by fit score:
    - Fit >= 0.75: r=5, solid stroke, green
    - Fit 0.45–0.75: r=7, solid stroke, amber
    - Fit < 0.45: r=9, dashed stroke (`"3 2"`), red
  - **Important:** `strokeDasharray` must be `undefined` (not `"none"`) when not dashed
- **Today reference line:** Vertical dashed line with "Today" label

### Chart 2: Hormonal Trajectories (Dashboard + Hormones tabs)

- **Type:** Recharts `ComposedChart`
- **Y-axis:** 0–100%
- **Lines:** Estrogen (`#f06292`, 2.5px), Progesterone (`#ce93d8`, 2.5px), LH (`#ffb74d`, 1.5px dashed), FSH (`#81d4fa`, 1.5px dashed)
- **Area fills:** Gradient under estrogen and progesterone
- **Today reference line**

### Custom Tooltip

Both charts share a tooltip showing: date, phase label (phase-colored), all 4 hormone percentages, and if a mood entry exists: mood indicator + full fit analysis (score, label, explanation).

---

## Upcoming Conversation Windows

Scans future chart data points. Groups consecutive days by type:
- **Sensitive:** luteal or menstruation phase
- **Resilient:** follicular or ovulation phase

Displays up to 6 upcoming windows as horizontal scrollable cards. Each shows: type label (color-coded), date range, phase name.

---

## Model Confidence Card

Aggregate statistics computed from all mood entries:
- **Average fit score** (displayed as large percentage, color-coded by tier)
- **Counts:** X hormonal, Y partial, Z situational
- **Outlier callouts:** If any entries score < 0.45, display them with explanations noting they occurred during a phase that doesn't match, suggesting they may be interpersonal rather than hormonal

---

## UI Structure (3 Tabs)

### Dashboard Tab
1. Current Status Card (today's phase, day in cycle, description, tip, patience/energy/estrogen/progesterone stats)
2. Upcoming Conversation Windows (scrollable cards)
3. Model Confidence Card
4. Input Area (with live preview)
5. Mood Trajectory Chart
6. Hormonal Trajectories Chart
7. Cycle Phase Map (colored bar)

### Hormones Tab
1. Current Status Card
2. Upcoming Windows
3. Model Confidence
4. Input Area
5. Hormonal Trajectories Chart
6. Phase Guide (4-card grid with descriptions, patience/energy stats, tips for each phase)
7. Cycle Phase Map

### History Tab
1. Current Status Card
2. Upcoming Windows
3. Model Confidence
4. Input Area
5. Mood Log (reverse-chronological list of entries, each showing: date, day in cycle, phase, mood emoji, label text, fit score card with score number + label + explanation + colored border)
6. Period Starts (pill-shaped tags, deletable)
7. Calculated Cycle Length display
8. Reset to Defaults button
9. Cycle Phase Map

---

## Cycle Length Auto-Calculation

When a new period start date is logged:
1. Add to `periodDays` array, deduplicate, sort
2. Calculate differences between consecutive period starts
3. Filter to valid range: 21–40 days
4. Average the valid diffs → new `cycleLength`
5. Update `lastPeriodStart` to the newly logged date

---

## Cycle Phase Map Bar

Horizontal colored bar showing the 4 phases proportionally:
- Menstruation: `periodLength / cycleLength`
- Follicular: `(cycleLength * 0.45 - periodLength) / cycleLength`
- Ovulation: `0.1` (fixed 10%)
- Luteal: `0.45` (fixed 45%)

Labels inside each segment. If today's phase matches a segment, show a white upward-pointing triangle at the bottom center of that segment (pulsing animation).

---

## Compatibility Constraints (Learned from Debugging)

These are critical for the artifact to render correctly:

1. **No arrow functions** — use `function(){}` everywhere
2. **No `**` operator** — use `Math.pow()`
3. **No emoji in SVG `<text>` elements** — causes rendering failures; use Unicode escapes or helper functions that return emoji strings outside SVG
4. **`strokeDasharray`** — set to `undefined` when not dashing, never `"none"`
5. **No `catch` without parameter** — always use `catch(err)`
6. **No `localStorage` or `sessionStorage`** — use `window.storage` API only
7. **State updates** — use explicit object construction, not spread syntax in functional setState (avoids closure bugs)
8. **`useState` initialization** — deep clone seed data with `JSON.parse(JSON.stringify(SEED_DATA))` to avoid mutation
9. **Storage key versioning** — use a versioned key (`"cycle-tracker-v3"`) so stale data from prior versions doesn't overwrite seed data
10. **All imports from recharts must be explicit** — only import what you use

---

## Toast Notification System

- Fixed position, top-right
- 4-second auto-dismiss
- Color-coded by type: success (green), error (red), warning (amber), info (blue)
- Shows the parsed result on successful log

---

## Future Enhancements (Planned, Not Yet Implemented)

- Input via chat messages (e.g., message from user like `{on $day, wife was angry}`)
- Predict upcoming "sensitive periods" more precisely by weighting observed data against the model
- Remind user when entering a certain phase ("heads up: entering luteal in 2 days")
- Correlate cycle length changes over time
- Export data as CSV
