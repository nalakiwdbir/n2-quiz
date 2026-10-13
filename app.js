"use strict";
/* JLPT N2 quiz app. Data via window.QUIZ_DATA (data.js). file:// safe. */
var D = window.QUIZ_DATA;
// Section -> display title + category, derived from data (no hardcoded text).
var SEC_TITLES = {}, SEC_CATS = {};
D.questions.forEach(function (q) {
  SEC_TITLES[q.section] = q.secTitle;
  SEC_CATS[q.section] = q.category;
});
var VOCAB_SECS = [1, 2, 3, 4, 5, 6];
var GRAMMAR_SECS = [7, 8, 9];
// Current-paper per-section quotas (B13): every 問題 present in paper
// counts; passage sections (9-14) take whole units (may overshoot).
var MOCK_QUOTA = { 1: 5, 2: 5, 3: 3, 4: 7, 5: 5, 6: 5, 7: 12, 8: 5,
  9: 4, 10: 5, 11: 8, 12: 2, 13: 3, 14: 2 };
function fingerprint(q) { return q.text + "\n" + q.choices.join("\n"); }
function takeQuotaUnits(units, n, takenFp) {
  // Whole units until >= n, skipping units whose content is already taken
  // (guards the known cross-exam duplicates without breaking atomicity).
  var out = [], count = 0, i, j;
  for (i = 0; i < units.length && count < n; i++) {
    var dupe = false;
    for (j = 0; j < units[i].length; j++) {
      if (takenFp[fingerprint(units[i][j])]) { dupe = true; break; }
    }
    if (dupe) continue;
    out.push(units[i]);
    count += units[i].length;
    for (j = 0; j < units[i].length; j++)
      takenFp[fingerprint(units[i][j])] = 1;
  }
  return out;
}

