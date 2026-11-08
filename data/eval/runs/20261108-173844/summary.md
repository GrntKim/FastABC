# Evaluation 20261108-173844

primary `jev-1.13.0`, secondary `gemini-3.6-flash`, commit `aa2e81f`, 24 answers, 150 labeled cells

## Accuracy

| | LLM only | decision model only | hybrid coverage | hybrid acc (covered) | cells left to grader | hybrid final (grader decides those) |
|---|---|---|---|---|---|---|
| all | 90.0% | 88.7% | 93.3% | 92.1% | 10 | 92.7% |
| q1_password_storage | 89.7% | 88.5% | 96.2% | 89.3% | 3 | 89.7% |
| q2_sql_injection | 90.3% | 88.9% | 90.3% | 95.4% | 7 | 95.8% |

Labels of non-gate items are ignored for answers the grader judged off topic.

Hybrid by route (human: no recommendation, the grader decides):

| route | cells | acc |
|---|---|---|
| auto | 130 | 94.6% |
| human | 10 | - |
| llm | 10 | 60.0% |

## Cost (USD, whole set)

| | total | per answer |
|---|---|---|
| (a) judgment: hybrid | 0.0534 | 0.00223 |
| (a) judgment: LLM only | 0.1906 | 0.00794 |
| (b) evidence (every answer opened) | 0.0544 | 0.00227 |
| (c) hybrid total | 0.1078 | 0.00449 |

## Latency per answer (s)

| | mean | median | max |
|---|---|---|---|
| hybrid: first recommendation (decision model) | 0.27 | 0.23 | 0.52 |
| hybrid: all cells done (with escalation) | 3.65 | 1.92 | 11.49 |
| LLM only | 10.07 | 10.07 | 14.67 |
| evidence lookup (on open) | 3.13 | 3.41 | 4.89 |

## Evidence lookup (display only)

106 confident cells looked up; 56.6% got at least one verified quote; 0.0% where the lookup's judgment differed from the decision model (shown to graders as a note)

Answers with an escalation: 12/24; mean decision-model cost 0.000053 USD/answer

## Threshold sweep (one threshold for every question type; escalations approximated by LLM-only judgments)

| threshold | auto | coverage | acc (covered) |
|---|---|---|---|
| 0.00 | 100.0% | 100.0% | 88.7% |
| 0.05 | 98.7% | 99.3% | 89.3% |
| 0.10 | 98.0% | 99.3% | 89.3% |
| 0.15 | 98.0% | 99.3% | 89.3% |
| 0.20 | 97.3% | 99.3% | 89.3% |
| 0.25 | 96.7% | 98.7% | 89.2% |
| 0.30 | 95.3% | 98.0% | 89.8% |
| 0.35 | 94.0% | 96.7% | 91.0% |
| 0.40 | 94.0% | 96.7% | 91.0% |
| 0.45 | 92.7% | 96.0% | 91.7% |
| 0.50 | 92.7% | 96.0% | 91.7% |
| 0.55 | 91.3% | 95.3% | 91.6% |
| 0.60 | 90.0% | 94.7% | 92.3% |
| 0.65 | 87.3% | 93.3% | 92.9% |
| 0.70 | 87.3% | 93.3% | 92.9% |
| 0.75 | 87.3% | 93.3% | 92.9% |
| 0.80 | 82.0% | 92.7% | 92.8% |
| 0.85 | 72.7% | 92.0% | 93.5% |
| 0.90 | 64.7% | 92.0% | 93.5% |
| 0.95 | 36.7% | 92.0% | 93.5% |
| 1.00 | 0.0% | 92.0% | 93.5% |

## Calibration (decision model, non-skipped cells)

| confidence | cells | acc |
|---|---|---|
| 0.0-0.2 | 4 | 50.0% |
| 0.2-0.4 | 5 | 40.0% |
| 0.4-0.6 | 6 | 50.0% |
| 0.6-0.8 | 12 | 83.3% |
| 0.8-1.0 | 123 | 94.3% |
