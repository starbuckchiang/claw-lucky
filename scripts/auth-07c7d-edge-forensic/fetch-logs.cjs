"use strict";

/**
 * Auth-07C.7D — attempt Management API log access (sanitized output only).
 * Never prints access tokens, bodies, or full IDs.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const REF = "umtqpstacjdwxcvcirbl";

function out(o) {
  console.log(JSON.stringify(o));
}

function findToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) {
    return { token: process.env.SUPABASE_ACCESS_TOKEN.trim(), source: "env" };
  }
  const candidates = [
    path.join(os.homedir(), ".supabase", "access-token"),
    path.join(os.homedir(), "AppData", "Roaming", "supabase", "access-token"),
    path.join(os.homedir(), "AppData", "Local", "supabase", "access-token")
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const token = fs.readFileSync(p, "utf8").trim();
      if (token) return { token, source: "file" };
    }
  }
  // CLI may store in credentials.json / config.json
  const dirs = [
    path.join(os.homedir(), ".supabase"),
    path.join(os.homedir(), "AppData", "Roaming", "supabase"),
    path.join(os.homedir(), "AppData", "Local", "supabase")
  ];
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    for (const name of fs.readdirSync(d)) {
      if (!/\.json$/i.test(name)) continue;
      try {
        const j = JSON.parse(fs.readFileSync(path.join(d, name), "utf8"));
        const token =
          j.access_token
          || j.token
          || j?.credentials?.access_token
          || null;
        if (token) return { token: String(token), source: `json:${name}` };
      } catch (_e) {
        // ignore
      }
    }
  }
  return { token: "", source: null };
}

async function queryLogs(token, start, end, sql) {
  const u = new URL(
    `https://api.supabase.com/v1/projects/${REF}/analytics/endpoints/logs.all`
  );
  u.searchParams.set("iso_timestamp_start", start);
  u.searchParams.set("iso_timestamp_end", end);
  u.searchParams.set("sql", sql);
  const res = await fetch(u.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    }
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { parse_error: true, prefix: text.slice(0, 160) };
  }
  return { status: res.status, body };
}

function sanitizeRows(body) {
  const result = body?.result || body?.data || body;
  const rows = Array.isArray(result) ? result : [];
  return rows.slice(0, 30).map((row) => {
    const msg = String(row.event_message || row.msg || "");
    return {
      timestamp: row.timestamp || row.ts || null,
      msg_prefix: msg.slice(0, 180),
      has_sale: /PAYMENT\.SALE|SALE\.COMPLETED/i.test(msg),
      has_created: /BILLING\.SUBSCRIPTION\.CREATED/i.test(msg),
      has_activated: /BILLING\.SUBSCRIPTION\.ACTIVATED/i.test(msg),
      has_verify: /verif|signature|WEBHOOK_/i.test(msg),
      has_error: /error|fail|timeout|crash/i.test(msg),
      status_hint: (msg.match(/\b([1-5]\d{2})\b/) || [])[1] || null
    };
  });
}

async function main() {
  const { token, source } = findToken();
  out({
    step: "token_probe",
    present: Boolean(token),
    source,
    len: token ? token.length : 0
  });
  if (!token) {
    out({ step: "log_access", ok: false, reason: "NO_MANAGEMENT_ACCESS_TOKEN" });
    return;
  }

  const windows = [
    { label: "original", start: "2026-09-07T14:34:15.000Z", end: "2026-09-07T14:35:30.000Z" },
    { label: "resend", start: "2026-09-07T14:45:00.000Z", end: "2026-09-07T15:15:00.000Z" }
  ];

  const queries = [
    {
      name: "function_edge_logs",
      sql: "select id, timestamp, event_message from function_edge_logs order by timestamp asc limit 100"
    },
    {
      name: "function_logs",
      sql: "select id, timestamp, event_message from function_logs order by timestamp asc limit 100"
    },
    {
      name: "edge_logs_path",
      sql: "select id, timestamp, event_message from edge_logs order by timestamp asc limit 100"
    }
  ];

  // Also try new logs endpoint
  async function queryNewLogs(start, end, sql) {
    const u = new URL(
      `https://api.supabase.com/v1/projects/${REF}/analytics/endpoints/logs`
    );
    u.searchParams.set("iso_timestamp_start", start);
    u.searchParams.set("iso_timestamp_end", end);
    u.searchParams.set("sql", sql);
    const res = await fetch(u.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      }
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { parse_error: true, prefix: text.slice(0, 160) };
    }
    return { status: res.status, body };
  }

  for (const w of windows) {
    for (const q of queries) {
      const r = await queryLogs(token, w.start, w.end, q.sql);
      const rows = sanitizeRows(r.body);
      out({
        step: "logs_all",
        window: w.label,
        source: q.name,
        http: r.status,
        row_count: rows.length,
        error:
          r.body?.error
          || r.body?.message
          || (r.status >= 400 ? String(JSON.stringify(r.body)).slice(0, 200) : null),
        rows
      });
    }

    const newSql =
      "select timestamp, event_message from logs where source_name = 'function_edge_logs' order by timestamp asc limit 100";
    const n = await queryNewLogs(w.start, w.end, newSql);
    out({
      step: "logs_new_endpoint",
      window: w.label,
      http: n.status,
      row_count: sanitizeRows(n.body).length,
      error:
        n.body?.error
        || n.body?.message
        || (n.status >= 400 ? String(JSON.stringify(n.body)).slice(0, 200) : null),
      rows: sanitizeRows(n.body)
    });
  }
}

main().catch((e) => {
  out({ step: "fatal", message: String(e && e.message ? e.message : e) });
  process.exit(1);
});
