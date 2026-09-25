// Fermi League — board page logic. shared.js (loaded first) provides
// firebase/auth/db, the $ helper, and all the join/league helpers.

let myId = null;       // canonical player id — the players/{id} doc this device acts as
let myAuthUid = null;  // this browser's own Firebase anonymous auth uid (always fixed)
let isAdmin = false;
let myName = null;
let currentTab = 'daily';
let viewDate = todayStr();
let weekOffset = 0;
let allScores = [];
let playerNames = {};
let hasAutoScrolled = false;
let inputMode = 'paste';
let parsedScores = null;
let scoresUnsub = null;
let playersUnsub = null;

let activeLeagueId = null;
let playersRef = null;
let scoresRef = null;

/* ---------------- Date helpers ---------------- */

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function formatDate(ds) {
  const [y, m, d] = ds.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const mn = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dn = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return dn[dt.getDay()] + ' ' + d + ' ' + mn[m - 1] + (y !== new Date().getFullYear() ? ' ' + y : '');
}
function shiftDate(ds, delta) {
  const [y, m, d] = ds.split('-').map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
}
function getWeekBounds(off) {
  const now = new Date(), day = now.getDay(), mo = day === 0 ? -6 : 1 - day;
  const mon = new Date(now); mon.setDate(now.getDate() + mo + off * 7);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const f = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  return { start: f(mon), end: f(sun), monday: mon, sunday: sun };
}
function formatWeekLabel(mon, sun) {
  const mn = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (mon.getMonth() === sun.getMonth()) return mon.getDate() + '\u2013' + sun.getDate() + ' ' + mn[mon.getMonth()];
  return mon.getDate() + ' ' + mn[mon.getMonth()] + ' \u2013 ' + sun.getDate() + ' ' + mn[sun.getMonth()];
}
// Geometric mean — matches how fermi.gg itself combines the three
// multiplier scores (an arithmetic mean gave a slightly different number
// than the site showed).
function avg3(a, b, c) { return Math.cbrt(a * b * c); }
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }
function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}
function getName(uid) { return playerNames[uid] || 'Player'; }

/* ---------------- Name registration ---------------- */

$('name-input').addEventListener('input', () => {
  $('name-save').disabled = !$('name-input').value.trim();
});
$('name-save').addEventListener('click', async () => {
  const name = $('name-input').value.trim();
  if (!name) return;
  $('name-save').disabled = true;

  // Is that name already taken by someone else in this league? playerNames
  // is already kept live-synced (subscribeToLeague started at boot), so no
  // extra query is needed — just check what's already on the page.
  const existingUid = Object.keys(playerNames).find(
    uid => uid !== myAuthUid && playerNames[uid].trim().toLowerCase() === name.toLowerCase()
  );

  try {
    if (existingUid) {
      const merge = confirm(
        '"' + name + '" is already in this league.\n\n' +
        'Continue as them and pick up their score history on this device?'
      );
      if (merge) {
        await playersRef.doc(existingUid).update({
          linkedUids: firebase.firestore.FieldValue.arrayUnion(myAuthUid)
        });
        myId = existingUid;
        setStoredPlayerId(activeLeagueId, existingUid);
        myName = name;
        playerNames[myId] = name;
        showToast('Welcome back, ' + name);
        render();
        return;
      }
      // Declined — fall through and register a separate identity under
      // this device's own uid, same as any other new name.
    }

    await playersRef.doc(myId).set({
      name,
      joinedAt: firebase.firestore.FieldValue.serverTimestamp(),
      linkedUids: [myId]
    });
    myName = name;
    playerNames[myId] = name;
    showToast('Welcome, ' + name);
    render();
  } catch (e) {
    console.error(e);
    showToast('Could not save your name');
    $('name-save').disabled = false;
  }
});

/* ---------------- League name (shared, admin-editable) ---------------- */

async function applyLeagueName() {
  const name = await leagueDisplayName(activeLeagueId);
  if (name) {
    $('league-title').textContent = name;
    document.title = name;
    rememberLeague(activeLeagueId, name); // keep this browser's switcher label in sync
    renderLeagueSwitcher();
  }
}

