#!/usr/bin/env node
/**
 * Context Audit Hook Server (v0)
 *
 * Purpose:
 * - Provide a lightweight HTTP endpoint that, when called, computes fixed-context token estimate
 * - If above threshold, runs the Context Auditor report and (optionally) triggers a Slack alert
 *
 * This avoids touching /opt/openclaw/app internals. It can be started via OPENCLAW_DOCKER_INIT_SCRIPT.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const WORKSPACE_DIR = process.env.OPENCLAW_WORKSPACE_DIR || '/data/workspace';
const STATE_DIR = path.join(WORKSPACE_DIR, 'security', 'state');
const PORT = Number(process.env.SEC_CONTEXT_AUDIT_HOOK_PORT || 33123);

const ENABLED = (process.env.SEC_CONTEXT_AUDIT_ENABLED || 'true').toLowerCase() === 'true';
const THRESHOLD = Number(process.env.SEC_CONTEXT_AUDIT_THRESHOLD || 3500);
const COOLDOWN_MIN = Number(process.env.SEC_CONTEXT_AUDIT_COOLDOWN_MIN || 60);

const AUDITOR = process.env.SEC_CONTEXT_AUDITOR_CMD || `node ${WORKSPACE_DIR}/security/scripts/context_auditor.js`;

const FILES = [
  'SOUL.md','USER.md','IDENTITY.md','TOOLS.md','AGENTS.md','MEMORY.md','HEARTBEAT.md'
].map(f => path.join(WORKSPACE_DIR, f));

function estTokens(s){ return Math.ceil(s.length/4); }

function fixedContextEstimate(){
  let total = 0;
  const perFile = [];
  for (const f of FILES){
    if (!fs.existsSync(f)) continue;
    const t = fs.readFileSync(f,'utf8');
    const tok = estTokens(t);
    total += tok;
    perFile.push({ file: path.basename(f), tokens: tok, chars: t.length });
  }
  perFile.sort((a,b)=>b.tokens-a.tokens);
  return { total, perFile };
}

function readState(){
  try {
    const p = path.join(STATE_DIR, 'context-audit.json');
    return JSON.parse(fs.readFileSync(p,'utf8'));
  } catch { return {}; }
}

function writeState(obj){
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const p = path.join(STATE_DIR, 'context-audit.json');
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

function cooldownOk(nowMs){
  const st = readState();
  const last = st.lastAlertAtMs || 0;
  return (nowMs - last) >= COOLDOWN_MIN*60*1000;
}

function runAuditor(){
  // run command via shell for simplicity (we control cmd)
  const out = execFileSync('/bin/sh', ['-lc', AUDITOR], { encoding: 'utf8' }).trim();
  return out; // auditor prints path
}

function json(res, code, obj){
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/context-audit'){
    res.writeHead(404); res.end('not found'); return;
  }

  // Read body but we don't require any fields; keep for future.
  let data='';
  req.on('data', c => data += c);
  req.on('end', () => {
    const now = Date.now();
    if (!ENABLED) return json(res, 200, { ok:true, enabled:false });

    const est = fixedContextEstimate();

    const over = est.total > THRESHOLD;
    let reportPath = null;

    if (over) {
      // Always generate a report when over.
      try {
        reportPath = runAuditor();
      } catch (e) {
        return json(res, 500, { ok:false, error:'auditor_failed', detail:String(e), est });
      }

      // Update state (cooldown bookkeeping). Actual Slack alert is handled by OpenClaw layer
      // or by a separate notifier if you add one.
      const st = readState();
      if (cooldownOk(now)) {
        st.lastAlertAtMs = now;
        st.lastAlertTokens = est.total;
        st.lastReportPath = reportPath;
        st.lastTopFiles = est.perFile.slice(0,2);
        writeState(st);
      }
    }

    return json(res, 200, {
      ok: true,
      enabled: true,
      threshold: THRESHOLD,
      fixedContextTokens: est.total,
      overThreshold: over,
      topFiles: est.perFile.slice(0,5),
      reportPath
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[context-hook] listening on :${PORT} POST /context-audit (threshold=${THRESHOLD})`);
});
