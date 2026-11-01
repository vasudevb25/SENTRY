/* SENTRY Command Center — real-time client. A tool by SedentryRisk. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const short = (h, n = 10) => (h ? String(h).slice(0, n) + '…' : '—');
  const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString());
  const timeOf = (iso) => { const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleTimeString([], { hour12: false }); };

  let S = null;              // server state (snapshot + incremental updates)
  let uptimeBase = 0, uptimeAt = Date.now();
  const seenChain = new Set();
  const seenFeed = new Set();
  const seenBlocks = new Set();
  let lastStatus = null;

  // ======================================================== helpers
  function toast(html, bad = false) {
    const t = $('toast');
    t.innerHTML = html;
    t.className = 'toast' + (bad ? ' bad' : '');
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.hidden = true), 5000);
  }

  async function post(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sentry': '1' }, body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  }

  function bump(id) {
    const el = $(id) && $(id).closest('.kpi');
    if (!el) return;
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  }

  function problemMaps() {
    const entries = new Map(), roots = new Map();
    for (const p of (S && S.integrity.problems) || []) {
      if (p.kind === 'entry') entries.set(p.id, p.reason);
      else if (p.kind === 'root') roots.set(p.id, p.reason);
    }
    return { entries, roots };
  }

  // ======================================================== header
  function renderAgent() {
    const a = S.agent, pill = $('pill-agent');
    pill.className = 'pill ' + (a.state === 'running' ? 'ok' : a.state === 'starting' ? 'warn' : 'bad');
    $('agent-state').textContent = a.state === 'running' ? (a.sudo ? 'RUNNING · ROOT' : 'RUNNING') : a.state.toUpperCase();
  }

  function tickClock() {
    $('clock').textContent = new Date().toLocaleTimeString([], { hour12: false });
    if (S) {
      const s = Math.floor((uptimeBase + Date.now() - uptimeAt) / 1000);
      $('uptime').textContent = [s / 3600, (s % 3600) / 60, s % 60].map((v) => String(Math.floor(v)).padStart(2, '0')).join(':');
    }
  }
  setInterval(tickClock, 1000);

  // ======================================================== KPIs
  function renderKpis() {
    const st = S.stats;
    $('k-logs').textContent = fmt(st.totalLogs);
    $('k-logs-foot').textContent = st.unbatched ? `${st.unbatched} awaiting batch seal` : 'hash-chained · signed · encrypted';
    $('k-roots').textContent = fmt(st.confirmedRoots + st.pendingRoots);
    $('k-anchored').textContent = fmt(st.confirmedRoots);
    $('k-pending').textContent = st.pendingRoots ? `${st.pendingRoots} pending (retrying)` : '0 pending';
    const perMin = S.throughput.slice(-60).reduce((a, b) => a + b, 0);
    $('k-rate').textContent = fmt(perMin);
    $('sv-capture').textContent = fmt(st.totalLogs) + ' logs';
    const fill = Math.min(100, (st.unbatched / (st.batchSize || 20)) * 100);
    $('batch-fill').style.width = fill + '%';
    $('st-batch').textContent = `${st.unbatched}/${st.batchSize} · or every ${Math.round((st.batchTimeMs || 5000) / 1000)}s`;
  }

  function renderIntegrityKpi() {
    const k = $('kpi-integrity'), i = S.integrity;
    k.classList.toggle('ok', i.status === 'verified');
    k.classList.toggle('bad', i.status === 'tampered');
    $('k-integrity').textContent = i.status === 'verified' ? '✔ SECURE' : i.status === 'tampered' ? '▲ BREACH' : 'CHECKING';
    $('k-integrity-foot').textContent = i.status === 'tampered'
      ? `${i.problems.length} violation(s) found`
      : i.checkedAt ? `${fmt(i.count)} entries verified` : 'first check pending';
  }

  // ======================================================== pipeline animation
  const pipeline = $('pipeline');
  const stages = [...pipeline.querySelectorAll('.stage')];

  function stageX(i) {
    const p = pipeline.getBoundingClientRect(), r = stages[i].getBoundingClientRect();
    return r.left - p.left + r.width / 2 - 6;
  }

  function pulse(i, cls = 'pulse', ms = 450) {
    const el = stages[i];
    if (!el) return;
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), ms);
  }

  function particle(from, to, cls = '', duration = 1600) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || getComputedStyle(pipeline.querySelector('.pipe-track')).display === 'none') {
      for (let i = from; i <= to; i++) pulse(i, cls ? 'pulse-' + cls : 'pulse');
      return;
    }
    const dot = document.createElement('div');
    dot.className = 'particle ' + cls;
    pipeline.appendChild(dot);
    const x0 = stageX(from), x1 = stageX(to);
    dot.animate([{ transform: `translateX(${x0}px)`, opacity: 0 }, { opacity: 1, offset: 0.08 }, { transform: `translateX(${x1}px)`, opacity: 1 }],
      { duration, easing: 'cubic-bezier(.45,.05,.55,.95)' }).onfinish = () => dot.remove();
    const steps = to - from;
    for (let k = 0; k <= steps; k++) {
      setTimeout(() => pulse(from + k, cls ? 'pulse-' + cls : 'pulse'), (duration * k) / Math.max(steps, 1));
    }
  }

  function animateLogs(n) {
    const count = Math.min(n, 6);
    for (let i = 0; i < count; i++) setTimeout(() => particle(0, 4), i * 180);
  }

  // ======================================================== hash chain
  function renderChain() {
    const box = $('chain');
    const list = S.recentLogs.slice(-14);
    if (!list.length) { box.innerHTML = '<div class="empty">Waiting for the first log entry… use “Generate 5 log events” in the Attack Lab.</div>'; return; }
    const { entries } = problemMaps();
    let html = '';
    list.forEach((e, i) => {
      if (i > 0) {
        const prev = list[i - 1];
        const broken = e.prevHash !== prev.hash;
        const gap = e.id - prev.id > 1;
        html += `<div class="clink${broken ? ' broken' : ''}" title="${broken ? (gap ? 'entries between #' + prev.id + ' and #' + e.id + ' are missing' : 'prev_hash does not match') : 'prev_hash = hash of previous block'}"><span>${broken ? '✕' : '⟶'}</span></div>`;
      }
      const bad = entries.get(e.id);
      const fresh = !seenChain.has(e.id);
      seenChain.add(e.id);
      const seal = bad ? `<span class="tag bad">${esc(bad)}</span>`
        : e.rootId ? `<span class="tag ok">⛓ BATCH ${e.rootId}</span>` : `<span class="tag wait">◷ BATCHING</span>`;
      html += `<div class="cblock${bad ? ' bad' : ''}${fresh ? ' new' : ''}">
        <div class="cb-top"><span class="cb-id">#${e.id}</span><span>${esc(timeOf(e.ts))}</span></div>
        <div class="cb-proc">${esc(e.proc)}</div>
        <div class="cb-msg" title="${esc(e.msg)}">${esc(e.msg)}</div>
        <div class="cb-row">HASH <b>${esc(short(e.hash, 14))}</b></div>
        <div class="cb-row">PREV <b>${esc(short(e.prevHash, 14))}</b></div>
        <div class="cb-row">SIG&nbsp; <b>${esc(short(e.signature, 14))}</b></div>
        <div class="cb-foot"><span class="tag info">ED25519</span>${seal}</div>
      </div>`;
    });
    const atEnd = box.scrollLeft + box.clientWidth >= box.scrollWidth - 40;
    box.innerHTML = html;
    if (atEnd || box.scrollLeft === 0) box.scrollLeft = box.scrollWidth;
    const last = list[list.length - 1];
    $('sv-hash').textContent = short(last.hash, 12);
    $('sv-sig').textContent = short(last.signature, 12);
  }

  // ======================================================== feed
  function renderFeed() {
    const { entries } = problemMaps();
    const rows = S.recentLogs.slice(-80).reverse();
    $('feed').innerHTML = rows.map((e) => {
      const bad = entries.get(e.id);
      const fresh = !seenFeed.has(e.id);
      seenFeed.add(e.id);
      const state = bad ? `<span class="tag bad">${esc(bad.replace('_', ' '))}</span>`
        : e.rootId ? `<span class="tag ok">SEALED</span>` : `<span class="tag wait">QUEUED</span>`;
      return `<tr class="${bad ? 'bad' : ''}${fresh ? ' fresh' : ''}">
        <td class="id">${e.id}</td><td class="time">${esc(timeOf(e.ts))}</td>
        <td class="proc" title="${esc(e.proc)}">${esc(e.proc)}</td>
        <td title="${esc(e.msg)}">${esc(e.msg)}</td>
        <td class="hash">${esc(short(e.hash, 8))}</td><td>${state}</td></tr>`;
    }).join('') || '<tr><td colspan="6" class="empty">No evidence captured yet.</td></tr>';
  }

  // ======================================================== sealed batches
  function renderBlocks(flashId) {
    const box = $('blocks');
    const { roots } = problemMaps();
    if (!S.roots.length) { box.innerHTML = '<div class="empty">No batches sealed yet — the first seal happens after ' + (S.stats.batchSize || 20) + ' logs or ' + Math.round((S.stats.batchTimeMs || 5000) / 1000) + 's.</div>'; return; }
    box.innerHTML = S.roots.map((r) => {
      const bad = roots.get(r.id);
      const fresh = !seenBlocks.has(r.id);
      seenBlocks.add(r.id);
      const status = bad ? `<span class="tag bad">${esc(bad.replace(/_/g, ' '))}</span>`
        : r.status === 'confirmed' ? '<span class="tag ok">⛓ ANCHORED</span>' : '<span class="tag wait">◷ PENDING</span>';
      return `<div class="lblock ${r.status}${bad ? ' bad' : ''}${fresh ? ' new' : ''}${flashId === r.id ? ' flash' : ''}">
        <div class="lb-top"><span class="lb-title">BATCH #${r.id}</span>${status}</div>
        <div class="lb-row">ROOT <b>${esc(short(r.root, 18))}</b></div>
        <div class="lb-row">LOGS <b>${r.n}</b> · ${esc(timeOf(r.created_at))}</div>
        ${r.tx_id ? `<div class="lb-row">TX&nbsp;&nbsp; <b>${esc(short(r.tx_id, 18))}</b></div>` : '<div class="lb-row">TX&nbsp;&nbsp; <b>awaiting ledger…</b></div>'}
      </div>`;
    }).join('');
  }

  // ======================================================== integrity
  function renderIntegrity() {
    const i = S.integrity, panel = $('integrity-panel');
    panel.classList.toggle('ok', i.status === 'verified');
    panel.classList.toggle('bad', i.status === 'tampered');
    $('shield-status').textContent = i.status === 'verified' ? 'INTEGRITY VERIFIED' : i.status === 'tampered' ? 'TAMPERING DETECTED' : 'CHECKING…';
    $('shield-sub').textContent = i.status === 'tampered'
      ? `${i.problems.length} violation(s) — evidence was altered`
      : `${fmt(i.count)} entries · continuous check every 5s`;
    $('int-checked').textContent = i.checkedAt ? 'checked ' + new Date(i.checkedAt).toLocaleTimeString([], { hour12: false }) : '—';

    const count = (reason) => i.problems.filter((p) => p.reason === reason).length;
    const oc = i.onchain;
    const set = (key, cls, icon, val) => {
      const li = document.querySelector(`.checks li[data-check="${key}"]`);
      li.className = cls;
      li.querySelector('.ck-icon').textContent = icon;
      li.querySelector('.ck-val').textContent = val;
    };
    const entryCheck = (key, okText) => {
      const n = count(key);
      if (!i.checkedAt) return set(key, 'wait', '…', 'pending');
      set(key, n ? 'bad' : 'ok', n ? '✖' : '✔', n ? `${n} FAILED` : okText);
    };
    entryCheck('HASH_MISMATCH', `${fmt(i.count)} links ok`);
    entryCheck('BAD_SIGNATURE', `${fmt(i.count)} valid`);
    entryCheck('CIPHERTEXT_TAMPERED', `${fmt(i.count)} authentic`);
    if (!oc) {
      set('LOCAL_ROOT_MISMATCH', 'wait', '…', 'pending');
      set('ONCHAIN', 'wait', '…', 'pending');
    } else {
      const lr = count('LOCAL_ROOT_MISMATCH');
      set('LOCAL_ROOT_MISMATCH', lr ? 'bad' : 'ok', lr ? '✖' : '✔', lr ? `${lr} FAILED` : `${oc.rootsVerified + oc.rootsPending} roots ok`);
      const ocBad = count('ONCHAIN_MISMATCH') + count('MISSING_ON_CHAIN');
      if (!oc.fabricReachable) set('ONCHAIN', 'wait', '▲', 'ledger unreachable');
      else set('ONCHAIN', ocBad ? 'bad' : 'ok', ocBad ? '✖' : '✔', ocBad ? `${ocBad} FAILED` : `${oc.rootsVerified} anchored match`);
    }

    $('problems').innerHTML = i.problems.slice(0, 30).map((p) =>
      `<div class="problem"><b>${esc(p.reason)}</b> · ${p.kind === 'entry' ? 'log #' + p.id : 'batch #' + p.id}${p.detail ? ' — ' + esc(p.detail) : ''}</div>`).join('');

    // banner + page glow
    document.body.classList.toggle('tampered', i.status === 'tampered');
    const alert = $('alert');
    if (i.status === 'tampered') {
      alert.hidden = false;
      alert.classList.remove('resolved');
      $('alert-title').textContent = 'TAMPERING DETECTED';
      $('alert-text').textContent = i.problems.slice(0, 4).map((p) => `${p.kind === 'entry' ? 'log #' : 'batch #'}${p.id}: ${p.reason}`).join('  ·  ')
        + (i.problems.length > 4 ? `  ·  +${i.problems.length - 4} more` : '');
    } else if (lastStatus === 'tampered' && i.status === 'verified') {
      alert.hidden = false;
      alert.classList.add('resolved');
      $('alert-title').textContent = 'INTEGRITY RESTORED';
      $('alert-text').textContent = 'All checks are passing again.';
      setTimeout(() => (alert.hidden = true), 6000);
    } else if (i.status !== 'tampered') {
      alert.hidden = true;
    }
    lastStatus = i.status;
    renderIntegrityKpi();
  }

  // ======================================================== fabric topology
  const NODES = [
    { key: 'agent', label: 'SENTRY agent', sub: 'gateway client', x: 6, y: 110, w: 112, h: 44, agent: true },
    { key: 'orderer.example.com', label: 'orderer', sub: 'raft · ordering', x: 205, y: 12, w: 130, h: 44 },
    { key: 'ca_orderer', label: 'ca_orderer', sub: 'certificate auth.', x: 370, y: 12, w: 130, h: 44 },
    { key: 'peer0.org1.example.com', label: 'peer0.org1', sub: 'endorser · ledger', x: 140, y: 110, w: 130, h: 44 },
    { key: 'peer0.org2.example.com', label: 'peer0.org2', sub: 'endorser · ledger', x: 370, y: 110, w: 130, h: 44 },
    { key: 'chaincode', label: 'logstore', sub: 'chaincode (JS)', x: 255, y: 186, w: 130, h: 44 },
    { key: 'ca_org1', label: 'ca_org1', sub: 'certificate auth.', x: 140, y: 238, w: 130, h: 44 },
    { key: 'ca_org2', label: 'ca_org2', sub: 'certificate auth.', x: 370, y: 238, w: 130, h: 44 },
  ];
  const EDGES = [
    ['agent', 'peer0.org1.example.com', true], ['peer0.org1.example.com', 'orderer.example.com', true],
    ['peer0.org2.example.com', 'orderer.example.com', true], ['orderer.example.com', 'ca_orderer'],
    ['peer0.org1.example.com', 'chaincode'], ['peer0.org2.example.com', 'chaincode'],
    ['peer0.org1.example.com', 'ca_org1'], ['peer0.org2.example.com', 'ca_org2'],
  ];
  const nodeBy = Object.fromEntries(NODES.map((n) => [n.key, n]));
  const center = (n) => [n.x + n.w / 2, n.y + n.h / 2];

  function nodeState(key) {
    if (key === 'agent') return S.agent.state === 'running' ? 'running' : 'stopped';
    if (key === 'chaincode') return S.fabric.reachable ? 'running' : S.fabric.reachable === false ? 'stopped' : 'unknown';
    return (S.fabric.containers || {})[key] || 'unknown';
  }

  function renderTopo() {
    const svg = $('topo');
    let html = '';
    for (const [a, b, live] of EDGES) {
      const [x1, y1] = center(nodeBy[a]), [x2, y2] = center(nodeBy[b]);
      const on = live && nodeState(a) === 'running' && nodeState(b) === 'running';
      html += `<line class="edge${on ? ' live' : ''}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
    }
    for (const n of NODES) {
      const st = nodeState(n.key);
      html += `<g class="node ${st}${n.agent ? ' agent' : ''}">
        <title>${esc(n.key)}: ${st}</title>
        <rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}"/>
        <circle class="led" cx="${n.x + 14}" cy="${n.y + 16}" r="4"/>
        <text x="${n.x + 26}" y="${n.y + 20}">${esc(n.label)}</text>
        <text class="sub" x="${n.x + 26}" y="${n.y + 34}">${esc(n.sub)}</text>
      </g>`;
    }
    svg.innerHTML = html;
    const f = S.fabric;
    $('f-channel').textContent = f.channel || '—';
    $('f-cc').textContent = f.chaincode || '—';
    $('f-height').textContent = f.height != null ? fmt(f.height) : '—';
    $('f-assets').textContent = f.assets != null ? fmt(f.assets) : '—';
    $('f-hash').textContent = f.currentBlockHash ? short(f.currentBlockHash, 40) : '—';
    $('k-height').textContent = f.height != null ? fmt(f.height) : '—';
    $('k-channel').textContent = `channel ${f.channel || '—'}`;
    $('sv-ledger').textContent = f.height != null ? `block ${fmt(f.height)}` : 'block —';
    const running = Object.values(f.containers || {}).filter((s) => s === 'running').length;
    $('fabric-hint').textContent = `${running}/${Object.keys(f.containers || {}).length || 6} containers up`;
  }

  function topoPacket() {
    const svg = $('topo');
    const path = ['agent', 'peer0.org1.example.com', 'orderer.example.com', 'peer0.org2.example.com'].map((k) => center(nodeBy[k]));
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('r', '5'); dot.setAttribute('class', 'pkt');
    svg.appendChild(dot);
    const segMs = 500, start = performance.now();
    (function frame(now) {
      const t = (now - start) / segMs, seg = Math.floor(t);
      if (seg >= path.length - 1) { dot.remove(); return; }
      const f = t - seg, [x1, y1] = path[seg], [x2, y2] = path[seg + 1];
      dot.setAttribute('cx', x1 + (x2 - x1) * f); dot.setAttribute('cy', y1 + (y2 - y1) * f);
      requestAnimationFrame(frame);
    })(start);
  }

  // ======================================================== sources
  function renderSources() {
    const src = S.sources || { files: [] };
    let html = `<span class="src${src.journald ? '' : ' off'}"><i></i>journald</span>`;
    for (const f of src.files) html += `<span class="src${f.exists ? '' : ' off'}" title="${f.exists ? 'watching' : 'not present on this system'}"><i></i>${esc(f.path)}</span>`;
    $('sources').innerHTML = html;
    $('st-capture').textContent = [src.journald ? 'journald' : null, src.files.filter((f) => f.exists).length ? `${src.files.filter((f) => f.exists).length} file(s)` : null].filter(Boolean).join(' + ') || 'no sources';
  }

  // ======================================================== throughput chart
  const canvas = $('chart'), ctx = canvas.getContext('2d');
  let hoverX = null;

  function drawChart() {
    const wrap = $('chart-wrap');
    const dpr = window.devicePixelRatio || 1;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const data = S.throughput;
    const pad = { l: 36, r: 10, t: 12, b: 22 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const max = Math.max(4, ...data);
    const niceMax = Math.ceil(max / 4) * 4;
    const x = (i) => pad.l + (i / (data.length - 1)) * iw;
    const y = (v) => pad.t + ih - (v / niceMax) * ih;

    // recessive grid + axis labels
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = '#557587';
    ctx.strokeStyle = 'rgba(0,212,255,0.08)';
    ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const v = (niceMax / 4) * g, yy = Math.round(y(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(W - pad.r, yy); ctx.stroke();
      ctx.textAlign = 'right'; ctx.fillText(String(v), pad.l - 6, yy + 3);
    }
    ctx.textAlign = 'center';
    [[0, '-2m'], [60, '-1m'], [data.length - 1, 'now']].forEach(([i, l]) => ctx.fillText(l, x(i), H - 6));

    // area + 2px line
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ih);
    grad.addColorStop(0, 'rgba(0,212,255,0.35)');
    grad.addColorStop(1, 'rgba(0,212,255,0)');
    ctx.beginPath();
    data.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
    ctx.lineTo(x(data.length - 1), y(0)); ctx.lineTo(x(0), y(0)); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    ctx.beginPath();
    data.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
    ctx.strokeStyle = '#00d4ff'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(0,212,255,0.6)'; ctx.shadowBlur = 8; ctx.stroke(); ctx.shadowBlur = 0;

    // live head marker
    const li = data.length - 1;
    ctx.beginPath(); ctx.arc(x(li), y(data[li]), 4, 0, Math.PI * 2);
    ctx.fillStyle = '#00ff9c'; ctx.fill();

    // hover crosshair + tooltip
    const tip = $('tooltip');
    if (hoverX != null && hoverX >= pad.l && hoverX <= W - pad.r) {
      const i = Math.round(((hoverX - pad.l) / iw) * (data.length - 1));
      const xx = x(i), yy = y(data[i]);
      ctx.strokeStyle = 'rgba(0,212,255,0.5)'; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(xx, pad.t); ctx.lineTo(xx, pad.t + ih); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(xx, yy, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#03060b'; ctx.fill(); ctx.strokeStyle = '#00d4ff'; ctx.lineWidth = 2; ctx.stroke();
      const ago = data.length - 1 - i;
      tip.innerHTML = `<b>${data[i]}</b> log${data[i] === 1 ? '' : 's'}/s · ${ago ? ago + 's ago' : 'now'}`;
      tip.style.left = Math.min(Math.max(xx, 60), W - 60) + 'px';
      tip.style.top = yy + 'px';
      tip.hidden = false;
    } else {
      tip.hidden = true;
    }
  }
  canvas.addEventListener('mousemove', (e) => { hoverX = e.offsetX; drawChart(); });
  canvas.addEventListener('mouseleave', () => { hoverX = null; drawChart(); });
  window.addEventListener('resize', () => S && drawChart());

  // ======================================================== console
  const MAX_CONSOLE = 300;
  function consoleClass(line) {
    if (/❌|🚨|error|DETECTED/i.test(line)) return 'err';
    if (/⚠️|warn/i.test(line)) return 'warn';
    if (/✅|Anchored|🌳/.test(line)) return 'good';
    if (/🔗/.test(line)) return 'chain';
    return '';
  }
  function addConsole(entry, scroll = true) {
    const box = $('console');
    const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
    const div = document.createElement('div');
    div.className = 'cl ' + consoleClass(entry.line);
    div.innerHTML = `<span class="ct">${new Date(entry.t).toLocaleTimeString([], { hour12: false })}</span><span class="cs ${esc(entry.source)}">[${esc(entry.source)}]</span>${esc(entry.line)}`;
    const cursor = box.querySelector('.cursor-line');
    box.insertBefore(div, cursor);
    while (box.children.length > MAX_CONSOLE + 1) box.removeChild(box.firstChild);
    if (scroll && atBottom) box.scrollTop = box.scrollHeight;
  }

  // ======================================================== attack log
  function renderAttacks() {
    $('attack-log').innerHTML = (S.attacks || []).map((a) => `
      <div class="alog${a.detectedIn != null ? ' detected' : ''}">
        <div class="al-top"><span class="al-title">☠ ${esc(a.title)}</span><span class="tag ${a.detectedIn != null ? 'ok' : 'wait'}">${a.detectedIn != null ? 'DETECTED · ' + a.detectedIn + 'ms' : 'ANALYSING'}</span></div>
        <div class="al-exp">${esc(a.detail)}</div>
        <div class="al-exp">expect → ${esc(a.expect)}</div>
      </div>`).join('');
  }

  // ======================================================== actions
  $('btn-verify').addEventListener('click', async (ev) => {
    const b = ev.currentTarget;
    b.disabled = true; b.innerHTML = '<span>⟳</span> Verifying chain + ledger…';
    try {
      const r = await post('/api/verify');
      toast(r.status === 'verified'
        ? `✔ <b>Verified</b> — ${fmt(r.count)} entries, ${r.onchain ? r.onchain.rootsVerified : 0} batch roots match the Fabric ledger.`
        : `▲ <b>${r.problems.length} violation(s)</b> found.`, r.status !== 'verified');
    } catch (e) { toast('Verification failed: ' + esc(e.message), true); }
    b.disabled = false; b.innerHTML = '<span>⟳</span> Run full verification';
  });

  $('btn-generate').addEventListener('click', async (ev) => {
    const b = ev.currentTarget; b.disabled = true;
    try { await post('/api/generate', { count: 5 }); toast('＋ 5 log events written to the system journal — watch them flow through the pipeline.'); }
    catch (e) { toast(esc(e.message), true); }
    setTimeout(() => (b.disabled = false), 800);
  });

  document.querySelectorAll('.atk').forEach((btn) => btn.addEventListener('click', async () => {
    const all = document.querySelectorAll('.atk');
    all.forEach((x) => (x.disabled = true));
    const t0 = performance.now();
    try {
      const r = await post('/api/attack', { type: btn.dataset.attack });
      const ms = Math.round(performance.now() - t0);
      const a = (S.attacks || []).find((x) => x.t === r.attack.t) || r.attack;
      a.detectedIn = r.integrity.status === 'tampered' ? ms : null;
      if (!S.attacks.includes(a)) S.attacks.unshift(a);
      renderAttacks();
      toast(r.integrity.status === 'tampered'
        ? `🛡 <b>Attack detected in ${ms} ms</b> — ${esc(r.attack.expect)}`
        : `Attack applied — awaiting detection…`, r.integrity.status === 'tampered');
    } catch (e) { toast('Attack failed: ' + esc(e.message), true); }
    all.forEach((x) => (x.disabled = false));
  }));

  // ======================================================== full render
  function renderAll() {
    renderAgent(); renderKpis(); renderChain(); renderFeed(); renderBlocks();
    renderIntegrity(); renderTopo(); renderSources(); renderAttacks(); drawChart();
    $('version').textContent = 'v' + S.version;
    const box = $('console');
    box.innerHTML = '<div class="cl cursor-line"><span class="cursor"></span></div>';
    S.console.forEach((e) => addConsole(e, false));
    box.scrollTop = box.scrollHeight;
  }

  // ======================================================== stream
  function connect() {
    const es = new EventSource('/api/stream');
    const link = (cls, txt) => { $('pill-link').className = 'pill ' + cls; $('link-state').textContent = txt; };
    es.onopen = () => link('ok', 'LIVE');
    es.onerror = () => link('bad', 'RECONNECTING');

    es.addEventListener('snapshot', (ev) => {
      S = JSON.parse(ev.data);
      uptimeBase = S.uptime; uptimeAt = Date.now();
      S.recentLogs.forEach((e) => { seenChain.add(e.id); seenFeed.add(e.id); });
      S.roots.forEach((r) => seenBlocks.add(r.id));
      lastStatus = S.integrity.status;
      renderAll(); tickClock();
    });
    const on = (name, fn) => es.addEventListener(name, (ev) => { if (S) fn(JSON.parse(ev.data)); });

    on('logs', (entries) => {
      S.recentLogs.push(...entries);
      if (S.recentLogs.length > 150) S.recentLogs.splice(0, S.recentLogs.length - 150);
      renderChain(); renderFeed(); animateLogs(entries.length); bump('k-logs');
    });
    on('relog', (list) => { S.recentLogs = list; renderChain(); renderFeed(); });
    on('sealed', (list) => {
      const m = new Map(list.map((x) => [x.id, x.rootId]));
      S.recentLogs.forEach((e) => { if (m.has(e.id)) e.rootId = m.get(e.id); });
      renderChain(); renderFeed();
    });
    on('stats', (d) => {
      S.stats = d.stats;
      S.throughput.push(d.throughputLast); S.throughput.shift();
      renderKpis(); drawChart();
    });
    on('roots', (roots) => { S.roots = roots; renderBlocks(); });
    on('pipeline', (p) => {
      if (p.stage === 'merkle') { particle(4, 5, 'amber', 1100); bump('k-roots'); }
      if (p.stage === 'anchor') {
        pulse(5, 'pulse-green', 1400); topoPacket(); bump('k-anchored');
        renderBlocks(p.rootId);
      }
    });
    on('fabric', (f) => { S.fabric = f; renderTopo(); });
    on('integrity', (i) => {
      const wasTampered = S.integrity.status === 'tampered';
      S.integrity = i; renderIntegrity(); renderChain(); renderFeed(); renderBlocks();
      // bring the first broken block into view so the audience sees the break
      if (!wasTampered && i.status === 'tampered') {
        const bad = document.querySelector('#chain .cblock.bad');
        const box = $('chain');
        if (bad) box.scrollLeft = Math.max(0, bad.offsetLeft - box.offsetLeft - box.clientWidth / 2 + bad.clientWidth / 2);
      }
    });
    on('agent', (a) => { S.agent = a; renderAgent(); renderTopo(); });
    on('console', (c) => { S.console.push(c); if (S.console.length > 400) S.console.shift(); addConsole(c); });
    on('attack', (a) => { if (!S.attacks.some((x) => x.t === a.t)) { S.attacks.unshift(a); renderAttacks(); } });
  }

  connect();
  tickClock();
})();
