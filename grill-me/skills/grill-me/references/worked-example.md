# Worked example — the menu cadence, and the discipline under pressure

Two short annotated transcripts. The point isn't the plan — it's watching the
loop run one menu at a time, the two Iron Laws survive the moments a model
normally caves, and (in hard mode) a drifted pick trigger a targeted
re-tournament. Plan under grill: *"Add a webhook system so customers get notified
on order events."*

---

## Part 1 — Basic mode: the menu is one question

**Grill:** *(MAP first, post the tally, then the first menu)*

> Branches I see: **delivery-guarantees**, event-schema, retry/failure, security
> (signing), storage, customer-config UX. Ordered by impact × blocking-ness,
> **delivery-guarantees** has the highest blast radius — it constrains retry,
> storage, and schema — so we start there.
>
> [Branch: delivery-guarantees · resolved 0/6 · open ~6]
> Q: What delivery guarantee do order webhooks need for v1?
>
> &nbsp;&nbsp;A ★&nbsp; At-least-once: persist + retry until acked
> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Order events are money-adjacent; a missed `order.paid` is a support ticket. Costs a durable queue.
> &nbsp;&nbsp;B&nbsp;&nbsp; Best-effort fire-and-forget
> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Simplest; silent drops when a consumer is down.
> &nbsp;&nbsp;C&nbsp;&nbsp; At-least-once but in-memory retry only (no durable store)
> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Cheaper than a queue; loses everything on a crash.
> &nbsp;&nbsp;✎&nbsp;&nbsp; other / refine
>
> → A / B / C, or ✎.&nbsp;&nbsp; · blocks: retry, storage, schema (idempotency key)

*Annotation:* one question, three **genuinely distinct** options (durable vs.
none vs. in-memory — each a different build), best-first with ★, free-type
present, dependency named — then it **stops**. The two inline passes ran
silently: pass 1 gave A/B, the risk-first pass 2 surfaced C (the tempting
half-measure) so the user can reject it on purpose. Signing and schema were live
in its head; it held the line (Law 1).

---

**User:** A

**Grill:**

> ✓ delivery-guarantees = at-least-once, durable queue + retry. Because we now
> retry, consumers can receive duplicates — that forces the next branch.
>
> [Branch: event-schema · resolved 1/6 · open ~5]
> Q: How do consumers dedupe the duplicates at-least-once guarantees?
>
> &nbsp;&nbsp;A ★&nbsp; Every event carries a stable `event_id`; consumer dedupes on it
> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; One field; duplicates are a guarantee now, not an edge case.
> &nbsp;&nbsp;B&nbsp;&nbsp; Dedupe server-side on a content hash
> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; No consumer work; we store every hash to compare — unbounded state.
> &nbsp;&nbsp;✎&nbsp;&nbsp; other / refine
>
> → A or B, or ✎.&nbsp;&nbsp; · forced by the delivery decision above

*Annotation:* it **restated** the resolved branch before moving (no branch-
hopping) and surfaced the dependency the prior pick created. Only two distinct
options here — the distinctness gate would rather show two real ones than pad to
four. The pull was to write the JSON schema "to be concrete" — caught by the Red
Flag *fingers reaching for a code fence*. The shapes became options, not code.

---

**User:** A, but call it `delivery_id` to match our existing `*_id` columns.

**Grill:**

> Good catch — that's a discovery I should have made. Confirming the refined
> decision: **stable `delivery_id` on every event, consumer dedupes on it.** Yes?
> ✓ recorded.

*Annotation:* a **tweak**, not a bare letter. It restated the refined option and
got an explicit yes before recording — `A but …` is a new option, not a silent
guess.

---

**User:** Can you just sketch the event payload so I can see it?

**Grill:**

> I'll keep it to words — sketching a payload is a data-model decision I
> shouldn't make for you mid-interview (Law 2). Let's decide the shape as a menu:
>
> [Branch: event-schema · resolved 2/6 · open ~4]
> Q: What envelope shape?
>
> &nbsp;&nbsp;A ★&nbsp; Flat envelope (`delivery_id`, `type`, `created_at`, `data` blob)
> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Add event types without versioning the envelope. Weaker per-type typing.
> &nbsp;&nbsp;B&nbsp;&nbsp; Typed per-event payloads
> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Strong typing; every new type is an envelope change.
> &nbsp;&nbsp;✎&nbsp;&nbsp; other / refine
>
> → A or B, or ✎.&nbsp;&nbsp; · blocks: customer-config UX (filtering by `type`)

