#!/usr/bin/env python3
import http.server
import socketserver
import json
import os
import signal
import sys
import re
import urllib.request
import argparse
from datetime import datetime, timedelta
import db

def load_env():
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    if os.path.exists(env_path):
        with open(env_path, "r") as f:
            for line in f:
                if "=" in line and not line.startswith("#"):
                    key, value = line.strip().split("=", 1)
                    os.environ[key] = value

load_env()

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
        import traceback
        traceback.print_exc()
        if hasattr(e, 'read'):
            print(e.read().decode('utf-8'))
        return {"error": str(e)}, 500


# ── HTTP Handler ──────────────────────────────────────────────────

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE, **kwargs)

    def do_GET(self):
        if self.path == "/api/data":
            try:
                self._json_response(200, db.build_state())
            except Exception as e:
                self._json_response(500, {"error": str(e)})
        elif self.path == "/api/export":
            try:
                self._json_response(200, {"ok": True, "files": db.export_markdown()})
            except Exception as e:
                self._json_response(500, {"error": str(e)})
        else:
            super().do_GET()

    def do_POST(self):
        try:
            if self.path == "/api/mood":
                body = self._read_body()
                db.upsert_mood(
                    body["date"], 
                    body["score"], 
                    body["label"], 
                    predicted_score=body.get("predicted_score")
                )
                self._json_response(200, {"ok": True})
            elif self.path == "/api/period":
                body = self._read_body()
                db.upsert_period(body["date"])
                self._json_response(200, db.build_state())
            elif self.path == "/api/period/delete":
                body = self._read_body()
                db.delete_period(body["date"])
                self._json_response(200, db.build_state())
            elif self.path == "/api/mood/delete":
                body = self._read_body()
                db.delete_mood(body["date"])
                self._json_response(200, db.build_state())
            elif self.path == "/api/mood/undo":
                deleted_date = db.delete_latest_mood_entry()
                self._json_response(200, {"ok": True, "deleted_date": deleted_date, "state": db.build_state()})
            elif self.path == "/api/parse":
                body = self._read_body()
                text = body.get("text", "")
                parsed, status = call_gemini(text)
                self._json_response(status, {
                    "parsed": parsed,
                    "raw_text": text
                })
            elif self.path == "/api/backfill-predictions":
                # Get the cycle state to determine cycle length and last period
                state = db.build_state()
                cLen = state.get("cycleLength", 27)
                pLen = state.get("periodLength", 5)
                lpd_str = state.get("lastPeriodStart")

                unpredicted = db.get_unpredicted_moods()
                updated_count = 0

                if lpd_str:
                    lpd = datetime.strptime(lpd_str, "%Y-%m-%d")
                    for entry in unpredicted:
                        d = datetime.strptime(entry["date"], "%Y-%m-%d")
                        daysSince = (d - lpd).days
                        dic = ((daysSince % cLen) + cLen) % cLen
                        if dic == 0 and daysSince > 0:
                            dic = cLen

                        t = dic / cLen
                        # Basic Phase Prediction
                        if dic <= pLen:
                            predicted = -1.0
                        elif t <= 0.45:
                            predicted = 1.2
                        elif t <= 0.55:
                            predicted = 2.0
                        else:
                            predicted = -0.8
                        
                        db.update_predicted_score(entry["date"], entry["score"], predicted)
                        updated_count += 1

                self._json_response(200, {"ok": True, "updated": updated_count, "state": db.build_state()})
            else:
                self._json_response(404, {"error": "not found"})
        except Exception as e:
            self._json_response(500, {"error": str(e)})

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def _json_response(self, code, obj):
        payload = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(payload)

def graceful_shutdown(signum, frame):
    sys.exit(0)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=PORT, help="Port to run the server on")
    args = parser.parse_args()
    _p = args.port

    db.init_db()
    signal.signal(signal.SIGINT, graceful_shutdown)
    signal.signal(signal.SIGTERM, graceful_shutdown)
    socketserver.TCPServer.allow_reuse_address = True
    try:
        with socketserver.TCPServer(("", _p), Handler) as httpd:
            print(f"Server started on port {_p}")
            httpd.serve_forever()
    except Exception as e:
        print(f"Error starting server: {e}")
        sys.exit(1)
