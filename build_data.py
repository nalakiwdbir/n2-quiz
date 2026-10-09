"""Build the quiz payload from read-only source data.

Reads (NEVER writes to these):
  n2_questions.json, n2_passages.json, n2_answers.json,
  keys_explanation.json, keys.json, sections.json
Writes (generated, safe to delete):
  data.js  (window.QUIZ_DATA = {...};)
  coverage_report.md
Usage: python build_data.py
"""
import json
from collections import Counter, defaultdict

ROOT = __file__.rsplit("\\", 1)[0] + "\\" if "\\" in __file__ else "./"


def load(name):
    with open(ROOT + name, encoding="utf-8") as f:
        return json.load(f)


def base_of(key_id):
    # "2014-12-1-1-jlpt" -> "2014-12-1-1" ; bare ids have no suffix
    parts = key_id.split("-")
    if len(parts) == 5:
        return "-".join(parts[:4]), parts[4]
    return key_id, None


def main():
    qd = load("n2_questions.json")
    pd = load("n2_passages.json")
    ad = load("n2_answers.json")
    ke = load("keys_explanation.json")
    kb = load("keys.json")

    # --- section rubrics (user-supplied exact wording; build fails if off) ---
    secs = load("sections.json")
    assert isinstance(secs, list) and len(secs) == 14, \
        "sections.json must hold exactly 14 entries, got %d" % len(secs)
    rubrics = {}
    for i, entry in enumerate(secs, start=1):
        inner = entry.get("section", {})
        assert inner.get("title") == "問題%d" % i, \
            "sections.json entry %d title mismatch: %r" % (i, inner.get("title"))
        assert (inner.get("instruction") or "").strip(), \
            "sections.json entry %d has empty instruction" % i
        rubrics[i] = {"title": inner["title"],
                      "instruction": inner["instruction"]}

    # --- highlight resolution: stored spans (S1/2/5) + S6 headword rule ---
    # Returns [start, end] or None. Fail-closed: anything suspicious -> None.
    hl_dropped = []
    def resolve_hl(q):
        text = q["question_text"]
        cand = None
        stored = q.get("highlights") or []
        if len(stored) > 1:
            hl_dropped.append((q["id"], "multi-span"))
            return None
        if stored:
            s = stored[0]
            cand = (s.get("start"), s.get("end"), s.get("text", ""))
        elif q["section"] == 6:
            # S6 headword rule: last non-empty line (bare word if single-line).
            lines = [ln for ln in text.split("\n") if ln.strip()]
            if not lines:
                hl_dropped.append((q["id"], "s6-empty"))
                return None
            head = lines[-1]
            if len(head) > 6:
                hl_dropped.append((q["id"], "s6-long-last-line"))
                return None
            start = text.rfind(head)
            cand = (start, start + len(head), head)
        else:
            return None
        st, en, want = cand
        if not (isinstance(st, int) and isinstance(en, int)
                and 0 <= st < en <= len(text)):
            hl_dropped.append((q["id"], "range"))
            return None
        if text[st:en] != want:
            hl_dropped.append((q["id"], "mismatch"))
            return None
        if "\n" in text[st:en] or "｜" in text[st:en]:
            hl_dropped.append((q["id"], "crosses-break"))
            return None
        return [st, en]

    questions = qd["questions"]
    qids = [q["id"] for q in questions]
    assert len(qids) == len(set(qids)), "dup question ids"
    qmap = {q["id"]: q for q in questions}
    for q in questions:
        assert len(q["choices"]) == 4 and all(c.strip() for c in q["choices"]), \
            "bad choices: " + q["id"]

    # --- passage inverted index: qid -> [passage] (file order wins) ---
    q2p = defaultdict(list)
    orphans = 0
    for p in pd["passages"]:
        for rq in p.get("related_questions", []):
            if rq in qmap:
                q2p[rq].append(p)
            else:
                orphans += 1
    for b in pd["passages"]:
        for blk in b.get("passage_blocks", []):
            assert blk.get("type") in ("para", "note", "table"), \
                "unknown block type in " + b["passage_id"]

    # --- keys by base id ---
    keys = defaultdict(dict)  # base -> {ktype: entry}
    ai_dupes = 0
    for a in ad["answers"]:
        b = a["id"]
        if b in keys and "ai" in keys[b]:
            ai_dupes += 1
        ex = a.get("explanation", {}) or {}
        keys[b]["ai"] = {
            "correct": a["correct_answer"],
            "rationale": ex.get("correct_rationale", ""),
            "wrong": ex.get("wrong_rationales", {}) or {},
            "hasExpl": True,
            "choiceText": "",
            "src": "AI",
        }
    for e in ke:
        b, suf = base_of(e["id"])
        assert suf == "jlpt", "unexpected suffix in keys_explanation: " + e["id"]
        assert "jlpt" not in keys[b], "jlpt dupe on " + b
        keys[b]["jlpt"] = {
            "correct": e["correct_answer"],
            "rationale": e.get("explanation", "") or "",
            "wrong": {},
            "hasExpl": True,
            "choiceText": e.get("corresponding_choice", "") or "",
            "src": "jlpt",
        }
    for e in kb:
        b, suf = base_of(e["id"])
        assert suf in ("teijing", "full", "mark", "jlpt"), "bad suffix " + e["id"]
        kt = suf
        assert kt not in keys[b], "key dupe %s on %s" % (kt, b)
        keys[b][kt] = {
            "correct": e["correct_answer"],
            "rationale": "",
            "wrong": {},
            "hasExpl": False,
            "choiceText": e.get("corresponding_choice", "") or "",
            "src": kt,
        }

    HUMAN = ("jlpt", "teijing", "full", "mark")
    PRIORITY = ("jlpt", "teijing", "full", "mark", "ai")

    out_q = []
    conflicts = []
    linked = 0
    hl_hits = 0
    for q in sorted(questions, key=lambda x: (x["exam"], x["section"],
                                             x["question_num"])):
        qid = q["id"]
        plist = q2p.get(qid, [])
        if plist:
            linked += 1
        k = keys.get(qid, {})
        # B10: ANY key disagreement (human or AI) -> conflict/Unknown.
        allv = {t: k[t]["correct"] for t in k}
        hum = {t: k[t]["correct"] for t in HUMAN if t in k}
        conflict = len(set(allv.values())) > 1
        human_conflict = len(set(hum.values())) > 1
        if conflict:
            conflicts.append((qid, allv, human_conflict))
        default = next((t for t in PRIORITY if t in k), None)
        hl = resolve_hl(q)
        if hl:
            hl_hits += 1
        out_q.append({
            "id": qid,
            "exam": q["exam"],
            "category": q["category"],
            "section": q["section"],
            "number": q["question_num"],
            "text": q["question_text"],
            "choices": q["choices"],
            "pids": [p["passage_id"] for p in plist],
            "keys": k,
            "conflict": conflict,
            "defaultKey": default,
            "secTitle": rubrics[q["section"]]["title"],
            "instruction": rubrics[q["section"]]["instruction"],
            "hl": hl,
        })

    passages = {}
    for p in pd["passages"]:
        passages[p["passage_id"]] = {
            "id": p["passage_id"],
            "exam": p["exam"],
            "section": p["section"],
            "blocks": p["passage_blocks"],
            "related": p["related_questions"],
        }

    exams = sorted({q["exam"] for q in questions})
    cat_count = Counter(q["category"] for q in questions)
    key_cov = Counter()
    for q in out_q:
        for t in q["keys"]:
            key_cov[t] += 1

    payload = {
        "builtBy": "build_data.py",
        "exams": exams,
        "categories": sorted(cat_count.keys()),
        "catCounts": dict(cat_count),
        "keyCoverage": dict(key_cov),
        "questionCount": len(out_q),
        "linkedCount": linked,
        "conflicts": [{"id": b, "keys": h, "human": hc}
                      for b, h, hc in sorted(conflicts)],
        "priority": list(PRIORITY),
        "questions": out_q,
        "passages": passages,
    }

    js = ("window.QUIZ_DATA = " +
          json.dumps(payload, ensure_ascii=False, sort_keys=True) + ";\n")
    with open(ROOT + "data.js", "w", encoding="utf-8", newline="\n") as f:
        f.write(js)

    # --- era shapes + coverage report ---
    era = {}
    for e in exams:
        secs = Counter(q["section"] for q in questions if q["exam"] == e)
        era[e] = dict(sorted(secs.items()))
    lines = ["# Coverage report (generated — do not hand-edit)", "",
             "## Key coverage (of %d questions)" % len(out_q)]
    for t in ["jlpt", "teijing", "full", "mark", "ai"]:
        lines.append("- %s: %d" % (t, key_cov.get(t, 0)))
    lines += ["", "## Key conflicts (ANY disagreement incl. AI): %d"
              % len(conflicts)]
    lines.append("- human-vs-human: %d" %
                 sum(1 for _, _, hc in conflicts if hc))
    lines.append("- AI-involved only: %d" %
                 sum(1 for _, _, hc in conflicts if not hc))
    for b, h, hc in sorted(conflicts):
        lines.append("- %s %s%s" % (b, h, "" if hc else " (ai-only)"))
    lines += ["", "## Per-exam section shapes"]
    for e in exams:
        lines.append("- %s total=%d %s" % (e, sum(era[e].values()), era[e]))
    lines += ["", "## Passage linkage",
              "- questions with >=1 passage: %d of %d" % (linked, len(out_q)),
              "- orphan passage refs: %d" % orphans,
              "- ai duplicate ids skipped: %d" % ai_dupes, ""]
    lines += ["", "## Section rubrics (sections.json)",
              "- sections covered: %d of 14" % len(rubrics),
              "- instruction present on payload questions: %d of %d"
              % (sum(1 for q in out_q if q["instruction"]), len(out_q)), ""]
    lines += ["", "## Highlights",
              "- questions with resolved span: %d of %d"
              % (hl_hits, len(out_q)),
              "- dropped spans: %d" % len(hl_dropped)]
    for qid, why in sorted(hl_dropped):
        lines.append("- %s %s" % (qid, why))
    lines.append("")
    with open(ROOT + "coverage_report.md", "w",
              encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))

    print("questions=%d linked=%d conflicts=%d orphans=%d" %
          (len(out_q), linked, len(conflicts), orphans))
    print("keyCoverage=%s" % dict(key_cov))
    print("OK data.js + coverage_report.md")


if __name__ == "__main__":
    main()
