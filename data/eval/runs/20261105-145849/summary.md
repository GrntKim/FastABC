# Evaluation 20261105-145849

primary `jev-1.13.0`, secondary `gemini-3.6-flash`, commit `2fe8bb9`, 12 answers, 78 labeled cells

## Accuracy

| | LLM only | decision model only | hybrid coverage | hybrid acc (covered) | cells left to grader | hybrid final (grader decides those) |
|---|---|---|---|---|---|---|
| all | 89.7% | 88.5% | 97.4% | 89.5% | 2 | 89.7% |
| q1_password_storage | 89.7% | 88.5% | 97.4% | 89.5% | 2 | 89.7% |

Labels of non-gate items are ignored for answers the grader judged off topic.

Hybrid by route (human: no recommendation, the grader decides):

| route | cells | acc |
|---|---|---|
| auto | 70 | 91.4% |
| human | 2 | - |
| llm | 6 | 66.7% |

## Cost (USD, whole set)

| | total | per answer |
|---|---|---|
| (a) judgment: hybrid | 0.0242 | 0.00202 |
| (a) judgment: LLM only | 0.0928 | 0.00773 |
| (b) evidence (every answer opened) | 0.0306 | 0.00255 |
| (c) hybrid total | 0.0547 | 0.00456 |

## Latency per answer (s)

| | mean | median | max |
|---|---|---|---|
| hybrid: first recommendation (decision model) | 0.27 | 0.23 | 0.53 |
| hybrid: all cells done (with escalation) | 3.45 | 1.86 | 10.19 |
| LLM only | 9.93 | 9.96 | 15.16 |
| evidence lookup (on open) | 3.58 | 3.73 | 5.33 |

## Evidence lookup (display only)

58 confident cells looked up; 60.3% got at least one verified quote; 1.7% where the lookup's judgment differed from the decision model (shown to graders as a note)

Answers with an escalation: 6/12; mean decision-model cost 0.000053 USD/answer

## Threshold sweep (one threshold for every question type; escalations approximated by LLM-only judgments)

| threshold | auto | coverage | acc (covered) |
|---|---|---|---|
| 0.00 | 100.0% | 100.0% | 88.5% |
| 0.05 | 98.7% | 98.7% | 89.6% |
| 0.10 | 98.7% | 98.7% | 89.6% |
| 0.15 | 97.4% | 97.4% | 89.5% |
| 0.20 | 97.4% | 97.4% | 89.5% |
| 0.25 | 96.2% | 96.2% | 89.3% |
| 0.30 | 96.2% | 96.2% | 89.3% |
| 0.35 | 96.2% | 96.2% | 89.3% |
| 0.40 | 96.2% | 96.2% | 89.3% |
| 0.45 | 94.9% | 96.2% | 89.3% |
| 0.50 | 94.9% | 96.2% | 89.3% |
| 0.55 | 94.9% | 96.2% | 89.3% |
| 0.60 | 92.3% | 94.9% | 90.5% |
| 0.65 | 91.0% | 94.9% | 90.5% |
| 0.70 | 91.0% | 94.9% | 90.5% |
| 0.75 | 88.5% | 94.9% | 90.5% |
| 0.80 | 82.1% | 94.9% | 90.5% |
| 0.85 | 70.5% | 93.6% | 91.8% |
| 0.90 | 65.4% | 93.6% | 91.8% |
| 0.95 | 34.6% | 93.6% | 91.8% |
| 1.00 | 0.0% | 93.6% | 91.8% |

## Calibration (decision model, non-skipped cells)

| confidence | cells | acc |
|---|---|---|
| 0.0-0.2 | 2 | 50.0% |
| 0.2-0.4 | 1 | 100.0% |
| 0.4-0.6 | 3 | 66.7% |
| 0.6-0.8 | 8 | 62.5% |
| 0.8-1.0 | 64 | 93.8% |
