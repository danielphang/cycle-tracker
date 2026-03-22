import sqlite3
import os
import json
import re
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "data", "cycle.db")
MOOD_LOG_PATH = os.path.join(os.path.dirname(__file__), "data", "mood_log.md")
PERIOD_LOG_PATH = os.path.join(os.path.dirname(__file__), "data", "period_log.md")

def get_conn():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn

def init_db():
    conn = get_conn()
    conn.execute("""
    CREATE TABLE IF NOT EXISTS mood_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        score INTEGER NOT NULL,
        summary TEXT NOT NULL,
        original_text TEXT,
        predicted_score REAL,
        delta REAL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(date)
    )""")
    conn.execute("""
    CREATE TABLE IF NOT EXISTS period_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL UNIQUE,
        created_at TEXT DEFAULT (datetime('now'))
    )""")
    conn.execute("""
    CREATE TABLE IF NOT EXISTS cycle_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )""")
    cursor = conn.execute("SELECT COUNT(*) FROM mood_entries")
    mood_count = cursor.fetchone()[0]
    cursor = conn.execute("SELECT COUNT(*) FROM period_entries")
    period_count = cursor.fetchone()[0]
    if mood_count == 0 and period_count == 0:
        migrate_from_markdown(conn)
    conn.execute("INSERT OR IGNORE INTO cycle_config (key, value) VALUES ('period_length', '5')")
    conn.commit()
    conn.close()

def migrate_from_markdown(conn):
    if os.path.exists(MOOD_LOG_PATH):
        with open(MOOD_LOG_PATH, 'r') as f:
            for line in f:
                match = re.match(r"\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*([+-]?\d+)\s*\|\s*(.*)\s*\|", line)
                if match:
                    date, score, summary = match.groups()
                    conn.execute(
                        "INSERT OR IGNORE INTO mood_entries (date, score, summary) VALUES (?, ?, ?)",
                        (date.strip(), int(score.strip()), summary.strip())
                    )
    if os.path.exists(PERIOD_LOG_PATH):
        with open(PERIOD_LOG_PATH, 'r') as f:
            for line in f:
                match = re.search(r"(\d{4}-\d{2}-\d{2})", line)
                if match:
                    date = match.group(1)
                    conn.execute("INSERT OR IGNORE INTO period_entries (date) VALUES (?)", (date.strip(),))

def upsert_mood(date, score, summary, original_text=None, predicted_score=None):
    conn = get_conn()
    delta = score - predicted_score if predicted_score is not None else None
    conn.execute("""
        INSERT INTO mood_entries (date, score, summary, original_text, predicted_score, delta, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(date) DO UPDATE SET
            score=excluded.score, summary=excluded.summary, original_text=excluded.original_text,
            predicted_score=excluded.predicted_score, delta=excluded.delta, updated_at=datetime('now')
    """, (date, score, summary, original_text, predicted_score, delta))
    conn.commit()
    conn.close()

def delete_mood(date):
    conn = get_conn()
    conn.execute("DELETE FROM mood_entries WHERE date = ?", (date,))
    conn.commit()
    conn.close()

def delete_latest_mood_entry():
    conn = get_conn()
    cursor = conn.execute("SELECT date FROM mood_entries ORDER BY updated_at DESC LIMIT 1")
    row = cursor.fetchone()
    if row:
        conn.execute("DELETE FROM mood_entries WHERE date = ?", (row['date'],))
        conn.commit()
        deleted_date = row['date']
    else:
        deleted_date = None
    conn.close()
    return deleted_date

def get_moods(start_date=None, end_date=None):
    conn = get_conn()
    query = "SELECT * FROM mood_entries"
    params = []
    if start_date and end_date:
        query += " WHERE date BETWEEN ? AND ?"
        params = [start_date, end_date]
    elif start_date:
        query += " WHERE date >= ?"
        params = [start_date]
    elif end_date:
        query += " WHERE date <= ?"
        params = [end_date]
    query += " ORDER BY date ASC"
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(row) for row in rows]

def upsert_period(date):
    conn = get_conn()
    conn.execute("INSERT OR IGNORE INTO period_entries (date) VALUES (?)", (date,))
    conn.commit()
    conn.close()

def delete_period(date):
    conn = get_conn()
    conn.execute("DELETE FROM period_entries WHERE date = ?", (date,))
    conn.commit()
    conn.close()

def get_periods():
    conn = get_conn()
    rows = conn.execute("SELECT date FROM period_entries ORDER BY date ASC").fetchall()
    conn.close()
    return [row['date'] for row in rows]

def get_config(key, default=None):
    conn = get_conn()
    row = conn.execute("SELECT value FROM cycle_config WHERE key = ?", (key,)).fetchone()
    conn.close()
    return row['value'] if row else default

def build_state():
    moods = get_moods()
    periods = get_periods()
    period_length = int(get_config('period_length', '5'))
    cycle_length = 27
    if len(periods) >= 2:
        diffs = []
        for i in range(1, len(periods)):
            d1 = datetime.strptime(periods[i-1], "%Y-%m-%d")
            d2 = datetime.strptime(periods[i], "%Y-%m-%d")
            diff = (d2 - d1).days
            if 21 <= diff <= 40: diffs.append(diff)
        if diffs: cycle_length = round(sum(diffs) / len(diffs))
    return {
        "lastPeriodStart": periods[-1] if periods else None,
        "cycleLength": cycle_length,
        "periodLength": period_length,
        "moodEntries": [{"date": m["date"], "score": m["score"], "label": m["summary"]} for m in moods],
        "periodDays": periods
    }

def export_markdown():
    moods = get_moods()
    periods = get_periods()
    with open(MOOD_LOG_PATH, 'w') as f:
        f.write("# Mood Log\n\n| Date | Score | Event |\n|------|-------|-------|\n")
        for m in moods: f.write(f"| {m['date']} | {m['score']} | {m['summary']} |\n")
    with open(PERIOD_LOG_PATH, 'w') as f:
        f.write("# Period Log\n\n| Date |\n|------|\n")
        for p in periods: f.write(f"| {p} |\n")
    return [MOOD_LOG_PATH, PERIOD_LOG_PATH]
