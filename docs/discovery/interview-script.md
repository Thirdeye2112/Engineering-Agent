# Consensus AI — User Interview Script
## Engineering Team Leads | 45-Minute Session

**Version:** 1.0  
**Target respondent:** Engineering team lead, 5–50 engineers, ships software regularly  
**Interviewer note:** This is a discovery session, not a demo. Resist the urge to sell. The goal is to surface real behavior, not to validate assumptions with leading questions. Follow the respondent's energy — if they light up on a topic, go deeper before moving on.

---

## Before the Call

- Confirm screen share is optional for this session (no prototype to show yet)
- Prepare the three one-paragraph mode descriptions (Debate / Collaborate / PR Workflow) to paste into chat when you reach Section 3
- Have a notes doc open split-screened; tag quotes with hypothesis codes (H1–H5)

---

## Section 1: Intro & Consent (5 min)

**Opening:**

> "Thanks for making time. This is a 45-minute research session — no product demo, no pitch. I want to understand how your team actually works today so we can figure out whether something we're building is worth your time. Everything you say is confidential and won't be attributed to you by name. Mind if I record just for my own notes?"

*(Pause for consent. Start recording only if granted.)*

> "Quick background on you: what does your team build, how big is it, and what's your role day-to-day?"

*Goal: establish team size, domain (product/platform/infra), and whether the lead writes code or manages. This maps to the three user profiles we're tracking.*

---

## Section 2: Current Workflow Pain Points (10 min)

**Opening anchor:**

> "Let's start with how decisions get made on your team today — specifically technical decisions. Walk me through a recent one: something where there was real ambiguity about the right approach."

*(Let them tell the story. Do not interrupt. Tag: architecture decision, code review, incident response, etc.)*

**Follow-ups (pick 2–3 based on what surfaces):**

1. > "Who was in the room — or the Slack thread — when that decision got made?"

2. > "How long did it take from 'we need to decide this' to 'we have a decision'?"

3. > "Looking back, how confident are you that you picked the right approach? What would have made you more confident?"
   > *[Listen for: desire for more perspectives, regret about skipping review, lack of time as a factor]*

4. > "Do you feel like you get enough critical pushback on technical proposals before they ship? Where does that pushback come from — peers, seniors, external reviewers?"
   > *[Listen for: H1 signal — does pushback feel insufficient? Would they trust a non-human critic?]*

5. > "When something goes wrong in production, what's the first thing you look for to understand what happened?"
   > *[Listen for: H2 signal — do they reach for logs, tests, the PR diff, a human who remembers?]*

6. > "Where do you do most of your technical work — editor, terminal, Slack, a browser-based tool?"
   > *[Listen for: H3 signal — IDE-first vs. browser-comfortable]*

7. > "Has your team ever used an AI assistant for a technical task? What happened? Did it make the cut or get dropped?"
   > *[Listen for: current AI comfort level, what failed, what stuck]*

---

## Section 3: Concept Reaction — Three Modes (15 min)

**Transition:**

> "I'm going to share three short descriptions of modes in a tool we're exploring. Don't worry about the name — just react to the concepts. Tell me if any of them resonate, which ones seem useless, and what questions they raise."

*(Paste or read the following three descriptions one at a time. Pause after each for reaction before moving to the next.)*

---

**Mode A — Debate**

> *N AI agents, each with a distinct role (e.g., Security Reviewer, Pragmatist, Contrarian), independently propose an approach to a problem. They then critique each other's proposals, identify blocking objections, and vote. The output is a structured recommendation with dissenting views, risk flags, and a cost/confidence summary.*

**Reaction prompt:** "What's your gut on this?"

**Follow-ups:**
- > "Who on your team would use the output of this — you, a senior engineer, the whole team?"
- > "Is the value in the answer itself, or in seeing how the agents disagreed?"
- > "What's missing from this that would make you actually act on the output?"
  > *[Listen for: H1 — do they want multi-agent debate or would they rather have one authoritative answer?]*
- > "If this produced a recommendation that conflicted with your senior engineer's instinct, what happens?"

---

**Mode B — Collaborate**

> *A task is decomposed into role-based subtasks — e.g., 'write the API design,' 'write the database migration,' 'write the test plan.' Each subtask is assigned to an agent by role, executed in dependency order, and the outputs are integrated into a single coherent document.*

**Reaction prompt:** "Does this map to anything you actually do?"