function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function mmss(sec) {
  sec = Math.max(0, Math.floor(sec));
  var m = Math.floor(sec / 60), s = sec % 60;
  return (m < 10 ? "0" + m : "" + m) + ":" + (s < 10 ? "0" + s : "" + s);
}
function cmpQ(a, b) {
  if (a.section !== b.section) return a.section - b.section;
  return a.number - b.number;
}
function shuffled(arr) {
  var a = arr.slice(), i, j, t;
  for (i = a.length - 1; i > 0; i--) {
    j = Math.floor(Math.random() * (i + 1));
    t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
function availKeys(q) { return Object.keys(q.keys); }
function effKey(q, pref) {
  return (pref && q.keys[pref]) ? pref : q.defaultKey;
}
function keyLabel(t) { return t === "ai" ? "AI" : t; }
function applyHlStyle(v) {
  var ok = ["bold", "underline", "mark", "color", "off"];
  document.body.setAttribute("data-hlstyle",
    ok.indexOf(v) >= 0 ? v : "bold");
}

/* ---------- session building ---------- */
function filteredPool(cfg) {
  var pool = D.questions;
  if (cfg.source === "exam") pool = pool.filter(function (q) { return q.exam === cfg.exam; });
  else if (cfg.source === "pool" && cfg.sections && cfg.sections.length < 14)
    pool = pool.filter(function (q) { return cfg.sections.indexOf(q.section) >= 0; });
  return pool;
}
function makeUnits(pool) {
  // Passage-linked questions sharing a passage form one atomic unit.
  var groups = {}, singles = [], order = [];
  pool.forEach(function (q) {
    if (q.pids && q.pids.length) {
      var g = q.exam + "::" + q.pids.slice().sort().join("+");
      if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push(q);
    } else singles.push(q);
  });
  var units = singles.map(function (q) { return [q]; });
  order.forEach(function (g) {
    groups[g].sort(cmpQ);
    units.push(groups[g]);
  });
  return units;
}
function takeUnits(units, n) {
  var out = [], count = 0, i;
  for (i = 0; i < units.length && count < n; i++) {
    out.push(units[i]);
    count += units[i].length;
  }
  return out;
}
function buildMockList() {
  // B13: per-section quotas mirroring a current paper — every 問題 present.
  // Passage sections take whole units (B12 ordering); singles are exact.
  var pool = D.questions;
  var takenFp = {};
  var secs = [];
  Object.keys(MOCK_QUOTA).forEach(function (s) {
    secs.push(parseInt(s, 10));
  });
  secs.sort(function (a, b) { return a - b; });
  var list = [];
  secs.forEach(function (s) {
    var units = shuffled(makeUnits(pool.filter(function (q) {
      return q.section === s;
    })));
    var taken = takeQuotaUnits(units, MOCK_QUOTA[s], takenFp);
    taken.sort(function (a, b) { return cmpQ(a[0], b[0]); });
    taken.forEach(function (u) { list = list.concat(u); });
  });
  return list;
}
function sessionTitle(cfg) {
  if (cfg.source === "mock") return "Mock exam (current-era shape)";
  if (cfg.source === "exam") return "Exam " + cfg.exam;
  if (!cfg.sections || cfg.sections.length >= 14) return "Shuffled pool — all categories";
  return "Shuffled pool — " + cfg.sections.map(function (s) {
    return SEC_TITLES[s] || ("S" + s);
  }).join(", ");
}

/* ---------- state ---------- */
var S = null;
function newState(cfg, list, stream) {
  return {
    config: cfg, list: list, idx: 0,
    pick: list.map(function () { return null; }),
    done: list.map(function () { return false; }),
    akey: list.map(function (q) { return effKey(q, cfg.prefKey); }),
    stream: !!stream, deck: stream ? stream.deck : null,
    unitAt: stream ? stream.unitAt : 0, posInUnit: stream ? stream.posInUnit : 0,
    deckTotal: stream ? stream.deckTotal : list.length,
    elapsed: 0, running: false, startedAt: 0,
  };
}
function startSession(cfg) {
  var pool = filteredPool(cfg);
  if (cfg.source === "mock") {
    var list = buildMockList();
    S = newState(cfg, list, null);
  } else if (cfg.mode === "unlimited" &&
             (cfg.source !== "exam" || cfg._forceStream)) {
    // Exam sessions are fixed full-paper like mock (mode greyed out in
    // setup); cfg._forceStream is a test-only bypass for the harness.
    var units = makeUnits(pool);
    var deck = (cfg.source === "exam") ? units : shuffled(units);
    S = newState(cfg, [], {
      deck: deck, unitAt: 0, posInUnit: 0, deckTotal: deckTotal(deck),
    });
    serveNext(); // deal exactly one question; rest served via advance path
  } else {
    var lunits = (cfg.source === "exam")
      ? makeUnits(pool.slice().sort(cmpQ))
      : shuffled(makeUnits(pool));
    var taken = (cfg.source === "exam") ? lunits : takeUnits(lunits, cfg.limit);
    var flat = [];
    taken.forEach(function (u) { flat = flat.concat(u); });
    S = newState(cfg, flat, null);
  }
  S.running = true;
  S.startedAt = Date.now();
  applyHlStyle(cfg.hl);
  showScreen("quiz");
  renderAll();
  tickLoop();
}
function deckTotal(deck) {
  return deck.reduce(function (n, u) { return n + u.length; }, 0);
}
function deckSpent() {
  // True only when the streaming frontier has consumed the final unit.
  if (!S.stream) return true;
  var u = S.deck[S.unitAt];
  return !!u && S.unitAt + 1 >= S.deck.length && S.posInUnit >= u.length;
}
function serveNext() {
  // Advance frontier by one question; returns false when deck is spent.
  var deck = S.deck, u = deck[S.unitAt];
  if (!u) return false;
  if (S.posInUnit < u.length) {
    S.list.push(u[S.posInUnit]);
    S.pick.push(null); S.done.push(false);
    S.akey.push(effKey(u[S.posInUnit], S.config.prefKey));
    S.posInUnit++;
    return true;
  }
  if (S.unitAt + 1 >= deck.length) return false;
  S.unitAt++;
  S.posInUnit = 1;
  var q = deck[S.unitAt][0];
  S.list.push(q);
  S.pick.push(null); S.done.push(false);
  S.akey.push(effKey(q, S.config.prefKey));
  return true;
}
function advanceForward() {
  if (S.idx + 1 < S.list.length) { S.idx++; return true; }
  if (S.stream) {
    if (serveNext()) { S.idx++; return true; }
    return false; // deck spent
  }
  return false;
}

/* ---------- timer (timestamp-derived) ---------- */
var tickTimer = null;
function nowElapsed() {
  return S.elapsed + (S.running ? (Date.now() - S.startedAt) / 1000 : 0);
}
function pauseTimer() {
  if (S.running) { S.elapsed = nowElapsed(); S.running = false; }
}
function resumeTimer() {
  if (!S.running) { S.startedAt = Date.now(); S.running = true; }
}
function syncTimerPause() {
  // Pause only while instant-correction feedback is on screen.
  var q = S.list[S.idx];
  if (S.config.instant && S.done[S.idx]) pauseTimer();
  else resumeTimer();
}
function tickLoop() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(function () {
    if (!S || $("screen-quiz").hidden) return;
    $("timer-val").textContent = mmss(nowElapsed());
    $("timer-note").textContent = S.running ? "" : " (paused)";
  }, 500);
}

/* ---------- grading ---------- */
function verdict(q, pickVal, keyType) {
  // B10: ANY key disagreement -> unknown (keyType irrelevant to grading;
  // the switcher is an explanation viewer only). Agreeing questions carry
  // one unanimous answer, graded via the default key.
  if (q.conflict) return "unknown";
  var k = q.keys[q.defaultKey] || q.keys[keyType];
  if (!k) return "nokey";
  if (pickVal == null) return "blank";
  return pickVal === k.correct ? "correct" : "incorrect";
}

/* ---------- rendering ---------- */
function showScreen(which) {
  ["setup", "quiz", "results"].forEach(function (s) {
    $("screen-" + s).hidden = (s !== which);
  });
  $("timer").hidden = (which !== "quiz");
  refreshEdgeZones();
}
function renderAll() {
  if (!S) return;
  syncTimerPause();
  refreshEdgeZones();
  var cfg = S.config, q = S.list[S.idx];
  var title = sessionTitle(cfg) + (cfg.instant ? " · instant correction" : "");
  $("quiz-meta").textContent = title;
  var answered = S.pick.filter(function (p) { return p != null; }).length;
  if (S.stream)
    $("quiz-counter").textContent = "Question " + (S.idx + 1) + " of " +
      S.deckTotal + " · answered " + answered;
  else
    $("quiz-counter").textContent = "Question " + (S.idx + 1) + " of " + S.list.length;
  renderNav();
  renderQuestion(q);
  var total = S.stream ? S.deckTotal : S.list.length;
  $("progress-fill").style.width = (100 * answered / Math.max(1, total)) + "%";
  $("progress-label").textContent = "Answered " + answered + " of " + total;
  $("timer-val").textContent = mmss(nowElapsed());
  $("timer-note").textContent = S.running ? "" : " (paused)";
}
function renderNav() {
  var nav = $("nav-grid");
  nav.innerHTML = "";
  for (var i = 0; i < S.list.length; i++) {
    (function (i) {
      var b = document.createElement("button");
      b.textContent = i + 1;
      if (S.pick[i] != null || S.done[i]) b.className = "done";
      if (i === S.idx) b.className += (b.className ? " " : "") + "current";
      else if (S.config.instant && S.done[i]) {
        // B16: instant-only verdict tint (current keeps `current`,
        // unanswered/unknown/blank keep existing styling).
        var vi = verdict(S.list[i], S.pick[i], S.akey[i]);
        if (vi === "correct") b.className += (b.className ? " " : "") + "good";
        else if (vi === "incorrect") b.className += (b.className ? " " : "") + "bad";
      }
      b.addEventListener("click", function () { S.idx = i; renderAll(); });
      nav.appendChild(b);
    })(i);
  }
  var cur = nav.children[S.idx];
  // Container-local scroll only (B9): scrollIntoView() also scrolls the
  // page, yanking users back up after answering long passages. Adjusting
  // nav.scrollTop never touches window.scrollY.
  if (cur) {
    var top = cur.offsetTop - nav.offsetTop;
    if (top < nav.scrollTop) nav.scrollTop = top;
    else if (top + cur.offsetHeight > nav.scrollTop + nav.clientHeight)
      nav.scrollTop = top + cur.offsetHeight - nav.clientHeight;
  }
}
function passageHTML(pid) {
  var p = D.passages[pid];
  if (!p) return "";
  var h = "";
  p.blocks.forEach(function (blk) {
    if (blk.type === "table") {
      h += '<div class="tablewrap"><table>';
      if (blk.header) {
        h += "<tr>" + blk.header.map(function (c) {
          return "<th>" + esc(c) + "</th>";
        }).join("") + "</tr>";
      }
      (blk.rows || []).forEach(function (r) {
        h += "<tr>" + r.map(function (c) {
          return "<td>" + esc(c) + "</td>";
        }).join("") + "</tr>";
      });
      h += "</table></div>";
    } else if (blk.type === "note") {
      h += '<p class="note">' + esc(blk.text) + "</p>";
    } else {
      h += "<p>" + esc(blk.text) + "</p>";
    }
  });
  return h;
}
function validHl(text, hl) {
  // Fail-closed range check (content match was validated at build time).
  if (!hl || hl.length !== 2) return null;
  var st = hl[0], en = hl[1];
  if (!(st >= 0 && en > st && en <= String(text).length)) return null;
  return [st, en];
}
function escInline(line, lineStart, span) {
  if (!span) return esc(line);
  var st = span[0] - lineStart, en = span[1] - lineStart;
  if (en <= 0 || st >= line.length) return esc(line);
  st = Math.max(0, st);
  en = Math.min(line.length, en);
  return esc(line.slice(0, st)) + '<span class="hl">' +
    esc(line.slice(st, en)) + "</span>" + esc(line.slice(en));
}
function stemHTML(text, hl) {
  // Lift embedded ｜-tables (S14, 2 questions); other lines as paragraphs.
  // A highlight span (if any) lives wholly inside one non-table line.
  var span = validHl(text, hl);
  var lines = String(text).split("\n");
  var h = "", i = 0, off = 0;
  while (i < lines.length) {
    if (lines[i].indexOf("｜") >= 0) {
      var rows = [];
      while (i < lines.length && lines[i].indexOf("｜") >= 0) {
        rows.push(lines[i].split("｜"));
        off += lines[i].length + 1;
        i++;
      }
      h += '<div class="tablewrap"><table><tr>' +
        rows[0].map(function (c) { return "<th>" + esc(c) + "</th>"; }).join("") +
        "</tr>";
      for (var r = 1; r < rows.length; r++) {
        h += "<tr>" + rows[r].map(function (c) {
          return "<td>" + esc(c) + "</td>";
        }).join("") + "</tr>";
      }
      h += "</table></div>";
    } else {
      if (lines[i].trim() !== "")
        h += "<p>" + escInline(lines[i], off, span) + "</p>";
      off += lines[i].length + 1;
      i++;
    }
  }
  return h;
}
function renderQuestion(q) {
  var wrap = $("passage-wrap");
  // B14: remember fold states keyed by passage id so re-renders (e.g. key
  // switching) never unfold what the user folded; unseen passages open.
  var foldOpen = {};
  wrap.querySelectorAll("details.passage-fold").forEach(function (d) {
    var pid = d.getAttribute("data-pid");
    if (pid) foldOpen[pid] = d.open;
  });
  wrap.innerHTML = "";
  (q.pids || []).forEach(function (pid, n) {
    var det = document.createElement("details");
    det.className = "passage-fold";
    det.setAttribute("data-pid", pid);
    det.open = (pid in foldOpen) ? foldOpen[pid] : true;
    var sum = document.createElement("summary");
    sum.textContent = (q.pids.length > 1 ? "Passage " + (n + 1) + " " : "Passage ") +
      "(tap to collapse)";
    var div = document.createElement("div");
    div.className = "passage";
    div.innerHTML = passageHTML(pid);
    det.appendChild(sum);
    det.appendChild(div);
    wrap.appendChild(det);
  });
  $("sec-title").textContent = q.secTitle || ("問題" + q.section);
  $("sec-instruction").textContent = q.instruction || "";
  $("q-text").innerHTML = stemHTML(q.text, q.hl);

  // key marker: conflict (revealed only — never leak answers pre-pick) or
  // preferred-key fallback (names keys, not answers — always safe to show)
  var mk = $("key-marker");
  var pref = S.config.prefKey, ak = S.akey[S.idx];
  if (q.conflict && S.done[S.idx]) {
    var parts = Object.keys(q.keys)
      .map(function (t) { return keyLabel(t) + ": " + q.keys[t].correct; });
    mk.hidden = false;
    mk.textContent = "⚠ Key conflict (" + parts.join(" vs ") +
      ") — marked as unknown, excluded from score.";
  } else if (pref && !q.keys[pref]) {
    mk.hidden = false;
    mk.textContent = "⚠ " + keyLabel(pref) + " key not available — showing " +
      keyLabel(ak) + ".";
  } else {
    mk.hidden = true;
    mk.textContent = "";
  }

  // key switch buttons: all key types always shown (B4); unavailable greyed out.
  // Hidden until the question is revealed (B9): instant-locked, i.e. error
  // verification time. Non-instant quizzes never reveal -> review only.
  var ks = $("key-switch");
  ks.innerHTML = "";
  ks.hidden = !S.done[S.idx];
  D.priority.forEach(function (t) {
    var b = document.createElement("button");
    if (q.keys[t]) {
      b.textContent = keyLabel(t) + (q.keys[t].hasExpl ? "" : " (no expl.)");
      if (t === ak) b.className = "picked";
      b.addEventListener("click", function () {
        S.akey[S.idx] = t;
        renderAll();
      });
    } else {
      b.textContent = keyLabel(t);
      b.disabled = true;
      b.title = "No " + keyLabel(t) + " key for this question";
    }
    ks.appendChild(b);
  });

  // choices
  var ch = $("choices");
  ch.innerHTML = "";
  var revealed = S.done[S.idx]; // instant-locked only; non-instant never reveals
  var v = verdict(q, S.pick[S.idx], ak);
  for (var i = 1; i <= 4; i++) {
    (function (i) {
      var b = document.createElement("button");
      b.className = "choice";
      b.textContent = i + ". " + q.choices[i - 1];
      if (S.pick[S.idx] === i) b.className += " selected";
      if (revealed && !q.conflict && q.keys[ak] && i === q.keys[ak].correct)
        b.className += " correct";
      if (revealed && S.pick[S.idx] === i &&
        (v === "incorrect" || (v === "blank" && false))) b.className += " wrong";
      if (revealed && S.pick[S.idx] === i && v === "incorrect") {
        if (b.className.indexOf("wrong") < 0) b.className += " wrong";
      }
      if (revealed) b.disabled = true;
      else b.addEventListener("click", function () { onPick(i); });
      ch.appendChild(b);
    })(i);
  }

  renderFeedback(q, ak, v, revealed);
  $("btn-prev").disabled = (S.idx === 0);
  var atEnd = (S.idx + 1 >= S.list.length);
  $("btn-next").disabled = (!S.stream && atEnd);
  $("btn-next").textContent = (S.stream && atEnd && deckSpent()) ? "Finish" : "Next";
}
function rationaleBlock(title, text) {
  return '<p><b>' + esc(title) + "</b></p>" +
    '<div class="why-text">' + esc(text) + "</div>";
}
function whyDetails(label, rationale, hint) {
  // Summary shows the choice label + hint ONLY; rationale revealed on click.
  return '<details class="why"><summary class="choice">' + esc(label) +
    ' <span class="why-hint">' + esc(hint || "— why wrong?") + "</span></summary>" +
    '<div class="why-text">' + esc(rationale) + "</div></details>";
}
function divergentKeys(q) {
  // Breakdown like "jlpt: 2 / AI: 1" when available keys disagree, else "".
  // Covers ALL key types including AI (AI-vs-human divergence is flagged;
  // only human-vs-human conflict changes the verdict to Unknown).
  var seen = {};
  availKeys(q).forEach(function (t) {
    var c = q.keys[t].correct;
    if (!seen[c]) seen[c] = [];
    seen[c].push(keyLabel(t));
  });
  var vals = Object.keys(seen);
  if (vals.length < 2) return "";
  return vals.sort().map(function (c) {
    return seen[c].join("+") + ": " + c;
  }).join(" / ");
}
function keyContentHTML(q, ak, v) {
  // GATED RULE (B2): show ONLY the active key's content. AI explanations
  // and distractor toggles appear only when AI is the active key.
  // Shared by quiz feedback and results review so they cannot drift apart.
  var h = "";
  var k = q.keys[ak];
  if (q.conflict) {
    h += '<p class="fb-result neutral">Unknown — answer keys disagree.</p>';
    // All keys' answers are always listed (transparency); the explanation
    // shown is the ACTIVE key's only (viewer model, B10).
    Object.keys(q.keys).forEach(function (t) {
      var e = q.keys[t];
      h += "<p>" + esc(keyLabel(t) + " answer: " + e.correct) + "</p>";
    });
    var ae = q.keys[ak];
    if (ae) {
      if (ak === "ai") {
        if (ae.rationale) h += rationaleBlock("AI — why this is correct", ae.rationale);
      } else if (ae.hasExpl && ae.rationale) {
        h += rationaleBlock(keyLabel(ak) + " explanation", ae.rationale);
      } else {
        h += '<p class="muted">No explanation for this key.</p>';
      }
    }
  } else if (!k) {
    h += '<p class="fb-result neutral">No answer key yet for this question.</p>';
  } else if (v === "correct") {
    h += '<p class="fb-result good">Correct ✓ (' + esc(keyLabel(ak)) + " key)</p>";
    if (k.hasExpl && k.rationale) h += rationaleBlock("Explanation", k.rationale);
    else h += '<p class="muted">No explanation for this key.</p>';
  } else if (v === "incorrect") {
    h += '<p class="fb-result bad">Incorrect ✗ — ' + esc(keyLabel(ak)) +
      " answer: " + k.correct + "</p>";
    if (k.hasExpl && k.rationale) h += rationaleBlock("Explanation", k.rationale);
    else h += '<p class="muted">No explanation for this key.</p>';
  } else { // blank with a key
    h += '<p class="fb-result bad">Blank — ' + esc(keyLabel(ak)) +
      " answer: " + k.correct + "</p>";
    if (k.hasExpl && k.rationale) h += rationaleBlock("Explanation", k.rationale);
  }
  // Distractor rationale toggles ONLY for the AI key (revealed contexts only;
  // both callers invoke this solely for revealed questions).
  if (ak === "ai" && q.keys.ai && q.keys.ai.wrong) {
    var aiw = q.keys.ai.wrong;
    var hideCorrect = (!q.conflict && k) ? k.correct : -1;
    Object.keys(aiw).forEach(function (n) {
      var ni = parseInt(n, 10);
      if (ni >= 1 && ni <= 4 && ni !== hideCorrect && aiw[n])
        h += whyDetails(ni + ". " + q.choices[ni - 1], aiw[n]);
    });
  }
  return h;
}
function renderFeedback(q, ak, v, revealed) {
  var fb = $("feedback");
  if (!revealed) { fb.hidden = true; fb.innerHTML = ""; return; }
  fb.hidden = false;
  fb.innerHTML = keyContentHTML(q, ak, v);
}

/* ---------- answering ---------- */
function onPick(i) {
  if (S.done[S.idx]) return; // instant-locked
  S.pick[S.idx] = i;
  if (S.config.instant) {
    S.done[S.idx] = true; // locked-on-first-pick
  }
  renderAll();
}
function onNext() {
  if (S.idx + 1 < S.list.length) {
    S.idx++;
    renderAll();
  } else if (S.stream) {
    if (serveNext()) {
      S.idx++;
      renderAll();
    } else {
      finishSession();
    }
  }
}
function unansweredCount() {
  var n = 0, i;
  for (i = 0; i < S.list.length; i++)
    if (S.pick[i] == null) n++;
  return n;
}
function finishSession() {
  pauseTimer();
  if (tickTimer) clearInterval(tickTimer);
  renderResults();
  showScreen("results");
}

/* ---------- results ---------- */
function renderResults() {
  var correct = 0, incorrect = 0, blank = 0, unknown = 0, nokey = 0;
  var i, q, v;
  for (i = 0; i < S.list.length; i++) {
    q = S.list[i];
    v = verdict(q, S.pick[i], S.akey[i]);
    if (v === "correct") correct++;
    else if (v === "incorrect") incorrect++;
    else if (v === "blank") blank++;
    else if (v === "unknown") unknown++;
    else nokey++;
  }
  var graded = correct + incorrect + blank;
  var total = S.list.length;
  var acc = graded ? Math.round(1000 * correct / graded) / 10 : null;
  var stats = $("stats");
  stats.innerHTML =
    statBox(correct, "Correct") + statBox(incorrect, "Incorrect") +
    statBox(blank, "Blank") + statBox(unknown, "Unknown") +
    (nokey ? statBox(nokey, "No key") : "") +
    '<div class="stat"><b>' + (acc == null ? "—" : acc + "%") +
    "</b><span>Accuracy</span></div>";
  var hon = "Graded " + graded + " of " + total;
  if (unknown) hon += " — " + unknown + " unknown (key conflict, excluded).";
  else if (graded === total) hon += " — every question had a key.";
  $("honesty").textContent = hon + " Grading key per question shown in review.";
  var t = nowElapsed();
  $("time-line").textContent = "Total time " + mmss(t) +
    (total ? " · avg " + mmss(t / total) + " per question" : "");

  var rev = $("review-list");
  rev.innerHTML = "";
  for (i = 0; i < S.list.length; i++) {
    (function (i) {
      var q = S.list[i];
      var v = verdict(q, S.pick[i], S.akey[i]);
      var tag = v === "correct" ? '<span class="tag good">correct</span>' :
        v === "incorrect" ? '<span class="tag bad">incorrect</span>' :
        v === "blank" ? '<span class="tag skip">blank</span>' :
        v === "unknown" ? '<span class="tag warn">unknown</span>' :
        '<span class="tag skip">no key</span>';
      var det = document.createElement("details");
      det.className = "review-item";
      var sum = document.createElement("summary");
      // B14: no grading-key tag — the switcher is an explanation viewer
      // (B10); only the verdict tag shows.
      sum.innerHTML = esc("#" + (i + 1) + " " + (q.secTitle || ("問題" + q.section)) +
        " (" + q.number + ")") + tag;
      det.appendChild(sum);
      var body = document.createElement("div");
      det.appendChild(body);
      refreshReviewItem(i, body); // builds body + switcher listeners
      rev.appendChild(det);
    })(i);
  }
}
// B14: rebuild ONE review item in place — the <details> element (and its
// open state) is never touched, so switching keys can't collapse it or
// move page scroll. Tiles/verdicts are key-independent (B10), hence need
// no recompute.
function refreshReviewItem(i, body) {
  var q = S.list[i];
  var v = verdict(q, S.pick[i], S.akey[i]);
  var h = '<div class="sec-head"><span class="sec-title">' +
    esc(q.secTitle || ("問題" + q.section)) + "</span>" +
    '<span class="sec-instruction">' + esc(q.instruction || "") + "</span></div>";
  (q.pids || []).forEach(function (pid) {
    h += '<details><summary>Passage</summary><div class="passage">' +
      passageHTML(pid) + "</div></details>";
  });
  h += "<div>" + stemHTML(q.text, q.hl) + "</div>";
  var k = q.keys[S.akey[i]];
  for (var c = 1; c <= 4; c++) {
    var mark = "";
    if (!q.conflict && k && c === k.correct) mark = " ✓";
    var your = (S.pick[i] === c) ? " (your pick)" : "";
    h += '<p class="choice' +
      ((!q.conflict && k && c === k.correct) ? " correct" : "") +
      ((S.pick[i] === c && v === "incorrect") ? " wrong" : "") + '">' +
      esc(c + ". " + q.choices[c - 1] + mark + your) + "</p>";
  }
  // Per-question key switcher (mirrors the quiz panel): all key types
  // always shown; unavailable ones greyed out (B4).
  var swHTML = '<div class="key-switch">';
  D.priority.forEach(function (t) {
    if (q.keys[t]) {
      swHTML += '<button data-rkey="' + esc(t) + '"' +
        (t === S.akey[i] ? ' class="picked"' : "") + ">" +
        esc(keyLabel(t) + (q.keys[t].hasExpl ? "" : " (no expl.)")) + "</button>";
    } else {
      swHTML += '<button disabled title="' +
        esc("No " + keyLabel(t) + " key for this question") + '">' +
        esc(keyLabel(t)) + "</button>";
    }
  });
  swHTML += "</div>";
  h += swHTML;
  // Divergence flag across ALL available keys (human + AI).
  var div = divergentKeys(q);
  if (div)
    h += '<p class="key-marker">' +
      esc("⚠ keys disagree on the answer (" + div + ")") + "</p>";
  h += keyContentHTML(q, S.akey[i], v);
  body.innerHTML = h;
  body.querySelectorAll(".key-switch button").forEach(function (b) {
    if (b.disabled) return;
    b.addEventListener("click", function () {
      S.akey[i] = b.getAttribute("data-rkey");
      refreshReviewItem(i, body);
    });
  });
}
function statBox(n, label) {
  return '<div class="stat"><b>' + n + "</b><span>" + esc(label) + "</span></div>";
}

/* ---------- setup screen ---------- */
function selectedSections() {
  var out = [];
  document.querySelectorAll('#prob-groups input[data-sec]').forEach(function (el) {
    if (el.checked) out.push(parseInt(el.getAttribute("data-sec"), 10));
  });
  out.sort(function (a, b) { return a - b; });
  return out;
}
function setupState() {
  var src = document.querySelector('input[name="source"]:checked').value;
  var mode = document.querySelector('input[name="mode"]:checked').value;
  return {
    source: src,
    sections: selectedSections(),
    exam: $("sel-exam").value,
    mode: (src === "mock" || src === "exam") ? "limited" : mode,
    limit: Math.max(1, parseInt($("limit-n").value, 10) || 20),
    instant: $("chk-instant").checked,
    prefKey: "jlpt", // default compare key; switchable per question/review
    hl: $("sel-hl").value || "bold",
  };
}
function refreshSetup() {
  var src = document.querySelector('input[name="source"]:checked').value;
  var mode = document.querySelector('input[name="mode"]:checked').value;
  $("row-problems").hidden = (src !== "pool");
  $("row-exam").hidden = (src !== "exam");
  var mock = (src === "mock");
  var fixed = mock || (src === "exam"); // full paper up front, no streaming
  $("mode-field").querySelectorAll("input").forEach(function (el) {
    el.disabled = fixed;
  });
  // The limit applies to limited pool mode only: hidden for fixed sources
  // (mock/exam deliver the whole paper) and for unlimited streaming.
  var effMode = fixed ? "limited" : mode;
  $("row-limit").hidden = fixed || mode === "unlimited";
  $("limit-n").disabled = mock;
  $("mock-note").hidden = !mock;
  if (mock)
    $("mock-note").textContent = "Mock: every 問題 present in current-paper " +
      "counts (30 vocab + 21 grammar + ~20 reading; whole passages may " +
      "overshoot) — study session (count-up timer). Passage groups stay " +
      "together in paper order.";

  var cfg = setupState();
  var pool = (src === "mock") ? D.questions : filteredPool(cfg);
  var units = makeUnits(pool);

  var info = "";
  var err = "";
  if (src === "pool" && cfg.sections.length === 0) {
    err = "Select at least one problem to start.";
  } else if (!pool.length) {
    err = "No questions match this filter.";
  } else if (src === "mock") {
    info = "Mock pool: " + pool.length + " questions — paper will be ~71–75 " +
      "(every 問題 in paper counts; whole passages may overshoot).";
  } else if (src === "exam") {
    info = "Exam " + cfg.exam + ": full paper, " + pool.length +
      " questions in paper order.";
  } else if (effMode === "limited") {
    info = "Pool: " + pool.length + " questions in " + units.length +
      " units — will use ~" + Math.min(cfg.limit, pool.length) +
      " (whole passages may overshoot).";
  } else {
    info = "Pool: " + pool.length + " questions in " + units.length +
      " units — streaming, ends when the pool is exhausted or you finish.";
  }
  $("pool-info").textContent = info;
  $("setup-error").hidden = !err;
  $("setup-error").textContent = err;
  $("btn-start").disabled = !!err;
}
function initSetup() {
  // Problem checkboxes grouped by category (B15), nothing checked initially.
  var pg = $("prob-groups");
  var secCount = {};
  D.questions.forEach(function (q) {
    secCount[q.section] = (secCount[q.section] || 0) + 1;
  });
  var byCat = {};
  D.categories.forEach(function (c) { byCat[c] = []; });
  Object.keys(SEC_CATS).forEach(function (s) {
    byCat[SEC_CATS[s]].push(parseInt(s, 10));
  });
  D.categories.forEach(function (c) {
    var fs = document.createElement("fieldset");
    fs.className = "prob-group";
    var lg = document.createElement("legend");
    lg.textContent = c;
    lg.title = "Click to toggle the whole group";
    lg.addEventListener("click", function () {
      var boxes = fs.querySelectorAll('input[data-sec]');
      var anyOff = false, i;
      for (i = 0; i < boxes.length; i++) if (!boxes[i].checked) anyOff = true;
      for (i = 0; i < boxes.length; i++) boxes[i].checked = anyOff;
      refreshSetup();
    });
    fs.appendChild(lg);
    byCat[c].sort(function (a, b) { return a - b; }).forEach(function (s) {
      var lab = document.createElement("label");
      lab.className = "check prob-item";
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.setAttribute("data-sec", s);
      cb.checked = false; // B15: start unchecked; Start gated until >= 1
      cb.addEventListener("change", refreshSetup);
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(" " + (SEC_TITLES[s] || ("S" + s)) +
        " (" + (secCount[s] || 0) + ")"));
      fs.appendChild(lab);
    });
    pg.appendChild(fs);
  });
  var se = $("sel-exam");
  D.exams.forEach(function (e) {
    var o = document.createElement("option");
    o.value = e; o.textContent = e;
    se.appendChild(o);
  });
  document.querySelectorAll('input[name="source"],input[name="mode"]')
    .forEach(function (el) {
      el.addEventListener("change", refreshSetup);
    });
  ["sel-exam", "limit-n", "chk-instant", "sel-hl"].forEach(function (id) {
    $(id).addEventListener("change", refreshSetup);
    $(id).addEventListener("input", refreshSetup);
  });
  $("btn-start").addEventListener("click", function () {
    var cfg = setupState();
    cfg.snapshot = true;
    startSession(cfg);
  });
  refreshSetup();
}

