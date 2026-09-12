-- Samson 0071 — a sixth coach, a bio for each of them, and two recast voices
--
-- Plan: docs/plans/coach-memory-voice-onboarding.md, PR 5.
-- Skill: .claude/skills/add-persona/SKILL.md — the row, the voice, the banned
--        phrases and the tests, together.
--
-- INVARIANT: content lives in the database, not in code — CLAUDE.md #7. Six
--            rows and no persona branch anywhere; there has never been one.
--
-- AI-NOTE: `system_prompt` is a column, therefore DATA. `src/persona/prompts.ts`
--          fences it into the per-call message and never concatenates it into
--          the stage's system prompt — ADR 0006. The prompt below is written as
--          a description of a CHARACTER rather than as instructions to a model:
--          anything phrased as an instruction is read as part of the
--          description and will not take effect the way its author expects.

-- ---------------------------------------------------------------------------
-- 1. A bio, because a name is not enough to choose between six coaches
-- ---------------------------------------------------------------------------
--
-- The persona menu gives a name and nothing else. With three coaches that was
-- survivable; with six it is guesswork.
--
-- WHY a new column rather than reusing `system_prompt`. That one is written FOR
-- A MODEL — it is a character brief in the second person, it reads badly to a
-- person, and it is fenced into the per-call message. Making it double as UI
-- copy would mean writing user-facing text into the payload that reaches the
-- instruction channel's neighbourhood, and would make every future edit to how
-- a coach BEHAVES an edit to what the picker SAYS.
--
-- WHY nullable, like `sample_line` and `tts_voice` before it: `personas_write`
-- lets a user own a persona row, and nothing in the app authors one. Every
-- SHIPPED coach has a bio, counted below and asserted in
-- tests/db/personas.test.ts.
--
-- 240 characters: two sentences under a select on a 375px screen. Past that the
-- picker becomes a page.

alter table public.personas
  add column bio text
    constraint personas_bio_length
      check (bio is null or char_length(bio) between 1 and 240);

comment on column public.personas.bio is
  'Two sentences about this coach IN THE THIRD PERSON, shown under the picker — what they are like to be coached by. Not system_prompt, which is written for a model and fenced into a message. Rework PR 5.';

-- ---------------------------------------------------------------------------
-- 2. The Austrian
-- ---------------------------------------------------------------------------
--
-- The owner asked for a coach as close to a particular Austrian bodybuilder as
-- possible. What ships is the ARCHETYPE, and that is this repo's own rule
-- rather than a flinch: `.claude/skills/add-persona` and the achievement skill
-- both say to twist a reference toward lifting rather than quote it, and that
-- trademarked slogans are not fine. A row in this table SPEAKS TO USERS in the
-- app's voice, so it does not claim to be a living person.
--
-- So: a former champion from a village in Styria who won everything there was
-- to win and now coaches. The accent, the cadence, the vocabulary — the pump,
-- the unembarrassed love of the work, the certainty that the last hard rep is
-- the good part. No name, no film lines, no claim to be anybody. The film
-- quotes are BANNED below rather than merely omitted, so the character cannot
-- drift into the impression by accident on a long delivery.
--
-- INTENSITY 4, which ties the Rival, and the tie is the point. Intensity drives
-- how hard delivery pushes; these two push equally and for opposite reasons.
-- The Rival needles you into the set. The Austrian is simply delighted that you
-- are about to do it. A user choosing between them is choosing a reason, not a
-- volume knob — which is what having six coaches is for.

insert into public.personas (
  user_id, slug, name, system_prompt,
  intensity, humor_level, banned_phrases, sample_line, bio,
  tts_voice, tts_instructions
)
values
  (
    null,
    'austrian',
    'The Austrian',

    -- A character, not instructions. Second person because that is how the
    -- other five are written and how the delivery stage reads them.
    'A former champion from a farming village in Styria who won everything there was to win and now coaches, with undimmed enthusiasm and a heavy Austrian accent. Enormous, genial, completely certain. Talks about training the way other people talk about a good meal: the pump, the blood filling the muscle, the last hard repetition that is the only one that really counts. Never doubts the lifter in front of him, out loud or otherwise. Treats a hard set as a gift rather than a punishment, and says so every time. Calls people my friend. Coarse about nothing; the enthusiasm is the whole personality, and it does not curdle when somebody misses a session — he simply expects them back.',

    4,
    'cheeky',

    -- AI-NOTE: matched by `phraseUsed` in src/persona/deliver.ts — whole words
    --          plus the plural, after lowercasing and clearing punctuation
    --          (ADR 0019). So "I'll be back" has to be listed as "ill be back",
    --          which is what the matcher sees.
    --
    -- The two universals, because the user's body is a stakeholder that cannot
    -- complain (docs/FRAMING.md). Then the film lines, which is what keeps this
    -- an archetype rather than an impression. Then the macho dismissals this
    -- character in particular would reach for: `src/llm/safety.ts` matches
    -- second-person targeting like "you're pathetic" and would not catch any of
    -- these, which is exactly what banned_phrases is for.
    --
    -- TRIMMED DELIBERATELY to the quotes a model might actually reach for while
    -- playing this archetype. "Get to the choppa" and "come with me if you want
    -- to live" are absurd in a gym and were dropped; "I will be back", the
    -- expansion, was dropped because it is a sentence somebody could write by
    -- accident and a banned phrase has no fallback — `deliverPlan` rejects,
    -- retries and then errors (ADR 0006), which is what the `weak`/"weakness"
    -- bug did to real deliveries. A ban that can fire on ordinary prose costs
    -- more than the quote it prevents.
    array[
      'no pain no gain',
      'push through the pain',
      'ill be back',
      'hasta la vista',
      'man up',
      'dont be a baby',
      'stop being a girl'
    ],

    -- No numeral, none of its own banned phrases, no square brackets, and a
    -- clean pass through scanOutput — tests/db/personas.test.ts checks all four.
    'Everybody wants the shoulders. Nobody wants the last few repetitions that build them. Those are the only ones that count, my friend. So we do them together, slowly, and we enjoy them.',

    'Won everything there was to win and still talks about training like a man describing a good meal. Expect to be told the hard set is the best part of your day, and to half believe him by the end of the block.',

    -- `Orus`, which Google lists as male and describes as firm. Free: the other
    -- five hold Algenib, Alnilam, Puck and — after section 3 below — Iapetus
    -- and Achird.
    'Orus',
    'A huge, genial Austrian former bodybuilding champion in his coaching years, delighted by the work itself. Deep and resonant, in Austrian-accented English. Unhurried, leaning into each sentence with obvious pleasure and landing hard on the verb. Chuckles low rather than laughing out loud. Never shouts, never hurries, never sounds bored.'
  );

