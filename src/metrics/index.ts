/**
 * The metrics engine.
 *
 * INVARIANT: the LLM never computes a number — CLAUDE.md #1. Every figure a user
 *            sees originates here, in deterministic code with unit tests. A model
 *            producing one of these is a bug.
 *
 * Everything exported is a pure function over the plain shapes in ./types. There
 * is no I/O in this directory, which is what keeps the suite fast enough to run
 * on every save.
 */
export * from './types';
export * from './dates';
export * from './e1rm';
export * from './tonnage';
export * from './adherence';
export * from './pr';
export * from './acwr';