$('rename-league-btn').addEventListener('click', () => {
  const current = $('league-title').textContent;
  const next = prompt('Rename this league:', current);
  if (!next || !next.trim() || next.trim() === current) return;
  const name = next.trim().slice(0, 40);
  renameLeague(activeLeagueId, name)
    .then(() => {
      $('league-title').textContent = name;
      document.title = name;
      rememberLeague(activeLeagueId, name);
      renderLeagueSwitcher();
    })
    .catch(() => showToast('Could not rename the league (admin only)'));
});

$('whoami-btn').addEventListener('click', () => {
  const next = prompt('Change your display name:', myName || '');
  if (next && next.trim() && next.trim() !== myName) {
    const name = next.trim().slice(0, 30);
    playersRef.doc(myId).set({ name, joinedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true })
      .then(() => { myName = name; playerNames[myId] = name; $('whoami-btn').textContent = name; render(); })
      .catch(() => showToast('Could not update name'));
  }
});

/* ---------------- Parsing fermi.gg share text ---------------- */

function parseFermiText(text) {
  // Preferred path: fermi.gg's own share format labels each score's line
  // "01", "02", "03" — e.g. "01  5.09×". This is unambiguous, so try it
  // before falling back to guesswork.
  const labeled = [];
  // (?!\.?\d) stops the "0?[1-3]" label from matching the leading digit of
  // an unrelated decimal number (e.g. the "1" in a "1.84x" summary line).
  const lineRe = /^\s*0?[1-3](?!\.?\d)\D{0,4}?(\d+\.?\d*)\s*[\u00d7x]/gim;
  let lm;
  while ((lm = lineRe.exec(text)) !== null) {
    const v = parseFloat(lm[1]);
    if (v >= 1 && v < 100000) labeled.push(v);
  }
  if (labeled.length === 3) return { q1: labeled[0], q2: labeled[1], q3: labeled[2] };

  // Fallback for anything pasted in a different shape: collect every
  // multiplier-looking number, then try to spot which one is a summary
  // (the average of the other three) so we can discard it.
  // [ \t] (not \s) keeps these from crossing a line break and picking up
  // the next line's question-number label as if it were a score.
  const mult = [];
  let m, p1 = /(\d+\.?\d*)[ \t]*[\u00d7x]/gi;
  while ((m = p1.exec(text)) !== null) { const v = parseFloat(m[1]); if (v >= 1 && v < 100000) mult.push(v); }
  let p2 = /[\u00d7x][ \t]*(\d+\.?\d*)/gi;
  while ((m = p2.exec(text)) !== null) { const v = parseFloat(m[1]); if (v >= 1 && v < 100000) mult.push(v); }

  const uniq = [], seen = new Set();
  for (const v of mult) { const k = v.toFixed(4); if (!seen.has(k)) { seen.add(k); uniq.push(v); } }

  if (uniq.length >= 4) {
    // Relative tolerance — fermi.gg rounds displayed values, so absolute
    // tolerance breaks down once numbers get into the hundreds.
    for (let i = 0; i < uniq.length; i++) {
      const c = uniq[i], rest = uniq.filter((_, j) => j !== i);
      for (let a = 0; a < rest.length - 2; a++)
        for (let b = a + 1; b < rest.length - 1; b++)
          for (let cc = b + 1; cc < rest.length; cc++) {
            const avg = (rest[a] + rest[b] + rest[cc]) / 3;
            const tolerance = Math.max(0.06, avg * 0.02);
            if (Math.abs(avg - c) < tolerance) return { q1: rest[a], q2: rest[b], q3: rest[cc] };
          }
    }
    // No summary identified — assume the per-question scores come first
    // and whatever trails them is the summary (matches fermi.gg's layout).
    return { q1: uniq[0], q2: uniq[1], q3: uniq[2] };
  }
  if (uniq.length === 3) return { q1: uniq[0], q2: uniq[1], q3: uniq[2] };
  return null;
}

