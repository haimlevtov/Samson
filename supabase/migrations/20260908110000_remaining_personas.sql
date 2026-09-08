-- Samson 0044 — the Sergeant, and a coach at the gentle end
--
-- Plan: docs/plans/phase-5-content-fill.md, PR 4.
-- Skill: .claude/skills/add-persona/SKILL.md — the row, the voice variant, the
--        banned phrases and the tests, together.
--
-- INVARIANT: content lives in the database, not in code — CLAUDE.md #7. Two
--            rows and no persona branch anywhere; there has never been one.
--
-- AI-NOTE: `system_prompt` is a column, therefore DATA. src/persona/prompts.ts
--          fences it into the per-call message and never concatenates it into
--          the stage's system prompt — ADR 0006. Both prompts below are written
--          as a description of a CHARACTER rather than as instructions to a
--          model: anything phrased as an instruction is read as part of the
--          character's description and will not take effect the way its author
--          expects.
--
-- ---------------------------------------------------------------------------
-- Why these two and not any others
-- ---------------------------------------------------------------------------
--
-- THE SERGEANT is named in three documents and existed in none of them:
-- docs/PRD.md §5.4 and docs/PLAN.md phase 3 both say "one of the Sergeant or
-- the Old Master", and docs/adr/0005-llm-safety.md §1 states as settled fact
-- that "the persona layer ships a Rival and a Sergeant". The Old Master
-- shipped; this is the other one, and ADR 0005's sentence becomes true.
--
-- THE PHYSIO is an argued addition rather than a promised one, and the
-- difference is worth stating because the obvious justification is wrong.
-- PRD §5.4's tone override reads "regardless of which persona is selected" —
-- it is explicitly cross-persona, so it is an argument AGAINST needing a gentle
-- coach, not for one. The actual argument: the three shipped coaches sit at
-- intensity 2, 3 and 4 and two of the three are `cheeky`, so choosing between
-- them changes the jokes more than the register. Intensity 1 is the one setting
-- the product does not have, and the returning and injured seed archetypes are
-- the people who would pick it.

insert into public.personas (
  user_id, slug, name, system_prompt,
  tts_voice_id, tts_voice_variant, intensity, humor_level, banned_phrases
)
values
  (
    null,
    'sergeant',
    'The Sergeant',
    'A former drill instructor who now shouts about tempo instead of drill. Loud, blunt, and unimpressed by anything short of showing up. Speaks in short bursts, mostly imperatives, with the cadence of a parade ground. Takes a skipped session as a personal affront and says so at volume. Coarse about the work and never about the person — the target is always the set, the tempo or the rest timer, never the body doing them. Underneath it, entirely on your side, which slips out about once a block and is immediately covered up.',

    -- en-GB variant 2. Old Master is 0 and Rival is 1.
    -- INVARIANT: two personas sharing a tts_voice_id must not share a variant —
    -- .claude/skills/add-persona/SKILL.md §2. Nothing enforces this in the
    -- schema (the column defaults to 0 and no constraint spans rows), so it is
    -- held by tests/db/personas.test.ts. The bug it exists to stop is real and
    -- already happened: before the variant was a column, all three coaches
    -- resolved to the same device voice under a control labelled "Voice".
    'en-GB',
    2,

    -- The only intensity 5 in the table, paired with the only crude row. That
    -- is the highest-risk combination the schema allows, and it is deliberate:
    -- users.humor_max_level has offered `crude` since the phase-0 schema with
    -- nothing behind it, so until now the setting did nothing for anybody who
    -- chose it.
    5,
    'crude',

    -- The longest list in the table, and the reason is the row above it.
    --
    -- WHAT THIS LIST IS FOR, given src/llm/safety.ts already scans every
    -- completion: that scanner matches demeaning language as SECOND-PERSON
    -- TARGETING ("you're pathetic"), deliberately, so that "your pathetic
    -- squat" and "body fat" stay sayable — a guard that fires on coaching
    -- vocabulary gets switched off and then protects nobody. This list covers
    -- what that construction misses: the gendered barracks idiom this character
    -- would otherwise reach for, and two pieces of advice that are dangerous
    -- rather than rude.
    --
    -- AI-NOTE: banned_phrases are matched with String.includes on the
    --          lowercased text — src/persona/deliver.ts — so a SHORT WORD BANS
    --          EVERY WORD CONTAINING IT. `fat` would ban "fatigue" and `soft`
    --          would ban "soften", which is why neither is here and why every
    --          entry below is either a phrase or a word with no innocent
    --          superstring. Check any addition the same way.
    array[
      'no pain no gain',
      'push through the pain',
      'pain is weakness leaving the body',
      'walk it off',
      'suck it up',
      'man up',
      'grow a pair',
      'like a girl',
      'ladies',
      'princess',
      'sissy',
      'crybaby',
      'quitter'
    ]
  ),
  (
    null,
    'physio',
    'The Physio',
    'A rehabilitation coach who has spent a career watching people come back from injuries, most of which were avoidable. Unhurried, plain and quietly warm. Notices what has changed since last time and mentions it before saying anything else. Asks how a movement felt before deciding what to do about it. Entirely comfortable telling somebody to do less, and treats a deload as a decision rather than a failure. Never dramatic about pain and never dismissive of it: says plainly when something is worth having looked at by a professional, and does not offer a way around it.',

    -- en-US variant 1. The Analyst is 0.
    'en-US',
    1,

    -- The only 1 in the table. WHY it matters that this is below
    -- GENTLE_MAX_INTENSITY (2, src/persona/tone.ts): the gentle override clamps
    -- intensity when an injury or a run of missed sessions is flagged, and this
    -- is the one persona it never has to clamp. It is already there.
    1,
    'clean',

    array[
      'no pain no gain',
      'push through the pain',
      'walk it off',
      'just stretch it',
      'toughen up',
      'it is probably nothing',
      'you will be fine'
    ]
  );
