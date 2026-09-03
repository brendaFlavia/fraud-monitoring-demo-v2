// Fraud Monitoring App — frontend logic
// Talks to the FastAPI backend (/api/alerts, /api/stats, /api/cases/:id/resolve).
// No build step, no framework — vanilla JS so this is easy for any team to
// host, modify, or swap out later.

const state = {
  alerts: [],
  filter: "all",
  selectedId: null,
};

const ICONS = {
  device: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/></svg>',
  pin: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
  alert: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>',
  trend: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
  gauge: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 15V9M4.6 15a8 8 0 1 1 14.8 0"/></svg>',
  ban: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg>',
  clock: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  card: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>',
  check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',
  shield: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2 3 6v6c0 5.5 3.8 9.7 9 11 5.2-1.3 9-5.5 9-11V6l-9-4Z"/></svg>',
  up: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>',
  eye: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg>',
  radio: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14"/></svg>',
};

const money = (n, c) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n) + " " + c;

function escapeHTML(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function timeAgo(ts) {
  const ref = new Date("2025-12-31T23:20:00");
  const diffMs = ref - new Date(ts.replace(" ", "T"));
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + "h ago";
  return Math.round(hrs / 24) + "d ago";
}

function tierOf(p) {
  if (p >= 0.85) return { label: "CRITICAL", color: "#D64545", bg: "rgba(214,69,69,0.12)" };
  if (p >= 0.593) return { label: "HIGH", color: "#E8A33D", bg: "rgba(232,163,61,0.12)" };
  if (p >= 0.15) return { label: "WATCH", color: "#D9C15B", bg: "rgba(217,193,91,0.10)" };
  return { label: "CLEAR", color: "#3FA796", bg: "rgba(63,167,150,0.10)" };
}

function reasonsFor(t) {
  const r = [];
  if (t.is_new_device_for_card) r.push({ icon: ICONS.device, text: "Unfamiliar device — never seen on this card before", weight: 3 });
  if (t.is_new_country_for_card) r.push({ icon: ICONS.pin, text: `First transaction from ${t.Country} on this card`, weight: 2 });
  if (t.impossible_travel_flag) r.push({ icon: ICONS.alert, text: "Impossible travel — prior transaction too far away in too little time", weight: 3 });
  if (t.amount_zscore >= 3) r.push({ icon: ICONS.trend, text: `Amount is ${t.amount_zscore.toFixed(1)}σ above this card's typical spend`, weight: 3 });
  else if (t.amount_zscore >= 1.5) r.push({ icon: ICONS.trend, text: `Amount is notably higher than this card's typical spend (z=${t.amount_zscore.toFixed(1)})`, weight: 1 });
  if (t.txn_count_last_1h >= 2) r.push({ icon: ICONS.gauge, text: `${Math.round(t.txn_count_last_1h)} other transactions on this card in the last hour`, weight: 2 });
  if (t.consecutive_declines_before >= 1) r.push({ icon: ICONS.ban, text: `${t.consecutive_declines_before} declined attempt${t.consecutive_declines_before > 1 ? "s" : ""} immediately before this one`, weight: 2 });
  if (t.is_night_txn) r.push({ icon: ICONS.clock, text: "Transacted between midnight and 5am", weight: 1 });
  if (t.is_new_merchant_category_for_card && !t.is_new_device_for_card) r.push({ icon: ICONS.card, text: `First ${t.Merchant_Category} purchase on this card`, weight: 1 });
  if (r.length === 0) r.push({ icon: ICONS.shield, text: "Matches this card's established spending pattern", weight: 0 });
  return r.sort((a, b) => b.weight - a.weight);
}

async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

async function loadAlerts() {
  const data = await fetchJSON(`/api/alerts?filter=${state.filter}`);
  state.alerts = data.alerts;
  if (!state.selectedId && state.alerts.length) {
    const flagged = state.alerts.find(a => a.fraud_flag === 1);
    state.selectedId = (flagged || state.alerts[0]).Transaction_ID;
  }
  renderQueue();
  renderDetail();
}

async function loadStats() {
  const stats = await fetchJSON("/api/stats");
  renderKPIs(stats);
}

function renderKPIs(stats) {
  const cards = [
    { label: "Transactions scored", value: stats.total_scored, icon: ICONS.radio },
    { label: "Flagged for review", value: stats.flagged, icon: ICONS.alert, accent: "#E8A33D" },
    { label: "Open in queue", value: stats.open_queue, icon: ICONS.eye, accent: "#D64545" },
    { label: "Auto-approved", value: stats.auto_approved, icon: ICONS.shield, accent: "#3FA796" },
    { label: "Cards flagged for block", value: stats.cards_flagged_for_block, icon: ICONS.ban, accent: "#D64545" },
    { label: "Review threshold", value: stats.review_threshold.toFixed(3), icon: ICONS.gauge },
  ];
  document.getElementById("kpiStrip").innerHTML = cards.map(k => `
    <div class="kpi-card">
      <div class="kpi-label">${k.icon}${k.label}</div>
      <div class="kpi-value" style="color:${k.accent || "var(--text)"}">${k.value}</div>
    </div>`).join("");
}

function renderQueue() {
  const list = document.getElementById("queueList");
  if (!state.alerts.length) {
    list.innerHTML = `<div class="detail-empty">No transactions match this filter.</div>`;
    return;
  }
  list.innerHTML = state.alerts.map(t => {
    const tier = tierOf(t.fraud_probability);
    const selected = t.Transaction_ID === state.selectedId;
    const resolved = t.case_status;
    const badgeLabel = t.card_flagged_for_block ? "BLOCK PENDING" : resolved ? resolved.toUpperCase() : tier.label;
    const badgeColor = t.card_flagged_for_block ? "#D64545" : (resolved ? tier.color : tier.color);
    const badgeBg = t.card_flagged_for_block ? "rgba(214,69,69,0.16)" : tier.bg;
    return `
      <div class="alert-row ${selected ? "selected" : ""} ${resolved ? "resolved" : ""}" data-id="${t.Transaction_ID}">
        <div class="row-top">
          <div class="row-top-left">
            <span class="card-id mono">${t.Card_ID}</span>
            <span class="tier-badge" style="color:${badgeColor};background:${badgeBg}">${badgeLabel}</span>
          </div>
          <span class="row-time mono">${timeAgo(t.Timestamp)}</span>
        </div>
        <div class="row-mid">
          <div class="row-meta">
            <span>${t.Channel}</span><span>·</span><span>${t.Country}</span><span>·</span><span>${t.Merchant_Category}</span>
          </div>
          <span class="row-amount mono">${money(t.Amount, t.Currency)}</span>
        </div>
        <div class="risk-bar-track"><div class="risk-bar-fill" style="width:${t.fraud_probability * 100}%;background:${tier.color}"></div></div>
      </div>`;
  }).join("");

  list.querySelectorAll(".alert-row").forEach(el => {
    el.addEventListener("click", () => {
      state.selectedId = el.dataset.id;
      renderQueue();
      renderDetail();
    });
  });
}

function actionControlsHTML() {
  return `
    <textarea class="comment-box mono" id="analystComment" placeholder="Add a comment explaining your decision (required)..."></textarea>
    <div class="action-row" id="actionRow">
      <button class="btn-confirm" data-action="confirmed">${ICONS.ban} Confirm Fraud</button>
      <button class="btn-dismiss" data-action="approved">${ICONS.check} Approve</button>
      <button class="btn-escalate" data-action="escalated">${ICONS.up}</button>
    </div>
    <div class="confirm-bar" id="confirmBar"></div>
    <div class="comment-hint">A comment is required before a decision is saved.</div>`;
}

function renderDetail() {
  const panel = document.getElementById("detailPanel");
  const t = state.alerts.find(a => a.Transaction_ID === state.selectedId);
  if (!t) {
    panel.innerHTML = `<div class="detail-empty">Select a transaction from the queue.</div>`;
    return;
  }
  const tier = tierOf(t.fraud_probability);
  const reasons = reasonsFor(t);
  const resolved = t.case_status;

  const fields = [
    ["Amount", money(t.Amount, t.Currency)],
    ["Channel", t.Channel],
    ["Location", `${t.City}, ${t.Country}`],
    ["Merchant", t.Merchant_Category],
    ["Device", t.Device_Type],
    ["Response", t.Response_Code],
  ];

  let actionHTML = "";
  if (t.card_flagged_for_block && !resolved) {
    // this specific transaction hasn't been individually resolved, but the card
    // was already flagged from a different confirmed-fraud case
    actionHTML = `
      <div class="resolved-banner" style="background:rgba(214,69,69,0.1);color:#D64545;margin-bottom:14px">
        ${ICONS.ban} This card is already flagged from a previous confirmed case — the actual block still needs to be actioned manually via the switch. You can still record a decision on this specific transaction.
      </div>
      <div class="section-title">ANALYST ACTION</div>
      ${actionControlsHTML()}`;
  } else if (resolved) {
    const bannerStyle = {
      confirmed: { color: "#D64545", bg: "rgba(214,69,69,0.1)", icon: ICONS.ban, text: "Confirmed fraud — flagged for card block. This system isn't connected to the card switch, so download the report and send it to Card Operations to action the block manually." },
      approved: { color: "#3FA796", bg: "rgba(63,167,150,0.1)", icon: ICONS.check, text: "Approved — transaction treated as legitimate." },
      escalated: { color: "#E8A33D", bg: "rgba(232,163,61,0.1)", icon: ICONS.up, text: "Escalated for senior review." },
    }[resolved];
    actionHTML = `
      <div class="section-title">ANALYST ACTION</div>
      <div class="resolved-banner" style="background:${bannerStyle.bg};color:${bannerStyle.color}">
        ${bannerStyle.icon} ${bannerStyle.text}
      </div>
      ${t.case_note ? `<div class="comment-recorded"><span class="field-label">Analyst comment</span><div class="mono">${escapeHTML(t.case_note)}</div></div>` : ""}
      ${resolved === "confirmed" ? `<a href="/api/report/csv" download class="download-report-inline">${ICONS.up} Download report for Card Operations</a>` : ""}`;
  } else if (t.fraud_flag === 1) {
    actionHTML = `
      <div class="section-title">ANALYST ACTION</div>
      ${actionControlsHTML()}`;
  } else {
    actionHTML = `<div class="approved-banner">${ICONS.shield} Auto-approved by the model — below review threshold (0.593). An analyst can still override this below.</div>
      <div style="margin-top:12px">${actionControlsHTML()}</div>`;
  }

  panel.innerHTML = `
    <div class="detail-head">
      <div>
        <div class="detail-txnid mono">${t.Transaction_ID}</div>
        <div class="detail-card">${t.Card_ID}</div>
      </div>
      <div>
        <div class="detail-score" style="color:${tier.color}">${(t.fraud_probability * 100).toFixed(1)}%</div>
        <div class="detail-tier" style="color:${tier.color}">${tier.label} RISK</div>
      </div>
    </div>
    <div class="fields-grid">
      ${fields.map(([label, val]) => `
        <div class="field-card">
          <div class="field-label">${label}</div>
          <div class="field-value mono">${val}</div>
        </div>`).join("")}
    </div>
    <div>
      <div class="section-title">WHY THIS WAS FLAGGED</div>
      <div class="reasons-list">
        ${reasons.map(r => `
          <div class="reason-item">
            <span class="reason-icon" style="color:${r.weight >= 3 ? "#D64545" : r.weight >= 1 ? "#E8A33D" : "#3FA796"}">${r.icon}</span>
            <span>${r.text}</span>
          </div>`).join("")}
      </div>
    </div>
    ${actionHTML}
  `;

  const actionRow = panel.querySelector("#actionRow");
  const confirmBar = panel.querySelector("#confirmBar");
  const commentEl = document.getElementById("analystComment");
  const actionLabels = { confirmed: "Confirm Fraud", approved: "Approve", escalated: "Escalate" };

  if (actionRow) {
    actionRow.querySelectorAll("[data-action]").forEach(btn => {
      btn.addEventListener("click", () => {
        const note = commentEl.value.trim();
        if (!note) {
          commentEl.classList.add("comment-box-error");
          commentEl.placeholder = "A comment is required — please explain your decision.";
          commentEl.focus();
          return;
        }
        const action = btn.dataset.action;
        actionRow.style.display = "none";
        commentEl.disabled = true;
        confirmBar.innerHTML = `
          <span class="confirm-bar-text">Mark this transaction as <strong>${actionLabels[action]}</strong>? This can't be undone.</span>
          <div class="confirm-bar-buttons">
            <button class="btn-confirm-yes" type="button">Yes, confirm</button>
            <button class="btn-confirm-cancel" type="button">Cancel</button>
          </div>`;

        confirmBar.querySelector(".btn-confirm-yes").addEventListener("click", async () => {
          confirmBar.innerHTML = `<span class="confirm-bar-text">Saving…</span>`;
          try {
            await fetchJSON(`/api/cases/${t.Transaction_ID}/resolve`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: action, note }),
            });
            await loadAlerts();
            await loadStats();
          } catch (err) {
            confirmBar.innerHTML = "";
            actionRow.style.display = "flex";
            commentEl.disabled = false;
            alert("Couldn't save that decision — please try again.");
          }
        });
        confirmBar.querySelector(".btn-confirm-cancel").addEventListener("click", () => {
          confirmBar.innerHTML = "";
          actionRow.style.display = "flex";
          commentEl.disabled = false;
        });
      });
    });
  }
}

document.getElementById("filterGroup").addEventListener("click", async (e) => {
  const btn = e.target.closest(".filter-btn");
  if (!btn) return;
  document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  state.filter = btn.dataset.filter;
  await loadAlerts();
});

(async function init() {
  await loadStats();
  await loadAlerts();
  // light polling so the queue reflects any changes without a manual refresh
  setInterval(() => { loadAlerts(); loadStats(); }, 15000);
})();
