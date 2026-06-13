# Consensus AI — Hypothesis Tracking Document

**Version:** 1.0  
**Last updated:** 2026-06-13  
**Interview round:** Discovery Round 1 (target: 8–12 engineering team leads)

---

## Section 1: User Profile Assumptions

We are targeting three distinct profiles. Each has different pain, different trust thresholds, and different deal-breakers. Interview sample should include at least 2 respondents from each profile.

### Profile A — Startup Engineering Lead (5–15 engineers)

| Attribute | Assumption |
|-----------|-----------|
| Team structure | Flat; lead writes code and makes architecture calls |
| Decision velocity | High — needs answers fast, tolerates some risk |
| AI familiarity | High; likely already using Copilot, Cursor, or Claude in editor |
| Primary pain | Not enough senior reviewers; decisions made with insufficient alternatives considered |
| Budget sensitivity | High — cost per run matters; won't pay for overhead |
| Compliance pressure | Low to none |
| Likely entry mode | Debate (quick architectural decisions) or Collaborate (RFC / design doc drafts) |
| Autonomy tolerance | Higher — more willing to let agents write and push code |

### Profile B — Mid-Size Platform Team (20–50 engineers)

| Attribute | Assumption |
|-----------|-----------|
| Team structure | Specialized roles (platform, product, security); lead coordinates across teams |
| Decision velocity | Medium — proposals go through RFC or architecture review |
| AI familiarity | Mixed; some enthusiasts, some skeptics; policy may be forming |
| Primary pain | Cross-team review bottleneck; security review slowing down shipping |
| Budget sensitivity | Medium — can absorb per-project cost if ROI is clear |
| Compliance pressure | Medium — SOC 2, internal security review |
| Likely entry mode | PR Workflow (reducing review bottleneck) or Debate (architecture decisions) |
| Autonomy tolerance | Medium — wants human-in-the-loop for file writes and PRs |

### Profile C — Regulated Enterprise Lead (50+ engineers)

| Attribute | Assumption |
|-----------|-----------|
| Team structure | Hierarchical; lead manages managers; writes little or no code |
| Decision velocity | Low — changes require sign-off, change management, compliance review |
| AI familiarity | Cautious; legal and security have issued guidance or restrictions |
| Primary pain | Audit and traceability — "who decided this and why" |
| Budget sensitivity | Low — will pay for compliance features; cost is secondary |
| Compliance pressure | High — SOC 2, ISO 27001, HIPAA, FedRAMP, or similar |
| Likely entry mode | Debate with full audit log (traceability story), or Collaborate for documentation |
| Autonomy tolerance | Low — any autonomous file write or PR creation requires explicit approval gates |

---

## Section 2: Key Hypotheses

### H1 — Teams Want Multi-Agent Debate

**Statement:** Engineering team leads prefer seeing multiple AI agents debate a problem and reach consensus over receiving a single expert-model response plus human review.

**Confidence:** Medium

**What would confirm it:**
- Respondent spontaneously mentions wanting "more than one opinion" or "a devil's advocate"
- Respondent ranks Debate mode #1 or #2 unprompted
- Respondent says they distrust single-model outputs or have been burned by LLM overconfidence
- Respondent values the dissenting view / risk flags as much as or more than the recommendation

**What would invalidate it:**
- Respondents consistently rank Debate last
- Respondents say multi-agent output is "too noisy" or "I just want an answer"
- Respondents say they would ignore anything except the final recommendation — skip reading the debate
- Respondents express that human review is the preferred check, not agent critique

**Interview questions that surface this:**
- Section 2, Q4: "Do you feel like you get enough critical pushback on technical proposals?"
- Section 3, Mode A follow-up: "Is the value in the answer itself, or in seeing how the agents disagreed?"
- Section 3, Mode A follow-up: "If this produced a recommendation that conflicted with your senior engineer's instinct, what happens?"
- Section 4 Debate deep-dive: "Would you trust unanimous agreement more or less than a split decision?"

---

### H2 — Audit Logs Are the Primary Trust Mechanism

