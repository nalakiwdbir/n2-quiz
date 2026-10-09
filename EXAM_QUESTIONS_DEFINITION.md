# EXAM_QUESTIONS_DEFINITION.md — JLPT N2 paper structure by era

Static snapshot of the exam structure as represented in this repo's dataset.
The living build contracts live in `.agent/ARCHITECTURE.md`; per-exam
verification data lives in `coverage_report.md` (per-exam section shapes).

## 1. Scope & basis

- Built from `n2_questions.json`: **2134 questions, 29 exams (2010-07 → 2024-12)**.
- Covers 文字・語彙 + 文法 + 読解 only. There is **no listening section**
  in this dataset, so real administered papers are longer than the totals below.
- Key-coverage gaps are **data artifacts, not exam changes**: 2011-12 has no
  `jlpt` key and the 2024 exams carry AI-only keys. Paper structure is
  unaffected.

## 2. Stable skeleton (unchanged across all 14 years)

These sections never changed count in any of the 29 exams:

| Section | Questions per exam |
|---|---|
| 問題1 | 5 |
| 問題2 | 5 |
| 問題4 | 7 |
| 問題5 | 5 |
| 問題6 | 5 |
| 問題7 | 12 |
| 問題8 | 5 |
| 問題10 | 5 |
| 問題12 | 2 |
| 問題13 | 3 |
| 問題14 | 2 |

## 3. Change timeline (5 eras — only 問題3/9/11 ever moved)

| Era | Exams | Total | 語彙 (S1–6) | 文法 (S7–9) | 読解 (S10–14) | Change vs previous |
|---|---|---|---|---|---|---|
| Legacy | 2010-07 → 2018-07 (17 exams) | **75** | 32 | 22 | 21 | baseline |
| Transitional I | 2018-12, 2019-07 | **73** | 30 | 22 | 21 | 問題3: 5 → 3 (−2) |
| Transitional II | 2019-12 | **72** | 30 | 22 | 20 | 問題11: 9 → 8 (−1) |
| Transitional III | 2020-12, 2021-07 | **72** | 30 | 21 | 21 | 問題9: 5 → 4 (−1); 問題11 back to 9 (+1) |
| Current | 2021-12 → 2024-12 (9 exams) | **71** | 30 | 21 | 20 | 問題11: 9 → 8 (−1); stable since |

Net evolution: **75 → 71**, purely item-count cuts in 問題3/9/11. No section
was ever added, removed, or re-tasked.

## 4. Paper-number exemplars (one per distinct shape)

Question numbering is paper-continuous, so each cut shifted all downstream
positions (e.g. 問題4 was 16–22 in legacy papers, 14–20 today).

- **2017-12 (legacy 75)**: S1 1–5, S2 6–10, S3 11–15, S4 16–22, S5 23–27,
  S6 28–32, S7 33–44, S8 45–49, S9 50–54, S10 55–59, S11 60–68,
  S12 69–70, S13 71–73, S14 74–75.
- **2019-12 (72)**: S1 1–5, S2 6–10, S3 11–13, S4 14–20, S5 21–25,
  S6 26–30, S7 31–42, S8 43–47, S9 48–52, S10 53–57, S11 58–65,
  S12 66–67, S13 68–70, S14 71–72.
- **2020-12 (72)**: same as 2019-12 except S9 48–51 (4 items),
  S10 52–56, S11 57–65 (9 items).
- **2024-12 (current 71)**: S1 1–5, S2 6–10, S3 11–13, S4 14–20,
  S5 21–25, S6 26–30, S7 31–42, S8 43–47, S9 48–51, S10 52–56,
  S11 57–64, S12 65–66, S13 67–69, S14 70–71.

Rule: never join on bare numbers across eras — the same section sits at
different paper positions depending on era.

## 5. Category mapping & 問題9 note

- 文字・語彙 = S1–S6 (legacy 32 → current 30).
- 文法 = S7–S9 (legacy 22 → current 21).
- 読解 = S10–S14 (legacy 21 → current 20).
- 問題9 (cloze grammar) exists in **all 29 exams** — 5 items through
  2019-12, 4 items from 2020-12 on. Its passage is synthesized per exam
  (`{exam}-問題9-cloze`) and its questions form one atomic unit per exam,
  exactly like the reading sections.

## 6. App reference

- The mock builder's `MOCK_QUOTA`
  (S1:5 S2:5 S3:3 S4:7 S5:5 S6:5 S7:12 S8:5 S9:4u S10:5 S11:8u S12:2 S13:3
  S14:2, u = whole units) mirrors the **current-paper column** above;
  honest total ~71–75 with passage overshoot.
- Single-exam mode renders the true per-exam shape from §3 verbatim.

*Snapshot verified against `coverage_report.md` per-exam shapes on
2026-10-05. Regenerate by hand if the dataset ever changes.*
