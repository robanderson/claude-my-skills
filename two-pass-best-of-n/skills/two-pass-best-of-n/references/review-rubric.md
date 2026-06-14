# Review and ranking rubric

Instructions for the two Opus passes: the round one reviewer (Phase 3) and the final ranker (Phase 5). In both, you receive candidate solutions to one task, labelled Candidate A, B, C, and so on. You do not know which model produced which, and should not speculate; judge the work in front of you.

## Shared scoring method

1. **Restate the task** in one line so your scoring stays anchored to what was actually asked.
2. **Inspect each candidate's real output**, not only its self-summary. For code, read it; run it or trace it where feasible; check it against the task and obvious edge cases. A confident summary over weak code should not score well.
3. **Score against criteria suited to the task.** For a coding task: correctness (does it do what was asked and run), completeness (all stated requirements covered), edge cases (empty input, repeats, invalid input, boundaries), readability (naming, structure, useful comments), robustness (graceful failure over crashes), efficiency (reasonable approach, no needless cost). For a non-code task, adapt (for writing: accuracy, structure, clarity, tone fit, completeness) and state which criteria you used.
4. **Cite specifics.** "Candidate B crashes on a repeated guess because it does not dedupe input" beats "Candidate B is buggy." Point to the line or behaviour.

## Phase 3: round one reviewer

You do two jobs.

### Job 1: judge and pick a winner

Produce, for round one:

```
# Round 1 review

Task: <one line restatement>

## Candidate A
Pros:
- <specific strength>
Cons:
- <specific weakness>

(... one block per candidate ...)

## Ranking
1. Candidate <X>
...

## Round 1 winner
Candidate <X>. <Two or three sentences of reasoning, including the deciding factor.>
```

### Job 2: distil guidance for round two

Read across **all** candidates, winners and losers alike, and produce two short lists that will steer the next round. Phrase them generically as patterns and principles. Do **not** quote or paraphrase any candidate's specific code; round two must be guided, not seeded.

```
## Guidance for round 2

Positives to consider:
- <a pattern or choice that worked well anywhere in round 1>
- <another>
- <another>
- <another>

Challenges to avoid:
- <a pitfall, bug, or weakness seen anywhere in round 1>
- <another>
- <another>
- <another>
```

Aim for roughly three to six items per list: enough to be useful, few enough to stay sharp. Good positives describe a principle ("validate and normalise user input before using it"), not an implementation lift ("copy Candidate C's input loop"). Good challenges name a concrete failure mode to avoid ("do not let a repeated guess decrement the remaining lives").

## Phase 5: final ranker

You receive the final pool: N fresh round two attempts plus one carried-over winner from round one, all blind-labelled together. Rank them on the merits using the shared scoring method. Do not try to guess which one is the carryover; it competes like any other.

```
# Final ranking

Task: <one line restatement>

## Candidate A
Pros:
- ...
Cons:
- ...

(... one block per candidate ...)

## Ranking
1. Candidate <X>
2. Candidate <Y>
...

## Overall winner
Candidate <X>. <Two or three sentences of reasoning, including the deciding factor over the runner-up.>
```

Be fair and specific in both passes. The point of two-pass Best of N is an honest comparison where the second round's guidance has a real chance to improve on the first, and a cheaper-looking solution that is actually better should win on the merits.
