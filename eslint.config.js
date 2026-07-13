module.exports = {
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'script',
    globals: {
      window: 'readonly',
      document: 'readonly',
      navigator: 'readonly',
      localStorage: 'readonly',
      Intl: 'readonly',
      requestAnimationFrame: 'readonly',
      cancelAnimationFrame: 'readonly',
      setTimeout: 'readonly',
      clearTimeout: 'readonly',
      setInterval: 'readonly',
      clearInterval: 'readonly',
      L: 'readonly',
      SunCalc: 'readonly',
      URLSearchParams: 'readonly',
      Node: 'readonly',
      require: 'readonly',
      module: 'readonly',
      console: 'readonly',
      self: 'readonly'
    }
  },
  rules: {
    'no-undef': 'error',
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^e$' }],
    'no-redeclare': 'error',
    'no-constant-condition': ['error', { checkLoops: false }],
    'no-debugger': 'error',
    'no-dupe-keys': 'error',
    'no-duplicate-case': 'error',
    'no-empty': ['error', { allowEmptyCatch: true }],
    'no-irregular-whitespace': 'error',
    'no-sparse-arrays': 'error',
    'no-undef-init': 'error',
    'no-unreachable': 'error',
    'no-unused-labels': 'error',
    'no-use-before-define': ['error', { functions: false, variables: false }],
    'eqeqeq': ['error', 'smart'],
    'semi': ['error', 'always']
  }
};