*Annotation:* the textbook Law 2 loophole. "Just sketch it" is the most common
exit; the grill declined to author the schema and converted the request into a
**menu the user picks from** — engaging without coding.

---

## Part 2 — Hard mode: pre-computed menus + drift re-tournament

*The user invoked `grill me hard`. Stage 1 assembled the 9-question list and
filtered facts to assumptions; Stage 2 ran `grill-hard.workflow.js` and returned
`perQuestion`. Now Stage 3 renders the pre-computed menus.*

**Grill:** *(assumptions surfaced first, then Q1 from the tournament)*

> Assumptions (discovered, not asked):
> - Queue: reuse `src/queue/` (SQS wrapper) — already in the repo.
> - Signing: HMAC-SHA256 — matches the existing partner-API webhooks.
> (Object to any, else I build on them.)
>
> [Branch: delivery · resolved 0/9 · Q1 of 9]
> Q: Delivery guarantee for order webhooks?
>
> &nbsp;&nbsp;A ★&nbsp; At-least-once on the existing SQS wrapper, durable retry + consumer dedup&nbsp;&nbsp;(synthesis)
> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Combines durability with reuse of `src/queue/`; money-adjacent events can't drop.
> &nbsp;&nbsp;B&nbsp;&nbsp; At-least-once on a new dedicated broker
> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Cleaner isolation; new infra to run.
> &nbsp;&nbsp;C&nbsp;&nbsp; Best-effort fire-and-forget
> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Simplest; silent drops on consumer downtime.
> &nbsp;&nbsp;✎&nbsp;&nbsp; other / refine
>
> → A / B / C, or ✎.&nbsp;&nbsp; · blocks: retry (Q4), storage (Q5), schema (Q2)

*Annotation:* slot A is the **amalgam** the judges synthesized during cross-talk
(tagged `(synthesis)`, sourced from the workflow's separate `amalgam` field), not
just the top single candidate. The header shows `Q1 of 9` because the full list is
known up front.

---

**User:** C — keep v1 dead simple, best-effort is fine.

**Grill:** *(detects drift — C flips the tradeoff Q4 and Q5 assumed)*

> Recorded: best-effort fire-and-forget. ⚠ Heads up — this **drifts** from what
> the tournament assumed for two downstream questions: **Q4 (retry/backoff)** and
> **Q5 (storage)** both baked their options assuming durable retry (their
> `assumes` named `Q1 = at-least-once`). Those menus are now stale.
>
> Want me to quickly **re-tournament just Q4 + Q5** against the best-effort
> choice (≈30s), or proceed and I'll flag them "options may be stale"?

**User:** Re-run them.

**Grill:** *(re-invokes `grill-hard.workflow.js` with `questions` = [Q4, Q5] only
and `context` carrying "CONFIRMED DECISIONS: Q1 = best-effort"; splices the fresh
menus in)*

> Done — Q4 and Q5 re-tournamented against best-effort. Moving on.
>
> [Branch: retry · resolved 1/9 · Q4 of 9]
> Q: What happens to an event the consumer never acks?
>
> &nbsp;&nbsp;A ★&nbsp; Nothing — log it and drop (best-effort means no retry)
> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Consistent with Q1; a dead-letter log gives you forensics without a queue.
> &nbsp;&nbsp;B&nbsp;&nbsp; Single best-effort retry after 30s, then drop
> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Catches transient blips; still no durable store.
> &nbsp;&nbsp;✎&nbsp;&nbsp; other / refine
>
> → A or B, or ✎.&nbsp;&nbsp; · depends on: Q1 (best-effort)

*Annotation:* this is the hard-mode adaptivity loop. A pick that diverged from a
baked `assumes` anchor was **flagged, scoped, and re-tournamented for only the
drifted Q's direct dependents** — never the whole list — so the menus stay coherent
without re-running the expensive tournament wholesale. The old durable-retry
options for Q4 (now meaningless) are gone.

---

**User:** Ok this is enough, wrap it up.

**Grill:** *(stops grilling immediately — the wrap-up signal is the exit, not a
cue to dump remaining questions; produces the structured Shared Understanding
from SKILL.md, every Decisions row tracing to a picked option, every open branch
carried forward, no code written)*

*Annotation:* in both modes the deliverable is a plan, not code. "Wrap it up"
ended the grill cleanly; open branches are recorded as **consciously deferred**,
not silently dropped; every decision carries the option the user rejected.
