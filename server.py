#!/usr/bin/env python3
import http.server
import socketserver
import json
import os
import signal
import sys
from datetime import datetime
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
                db.upsert_mood(body["date"], body["score"], body["label"])
                self._json_response(200, {"ok": True})
            elif self.path == "/api/period":
                body = self._read_body()
                db.upsert_period(body["date"])
                self._json_response(200, db.build_state())
            elif self.path == "/api/period/delete":
                body = self._read_body()
                db.delete_period(body["date"])
                self._json_response(200, db.build_state())
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
    db.init_db()
    signal.signal(signal.SIGINT, graceful_shutdown)
    signal.signal(signal.SIGTERM, graceful_shutdown)
    socketserver.TCPServer.allow_reuse_address = True
    try:
        with socketserver.TCPServer(("", PORT), Handler) as httpd:
            print(f"Server started on port {PORT}")
            httpd.serve_forever()
    except Exception as e:
        sys.exit(1)
