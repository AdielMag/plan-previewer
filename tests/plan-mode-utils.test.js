import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  isSafeCommand,
  hasCommandChaining,
  stripQuotedLiterals,
  isPlanArtifactPath,
  extractTodoItems,
} from '../src/plan-mode-utils.js';

test('isSafeCommand - allowlists safe read-only inspection commands', () => {
  assert.equal(isSafeCommand('ls -la'), true);
  assert.equal(isSafeCommand('grep -rn "test" src'), true);
  assert.equal(isSafeCommand('find . -name "*.ts"'), true);
  assert.equal(isSafeCommand('git status'), true);
  assert.equal(isSafeCommand('git diff HEAD~1'), true);
  assert.equal(isSafeCommand('git log -n 5'), true);
  assert.equal(isSafeCommand('cat package.json'), true);
  assert.equal(isSafeCommand('pwd'), true);
  assert.equal(isSafeCommand('echo "Hello World"'), true);
});

test('isSafeCommand - allows plan-previewer invocations', () => {
  assert.equal(isSafeCommand('npx plan-previewer ./plan.md'), true);
  assert.equal(isSafeCommand('npx plan-previewer ./plan.md --context="Task summary"'), true);
  assert.equal(isSafeCommand('plan-previewer ./plan.md --port=3456'), true);
  assert.equal(isSafeCommand('node ./bin/plan-previewer.js ./plan.md'), true);
});

test('isSafeCommand - prevents false positives on quoted strings containing destructive keywords', () => {
  // Previously, the word "code" in context would trigger the /\b(vim?|nano|emacs|code|subl)\b/ editor rule
  assert.equal(isSafeCommand('npx plan-previewer ./plan.md --context="Refactor code layout"'), true);
  assert.equal(isSafeCommand('npx plan-previewer ./plan.md --context="Fix rm command bug"'), true);
  assert.equal(isSafeCommand('grep -rn "rm -rf" src'), true);
  assert.equal(isSafeCommand('grep -rn "git commit" .'), true);
  assert.equal(isSafeCommand('echo "git commit and rm are blocked"'), true);
});

test('isSafeCommand - blocks real destructive commands', () => {
  assert.equal(isSafeCommand('rm -rf src'), false);
  assert.equal(isSafeCommand('rmdir old_dir'), false);
  assert.equal(isSafeCommand('mkdir new_dir'), false);
  assert.equal(isSafeCommand('touch file.txt'), false);
  assert.equal(isSafeCommand('git add .'), false);
  assert.equal(isSafeCommand('git commit -m "test"'), false);
  assert.equal(isSafeCommand('git push origin main'), false);
  assert.equal(isSafeCommand('npm install express'), false);
  assert.equal(isSafeCommand('npm update'), false);
  assert.equal(isSafeCommand('pip install requests'), false);
  assert.equal(isSafeCommand('code src/index.ts'), false);
  assert.equal(isSafeCommand('vim file.txt'), false);
});

test('isSafeCommand - rejects chained commands & command substitution', () => {
  assert.equal(isSafeCommand('ls; rm -rf src'), false);
  assert.equal(isSafeCommand('git status && rm -rf src'), false);
  assert.equal(isSafeCommand('cat file | rm -rf'), false);
  assert.equal(isSafeCommand('npx plan-previewer ./plan.md; rm -rf src'), false);
  assert.equal(isSafeCommand('echo $(rm -rf src)'), false);
  assert.equal(isSafeCommand('echo `rm -rf src`'), false);
  assert.equal(isSafeCommand('ls\nrm -rf src'), false);
});

test('isPlanArtifactPath - permits valid plan files inside cwd', () => {
  const cwd = process.cwd();
  assert.equal(isPlanArtifactPath('plan.md', cwd), true);
  assert.equal(isPlanArtifactPath('./plan.md', cwd), true);
  assert.equal(isPlanArtifactPath('PLAN.md', cwd), true);
  assert.equal(isPlanArtifactPath('task_plan.md', cwd), true);
  assert.equal(isPlanArtifactPath('IMPLEMENTATION_PLAN.md', cwd), true);
  assert.equal(isPlanArtifactPath('auth-plan.md', cwd), true);
  assert.equal(isPlanArtifactPath('feature_plan.md', cwd), true);
  assert.equal(isPlanArtifactPath('.plan-response.md', cwd), true);
  assert.equal(isPlanArtifactPath('.plan-feedback.json', cwd), true);
  assert.equal(isPlanArtifactPath('.plan-feedback.md', cwd), true);
});

test('isPlanArtifactPath - blocks non-plan files', () => {
  const cwd = process.cwd();
  assert.equal(isPlanArtifactPath('src/index.ts', cwd), false);
  assert.equal(isPlanArtifactPath('package.json', cwd), false);
  assert.equal(isPlanArtifactPath('README.md', cwd), false);
  assert.equal(isPlanArtifactPath('styles.css', cwd), false);
  assert.equal(isPlanArtifactPath('app.js', cwd), false);
});

test('isPlanArtifactPath - blocks path traversal outside cwd', () => {
  const cwd = process.cwd();
  assert.equal(isPlanArtifactPath('../plan.md', cwd), false);
  assert.equal(isPlanArtifactPath('../../plan.md', cwd), false);
  assert.equal(isPlanArtifactPath('/tmp/plan.md', cwd), false);
});

test('extractTodoItems - extracts numbered plan steps and stops before decision questions', () => {
  const msg = `
Here is the proposal:

Plan:
1. Create a chaining guard in utils.ts
2. Allow plan-previewer commands
3. Gate write and edit tools to plan artifacts

### Open questions
1. Should we also install questionnaire?
2. What width should the previewer use?

> [!CHOICE] Choice Card
> - (x) Option A
> - ( ) Option B
`;

  const todos = extractTodoItems(msg);
  assert.equal(todos.length, 3);
  assert.equal(todos[0].text, 'Chaining guard in utils.ts');
  assert.equal(todos[1].text, 'Allow plan-previewer commands');
  assert.equal(todos[2].text, 'Gate write and edit tools to plan artifacts');
});
