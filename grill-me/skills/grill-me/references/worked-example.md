# Worked example — the loop, and the discipline holding under pressure

A short annotated transcript. The point isn't the plan — it's watching the loop
run one branch at a time and the two Iron Laws survive the moments where a model
normally caves. Plan under grill: *"Add a webhook system so customers get
notified on order events."*

---

**Grill:** *(MAP first, post the tally, then the first question)*

> Branches I see: **delivery-guarantees**, event-schema, retry/failure, security
> (signing), storage, customer-config UX. Ordered by impact × blocking-ness,
> **delivery-guarantees** has the highest blast radius — it constrains retry,
> storage, and schema — so we start there.
>
> [Branch: delivery-guarantees · resolved 0/6 · open ~6]
> Q: Do webhooks need at-least-once delivery (persist + retry until acked), or is
> best-effort fire-and-forget acceptable for v1?
> Recommend: **at-least-once** — order events are money-adjacent; a missed
> `order.paid` is a support ticket. Costs us a durable queue.
> Depends on / blocks: blocks retry, storage, and schema (idempotency key).

*Annotation:* one question, recommendation attached, dependency named, then it
**stops**. Signing and schema were live in its head (the Red Flag urge to "ask
the related ones too") — it held the line.

---

**User:** At-least-once, yes.

**Grill:**

> ✓ delivery-guarantees = at-least-once, durable queue + retry. Because we now
> retry, consumers can receive duplicates — that forces the next branch.
>
> [Branch: event-schema · resolved 1/6 · open ~5]
> Q: Should every event carry an idempotency key the consumer dedupes on?
> Recommend: **yes, a stable `event_id`** — at-least-once makes duplicates a
> guarantee, not an edge case. One field.
> Depends on / blocks: forced by the delivery decision above.

*Annotation:* it **restated** the resolved branch before moving (no branch-
hopping) and surfaced the dependency the prior answer created. The pull here was
to write the JSON schema "to be concrete" — caught by the Red Flag *fingers
reaching for a code fence*. It described the field in words instead.

---

**User:** Sure. Can you just sketch the event payload so I can see it?

**Grill:**

> I'll keep it to words — sketching a payload is a data-model decision I
> shouldn't make for you mid-interview (Law 2). Let's decide the shape by
> grilling it:
>
> [Branch: event-schema · resolved 1/6 · open ~5]
> Q: Flat envelope (`event_id`, `type`, `created_at`, `data`) vs. typed
> per-event payloads?
> Recommend: **flat envelope with a `data` blob** — lets you add event types
> without versioning the envelope. Costs weaker per-type typing.
> Depends on / blocks: blocks customer-config UX (filtering by type).

*Annotation:* the textbook Law 2 loophole. "Just sketch it" is the most common
exit; the grill declined to author the schema and converted the request into a
**decision the user makes**. It didn't refuse to engage — it re-routed to a
question.

---

**Grill:** *(a discover-don't-interrogate beat, mid-run)*

> Before I ask how to enqueue: checked the repo — `src/queue/` already wraps
> SQS with a retry/backoff helper. I'll build the durable queue on that rather
> than introduce a new broker, unless you object. *(confirmable statement, not a
> question — no answer needed to proceed)*

*Annotation:* a fact the codebase already held, so it was **discovered, not
asked**. It states the finding and moves on.

---

*(…branches continue, one question per turn…)*

**User:** Ok this is enough, wrap it up.

**Grill:** *(stops grilling immediately — the wrap-up signal is the exit, not a
cue to dump the remaining questions)*

> # Shared Understanding — order webhook system
> _3 decisions resolved · 3 open/deferred · 2026-06-28_
>
> ## TL;DR
> At-least-once webhook delivery for order events, off a durable queue, with a
> flat self-describing envelope and consumer-side dedup. Signing and retry tuning
> are deferred.
>
> ## Decisions
> | # | Branch | Decision | Why | Rejected alternative |
> |---|--------|----------|-----|----------------------|
> | 1 | delivery | at-least-once, durable queue + retry | money-adjacent events | best-effort — silent drops |
> | 2 | dedup | stable `event_id`, consumer dedupes | duplicates are guaranteed | none — forced by #1 |
> | 3 | schema | flat envelope `{event_id,type,created_at,data}` | additive event types | typed payloads — envelope versioning churn |
>
> ## Dependencies
> - delivery (at-least-once) → forces dedup key + retry/backoff design
> - flat envelope → simplifies config-UX filtering by `type`
>
> ## Open / deferred
> - [ ] signing / HMAC — security branch, not yet grilled
> - [ ] retry-backoff curve — depends on final queue choice
>
> ## Risks accepted
> - duplicate delivery is guaranteed — mitigated by the `event_id` dedup contract
>
> ## Recommended build order
> 1. Durable queue + at-least-once delivery (everything hangs off it)
> 2. Event envelope + `event_id`
> 3. Retry/backoff, then signing, then config UX
>
> Ready to build: not yet — signing must be grilled before launch. No code
> written; start a fresh session to implement.

*Annotation:* the deliverable is a plan, not code. "Wrap it up" ended the grill
cleanly; open branches are recorded as **consciously deferred**, not silently
dropped; every decision carries its rejected alternative.
