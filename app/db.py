"""
Persistence for analyst case decisions and flagged-for-block cards.

Plain sqlite3, one connection per call — simplest thing that survives a
server restart (Render's free tier spins the app down after ~15 min idle,
which would otherwise silently wipe every decision an analyst made). No
new dependency: sqlite3 ships with Python.

This is still a single-file, single-process store — fine for a demo or a
small team's pilot, not a substitute for a real database once this has
multiple app instances or needs concurrent-write guarantees beyond what
the module-level lock in main.py already provides.
"""

import sqlite3
from pathlib import Path

DB_FILE = Path(__file__).parent / "data" / "app_state.db"


def init_db():
    DB_FILE.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS case_status (
                transaction_id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                note TEXT NOT NULL,
                resolved_at TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS flagged_cards (
                card_id TEXT PRIMARY KEY,
                flagged_at TEXT NOT NULL,
                reason_transaction_id TEXT NOT NULL
            )
        """)
        conn.commit()


def get_case(transaction_id: str):
    with sqlite3.connect(DB_FILE) as conn:
        row = conn.execute(
            "SELECT status, note, resolved_at FROM case_status WHERE transaction_id = ?",
            (transaction_id,),
        ).fetchone()
    if row is None:
        return None
    return {"status": row[0], "note": row[1], "resolved_at": row[2]}


def get_all_cases() -> dict:
    with sqlite3.connect(DB_FILE) as conn:
        rows = conn.execute("SELECT transaction_id, status, note, resolved_at FROM case_status").fetchall()
    return {r[0]: {"status": r[1], "note": r[2], "resolved_at": r[3]} for r in rows}


def set_case(transaction_id: str, status: str, note: str, resolved_at: str):
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute(
            "INSERT INTO case_status (transaction_id, status, note, resolved_at) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(transaction_id) DO UPDATE SET status=excluded.status, note=excluded.note, resolved_at=excluded.resolved_at",
            (transaction_id, status, note, resolved_at),
        )
        conn.commit()


def is_card_flagged(card_id: str) -> bool:
    with sqlite3.connect(DB_FILE) as conn:
        row = conn.execute("SELECT 1 FROM flagged_cards WHERE card_id = ?", (card_id,)).fetchone()
    return row is not None


def get_all_flagged_cards() -> dict:
    with sqlite3.connect(DB_FILE) as conn:
        rows = conn.execute("SELECT card_id, flagged_at, reason_transaction_id FROM flagged_cards").fetchall()
    return {r[0]: {"flagged_at": r[1], "reason_transaction_id": r[2]} for r in rows}


def flag_card(card_id: str, flagged_at: str, reason_transaction_id: str):
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute(
            "INSERT OR IGNORE INTO flagged_cards (card_id, flagged_at, reason_transaction_id) VALUES (?, ?, ?)",
            (card_id, flagged_at, reason_transaction_id),
        )
        conn.commit()


def reset_all():
    """Wipes all case decisions and flagged cards. Used by POST /api/reset to
    get back to a clean demo state — not exposed anywhere in the UI on purpose."""
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute("DELETE FROM case_status")
        conn.execute("DELETE FROM flagged_cards")
        conn.commit()
