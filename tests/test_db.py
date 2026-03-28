import unittest
import sqlite3
import os
import json
import db
from datetime import datetime

TEST_DB_PATH = "data/test_cycle.db"

class TestDB(unittest.TestCase):
    def setUp(self):
        # Override DB_PATH in db module
        db.DB_PATH = TEST_DB_PATH
        if os.path.exists(TEST_DB_PATH):
            os.remove(TEST_DB_PATH)
        db.init_db()

    def tearDown(self):
        if os.path.exists(TEST_DB_PATH):
            os.remove(TEST_DB_PATH)

    def test_upsert_mood(self):
        db.upsert_mood("2026-03-20", 2, "Feeling great", predicted_score=1.5)
        conn = sqlite3.connect(TEST_DB_PATH)
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT * FROM mood_entries WHERE date = '2026-03-20'").fetchone()
        conn.close()
        self.assertIsNotNone(row)
        self.assertEqual(row['score'], 2)
        self.assertEqual(row['summary'], "Feeling great")
        self.assertEqual(row['predicted_score'], 1.5)
        self.assertEqual(row['delta'], 0.5)

    def test_delete_mood(self):
        db.upsert_mood("2026-03-20", 2, "Feeling great")
        db.delete_mood("2026-03-20")
        conn = sqlite3.connect(TEST_DB_PATH)
        row = conn.execute("SELECT * FROM mood_entries WHERE date = '2026-03-20'").fetchone()
        conn.close()
        self.assertIsNone(row)

    def test_upsert_period(self):
        db.upsert_period("2026-03-01")
        conn = sqlite3.connect(TEST_DB_PATH)
        row = conn.execute("SELECT * FROM period_entries WHERE date = '2026-03-01'").fetchone()
        conn.close()
        self.assertIsNotNone(row)

    def test_delete_period(self):
        db.upsert_period("2026-03-01")
        db.delete_period("2026-03-01")
        conn = sqlite3.connect(TEST_DB_PATH)
        row = conn.execute("SELECT * FROM period_entries WHERE date = '2026-03-01'").fetchone()
        conn.close()
        self.assertIsNone(row)

    def test_build_state(self):
        db.upsert_period("2026-03-01")
        db.upsert_period("2026-03-28")
        db.upsert_mood("2026-03-10", 1, "Testing state")
        state = db.build_state()
        self.assertEqual(state['lastPeriodStart'], "2026-03-28")
        self.assertIn('moodEntries', state)
        self.assertIn('periodDays', state)
        self.assertIn('cycleLength', state)

    def test_get_unpredicted_moods(self):
        db.upsert_mood("2026-03-20", 2, "Unpredicted") # predicted_score is None by default
        unpredicted = db.get_unpredicted_moods()
        self.assertTrue(any(e['date'] == '2026-03-20' for e in unpredicted))

    def test_update_predicted_score(self):
        db.upsert_mood("2026-03-20", 2, "To update")
        db.update_predicted_score("2026-03-20", 2, 1.0)
        conn = sqlite3.connect(TEST_DB_PATH)
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT * FROM mood_entries WHERE date = '2026-03-20'").fetchone()
        conn.close()
        self.assertEqual(row['predicted_score'], 1.0)
        self.assertEqual(row['delta'], 1.0)

if __name__ == '__main__':
    unittest.main()