**Follow-ups:**
- > "What kind of tasks would you throw at this — RFC drafts, runbooks, postmortems?"
- > "Where does this break down for you?"
- > "Would you read the integrated document end-to-end, or just jump to the section your role cares about?"

---

**Mode C — PR Workflow**

> *Agents debate a plan for implementing a code change. One agent then executes the plan — writing files, running git commands — and opens a pull request. A separate security-reviewer agent gates the PR before it becomes visible to humans. You review a finished PR, not a chat conversation.*

**Reaction prompt:** "What's your reaction?"

**Follow-ups:**
- > "Walk me through what you'd do when you see a PR generated this way. What's the first thing you check?"
  > *[Listen for: H5 — is autonomous PR generation exciting or alarming? What does trust look like?]*
- > "What would have to be true about the PR for you to merge it without a full line-by-line review?"
- > "What's the first thing that goes wrong in your mental model of this?"
- > "Would your team's security or compliance process block a PR with no human author on the implementation?"

---

**Ranking prompt (after all three):**

> "Of these three, rank them: most useful to your team right now, second, third. One sentence on why for each."

*[This is the most important piece of data from this section. Record verbatim.]*

---

## Section 4: Deep Dive on 1–2 Resonant Modes (10 min)

*Based on ranking and energy from Section 3, pick the top 1–2 modes and go deeper. Suggested probes by mode:*

**If Debate ranked #1:**
- > "What problems would you bring to this first? Give me a specific example from the last month."
- > "How many agents feels right — 2, 3, 5? Does more feel more trustworthy or more noisy?"
- > "Would you want agents to remember context from previous debates on your codebase, or start fresh each time?"
  > *[Listen for: H4 — does persistent memory feel valuable or risky?]*
- > "If the agents agreed unanimously, would you trust that more or less than a split decision?"

**If PR Workflow ranked #1:**
- > "What's the smallest meaningful PR you'd feel comfortable with this generating?"
- > "Who approves it — you, a senior engineer, does it go through your normal review process?"
- > "What audit trail would you need to see attached to the PR? Commit log, agent reasoning, tool call log?"
  > *[Listen for: H2 — audit log as the trust mechanism]*
- > "If this touched infrastructure or a security-sensitive file, what changes?"

**If Collaborate ranked #1:**
- > "What document would you generate first? Walk me through the use case."
- > "How would you use the output — paste into Confluence, hand it to the team, iterate on it?"

---

## Section 5: Trust & Safety (5 min)

> "I want to ask about trust directly. When you think about AI taking actions — writing files, opening PRs, calling external APIs — what would make you comfortable letting that happen without watching every step?"

*[Listen for: H2 — audit logs, test coverage, human approval gates, rollback capability]*

**Follow-ups:**
- > "If an agent wrote to a file it shouldn't have, how would you find out? What would you want to exist so you could find out?"
- > "Is there a category of action — deleting files, pushing to main, calling a third-party API — that should always require human approval, no exceptions?"
- > "How does your company think about AI-generated code in production? Is there a policy? Is there pressure from security or legal?"
  > *[Listen for: regulated-industry concerns, compliance blocks, insurance/liability language]*
- > "Would knowing that all agent actions are logged to an immutable audit trail change how much autonomy you'd grant them?"
  > *[Listen for: H2 confirmation or invalidation]*

---

## Section 6: Closing / Would They Pilot It (5 min)

> "Last section — I want to make this concrete."

1. > "If you could have one of these three modes working on your actual codebase next Monday, which would you pick and what would you use it for?"

2. > "What would you need to see in the first week to believe it was worth continuing?"

3. > "What would immediately kill it for your team — a single thing that would make you say 'we're done'?"
   > *[Listen for: cost, hallucination rate, broken autonomy, slow turnaround, compliance block]*

4. > "If we ran a 4-week pilot — you bring 3 real tasks, we run them through the system, you evaluate the outputs — is that something you'd do?"
   > *[Listen for: yes/conditional/no and the specific condition]*

5. > "Who else on your team or in your network should I talk to about this?"

**Close:**

> "This was incredibly useful. I'll send you a summary of what we heard across all interviews (anonymized) once we're done with the round. Any questions for me before we wrap?"

---

## Post-Interview Checklist

- [ ] Tag all quotes with H1–H5 hypothesis codes
- [ ] Record mode ranking verbatim
- [ ] Note team size and classify into user profile (startup / mid-size / enterprise)
- [ ] Flag any new hypotheses surfaced that aren't in H1–H5
- [ ] Update hypothesis tracker within 24 hours
