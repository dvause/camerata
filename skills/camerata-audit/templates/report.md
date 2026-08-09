# [PROJECT] audit report

Repo: [REPO]
Base SHA: [BASE_SHA]
Date: [DATE]
Charter: [CHARTER ONE-LINER]

## Method

| worker | rubric | model/LOE | status | findings file |
| --- | --- | --- | --- | --- |
| [WORKER] | [RUBRIC] | [MODEL / LOE] | [STATUS] | [FINDINGS FILE] |

## Ranked findings (confirmed)

Only orchestrator-confirmed findings appear here, ranked P1 → P3.

### R<n> [P1] <title>

Source: [WORKER/F<n>]
Where: [FILE:LINE]
What: [DEFECT]
Why it matters: [CONSEQUENCE]
Fix: [CONCRETE RECOMMENDATION]
Adjudication note: [WHY CONFIRMED, WHAT WAS VERIFIED]

## Rejected

| source | claim | why rejected |
| --- | --- | --- |
| [WORKER/F<n>] | [CLAIM] | [WHY REJECTED] |

## Deferred

| source | claim | what would resolve it |
| --- | --- | --- |
| [WORKER/F<n>] | [CLAIM] | [WHAT WOULD RESOLVE IT] |

## Coverage

Examined: [FOCUS AREAS / SUBSYSTEMS EXAMINED, consolidated from the workers'
Coverage sections and your own reading]

Not examined / blind spots: [FOCUS AREAS / SUBSYSTEMS NOT EXAMINED, with reasons]

## Verdict

[OVERALL ASSESSMENT. Cluster the confirmed findings into shared themes — the
pattern across findings is the most useful synthesis. Strength claims here must
be orchestrator-re-traced (recorded in progress.md) or attributed to the worker.]

Top-3 actions:
1. [ACTION]
2. [ACTION]
3. [ACTION]

Suggested follow-up: [E.G. A CAMERATA-BUILD RUN FOR CONFIRMED P1/P2 FIXES]
