/**
 * The "and logged" half of phase 6's acceptance criterion.
 *
 * `docs/PLAN.md` phase 6: _"no prompt, persona, or user framing moves the
 * calorie floor. Every attempt blocked **and logged**."_ The blocked half is
 * `src/diet/advice.test.ts`, against a scripted model. This half cannot be
 * tested there at all: **the unit suite mocks the gateway, so it never inserts a
 * row and structurally cannot see one** — `.claude/skills/add-pipeline-stage/SKILL.md`
 * says so in as many words, and it is why the `chat` stage's missing constraint
 * survived 757 green tests before failing on the first live message.
 *
 * What this file proves, and what it does not:
 *
 * - **Proved here:** a `stage = 'diet'` row inserts under the user's own token,
 *   a blocked attempt is representable, a second attempt is a second row rather
 *   than an update, and nobody reads anybody else's spend.
 * - **Proved elsewhere:** that the gateway writes one row per attempt including
 *   failures — `src/llm/gateway.test.ts`, "logs one row for every attempt,
 *   failures included". That the union and the CHECK admit the same set —
 *   `tests/db/schema-invariants.test.ts`.
 * - **Not proved by anything, and it needs saying:** that a LIVE model call
 *   lands a row. No API key has ever been configured on this project, which is
 *   the same gap phase 2's and phase 3's unmet criteria sit in.
 *
 * The rows below are written directly rather than through the gateway, because
 * the gateway needs a key. That is the seam, and naming it is the point.
 *
 * INVARIANT: the service role creates fixtures; every assertion runs through a
 *            user-scoped client — the same split as tests/db/rls.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestUser, deleteTestUser, type TestUser } from './helpers';

let user: TestUser;
let other: TestUser;

beforeAll(async () => {
  [user, other] = await Promise.all([createTestUser('diet-ledger'), createTestUser('diet-other')]);
}, 90_000);

afterAll(async () => {
  await Promise.all([deleteTestUser(user), deleteTestUser(other)]);
});

/** One ledger row, as the gateway would write it for this stage. */
function row(as: TestUser, overrides: Record<string, unknown> = {}) {
  return {
    user_id: as.id,
    stage: 'diet',
    attempt: 1,
    status: 'ok',
    models_requested: ['anthropic/claude-haiku-4.5'],
    model_used: 'anthropic/claude-haiku-4.5',
    latency_ms: 412,
    ...overrides,
  };
}

describe('a diet call can be logged at all', () => {
  it('accepts stage = diet', async () => {
    const { error } = await user.client.from('llm_calls').insert(row(user) as never);
    expect(error, 'has 20260907160000_llm_calls_chat_stage.sql been applied?').toBeNull();
  });

  it('rejects a stage nobody declared', async () => {
    const { error } = await user.client
      .from('llm_calls')
      .insert(row(user, { stage: 'supplement' }) as never);
    // The trap the add-pipeline-stage skill leads with: a stage in the union
    // and not in the CHECK fails here and nowhere else.
    expect(error).not.toBeNull();
  });

  /*
   * The criterion says every attempt is logged, blocked ones included. A reply
   * the content checks rejected still spent tokens, so invariant #3 requires the
   * row — and the taxonomy PLAN.md asks for is then countable from the ledger
   * rather than reconstructed from memory.
   */
  it('accepts a blocked attempt, which is the half the criterion is about', async () => {
    const { error } = await user.client
      .from('llm_calls')
      .insert(row(user, { status: 'safety_blocked', attempt: 2, error: 'blocked' }) as never);
    expect(error).toBeNull();
  });

  it('makes a retry a second row rather than an update', async () => {
    const first = await user.client.from('llm_calls').insert(row(user, { attempt: 1 }) as never);
    const second = await user.client.from('llm_calls').insert(row(user, { attempt: 2 }) as never);
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();

    const { data } = await user.client
      .from('llm_calls')
      .select('attempt')
      .eq('user_id', user.id)
      .eq('stage', 'diet');

    // At least the two just written, plus whatever the cases above left.
    expect((data ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe('whose spend it is', () => {
  it('does not let one user log against another', async () => {
    const { error } = await user.client.from('llm_calls').insert(row(other) as never);
    expect(error, 'llm_calls_insert_own should reject this').not.toBeNull();
  });

  it('does not let one user read another’s diet calls', async () => {
    await user.client.from('llm_calls').insert(row(user) as never);

    const { data } = await other.client.from('llm_calls').select('id').eq('stage', 'diet');
    expect(data ?? []).toHaveLength(0);
  });
});