**Statement:** The most important trust signal for engineering team leads is a detailed, immutable audit log of every agent action — more important than test coverage on generated code or a human approval step.

**Confidence:** Low

**What would confirm it:**
- Respondent unprompted mentions audit trail, logs, or traceability when asked about trust
- Respondent says "I need to see what it did" rather than "I need a human to check it"
- Respondent in regulated industry says audit log satisfies compliance requirement
- Respondent explicitly says they would grant more autonomy if an audit log existed

**What would invalidate it:**
- Respondent says "I don't care about logs, I care about tests passing"
- Respondent says "the only thing I trust is another human reviewing the output"
- Respondent dismisses logs as "nice to have, not a blocker"
- Respondent raises concerns that audit logs themselves could be tampered with

**Interview questions that surface this:**
- Section 2, Q5: "When something goes wrong in production, what's the first thing you look for?"
- Section 5: "What would make you comfortable letting agents take actions without watching every step?"
- Section 5: "If an agent wrote to a file it shouldn't have, how would you find out?"
- Section 5: "Would knowing all agent actions are logged to an immutable audit trail change how much autonomy you'd grant?"
- Section 4 PR deep-dive: "What audit trail would you need to see attached to the PR?"

---

### H3 — Web UI Is an Acceptable Interface

**Statement:** Engineering team leads are willing to use a browser-based UI to initiate and monitor multi-agent workflows, rather than requiring IDE integration or webhook/Slack triggers.

**Confidence:** Medium

**What would confirm it:**
- Respondent does not mention IDE or CLI when describing desired interaction pattern
- Respondent says they monitor async work in dashboards or web tools already
- Respondent finds async "fire and check back" acceptable for longer workflows
- Respondent is not primarily a keyboard-in-terminal type

**What would invalidate it:**
- Respondent says "I never leave my editor" or "context switching to a browser kills flow"
- Respondent immediately asks "does it have a CLI?" or "can I trigger this from a GitHub Action?"
- Respondent says they want results pushed to them (Slack, email) rather than polling a dashboard
- Multiple respondents independently ask for IDE extension or webhook as a prerequisite

**Interview questions that surface this:**
- Section 2, Q6: "Where do you do most of your technical work — editor, terminal, Slack, a browser-based tool?"
- Section 6, Q3: "What would immediately kill it for your team?"

---

### H4 — Persistent Agent Memory Improves Outcomes

**Statement:** Engineering team leads believe that agents with persistent memory of the codebase and prior decisions will produce better results than stateless agents operating on fresh context each run.

**Confidence:** Low

**What would confirm it:**
- Respondent unprompted mentions that "knowing our codebase" is a prerequisite for useful output
- Respondent expresses frustration that current AI tools don't remember past decisions
- Respondent says "if it had to learn our context every time it would be too slow/expensive"
- Respondent's use cases are inherently iterative (e.g., ongoing architecture evolution, multi-week projects)

**What would invalidate it:**
- Respondent prefers fresh context: "I don't want it inheriting stale assumptions"
- Respondent is primarily interested in one-shot tasks (isolated decision, isolated PR)
- Respondent expresses privacy or IP concerns about storing codebase context
- Respondent treats statelessness as a feature: "I can describe the problem fully myself"

**Interview questions that surface this:**
- Section 4 Debate deep-dive: "Would you want agents to remember context from previous debates on your codebase, or start fresh each time?"
- Section 2, Q7: "Has your team ever used an AI assistant for a technical task? What happened?"

---

### H5 — Autonomous PR Generation Is Desirable

**Statement:** Engineering team leads want agents to generate and open a complete pull request autonomously — they would rather review a finished PR than a chat conversation recommending what to implement.

**Confidence:** Low-Medium

**What would confirm it:**
- Respondent ranks PR Workflow mode #1 or reacts with excitement ("that's the thing I want")
- Respondent says code review is faster than implementation for them — they want to move the bottleneck
- Respondent says "reviewing is easy, doing is the slow part"
- Respondent frames it as "junior dev that can ship a first draft"

