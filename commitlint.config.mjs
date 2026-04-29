export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', ['feat', 'fix', 'update', 'remove', 'refactor', 'docs', 'chore']],
    'type-case': [2, 'always', 'lowercase'],
    'scope-empty': [0],
    'subject-empty': [2, 'never'],
    'subject-full-stop': [2, 'never', '.'],
    'header-max-length': [2, 'always', 72],
  },
  ignores: [(commit) => commit === ''],
  defaultIgnores: true,
}
