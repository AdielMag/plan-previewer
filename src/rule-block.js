/**
 * Managed rule-block handling for agent global instruction files
 * (~/.claude/CLAUDE.md, ~/.gemini/config/GEMINI.md, ~/.pi/agent/AGENTS.md).
 *
 * These files are user-owned and usually contain unrelated personal
 * instructions, so the installer must only ever own one clearly delimited
 * region of them and leave everything else untouched.
 */

export const RULE_BLOCK_START = '<!-- BEGIN plan-previewer managed block -->';
export const RULE_BLOCK_END = '<!-- END plan-previewer managed block -->';

/** Heading of blocks written by versions that predate the markers. */
export const LEGACY_RULE_HEADING = '# Plan Previewer Required Execution';

export const MANDATORY_RULE_BLOCK = `
# Plan Previewer Required Execution

Plan Previewer has two distinct triggers - know which one applies before you launch it:

- **Phase A - Before execution (mandatory).** Any time you are authoring or revising an execution plan or plan markdown file (such as \`./plan.md\`, \`PLAN.md\`, or temporary plan files) for approval - including the very first draft and every \`changes_requested\`/\`questions_asked\` revision round - you MUST run the protocol below before proceeding.
- **Phase B - After approval (execution phase).** Once \`status\` is \`'approved'\` and you have started executing, do NOT re-launch Plan Previewer just because the plan file changed again (e.g. checking off \`- [x]\` tasks, appending progress notes, logging status). Only launch it again if you have a deliberate, standalone reason to show the user something or ask them a question mid-execution (a blocking decision, a checkpoint, a final summary). When that happens, treat it as a fresh Phase A round and run the exact same protocol - do not substitute a plain chat message instead.

## Protocol (both phases)

0. Apply the \`rich-plan-formatting\` skill to the plan content first - keep it concise and human-readable first with progressive disclosure (collapsible deep-dives for low-level details), choice/question blocks, alert callouts, and status badges before launching the previewer.
1. Run \`npx plan-previewer <path-to-plan> --context="<task summary>"\` in terminal as a plain command.
   - On **Claude Code** and **Pi CLI**: the command blocks in the foreground until feedback is submitted - simply let it run to completion.
   - On **Antigravity AGY**: If \`run_command\` sends the command to a background task, simply stop calling tools to end your turn. The installed \`Stop\` hook intercepts the execution loop's termination and automatically resumes the session with the result the instant feedback is submitted - no extra tool call is needed.
2. **CRITICAL: STOP AND WAIT FOR IT TO EXIT.** Do NOT execute plan steps, edit files, or make further tool calls until the command finishes. It exits either when the user submits feedback in the web UI, or after a bounded wait with no decision yet (4 minutes under Pi CLI; elsewhere when the harness's own command timeout fires) - that second case is normal, not an error. Re-run the same command and keep waiting.
3. Read \`.plan-feedback.json\` (or \`.plan-feedback.md\`), written next to the plan file, to inspect the user's comments, questions, and approval status.
4. If the file doesn't exist yet, or its \`status\` is the same one you already handled in a previous round: the user hasn't responded yet - just re-run the exact same command again and keep waiting, as many times as it takes.
5. If \`status\` is \`'approved'\`, immediately proceed with plan execution (Phase B) and stop re-launching Plan Previewer for routine plan-file edits from here on. If \`status\` is \`'changes_requested'\` or \`'questions_asked'\` and you haven't already addressed it, update the plan, then re-run the exact same command (same plan file, default port) and wait again - the already-open browser tab reconnects and shows the update automatically.
6. On Claude Code, this is enforced by a \`PreToolUse\` hook on \`ExitPlanMode\` (\`~/.claude/hooks/require-plan-previewer.mjs\`). Exiting plan mode is blocked unless step 3's feedback file is fresh and \`"approved"\`. This hook only guards Phase A (leaving plan mode); it does not require re-running Plan Previewer during Phase B. Do not attempt to bypass it; fix the underlying gap instead.
`;

/**
 * @returns {string} the rule block wrapped in its managed-region markers
 */
export function buildManagedRuleBlock(body = MANDATORY_RULE_BLOCK) {
  return [
    RULE_BLOCK_START,
    '<!-- Managed by `plan-previewer install`. Edits inside this block are overwritten on reinstall. -->',
    body.trim(),
    RULE_BLOCK_END,
  ].join('\n');
}

/**
 * Locate a legacy, unmarked block so it can be upgraded in place.
 *
 * The block is bounded by the next line that starts a markdown heading, since
 * the block itself contains no headings below its own H1. Anything the user
 * wrote after it is therefore preserved.
 *
 * @param {string} content
 * @returns {{start: number, end: number}|null}
 */
export function findLegacyBlock(content) {
  const start = content.indexOf(LEGACY_RULE_HEADING);
  if (start === -1) return null;

  const nextHeading = content.indexOf('\n#', start + LEGACY_RULE_HEADING.length);
  return { start, end: nextHeading === -1 ? content.length : nextHeading + 1 };
}

function joinSections(before, block, after) {
  const head = before.trimEnd();
  const tail = after.trimStart();

  let out = head ? `${head}\n\n` : '';
  out += block;
  if (tail) out += `\n\n${tail}`;
  return out.endsWith('\n') ? out : `${out}\n`;
}

/**
 * Insert, refresh, or migrate the managed rule block within a document.
 *
 * @param {string} original current file contents ('' when the file is new)
 * @param {string} [block] managed block to apply
 * @returns {{content: string, mode: 'added'|'updated'|'migrated'|'unchanged'}}
 */
export function applyManagedRuleBlock(original, block = buildManagedRuleBlock()) {
  const content = original || '';

  let next;
  let mode;

  const start = content.indexOf(RULE_BLOCK_START);
  const end = content.indexOf(RULE_BLOCK_END);

  if (start !== -1 && end > start) {
    next = joinSections(content.slice(0, start), block, content.slice(end + RULE_BLOCK_END.length));
    mode = 'updated';
  } else {
    const legacy = findLegacyBlock(content);
    if (legacy) {
      next = joinSections(content.slice(0, legacy.start), block, content.slice(legacy.end));
      mode = 'migrated';
    } else {
      next = joinSections(content, block, '');
      mode = 'added';
    }
  }

  return next === content ? { content, mode: 'unchanged' } : { content: next, mode };
}
