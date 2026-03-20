#!/usr/bin/env python3
"""
Cycle Intelligence — Local Development Server
Serves static files and provides JSON API backed by Markdown files.
"""
import http.server
import socketserver
import json
import os
import re
import urllib.request
from datetime import datetime, timedelta

PORT = int(os.environ.get("PORT", 8000))
BASE = os.path.dirname(os.path.abspath(__file__))

def _load_api_key():
    key = os.environ.get("GEMINI_API_KEY")
    if key:
        return key.strip()
    secrets_file = os.path.join(BASE, ".secrets", "gemini_apikey")
    if os.path.exists(secrets_file):
        with open(secrets_file, "r") as f:
            return f.read().strip()
    return None

GEMINI_API_KEY = _load_api_key()
MOOD_FILE = os.path.join(BASE, "data", "mood_log.md")
PERIOD_FILE = os.path.join(BASE, "data", "period_log.md")

# ── Markdown Parsing ──────────────────────────────────────────────

def read_mood_log():
    entries = []
    if not os.path.exists(MOOD_FILE):
        return entries
    with open(MOOD_FILE, "r") as f:
        for line in f:
            line = line.strip()
            if not line.startswith("|") or "Date" in line or ":---" in line:
                continue
            cols = [c.strip() for c in line.split("|")]
            # cols[0] is empty (before first |), cols[1]=Date, cols[2]=Score, cols[3]=Event
            if len(cols) >= 4:
                try:
                    score = int(cols[2])
                except ValueError:
                    score = 0
                entries.append({
                    "date": cols[1],
                    "score": score,
                    "label": cols[3]
                })
    return entries


def read_period_log():
    dates = []
    if not os.path.exists(PERIOD_FILE):
        return dates
    with open(PERIOD_FILE, "r") as f:
        for line in f:
            line = line.strip()
            if not line.startswith("|") or "Date" in line or ":---" in line:
                continue
            cols = [c.strip() for c in line.split("|")]
            if len(cols) >= 2 and cols[1]:
                dates.append(cols[1])
    dates.sort()
    return dates


def append_mood(date_str, score, label):
    # Ensure label doesn't contain pipe chars
    label = label.replace("|", "–")
    row = f"| {date_str} | {score} | {label} |\n"
    with open(MOOD_FILE, "a") as f:
        f.write(row)


def append_period(date_str):
    # Check for duplicates
    existing = read_period_log()
    if date_str in existing:
        return
    row = f"| {date_str} |\n"
    with open(PERIOD_FILE, "a") as f:
        f.write(row)


def delete_period(date_str):
    if not os.path.exists(PERIOD_FILE):
        return
    with open(PERIOD_FILE, "r") as f:
        lines = f.readlines()
    with open(PERIOD_FILE, "w") as f:
        for line in lines:
            if date_str not in line:
                f.write(line)


def compute_cycle_length(period_days):
    sorted_days = sorted(period_days)
    valid_diffs = []
    for i in range(1, len(sorted_days)):
        try:
            d1 = datetime.strptime(sorted_days[i-1], "%Y-%m-%d")
            d2 = datetime.strptime(sorted_days[i], "%Y-%m-%d")
            diff = (d2 - d1).days
            if 21 <= diff <= 40:
                valid_diffs.append(diff)
        except ValueError:
            pass
    if valid_diffs:
        return round(sum(valid_diffs) / len(valid_diffs))
    return 27  # default


def build_state():
    mood_entries = read_mood_log()
    period_days = read_period_log()
    cycle_length = compute_cycle_length(period_days)
    last_period = period_days[-1] if period_days else "2026-03-04"
    return {
        "lastPeriodStart": last_period,
        "cycleLength": cycle_length,
        "periodLength": 5,
        "moodEntries": mood_entries,
        "periodDays": period_days
    }


def call_gemini(text):
    if not GEMINI_API_KEY:
        return {"error": "GEMINI_API_KEY not configured"}, 500

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
    
    today = datetime.now().strftime("%Y-%m-%d")
    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
    
    system_prompt = f"""
You are a mood/event parser for a menstrual cycle tracking app. 
Extract structured data from the user's natural language input.

Return ONLY valid JSON with this schema:
{{
  "entries": [{{
    "date": "YYYY-MM-DD",
    "type": "mood" | "period",
    "score": -3 to +3 (integer, only for mood type),
    "summary": "brief event description",
    "original_text": "the part of input this was extracted from"
  }}],
  "understood": true/false,
  "clarification": "optional message if input is ambiguous"
}}

Mood scoring guide:
  -3: screaming, raging, explosive meltdown, terrible
  -2: angry, fighting, irritable, overreacting, hostile, bad mood
  -1: sensitive, emotional, withdrawn, tearful, quiet, off
   0: neutral
  +1: fine, okay, normal, stable, decent
  +2: happy, cheerful, calm, patient, loving, good mood, sweet
  +3: amazing, incredible, ecstatic, fantastic

Date resolution rules:
- Today's date is {today}
- "today" = {today}
- "yesterday" = {yesterday}
- Relative days: "3 days ago", "last Tuesday", etc.
- If no date mentioned, assume today.
- Support backdating without friction.

For period entries, detect phrases like "period started", "got her period", "day 1 of cycle".
"""

    payload = {
        "contents": [{
            "parts": [{
                "text": f"{system_prompt}\n\nInput: {text}"
            }]
        }],
        "generationConfig": {
            "temperature": 0.1,
            "responseMimeType": "application/json"
        }
    }

    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req) as response:
            res_data = json.loads(response.read().decode("utf-8"))
            # Extract JSON from Gemini response format
            text_response = res_data['candidates'][0]['content']['parts'][0]['text']
            return json.loads(text_response), 200
    except Exception as e:
        return {"error": str(e)}, 500


# ── HTTP Handler ──────────────────────────────────────────────────

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE, **kwargs)

    def do_GET(self):
        if self.path == "/api/data":
            data = build_state()
            self._json_response(200, data)
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == "/api/mood":
            body = self._read_body()
            append_mood(body["date"], body["score"], body["label"])
            self._json_response(200, {"ok": True})

        elif self.path == "/api/period":
            body = self._read_body()
            append_period(body["date"])
            # Return updated state so frontend can refresh cycle length
            self._json_response(200, build_state())

        elif self.path == "/api/period/delete":
            body = self._read_body()
            delete_period(body["date"])
            self._json_response(200, build_state())

        elif self.path == "/api/parse":
            body = self._read_body()
            text = body.get("text", "")
            parsed, status = call_gemini(text)
            self._json_response(status, {
                "parsed": parsed,
                "raw_text": text
            })

        else:
            self._json_response(404, {"error": "not found"})

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def _json_response(self, code, obj):
        payload = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, fmt, *args):
        # Quieter logs
        ts = datetime.now().strftime("%H:%M:%S")
        print(f"[{ts}] {args[0]}")


# ── Main ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    # Allow port reuse so restarts don't fail
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"╔══════════════════════════════════════════╗")
        print(f"║  Cycle Intelligence Server               ║")
        print(f"║  → http://localhost:{PORT}                 ║")
        print(f"╚══════════════════════════════════════════╝")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down.")