/* ---------- quiz wiring ---------- */
function goPrev() {
  if (!S || $("screen-quiz").hidden || S.idx <= 0) return;
  S.idx--;
  renderAll();
}
function goNext() {
  if (!S || $("screen-quiz").hidden) return;
  onNext();
}
function refreshEdgeZones() {
  // B16 desktop-only edge strips mirror the Back/Next buttons (same
  // handlers, same disabled rules). Hidden off the quiz screen entirely.
  var onQuiz = S && !$("screen-quiz").hidden;
  var atEnd = !!onQuiz && (S.idx + 1 >= S.list.length);
  var zp = $("edge-prev"), zn = $("edge-next");
  zp.hidden = !onQuiz;
  zn.hidden = !onQuiz;
  zp.disabled = !onQuiz || S.idx <= 0;
  zn.disabled = !onQuiz || (!S.stream && atEnd);
}
function initQuiz() {
  $("btn-prev").addEventListener("click", goPrev);
  $("btn-next").addEventListener("click", goNext);
  $("edge-prev").addEventListener("click", function () { $("btn-prev").click(); });
  $("edge-next").addEventListener("click", function () { $("btn-next").click(); });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    var t = e.target && e.target.tagName;
    if (t === "INPUT" || t === "SELECT" || t === "TEXTAREA") return;
    if (!S || $("screen-quiz").hidden) return;
    e.preventDefault();
    if (e.key === "ArrowLeft") goPrev();
    else goNext();
  });
  $("btn-finish").addEventListener("click", function () {
    var n = unansweredCount();
    var msg = n > 0 ? n + " unanswered. Finish anyway?"
      : "Finish and see results?";
    if (!window.confirm(msg)) return;
    finishSession();
  });
  $("btn-retry").addEventListener("click", function () {
    startSession(S.config);
  });
  $("btn-new").addEventListener("click", function () {
    S = null;
    showScreen("setup");
    refreshSetup();
  });
}

