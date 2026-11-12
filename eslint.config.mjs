import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

/**
 * eslint-config-next 16 ships a flat config, so it is spread directly.
 * Wrapping it in FlatCompat re-validates an already-flat config and fails
 * with "Converting circular structure to JSON".
 *
 * eslint-config-next 16 also enables the React Compiler rules from
 * eslint-plugin-react-hooks v6. They flag long-standing patterns across the
 * whole upstream codebase (setState inside an effect, reading refs during
 * render, ...). Clearing those would be a product-wide refactor outside the
 * scope of the stable-release merge, so they stay visible as warnings while
 * rules-of-hooks — the rule AGENTS.md calls out — stays an error.
 */
const REACT_HOOKS_SEVERITY = {
  'react-hooks/rules-of-hooks': 'error',
  'react-hooks/set-state-in-effect': 'warn',
  'react-hooks/refs': 'warn',
  'react-hooks/immutability': 'warn',
  'react-hooks/static-components': 'warn',
  'react-hooks/preserve-manual-memoization': 'warn',
  'react-hooks/use-memo': 'warn',
  'react-hooks/purity': 'warn',
  'react-hooks/globals': 'warn',
  'react-hooks/unsupported-syntax': 'warn',
  'react-hooks/config': 'warn',
  'react-hooks/gating': 'warn',
};

/**
 * A rule can only be re-configured in the same config object that registers
 * its plugin, so the severity overrides are folded into the entries that
 * already own the react-hooks plugin.
 */
const withReactHooksSeverity = (entry) => {
  if (!entry?.plugins?.['react-hooks']) {
    return entry;
  }

  const overrides = Object.fromEntries(
    Object.entries(REACT_HOOKS_SEVERITY).filter(
      ([rule]) => rule in (entry.rules ?? {})
    )
  );

  if (Object.keys(overrides).length === 0) {
    return entry;
  }

  return { ...entry, rules: { ...entry.rules, ...overrides } };
};

const eslintConfig = [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      // generated build copies: the repository root is the source of truth
      'k8s/apps/**',
      'k8s/libraries/**',
      'reports/**',
    ],
  },
  ...nextCoreWebVitals.map(withReactHooksSeverity),
  {
    rules: {
      'react/no-unescaped-entities': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'react/display-name': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/prefer-as-const': 'off',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'off',
    },
  },
];

export default eslintConfig;
