"""
Fraud Monitoring Web App — Backend
====================================
FastAPI app that serves:
  - the alert queue API (GET /api/alerts, GET /api/stats)
  - case actions for analysts (POST /api/cases/{transaction_id}/resolve)
  - a downloadable case report (GET /api/report/csv)
  - the static frontend (index.html / app.js / styles.css)

Currently backed by seeded sample data (app/data/alerts_seed.json) — the
output of the trained model scoring a batch of transactions. This is
intentionally the ONLY thing you need to swap to go live: replace
load_alerts() with a call to your live scoring pipeline / database, and
everything else (API shape, frontend, case workflow) keeps working
unchanged. See the "Going live" section in README.md.

Case decisions and flagged-for-block cards persist in SQLite (app/db.py) —
so a server restart (e.g. Render's free tier spinning down after idle)
doesn't silently wipe an analyst's work.

Run:
    pip install -r requirements.txt
    uvicorn main:app --host 0.0.0.0 --port 8000
Then open http://localhost:8000
"""

import csv
import io
import json
import threading
from pathlib import Path
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

import db

BASE_DIR = Path(__file__).parent
DATA_FILE = BASE_DIR / "data" / "alerts_seed.json"
STATIC_DIR = BASE_DIR / "static"
REVIEW_THRESHOLD = 0.593  # must match model_config.joblib's tuned threshold

app = FastAPI(title="Fraud Monitoring API", version="1.0")
db.init_db()

_lock = threading.Lock()  # guards the check-then-write in resolve_case below


def load_alerts():
    """
    Data source for the alert queue.

    TO GO LIVE: replace this function's body with a call to your scoring
    pipeline / database — e.g. `SELECT * FROM scored_transactions WHERE
    scored_at > now() - interval '24 hours' ORDER BY scored_at DESC`, or a
    call to score_live.score_transactions() for freshly-arriving
    transactions. The rest of the app (API routes, frontend) doesn't need
    to change — it only depends on this function returning a list of dicts
    shaped like the ones in alerts_seed.json.
    """
    with open(DATA_FILE) as f:
        return json.load(f)


@app.get("/api/alerts")
def get_alerts(filter: str = "all"):
    """
    filter: 'all' | 'flagged' | 'critical'
    Returns alerts newest-first, each annotated with its current case status.
    """
    alerts = load_alerts()
    alerts.sort(key=lambda a: a["Timestamp"], reverse=True)

    cases = db.get_all_cases()
    flagged_cards = db.get_all_flagged_cards()
    for a in alerts:
        case = cases.get(a["Transaction_ID"])
        a["case_status"] = case["status"] if case else None
        a["case_note"] = case["note"] if case else None
        a["card_flagged_for_block"] = a["Card_ID"] in flagged_cards

    if filter == "flagged":
        alerts = [a for a in alerts if a["fraud_flag"] == 1]
    elif filter == "critical":
        alerts = [a for a in alerts if a["fraud_probability"] >= 0.85]

    return {"count": len(alerts), "alerts": alerts}


@app.get("/api/stats")
def get_stats():
    alerts = load_alerts()
    flagged = [a for a in alerts if a["fraud_flag"] == 1]
    cases = db.get_all_cases()
    open_queue = [a for a in flagged if a["Transaction_ID"] not in cases]
    return {
        "total_scored": len(alerts),
        "flagged": len(flagged),
        "open_queue": len(open_queue),
        "auto_approved": len(alerts) - len(flagged),
        "cards_flagged_for_block": len(db.get_all_flagged_cards()),
        "review_threshold": REVIEW_THRESHOLD,
    }


class ResolveRequest(BaseModel):
    status: str  # "approved" | "confirmed" | "escalated"
    note: str  # required — analyst must record a reason before a decision is saved


@app.post("/api/cases/{transaction_id}/resolve")
def resolve_case(transaction_id: str, body: ResolveRequest):
    if body.status not in ("approved", "confirmed", "escalated"):
        raise HTTPException(400, "status must be approved, confirmed, or escalated")
    if not body.note or not body.note.strip():
        raise HTTPException(400, "a comment is required before recording a decision")

    alerts = load_alerts()
    match = next((a for a in alerts if a["Transaction_ID"] == transaction_id), None)
    if match is None:
        raise HTTPException(404, "transaction not found")

    resolved_at = datetime.now(timezone.utc).isoformat()
    note = body.note.strip()

    with _lock:
        db.set_case(transaction_id, body.status, note, resolved_at)
        flagged_for_block = db.is_card_flagged(match["Card_ID"])
        if body.status == "confirmed" and not flagged_for_block:
            # Bookkeeping only — nothing here touches the card switch. This is
            # what makes the case show up in the downloadable report below,
            # which is how the actual block gets actioned by a human today.
            db.flag_card(match["Card_ID"], resolved_at, transaction_id)
            flagged_for_block = True

    return {"Transaction_ID": transaction_id, "Card_ID": match["Card_ID"],
            "card_flagged_for_block": flagged_for_block,
            "status": body.status, "note": note, "resolved_at": resolved_at}


@app.get("/api/flagged-cards")
def get_flagged_cards():
    flagged = db.get_all_flagged_cards()
    return {"count": len(flagged), "cards": flagged}


@app.get("/api/report/csv")
def get_report_csv():
    """
    Downloadable CSV of every transaction an analyst has made a decision on.

    This exists specifically to bridge the gap until there's a real switch
    integration: confirming fraud in this app does NOT block a card anywhere —
    it only records the decision here. This report is what an analyst hands to
    Card Operations (or attaches to a ticket) so a human can action the actual
    block against the switch, and it doubles as the audit trail of who decided
    what and why (the required comment) for every case.
    """
    alerts = load_alerts()
    cases = db.get_all_cases()
    flagged_cards = db.get_all_flagged_cards()

    rows = [a for a in alerts if a["Transaction_ID"] in cases]
    rows.sort(key=lambda a: cases[a["Transaction_ID"]]["resolved_at"], reverse=True)

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "Transaction_ID", "Card_ID", "Timestamp", "Channel", "Amount", "Currency",
        "Country", "City", "Merchant_Category", "Device_Type", "Response_Code",
        "Fraud_Probability", "Model_Decision", "Analyst_Decision", "Analyst_Comment",
        "Resolved_At", "Card_Block_Action_Needed",
    ])
    for a in rows:
        case = cases[a["Transaction_ID"]]
        needs_block_action = "YES — action via switch" if a["Card_ID"] in flagged_cards else "No"
        writer.writerow([
            a["Transaction_ID"], a["Card_ID"], a["Timestamp"], a["Channel"], a["Amount"],
            a["Currency"], a["Country"], a["City"], a["Merchant_Category"], a["Device_Type"],
            a["Response_Code"], a["fraud_probability"], a["decision"],
            case["status"], case["note"], case["resolved_at"], needs_block_action,
        ])

    filename = f"fraud_case_report_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/api/reset")
def reset_demo():
    """
    Wipes all case decisions and flagged cards back to a clean slate.

    Deliberately POST-only and not linked from anywhere in the UI — a normal
    link click is a GET request, so this can't be triggered by accidental
    clicking during a live demo. Call it yourself before presenting, e.g.:
        curl -X POST https://your-app.onrender.com/api/reset
    """
    with _lock:
        db.reset_all()
    return {"status": "reset"}


@app.get("/api/health")
def health():
    return {"status": "ok"}


# ---- serve the static frontend ----
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")