**What would invalidate it:**
- Respondent's first question is "how do I stop it from touching production?" — fear dominates
- Respondent says "I'd never merge code I didn't write or understand line by line"
- Respondent says agents suggesting + human implementing is the right division of labor
- Respondent raises blocker: company policy prohibits AI-authored code in production
- Multiple respondents say the security gate isn't sufficient — they need human review regardless

**Interview questions that surface this:**
- Section 3, Mode C: "Walk me through what you'd do when you see a PR generated this way."
- Section 3, Mode C: "What would have to be true about the PR for you to merge it without a full line-by-line review?"
- Section 3, Mode C: "Would your team's security or compliance process block a PR with no human author?"
- Section 6, Q1: "If you could have one of these three modes working next Monday, which would you pick?"

---

## Section 3: Decision Criteria

These are the quantitative thresholds (across 8–12 interviews) that drive positioning decisions at the end of Round 1.

### Keep Debate-First Positioning

**Threshold:** 6+ respondents rank Debate #1 or #2 AND at least 4 of those say the dissenting view / risk flags are part of the value (not just the recommendation).

**If below threshold:** Debate is a supporting feature, not the headline. Reposition around the PR Workflow or Collaborate depending on which ranked higher.

---

### Pivot to Single-Agent Expert Mode as Primary

**Trigger:** 5+ respondents say the multi-agent output is "noisy," "I just want one answer," or rank Debate last.

**Action:** Redesign Debate as an optional "deep dive" toggle. Default experience becomes single high-tier agent with human-in-the-loop review. Keep debate infrastructure but hide it behind an advanced setting.

---

### Deprioritize PR Workflow

**Trigger:** Any of the following in 4+ interviews:
- Respondent says company policy prohibits AI-authored PRs
- Respondent's primary concern is "what if it breaks something" with no resolution path
- Respondent ranks PR Workflow last in all 3 target profiles

**Action:** Move PR Workflow to beta / power-user tier. Do not lead with it in marketing. Focus engineering on Debate and Collaborate modes first.

---

### Deprioritize Persistent Memory

**Trigger:** 5+ respondents prefer stateless fresh-context OR raise IP/privacy concerns about persisting codebase state.

**Action:** Remove persistent memory from V1 scope. Ship stateless-first. Add memory as an opt-in feature with explicit data retention controls and documented what-is-stored disclosure.

---

### Deprioritize Web UI in Favor of CLI/Webhook

**Trigger:** 5+ respondents ask for CLI or webhook as a prerequisite, OR say they would not use a browser-based tool as a primary interface.

**Action:** Build CLI wrapper for the API server before web UI. Add GitHub Actions trigger support. Defer web UI polish to V2.

---

## Section 4: What Would Kill Debate Mode

The following specific findings, if they surface consistently (3+ respondents), would invalidate the multi-agent-debate core positioning and require fundamental product rethinking:

1. **"I just want one answer."** Respondents consistently skip the debate transcript and read only the final recommendation — the multi-agent process adds no perceived value over a single strong model.

2. **"The agents agree too much to be useful."** Agents with similar training converge too quickly; respondents perceive debates as theater rather than genuine critical analysis.

3. **"I already have this — it's called a design review."** Respondents map Debate mode directly onto their existing RFC or architecture review process and see no marginal value.

4. **"I don't trust any of them individually, so I don't trust the consensus."** Respondents' trust in LLM output is low enough that aggregating N low-trust opinions does not produce one high-trust output in their mental model.

5. **"The cost per debate is too high for daily use."** Running N agents per decision at frontier-model pricing is prohibitive for the volume of decisions teams make; respondents would batch or avoid the tool.

6. **"My team won't act on it without a named human accountable for the decision."** Organizational culture or compliance requires a human owner of every architectural decision; agent consensus cannot satisfy this requirement.

7. **"What happens when the agents are wrong?"** Respondents have no confidence in their ability to identify when the consensus recommendation is incorrect — and lack of recourse (who to blame, how to audit the failure) is a blocker to adoption.
