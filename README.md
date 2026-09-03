# Fraud Monitoring Web App

A full web app for your fraud monitoring team: a live-style alert queue,
a transaction detail panel that explains *why* each transaction was
flagged in plain language, and Confirm/Dismiss/Escalate case actions.

Currently backed by **sample data** — 40 real scored transactions from the
trained model (10 flagged, including a genuine card-testing fraud burst
and one honest false positive). No React/Node build step: a FastAPI
backend serves both the API and a plain HTML/CSS/JS frontend, so it's one
process to run or deploy.

## Run locally

```bash
pip install -r requirements.txt
cd app
uvicorn main:app --host 0.0.0.0 --port 8000
```

Open **http://localhost:8000**

## Run with Docker

```bash
docker build -t fraud-monitor .
docker run -p 8000:8000 fraud-monitor
```

## What's inside

```
fraud_webapp/
├── requirements.txt
├── Dockerfile
└── app/
    ├── main.py              # FastAPI backend — API + serves the frontend
    ├── data/
    │   └── alerts_seed.json # sample scored transactions (swap this for live data)
    └── static/
        ├── index.html
        ├── styles.css
        └── app.js           # vanilla JS — fetches from the API, no build step
```

## API endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/alerts?filter=all\|flagged\|critical` | The alert queue, newest first |
| `GET /api/stats` | KPI numbers for the top strip |
| `POST /api/cases/{transaction_id}/resolve` | Analyst marks a case `confirmed`, `dismissed`, or `escalated` |
| `GET /api/health` | Health check |

## Going live (connecting real data)

This is the one place designed to be swapped out — everything else
(routes, frontend, case workflow) stays the same:

```python
# app/main.py
def load_alerts():
    with open(DATA_FILE) as f:
        return json.load(f)
```

Replace this with a call to your actual data source, for example:

```python
def load_alerts():
    # Option A: query a database table your scoring pipeline writes to
    return db.query("SELECT * FROM scored_transactions ORDER BY scored_at DESC LIMIT 500")

    # Option B: call the scoring pipeline directly (score_live.py from earlier)
    from score_live import score_transactions
    new_txns = get_recent_unscored_transactions()  # from your transaction feed
    history = get_card_histories(new_txns["Card_ID"].unique())
    return score_transactions(new_txns, history).to_dict("records")
```

Each alert dict needs the fields the frontend already expects — same
shape as `alerts_seed.json` (Card_ID, Transaction_ID, Timestamp, Channel,
Amount, Currency, Country, City, Merchant_Category, Device_Type,
Response_Code, fraud_probability, fraud_flag, decision, plus the
engineered feature columns used for the "why flagged" reasons:
is_new_device_for_card, is_new_country_for_card,
is_new_merchant_category_for_card, amount_zscore,
distance_from_prev_txn_km, time_since_last_txn_min, txn_count_last_1h,
consecutive_declines_before, is_night_txn, impossible_travel_flag).

## Known limitations of this version (worth fixing before production)

- **No switch integration — "Confirm Fraud" does not block a card anywhere.**
  It only records the analyst's decision in this app. Because of this, the
  app generates a **downloadable CSV report** (`/api/report/csv`, or the
  "Download Report" button in the header / detail panel) listing every
  actioned case — including a `Card_Block_Action_Needed` column — so an
  analyst can hand it to Card Operations to action the real block against
  the switch until that integration exists. Treat this as the interim
  process, not the end state.
- **No authentication.** Anyone who can reach the server can resolve
  cases or download the report. Add auth (even basic auth behind your VPN
  to start) before this touches real transaction data.
- **No audit trail beyond `resolved_at`.** For compliance you'll likely
  want to log which analyst made each decision — add an `analyst_id`
  field to `ResolveRequest` once you have logins; it would also belong
  as its own column in the CSV report.
- **Polling, not push.** The frontend re-fetches every 15 seconds
  (`setInterval` in `app.js`). Fine for a small team; if you need
  sub-second updates for a larger team, swap this for a WebSocket.
- **SQLite is single-file, single-process.** Case decisions and flagged
  cards now persist across restarts (`app/db.py`), which fixes the
  original "resets when the free tier sleeps" problem — but SQLite isn't
  built for multiple app instances writing concurrently. Move to
  Postgres/MySQL if this ever runs as more than one process.

## Resetting to a clean demo state

`POST /api/reset` wipes all case decisions and flagged cards back to a
clean slate. It's deliberately **not** linked anywhere in the UI — a plain
link click is a GET request, so nobody can trigger it by accidentally
clicking around during a live demo. Run this yourself before presenting:

```bash
curl -X POST https://your-app.onrender.com/api/reset
```