$('paste-input').addEventListener('input', () => {
  const text = $('paste-input').value.trim();
  const pr = $('parsed-result');
  if (!text) { pr.hidden = true; parsedScores = null; updateSubmit(); return; }
  const r = parseFermiText(text);
  if (r) {
    parsedScores = r;
    const a = avg3(r.q1, r.q2, r.q3);
    pr.className = 'parsed-result'; pr.hidden = false;
    pr.innerHTML =
      '<div class="parsed-scores">' +
      '<div class="parsed-score-item"><span class="label">Q1</span> <span class="value">\u00d7' + r.q1.toFixed(2) + '</span></div>' +
      '<div class="parsed-score-item"><span class="label">Q2</span> <span class="value">\u00d7' + r.q2.toFixed(2) + '</span></div>' +
      '<div class="parsed-score-item"><span class="label">Q3</span> <span class="value">\u00d7' + r.q3.toFixed(2) + '</span></div>' +
      '<div class="parsed-avg">avg <strong>\u00d7' + a.toFixed(2) + '</strong></div></div>';
  } else {
    parsedScores = null;
    pr.className = 'parsed-result error'; pr.hidden = false;
    pr.textContent = 'Could not find three scores. Try pasting the full results, or enter manually.';
  }
  updateSubmit();
});

$('q1').addEventListener('input', updateSubmit);
$('q2').addEventListener('input', updateSubmit);
$('q3').addEventListener('input', updateSubmit);

$('mode-toggle').addEventListener('click', () => {
  if (inputMode === 'paste') {
    inputMode = 'manual';
    $('paste-mode').hidden = true; $('manual-entry').hidden = false;
    $('mode-toggle').textContent = 'Paste results instead';
  } else {
    inputMode = 'paste';
    $('paste-mode').hidden = false; $('manual-entry').hidden = true;
    $('mode-toggle').textContent = 'Enter manually instead';
  }
  updateSubmit();
});

function updateSubmit() {
  if (inputMode === 'paste') {
    $('submit-btn').disabled = !parsedScores;
  } else {
    const a = parseFloat($('q1').value), b = parseFloat($('q2').value), c = parseFloat($('q3').value);
    $('submit-btn').disabled = !(a >= 1 && b >= 1 && c >= 1);
  }
}

$('submit-btn').addEventListener('click', async () => {
  let v1, v2, v3;
  if (inputMode === 'paste' && parsedScores) { v1 = parsedScores.q1; v2 = parsedScores.q2; v3 = parsedScores.q3; }
  else { v1 = parseFloat($('q1').value); v2 = parseFloat($('q2').value); v3 = parseFloat($('q3').value); }
  if (!(v1 >= 1 && v2 >= 1 && v3 >= 1)) return;

  $('submit-btn').disabled = true;
  const date = todayStr();
  const docId = date + '~' + myId;
  try {
    await scoresRef.doc(docId).set({
      uid: myId,
      date,
      q1: Math.round(v1 * 100) / 100,
      q2: Math.round(v2 * 100) / 100,
      q3: Math.round(v3 * 100) / 100,
      avg: Math.round(avg3(v1, v2, v3) * 100) / 100,
      submittedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast('Score submitted');
  } catch (e) {
    console.error(e);
    showToast('Failed to submit');
    $('submit-btn').disabled = false;
  }
});

/* ---------------- Tabs & nav ---------------- */

document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  currentTab = tab.dataset.tab;
  $('date-nav').hidden = currentTab !== 'daily';
  $('week-nav').hidden = currentTab !== 'weekly';
  updateTabLabels();
  render();
}));

function updateTabLabels() {
  const tabs = document.querySelectorAll('.tab');
  tabs[0].textContent = currentTab === 'daily' ? (viewDate === todayStr() ? 'Today' : formatDate(viewDate)) : 'Daily';
  tabs[1].textContent = currentTab === 'weekly' ? (weekOffset === 0 ? 'This week' : formatWeekLabel(getWeekBounds(weekOffset).monday, getWeekBounds(weekOffset).sunday)) : 'Weekly';
  tabs[2].textContent = 'All time';
}

$('prev-day').addEventListener('click', () => { viewDate = shiftDate(viewDate, -1); updateDateDisplay(); render(); });
$('next-day').addEventListener('click', () => { viewDate = shiftDate(viewDate, 1); updateDateDisplay(); render(); });
function updateDateDisplay() {
  const isToday = viewDate === todayStr();
  $('date-label').innerHTML = formatDate(viewDate) + (isToday ? '<span class="today-tag">today</span>' : '');
  $('next-day').disabled = viewDate >= todayStr();
  updateTabLabels();
}

