-- Samson 0045 — phrases that could not fire, and inflections that escaped
--
-- ALL FOUND IN REVIEW, 2026-09-08, on the migration one file earlier. Two
-- reviewers ran the shipped matcher over the shipped rows, which is the step
-- that had not been taken.
--
-- Contract for the matcher itself: docs/adr/0019-banned-phrase-matching.md.
--
-- WHY a second migration rather than editing 20260908110000: that file is
-- already applied. Its COMMENTS were corrected in place, because a comment is
-- not stored in the database and cannot desync anything; every value change is
-- here.

-- ---------------------------------------------------------------------------
-- 1. The Physio's two dangerous-advice phrases never fired
-- ---------------------------------------------------------------------------
--
-- MEASURED: `phraseUsed` returns false for both of these against the form a
-- model actually writes.
--
--   "it's probably nothing."  vs banned `it is probably nothing`  -> false
--   "you'll be fine."         vs banned `you will be fine`        -> false
--
-- Contractions. The two entries with the most riding on them — this is the
-- coach whose whole character is not being dismissive about pain — were written
-- in the one form a model almost never produces.
--
-- The fix is to ban the fragment that carries the meaning rather than the full
-- sentence, so it fires whichever way the clause is built. `probably nothing`
-- catches both "it is" and "it's"; `nothing to worry about` is the other way of
-- saying the same thing.
--
-- AI-NOTE: prefer the shortest fragment that is unambiguously the thing you are
--          banning. A whole sentence only matches that sentence, and a model
--          has a hundred ways to write one.

update public.personas
set banned_phrases = array[
  'no pain no gain',
  'push through the pain',
  'walk it off',
  'just stretch it',
  'toughen up',
  'probably nothing',
  'nothing to worry about'
]
where slug = 'physio' and user_id is null;

-- ---------------------------------------------------------------------------
-- 2. `weakling` escapes both guards
-- ---------------------------------------------------------------------------
--
-- The matcher now covers a phrase and its PLURAL, which restored `quitters` and
-- `princesses`. It does not cover other inflections, deliberately — that is the
-- trade for `weak` not banning "weakness". The one that matters is `weakling`,
-- because it is a noun the Rival's `weak` used to catch by accident.
--
-- MEASURED, and this is the part worth knowing: `src/llm/safety.ts` does not
-- back it up either. `DEMEANING` matches "you are" plus an optional intensifier
-- and article, then a FIXED ADJECTIVE LIST — and "weakling" is not on it. So
-- **"you are a weakling" passes the scanner**, in the release that shipped the
-- app's first crude, intensity-5 persona. These rows are the only thing
-- stopping it, which is the whole argument for per-persona lists.
--
-- Recorded as a known gap in src/llm/safety.test.ts rather than papered over:
-- a passing assertion there means a hole, not a success.
--
-- Listed on both rows that could produce it. The plural comes free.

update public.personas
set banned_phrases = array[
  'no pain no gain',
  'push through the pain',
  'pathetic',
  'weak',
  'weakling',
  'excuses'
]
where slug = 'rival' and user_id is null;

update public.personas
set banned_phrases = array[
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
  'quitter',
  'weakling'
]
where slug = 'sergeant' and user_id is null;

-- ---------------------------------------------------------------------------
-- 3. Migration 20260907120000's voice-variant note is spent
-- ---------------------------------------------------------------------------
--
-- That file's AI-NOTE says "a new en-GB coach needs 2, not the default 0", and
-- 2 is now the Sergeant's. A sixth coach following it lands on a duplicate and
-- reintroduces the bug the column exists to prevent — two coaches resolving to
-- one device voice under a control labelled "Voice".
--
-- Recorded here because that migration is applied and its statements cannot
-- change. The live allocation is maintained in
-- .claude/skills/add-persona/SKILL.md §2, which is where the next author looks:
--
--   en-GB  old-master 0, rival 1, sergeant 2   -> next takes 3
--   en-US  analyst 0, physio 1                 -> next takes 2
--
-- tests/db/personas.test.ts fails if two rows of one language ever share one.
