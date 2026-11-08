# Evaluation 20261108-171254

primary `jev-1.13.0`, secondary `gemini-3.6-flash`, commit `557b89a`, 12 answers, 72 labeled cells

## Accuracy

| | LLM only | decision model only | hybrid coverage | hybrid acc (covered) | cells left to grader | hybrid final (grader decides those) |
|---|---|---|---|---|---|---|
| all | 91.7% | 87.5% | 90.3% | 95.4% | 7 | 95.8% |
| q2_sql_injection | 91.7% | 87.5% | 90.3% | 95.4% | 7 | 95.8% |

Labels of non-gate items are ignored for answers the grader judged off topic.

Hybrid by route (human: no recommendation, the grader decides):

| route | cells | acc |
|---|---|---|
| auto | 61 | 96.7% |
| human | 7 | - |
| llm | 4 | 75.0% |

## Cost (USD, whole set)

| | total | per answer |
|---|---|---|
| (a) judgment: hybrid | 0.0288 | 0.00240 |
| (a) judgment: LLM only | 0.0942 | 0.00785 |
| (b) evidence (every answer opened) | 0.0249 | 0.00207 |
| (c) hybrid total | 0.0537 | 0.00447 |

## Latency per answer (s)

| | mean | median | max |
|---|---|---|---|
| hybrid: first recommendation (decision model) | 0.36 | 0.26 | 1.29 |
| hybrid: all cells done (with escalation) | 3.40 | 3.58 | 6.93 |
| LLM only | 9.09 | 8.60 | 12.44 |
| evidence lookup (on open) | 2.62 | 3.13 | 3.79 |

## Evidence lookup (display only)

49 confident cells looked up; 55.1% got at least one verified quote; 2.0% where the lookup's judgment differed from the decision model (shown to graders as a note)

Answers with an escalation: 6/12; mean decision-model cost 0.000054 USD/answer

## Threshold sweep (one threshold for every question type; escalations approximated by LLM-only judgments)

| threshold | auto | coverage | acc (covered) |
|---|---|---|---|
| 0.00 | 100.0% | 100.0% | 87.5% |
| 0.05 | 97.2% | 98.6% | 88.7% |
| 0.10 | 97.2% | 98.6% | 88.7% |
| 0.15 | 97.2% | 98.6% | 88.7% |
| 0.20 | 97.2% | 98.6% | 88.7% |
| 0.25 | 94.4% | 95.8% | 91.3% |
| 0.30 | 94.4% | 95.8% | 91.3% |
| 0.35 | 91.7% | 94.4% | 92.6% |
| 0.40 | 91.7% | 94.4% | 92.6% |
| 0.45 | 91.7% | 94.4% | 92.6% |
| 0.50 | 90.3% | 93.1% | 94.0% |
| 0.55 | 88.9% | 91.7% | 93.9% |
| 0.60 | 88.9% | 91.7% | 93.9% |
| 0.65 | 83.3% | 90.3% | 95.4% |
| 0.70 | 83.3% | 90.3% | 95.4% |
| 0.75 | 83.3% | 90.3% | 95.4% |
| 0.80 | 79.2% | 90.3% | 95.4% |
| 0.85 | 75.0% | 90.3% | 95.4% |
| 0.90 | 65.3% | 90.3% | 95.4% |
| 0.95 | 41.7% | 90.3% | 95.4% |
| 1.00 | 0.0% | 90.3% | 95.4% |

## Calibration (decision model, non-skipped cells)

| confidence | cells | acc |
|---|---|---|
| 0.0-0.2 | 2 | 0.0% |
| 0.2-0.4 | 4 | 25.0% |
| 0.4-0.6 | 2 | 50.0% |
| 0.6-0.8 | 7 | 71.4% |
| 0.8-1.0 | 57 | 98.2% |