$('prev-week').addEventListener('click', () => { weekOffset--; updateWeekDisplay(); render(); });
$('next-week').addEventListener('click', () => { weekOffset++; updateWeekDisplay(); render(); });
function updateWeekDisplay() {
  const w = getWeekBounds(weekOffset);
  $('week-label').textContent = (weekOffset === 0 ? 'This week: ' : '') + formatWeekLabel(w.monday, w.sunday);
  $('next-week').disabled = weekOffset >= 0;
  updateTabLabels();
}

/* ---------------- Ranking ---------------- */

function dailyRank(scores) {
  if (!scores.length) return [];
  const sorted = [...scores].sort((a, b) => a.avg - b.avg);
  const n = sorted.length;
  const res = [];
  let rank = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && Math.abs(sorted[i].avg - sorted[i - 1].avg) > 0.001) rank = i + 1;
    res.push({ ...sorted[i], rank, points: n - rank + 1 });
  }
  return res;
}
function mySub(date) { return allScores.find(s => s.date === date && s.uid === myId); }

/* ---------------- Render ---------------- */

function render() {
  try {
    if (!myName) {
      $('name-reg').hidden = false;
      $('score-entry').hidden = true;
      $('already-submitted').hidden = true;
      $('whoami-btn').textContent = '';
    } else {
      $('name-reg').hidden = true;
      $('whoami-btn').textContent = myName;
      const sub = mySub(todayStr());
      if (sub) {
        $('score-entry').hidden = true;
        $('already-submitted').hidden = false;
        const a = (typeof sub.avg === 'number') ? sub.avg : avg3(sub.q1, sub.q2, sub.q3);
        $('recap').innerHTML = '<span>\u00d7' + sub.q1 + '</span> <span>\u00d7' + sub.q2 + '</span> <span>\u00d7' + sub.q3 + '</span> <span>avg <strong>\u00d7' + a.toFixed(2) + '</strong></span>';
      } else {
        $('score-entry').hidden = false;
        $('already-submitted').hidden = true;
      }
    }
    if (currentTab === 'daily') renderDaily();
    else if (currentTab === 'weekly') renderWeekly();
    else renderAllTime();

    // Jump straight to the leaderboard for anyone who already has a name on
    // this browser — no reason to make a returning player scroll past their
    // own already-submitted panel to see standings. First-time joiners still
    // land on the name prompt at the top, since they need to fill it in.
    if (!hasAutoScrolled && myName) {
      hasAutoScrolled = true;
      requestAnimationFrame(() => {
        const target = document.querySelector('.tabs');
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  } catch (e) {
    console.error('render error', e);
    $('leaderboard-content').innerHTML = '<div class="empty-state">Something went wrong rendering the board:<br><code style="font-size:11px">' + escapeHtml(e.message || String(e)) + '</code></div>';
  }
}

function renderDaily() {
  const ds = allScores.filter(s => s.date === viewDate);
  const ranked = dailyRank(ds);
  if (!ranked.length) {
    $('leaderboard-content').innerHTML = '<div class="empty-state"><div class="emoji">&#127919;</div>No scores for this day yet.<br>Be the first to log a result.</div>';
    return;
  }
  const rows = ranked.map(r => {
    try { return rowHTML(r, r.points, 'pts', '\u00d7' + r.q1 + '  \u00d7' + r.q2 + '  \u00d7' + r.q3 + '   <span class="avg">avg \u00d7' + r.avg.toFixed(2) + '</span>', isAdmin); }
    catch (e) { console.error('row error', e, r); return ''; }
  }).join('');
  $('leaderboard-content').innerHTML = '<div class="leaderboard">' + rows + '</div>';
}

function renderWeekly() {
  const w = getWeekBounds(weekOffset);
  const ws = allScores.filter(s => s.date >= w.start && s.date <= w.end);
  const byDate = {};
  ws.forEach(s => { (byDate[s.date] = byDate[s.date] || []).push(s); });

  const pts = {}, days = {};
  Object.values(byDate).forEach(ds => dailyRank(ds).forEach(r => {
    pts[r.uid] = (pts[r.uid] || 0) + r.points;
    days[r.uid] = (days[r.uid] || 0) + 1;
  }));
  const entries = Object.keys(pts).map(u => ({ uid: u, totalPoints: pts[u], daysPlayed: days[u] })).sort((a, b) => b.totalPoints - a.totalPoints);

  if (!entries.length) {
    $('leaderboard-content').innerHTML = '<div class="empty-state"><div class="emoji">&#128197;</div>No scores this week yet.</div>';
    return;
  }
  let rank = 1;
  entries.forEach((e, i) => { if (i > 0 && e.totalPoints !== entries[i - 1].totalPoints) rank = i + 1; e.rank = rank; });

  $('leaderboard-content').innerHTML =
    '<div class="stats-row"><div class="stat-card"><div class="stat-value">' + Object.keys(byDate).length + '</div><div class="stat-label">days played</div></div>' +
    '<div class="stat-card"><div class="stat-value">' + entries.length + '</div><div class="stat-label">players</div></div></div>' +
    '<div class="leaderboard">' + entries.map(e => rowHTML({ uid: e.uid, rank: e.rank }, e.totalPoints, 'pts', e.daysPlayed + ' day' + (e.daysPlayed !== 1 ? 's' : ''))).join('') + '</div>';
}

function renderAllTime() {
  const byDate = {};
  allScores.forEach(s => { (byDate[s.date] = byDate[s.date] || []).push(s); });

  const pts = {}, days = {}, wins = {};
  Object.values(byDate).forEach(ds => dailyRank(ds).forEach(r => {
    pts[r.uid] = (pts[r.uid] || 0) + r.points;
    days[r.uid] = (days[r.uid] || 0) + 1;
    if (r.rank === 1) wins[r.uid] = (wins[r.uid] || 0) + 1;
  }));
  const entries = Object.keys(pts).map(u => ({ uid: u, totalPoints: pts[u], daysPlayed: days[u], wins: wins[u] || 0 })).sort((a, b) => b.totalPoints - a.totalPoints);

  if (!entries.length) {
    $('leaderboard-content').innerHTML = '<div class="empty-state"><div class="emoji">&#127942;</div>No scores logged yet.<br>Submit the first result above.</div>';
    return;
  }
  let rank = 1;
  entries.forEach((e, i) => { if (i > 0 && e.totalPoints !== entries[i - 1].totalPoints) rank = i + 1; e.rank = rank; });

  $('leaderboard-content').innerHTML =
    '<div class="stats-row"><div class="stat-card"><div class="stat-value">' + Object.keys(byDate).length + '</div><div class="stat-label">total days</div></div>' +
    '<div class="stat-card"><div class="stat-value">' + entries.length + '</div><div class="stat-label">players</div></div></div>' +
    '<div class="leaderboard">' + entries.map(e => rowHTML({ uid: e.uid, rank: e.rank }, e.totalPoints, 'pts', e.wins + ' win' + (e.wins !== 1 ? 's' : '') + ' / ' + e.daysPlayed + 'd')).join('') + '</div>';
}

function rowHTML(entry, mainVal, mainLbl, detail, showDelete) {
  const isMe = entry.uid === myId;
  const name = getName(entry.uid);
  const initials = name.split(/\s+/).map(w => w[0] || '').join('').toUpperCase().slice(0, 2) || '?';
  const rc = entry.rank <= 3 ? 'r' + entry.rank : '';
  const delBtn = (showDelete && entry.docId) ? '<button class="lb-delete" data-doc="' + escapeHtml(entry.docId) + '" onclick="window._deleteScore(this,this.dataset.doc)">\u2715</button>' : '';
  return '<div class="lb-row' + (isMe ? ' is-me' : '') + '">' +
    '<div class="lb-rank ' + rc + '">' + entry.rank + '</div>' +
    '<div class="lb-avatar">' + escapeHtml(initials) + '</div>' +
    '<div class="lb-info"><div class="lb-name">' + escapeHtml(name) + (isMe ? ' <span style="opacity:.5">(you)</span>' : '') + '</div>' +
    '<div class="lb-detail">' + detail + '</div></div>' +
    '<div class="lb-score"><div class="lb-points">' + mainVal + '</div><div class="lb-points-label">' + mainLbl + '</div></div>' + delBtn + '</div>';
}

/* ---------------- Admin delete (two-tap confirm; no native dialogs) ---------------- */

window._deleteScore = async function (btn, docId) {
  if (!isAdmin) return;
  if (btn.dataset.confirming !== '1') {
    btn.dataset.confirming = '1';
    btn.textContent = 'Confirm?';
    btn.style.color = 'var(--bad)';
    btn.style.borderColor = 'var(--bad)';
    setTimeout(() => {
      if (btn.isConnected && btn.dataset.confirming === '1') {
        btn.dataset.confirming = '0';
        btn.textContent = '\u2715';
        btn.style.color = '';
        btn.style.borderColor = '';
      }
    }, 3000);
    return;
  }
  btn.disabled = true;
  try {
    await scoresRef.doc(docId).delete();
    showToast('Entry deleted');
  } catch (e) {
    console.error(e);
    showToast('Could not delete (admin only)');
    btn.disabled = false;
  }
};

/* ---------------- Data subscriptions ---------------- */

function subscribeToLeague() {
  playersUnsub = playersRef.onSnapshot(snap => {
    snap.docChanges().forEach(change => {
      if (change.type === 'removed') return;
      const data = change.doc.data();
      playerNames[change.doc.id] = data.name || 'Player';
      if (change.doc.id === myId) {
        myName = data.name;
        // Older player docs (created before merging existed) have no
        // linkedUids field. Backfill it quietly so this identity can be
        // merged into from another device later. Harmless to retry.
        if (!data.linkedUids) {
          playersRef.doc(myId).set({ linkedUids: [myId] }, { merge: true }).catch(() => {});
        }
      }
    });
    render();
  }, e => console.error('players subscribe error', e));

  scoresUnsub = scoresRef.onSnapshot(snap => {
    allScores = snap.docs.map(d => {
      const data = d.data();
      let avg = data.avg;
      if (typeof avg !== 'number') avg = avg3(data.q1, data.q2, data.q3);
      return { ...data, avg, docId: d.id };
    });
    $('connection-status').textContent = 'Fermi League \u2014 ' + Object.keys(playerNames).length + ' player' + (Object.keys(playerNames).length !== 1 ? 's' : '');
    updateDateDisplay();
    updateWeekDisplay();
    render();
  }, e => {
    console.error('scores subscribe error', e);
    $('connection-status').textContent = 'Connection lost \u2014 try refreshing';
  });
}

/* ---------------- League switcher ---------------- */

function renderLeagueSwitcher() {
  const sel = $('league-switcher');
  if (!sel) return;
  const list = getJoinedLeagues();
  sel.innerHTML = list.map(l =>
    '<option value="' + escapeHtml(l.id) + '"' + (l.id === activeLeagueId ? ' selected' : '') + '>' + escapeHtml(l.label || l.id) + '</option>'
  ).join('') + '<option value="__join__">+ Join another league</option>';
}

const switcherEl = $('league-switcher');
if (switcherEl) {
  switcherEl.addEventListener('change', e => {
    const val = e.target.value;
    if (val === '__join__') { window.location.href = 'index.html?join=1'; return; }
    if (val !== activeLeagueId) { setActiveLeague(val); window.location.reload(); }
  });
}

/* ---------------- Boot ---------------- */

(async () => {
  const active = getActiveLeague();
  if (!active) {
    window.location.href = 'index.html';
    return;
  }

  try {
    const user = await ensureSignedIn();
    myAuthUid = user.uid;
    // If this browser previously merged into someone else's name, act as
    // that player id again; otherwise default to acting as ourselves.
    myId = getStoredPlayerId(active) || myAuthUid;

    const ok = await leagueStillValid(active);
    if (!ok) {
      // The league disappeared, or was never valid — drop it and send
      // them back to the gate rather than showing an empty board forever.
      forgetLeague(active);
      localStorage.removeItem(LS_ACTIVE_LEAGUE);
      window.location.href = 'index.html';
      return;
    }

    activeLeagueId = active;
    const cols = collectionsFor(active);
    playersRef = cols.players;
    scoresRef = cols.scores;
    isAdmin = (await adminsFor(active)).includes(myAuthUid);
    $('rename-league-btn').hidden = !isAdmin;

    $('checking-access').hidden = true;
    $('app').hidden = false;
    renderLeagueSwitcher();
    subscribeToLeague();
    applyLeagueName();
  } catch (e) {
    console.error('Boot failed', e);
    const detail = (e && (e.code || e.message)) ? ' (' + (e.code || e.message) + ')' : '';
    $('checking-access').innerHTML = '<div class="loading-mark">&#402;</div><p>Could not connect' + detail + '. Check your internet connection and reload the page.</p>';
  }
})();
