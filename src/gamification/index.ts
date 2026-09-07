/**
 * The gamification engine — deterministic, offline, and the only source of any
 * XP or completion figure a user sees.
 *
 * INVARIANT: the LLM never computes a number — CLAUDE.md #1.
 * Contract: `docs/specs/xp-and-challenges.md`. Trust boundary: ADR 0009.
 */
export * from './xp';
export * from './level';
export * from './plausibility';
export * from './challenge';
export * from './settlement';