/* ---------- demo hooks (?demo=, synchronous) ---------- */
function runDemo() {
  var p = new URLSearchParams(window.location.search);
  // Test-only setup preset (?setup=unlimited|mock|limited|exam): checks the
  // matching source/mode radios and re-renders, without starting a session.
  if (p.has("setup")) {
    var preset = p.get("setup");
    var srcVal = preset === "mock" ? "mock" : preset === "exam" ? "exam" : "pool";
    var modeVal = preset === "unlimited" ? "unlimited" : "limited";
    document.querySelectorAll('input[name="source"]').forEach(function (el) {
      el.checked = (el.value === srcVal);
    });
    document.querySelectorAll('input[name="mode"]').forEach(function (el) {
      el.checked = (el.value === modeVal);
    });
    // Test-only problem selection (?secs=1,3 or ?secs= for none).
    if (p.has("secs")) {
      var want = {};
      p.get("secs").split(",").forEach(function (x) {
        if (x) want[parseInt(x, 10)] = 1;
      });
      document.querySelectorAll('#prob-groups input[data-sec]').forEach(function (el) {
        el.checked = !!want[parseInt(el.getAttribute("data-sec"), 10)];
      });
    }
    refreshSetup();
    if (!p.has("demo")) return;
  } else if (!p.has("demo")) return;
  var which = p.get("demo");
  var instant = p.get("instant") !== "0";
  if (which === "quiz") {
    startSession({
      source: "pool", sections: [1,2,3,4,5,6,7,8,9,10,11,12,13,14], mode: "limited", limit: 5,
      instant: false, prefKey: "jlpt",
    });
  } else if (which === "results") {
    startSession({
      source: "pool", sections: [1,2,3,4,5,6,7,8,9,10,11,12,13,14], mode: "limited", limit: 5,
      instant: false, prefKey: "jlpt",
    });
    for (var i = 0; i < S.list.length; i++) S.pick[i] = 1;
    finishSession();
  } else if (which === "mock") {
    startSession({
      source: "mock", sections: [1,2,3,4,5,6,7,8,9,10,11,12,13,14], mode: "limited", limit: 0,
      instant: false, prefKey: "jlpt",
    });
    if (tickTimer) clearInterval(tickTimer);
    pauseTimer();
    if (p.get("diag") === "1") {
      var cls = { vocab: 0, grammar: 0, reading: 0 };
      S.list.forEach(function (q) {
        if (VOCAB_SECS.indexOf(q.section) >= 0) cls.vocab++;
        else if (GRAMMAR_SECS.indexOf(q.section) >= 0) cls.grammar++;
        else cls.reading++;
      });
      var md = document.createElement("script");
      md.type = "application/json";
      md.id = "diag";
      md.textContent = JSON.stringify({
        total: S.list.length, classes: cls,
        secs: S.list.reduce(function (m, q) {
          m[q.section] = (m[q.section] || 0) + 1; return m;
        }, {}),
        ids: S.list.map(function (q) { return q.id; }),
        units: makeUnits(S.list).map(function (u) {
          return u.map(function (q) { return q.id; });
        }),
      });
      document.body.appendChild(md);
    }
    if (p.get("finish") === "1") {
      for (var mi = 0; mi < S.list.length; mi++) S.pick[mi] = 1;
      finishSession();
    }
  } else if (which === "passage") {
    var rq = D.questions.filter(function (q) {
      return q.pids && q.pids.length && q.section >= 10;
    }).slice(0, 3);
    S = newState({
      source: "pool", sections: [1,2,3,4,5,6,7,8,9,10,11,12,13,14], mode: "limited", limit: 3,
      instant: false, prefKey: "jlpt",
    }, rq, null);
    S.running = true; S.startedAt = Date.now();
    showScreen("quiz");
    renderAll();
  } else if (which === "stream") {
    var n = Math.max(1, parseInt(p.get("n") || "5", 10));
    var scfg = {
      source: p.get("source") || "pool", sections: [1,2,3,4,5,6,7,8,9,10,11,12,13,14], mode: "unlimited",
      limit: 0, instant: instant, prefKey: p.get("key") || "jlpt",
      exam: p.get("exam") || D.exams[0],
      _forceStream: p.get("forcestream") === "1", // test-only bypass
    };
    startSession(scfg);
    if (tickTimer) clearInterval(tickTimer);
    pauseTimer();
    var edit = p.get("edit");
    if (p.get("drain") === "1") {
      while (serveNext()) { /* consume whole deck */ }
    } else {
      var served = 1;
      while (served < n && serveNext()) served++;
    }
    // answer all served via the advance path
    for (var j = 0; j < S.list.length; j++) {
      S.idx = j;
      if (instant) { S.pick[j] = 1; S.done[j] = true; }
      else S.pick[j] = 1;
    }
    if (edit) {
      var parts = edit.split(":");
      S.pick[parseInt(parts[0], 10)] = parseInt(parts[1], 10);
    }
    S.idx = S.list.length - 1;
    renderAll();
    pauseTimer();
    if (p.get("finish") === "1") {
      for (var k = 0; k < S.list.length; k++) {
        if (S.pick[k] == null) S.pick[k] = 1;
      }
      finishSession();
    }
    if (p.get("diag") === "1") {
      var units = [];
      S.deck.forEach(function (u) {
        units.push(u.map(function (q) { return q.id; }));
      });
      var diag = document.createElement("script");
      diag.type = "application/json";
      diag.id = "diag";
      diag.textContent = JSON.stringify({
        served: S.list.map(function (q) { return q.id; }),
        picks: S.pick, units: units, deckTotal: S.deckTotal,
      });
      document.body.appendChild(diag);
    }
  }
  var qid = p.get("qid");
  if (qid) {
    var hit = D.questions.filter(function (q) { return q.id === qid; });
    if (hit.length) {
      S = newState({
        source: "pool", sections: [1,2,3,4,5,6,7,8,9,10,11,12,13,14], mode: "limited", limit: 1,
        instant: instant, prefKey: p.get("key") || "jlpt",
      }, hit.slice(0, 1), null);
      S.running = true; S.startedAt = Date.now();
      showScreen("quiz");
      if (p.get("answer")) {
        S.pick[0] = parseInt(p.get("answer"), 10);
        S.done[0] = true;
      }
      renderAll();
      pauseTimer();
      if (p.get("finish") === "1") finishSession();
    }
  }
  // Test-only edge-zone navigation (?edge=left|right): drives the real
  // Back/Next handlers, exactly as the strips and arrow keys do.
  if (p.get("edge") === "left") goPrev();
  else if (p.get("edge") === "right") goNext();
  var why = p.get("why");
  if (why === "click" || why === "click2") {
    var t = document.querySelector("details.why");
    if (t) {
      t.open = true;
      if (why === "click2") t.open = false;
    }
  }
  if (p.get("expand") === "1") {
    document.querySelectorAll("details").forEach(function (d) { d.open = true; });
  }
  // Test-only review key-switch (?rkey=idx:key): clicks the real handler on
  // the results screen, so open-state preservation is genuinely exercised.
  if (p.get("rkey")) {
    var rk = p.get("rkey").split(":");
    var ritem = document.querySelectorAll("#review-list .review-item")[parseInt(rk[0], 10)];
    if (ritem) {
      var rbtn = ritem.querySelector('.key-switch button[data-rkey="' + rk[1] + '"]');
      if (rbtn) rbtn.click();
    }
  }
  if (p.get("hl")) applyHlStyle(p.get("hl"));
  if (p.get("measure") === "1") {
    var wide = [];
    document.querySelectorAll("body > *").forEach(function (el) {
      wide.push({
        tag: (el.id ? "#" + el.id : el.tagName),
        sw: el.scrollWidth, ow: el.offsetWidth,
      });
    });
    var mm = document.createElement("script");
    mm.type = "application/json";
    mm.id = "measure";
    mm.textContent = JSON.stringify({
      innerWidth: window.innerWidth,
      docSW: document.documentElement.scrollWidth,
      bodySW: document.body.scrollWidth,
      kids: wide,
    });
    document.body.appendChild(mm);
  }
}

/* ---------- boot ---------- */
applyHlStyle("bold");
initSetup();
initQuiz();
runDemo();