-- ---------------------------------------------------------------------------
-- 3. The Physio and the Analyst are recast in male voices
-- ---------------------------------------------------------------------------
--
-- The owner asked for it, and both were cast female: `Sulafat` and `Erinome`.
--
-- CHECKED, NOT REMEMBERED. `SPEECH_VOICES` in src/speech/script.ts carries
-- Google's one-word style label per voice and says nothing about the speaker,
-- and neither does the OpenRouter catalogue — so the gender comes from Google's
-- own published prebuilt-voice table for Gemini-TTS, which lists each name as
-- male or female. `add-persona`'s voice-variant bug is what picking a voice on
-- an assumption looks like.
--
-- The swaps keep each coach's style label where one was free, so the only thing
-- that changes is the thing the owner asked to change:
--
--   analyst  Erinome "clear"  ->  Iapetus "clear"   — the same label, male.
--   physio   Sulafat "warm"   ->  Achird  "friendly" — the nearest male label;
--                                 no male voice is labelled "warm".
--
-- The DIRECTIONS are untouched. They describe the character, not the timbre,
-- and the character has not changed.

update public.personas
set tts_voice = 'Iapetus'
where user_id is null and slug = 'analyst';

update public.personas
set tts_voice = 'Achird'
where user_id is null and slug = 'physio';

-- ---------------------------------------------------------------------------
-- 4. A bio for the five that were already here
-- ---------------------------------------------------------------------------
--
-- Third person, because the reader is choosing between coaches rather than
-- being addressed by one. Each says what it is like to BE COACHED by them,
-- which is the question the picker is asking.

update public.personas
set bio = 'Has trained more lifters than he can remember and is impressed by none of them, which is not the same as being unkind. Expect short sentences, long pauses, and more credit for turning up on a bad day than on a good one.'
where user_id is null and slug = 'old-master';

update public.personas
set bio = 'Trains alongside you and keeps score. Expect to be needled about your numbers and quietly matched every session — encouragement wearing a competitor''s face, which works on the people it works on.'
where user_id is null and slug = 'rival';

update public.personas
set bio = 'Volume and tempo, neither of them negotiable. Expect to be shouted at about the rest timer and never about yourself: the target is always the set, never the person doing it.'
where user_id is null and slug = 'sergeant';

update public.personas
set bio = 'Reads what you logged and explains the reason for every change before asking you to make it. Expect no hype and no slogans, and an answer to why every single time.'
where user_id is null and slug = 'analyst';

update public.personas
set bio = 'Asks how the last session felt before adding anything to it. Expect the plan to bend around a sore shoulder rather than the other way round, and to be told when to stop.'
where user_id is null and slug = 'physio';

-- ---------------------------------------------------------------------------
-- 5. Count it, because an update that matches no row says nothing
-- ---------------------------------------------------------------------------
--
-- The same guard 20260911130000 and 20260911140100 carry, for the same reason:
-- a renamed or mistyped slug updates nothing, raises nothing, and ships a coach
-- with a blank picker entry. The number is SIX now.

do $$
declare
  n int;
  voices int;
begin
  select count(*) into n
  from public.personas
  where user_id is null and bio is not null;

  if n <> 6 then
    raise exception 'expected all six shipped personas to have a bio, found %', n;
  end if;

  -- No two coaches may share a voice — the whole point of having six. Held by
  -- tests/db/personas.test.ts too; counted here so a bad recast fails at the
  -- migration rather than at the next db run.
  select count(distinct tts_voice) into voices
  from public.personas
  where user_id is null and tts_voice is not null;

  if voices <> 6 then
    raise exception 'expected six distinct shipped voices, found %', voices;
  end if;
end $$;
