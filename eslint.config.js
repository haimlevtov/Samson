import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'next-env.d.ts',
      'src/db/types.ts',
      // Vendored skill tooling and subagent worktrees. Neither is project
      // source, and both carry their own tsconfig, which breaks root discovery.
      '.claude/**',
      // Throwaway edit scripts. They live in the repo root only so they can
      // resolve project imports, and they are deleted in the same turn.
      '.tmp-*',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    // INVARIANT: all LLM calls go through src/llm/gateway.ts — see CLAUDE.md #2
    // WHY: the gateway owns retries, fallback, budget checks and the llm_calls
    //      ledger. A direct fetch elsewhere silently drops a row from the token
    //      data the project is graded on, and no test would catch it.
    // AI-NOTE: tests/unit/invariants.test.ts greps the tree for the same thing,
    //          because lint can be disabled inline and a grep cannot.
    files: ['**/*.ts', '**/*.tsx'],
    // tests/unit/invariants.test.ts enforces this same rule by grepping the
    // source tree, so it necessarily contains the literal it forbids.
    ignores: ['src/llm/**', 'tests/unit/invariants.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/openrouter/i]',
          message: 'Reach OpenRouter through callLLM() in src/llm/gateway.ts — see CLAUDE.md #2.',
        },
        {
          selector: "MemberExpression[property.name='OPENROUTER_API_KEY']",
          message: 'Only src/llm/ reads the OpenRouter key — see CLAUDE.md #2.',
        },
      ],
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // Underscore-prefixed bindings are intentional discards.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ['**/*.test.ts', 'scripts/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  }
);
