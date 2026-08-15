/**
 * Plan Mode Extension
 *
 * Plan-authoring and read-only code exploration mode.
 * Safe for code analysis and plan creation with Plan Previewer.
 *
 * Features:
 * - /plan command or Ctrl+Alt+P to toggle
 * - Bash restricted to allowlisted read-only commands + plan-previewer
 * - Write/edit tools gated to plan artifacts only (e.g. ./plan.md, .plan-response.md)
 * - Extracts numbered plan steps from approved plan.md or "Plan:" sections
 * - Auto-executes upon Plan Previewer approval
 * - [DONE:n] markers to complete steps during execution
 * - Progress tracking widget during execution
 */

import fs from "node:fs";
import path from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import {
	extractTodoItems,
	isPlanArtifactPath,
	isSafeCommand,
	markCompletedSteps,
	type TodoItem,
} from "./utils.ts";

// Tools
const PLAN_MODE_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls", "questionnaire"];
const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write"];
const PLAN_MODE_DISABLED_TOOLS = new Set<string>([]); // Gated via tool_call event handler
const PLAN_MANAGED_TOOLS = new Set<string>([...PLAN_MODE_TOOLS, ...NORMAL_MODE_TOOLS]);

interface PlanModeState {
	enabled: boolean;
	todos?: TodoItem[];
	executing?: boolean;
	stepByStep?: boolean;
	toolsBeforePlanMode?: string[];
}

// Type guard for assistant messages
function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
	return m.role === "assistant" && Array.isArray(m.content);
}

// Extract text content from an assistant message
function getTextContent(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

export default function planModeExtension(pi: ExtensionAPI): void {
	let planModeEnabled = false;
	let executionMode = false;
	let stepByStepMode = false;
	let todoItems: TodoItem[] = [];
	let toolsBeforePlanMode: string[] | undefined;

	pi.registerFlag("plan", {
		description: "Start in plan mode (plan authoring & read-only exploration)",
		type: "boolean",
		default: false,
	});

	function updateStatus(ctx: ExtensionContext): void {
		// Footer status
		if (executionMode && todoItems.length > 0) {
			const completed = todoItems.filter((t) => t.completed).length;
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("accent", `⚡ ${completed}/${todoItems.length}`));
		} else if (planModeEnabled) {
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "⏸ plan"));
		} else {
			ctx.ui.setStatus("plan-mode", undefined);
		}

		// Widget showing todo list
		if (executionMode && todoItems.length > 0) {
			const lines = todoItems.map((item) => {
				if (item.completed) {
					return (
						ctx.ui.theme.fg("success", "☑ ") + ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(item.text))
					);
				}
				return `${ctx.ui.theme.fg("muted", "☐ ")}${item.text}`;
			});
			ctx.ui.setWidget("plan-todos", lines);
		} else {
			ctx.ui.setWidget("plan-todos", undefined);
		}
	}

	function uniqueToolNames(toolNames: string[]): string[] {
		return [...new Set(toolNames)];
	}

	function getPlanModeTools(activeToolNames: string[]): string[] {
		return uniqueToolNames([
			...activeToolNames.filter((name) => !PLAN_MODE_DISABLED_TOOLS.has(name)),
			...PLAN_MODE_TOOLS,
		]);
	}

	function getNormalModeTools(activeToolNames: string[]): string[] {
		return uniqueToolNames([
			...NORMAL_MODE_TOOLS,
			...activeToolNames.filter((name) => !PLAN_MANAGED_TOOLS.has(name)),
		]);
	}

	function enablePlanModeTools(): void {
		if (toolsBeforePlanMode === undefined) {
			toolsBeforePlanMode = pi.getActiveTools();
		}
		pi.setActiveTools(getPlanModeTools(toolsBeforePlanMode));
	}

	function restoreNormalModeTools(): void {
		pi.setActiveTools(toolsBeforePlanMode ?? getNormalModeTools(pi.getActiveTools()));
		toolsBeforePlanMode = undefined;
	}

	function persistState(): void {
		pi.appendEntry("plan-mode", {
			enabled: planModeEnabled,
			todos: todoItems,
			executing: executionMode,
			stepByStep: stepByStepMode,
			toolsBeforePlanMode,
		});
	}

	function togglePlanMode(ctx: ExtensionContext): void {
		planModeEnabled = !planModeEnabled;
		executionMode = false;
		stepByStepMode = false;
		todoItems = [];

		if (planModeEnabled) {
			enablePlanModeTools();
			ctx.ui.notify("Plan mode enabled. Source modifications gated to plan artifacts.");
		} else {
			restoreNormalModeTools();
			ctx.ui.notify("Plan mode disabled. Full access restored.");
		}
		updateStatus(ctx);
		persistState();
	}

	pi.registerCommand("plan", {
		description: "Toggle plan mode (plan authoring & read-only exploration)",
		handler: async (_args, ctx) => togglePlanMode(ctx),
	});

	pi.registerCommand("todos", {
		description: "Show current plan todo list",
		handler: async (_args, ctx) => {
			if (todoItems.length === 0) {
				ctx.ui.notify("No todos. Create a plan first with /plan", "info");
				return;
			}
			const list = todoItems.map((item, i) => `${i + 1}. ${item.completed ? "✓" : "○"} ${item.text}`).join("\n");
			ctx.ui.notify(`Plan Progress:\n${list}`, "info");
		},
	});

	pi.registerShortcut(Key.ctrlAlt("p"), {
		description: "Toggle plan mode",
		handler: async (ctx) => togglePlanMode(ctx),
	});

	// Gate tool calls in plan mode
	pi.on("tool_call", async (event) => {
		if (!planModeEnabled) return;

		// 1. Gate bash commands
		if (event.toolName === "bash") {
			const command = event.input.command as string;
			if (!isSafeCommand(command)) {
				return {
					block: true,
					reason: `Plan mode: command blocked (not allowlisted). In plan mode, only read-only inspection commands and plan-previewer are permitted.\nCommand: ${command}`,
				};
			}
		}

		// 2. Gate write & edit tools to plan artifacts only
		if (event.toolName === "write" || event.toolName === "edit") {
			const targetPath =
				(event.input as { path?: string; file_path?: string }).path ??
				(event.input as { path?: string; file_path?: string }).file_path;

			if (!targetPath || !isPlanArtifactPath(targetPath, process.cwd())) {
				return {
					block: true,
					reason: `Plan mode: ${event.toolName} to "${targetPath || "unknown"}" is blocked. In plan mode, you may only write or edit plan artifacts (e.g. ./plan.md, task_plan.md, .plan-response.md). Source code edits are blocked until plan execution begins.`,
				};
			}
		}
	});

	// Filter out stale plan mode context when not in plan mode
	pi.on("context", async (event) => {
		if (planModeEnabled) return;

		return {
			messages: event.messages.filter((m) => {
				const msg = m as AgentMessage & { customType?: string };
				if (msg.customType === "plan-mode-context") return false;
				if (msg.role !== "user") return true;

				const content = msg.content;
				if (typeof content === "string") {
					return !content.includes("[PLAN MODE ACTIVE]");
				}
				if (Array.isArray(content)) {
					return !content.some(
						(c) => c.type === "text" && (c as TextContent).text?.includes("[PLAN MODE ACTIVE]"),
					);
				}
				return true;
			}),
		};
	});

	// Inject plan/execution context before agent starts
	pi.on("before_agent_start", async () => {
		if (planModeEnabled) {
			return {
				message: {
					customType: "plan-mode-context",
					content: `[PLAN MODE ACTIVE]
You are in plan mode - an exploration, plan-authoring, and review mode.

Protocol:
1. Explore and analyze code using read-only inspection tools (read, grep, find, ls, safe bash).
2. Write or update your execution plan in \`./plan.md\` using the write/edit tool.
   Apply the \`rich-plan-formatting\` skill: structure it with \`[!CHOICE]\` cards for options and \`[!QUESTION]\` blocks for clarifying questions.
3. Launch Plan Previewer:
   \`npx plan-previewer ./plan.md --context="<task summary>"\`
   and wait for it to exit.
4. Read \`.plan-feedback.json\` to inspect user approvals or comments.
5. If approved, outline your implementation steps under a "Plan:" header.
   If changes requested, revise \`./plan.md\` and re-run Plan Previewer.

Restrictions:
- Modifying source code is blocked during plan mode (only plan artifacts like \`./plan.md\` may be written)
- Destructive bash commands are blocked
- Use the questionnaire tool or Plan Previewer choice cards for user input`,
					display: false,
				},
			};
		}

		if (executionMode && todoItems.length > 0) {
			const remaining = todoItems.filter((t) => !t.completed);
			const todoList = remaining.map((t) => `${t.step}. ${t.text}`).join("\n");
			const executionDirective = stepByStepMode
				? "Execute only the next pending step and stop. Include a [DONE:n] tag when that step is done."
				: "Execute ALL remaining steps in order without pausing between steps. Complete everything continuously, emitting the corresponding [DONE:n] tag as each step is completed.";

			return {
				message: {
					customType: "plan-execution-context",
					content: `[EXECUTING PLAN - Full tool access enabled]

Remaining steps:
${todoList}

${executionDirective}`,
					display: false,
				},
			};
		}
	});

	// Track progress after each turn
	pi.on("turn_end", async (event, ctx) => {
		if (!executionMode || todoItems.length === 0) return;
		if (!isAssistantMessage(event.message)) return;

		const text = getTextContent(event.message);
		if (markCompletedSteps(text, todoItems) > 0) {
			updateStatus(ctx);
		}
		persistState();
	});

	// Helper to start execution
	function startExecution(
		ctx: ExtensionContext,
		stepByStep: boolean,
		todoListMessage: { customType: string; content: string; display: boolean },
	) {
		const firstTodoItem = todoItems[0];
		if (!firstTodoItem) return;

		planModeEnabled = false;
		executionMode = true;
		stepByStepMode = stepByStep;
		restoreNormalModeTools();
		updateStatus(ctx);
		persistState();

		const remainingList = todoItems.map((t) => `${t.step}. ${t.text}`).join("\n");
		const execMessage = stepByStep
			? `Execute the plan step by step.\n\nRemaining steps:\n${remainingList}\n\nStart with: ${firstTodoItem.text}\nAfter completing this single step, include a [DONE:n] tag and stop for feedback.`
			: `Execute the plan.\n\nRemaining steps:\n${remainingList}\n\nExecute ALL steps in order without pausing until the entire plan is finished. Include a [DONE:n] tag as each step is completed.`;

		pi.sendMessage(todoListMessage, { deliverAs: "followUp" });
		pi.sendMessage(
			{ customType: "plan-mode-execute", content: execMessage, display: true },
			{ triggerTurn: true, deliverAs: "followUp" },
		);
	}

	// Handle plan completion and plan mode UI
	pi.on("agent_end", async (event, ctx) => {
		// Check if execution is complete
		if (executionMode && todoItems.length > 0) {
			if (todoItems.every((t) => t.completed)) {
				const completedList = todoItems.map((t) => `~~${t.text}~~`).join("\n");
				pi.sendMessage(
					{ customType: "plan-complete", content: `**Plan Complete!** ✓\n\n${completedList}`, display: true },
					{ triggerTurn: false },
				);
				executionMode = false;
				stepByStepMode = false;
				todoItems = [];
				updateStatus(ctx);
				persistState();
			} else if (!stepByStepMode) {
				// If not all steps completed in continuous mode, continue automatically
				const remaining = todoItems.filter((t) => !t.completed);
				if (remaining.length > 0) {
					const nextTodo = remaining[0];
					const continueMessage = `Continue executing remaining plan steps:\n${remaining.map((t) => `${t.step}. ${t.text}`).join("\n")}\n\nExecute all remaining steps without stopping. Emit [DONE:n] for each completed step.`;
					pi.sendMessage(
						{ customType: "plan-mode-continue", content: continueMessage, display: false },
						{ triggerTurn: true, deliverAs: "followUp" },
					);
				}
			}
			return;
		}

		if (!planModeEnabled || !ctx.hasUI) return;

		// 1. Try extracting todos from plan.md first, then fall back to assistant message
		const planFilePath = path.resolve(process.cwd(), "plan.md");
		if (fs.existsSync(planFilePath)) {
			try {
				const planContent = fs.readFileSync(planFilePath, "utf8");
				const extracted = extractTodoItems(planContent);
				if (extracted.length > 0) {
					todoItems = extracted;
				}
			} catch {}
		}

		if (todoItems.length === 0) {
			const lastAssistant = [...event.messages].reverse().find(isAssistantMessage);
			if (lastAssistant) {
				const extracted = extractTodoItems(getTextContent(lastAssistant));
				if (extracted.length > 0) {
					todoItems = extracted;
				}
			}
		}

		if (todoItems.length === 0) return;
		persistState();

		const todoListText = todoItems.map((t, i) => `${i + 1}. ☐ ${t.text}`).join("\n");
		const planTodoListMessage = {
			customType: "plan-todo-list",
			content: `**Plan Steps (${todoItems.length}):**\n\n${todoListText}`,
			display: true,
		};

		// 2. Check if Plan Previewer already approved the plan in browser
		const feedbackPath = path.resolve(process.cwd(), ".plan-feedback.json");
		if (fs.existsSync(feedbackPath)) {
			try {
				const fb = JSON.parse(fs.readFileSync(feedbackPath, "utf8"));
				if (fb.status === "approved") {
					ctx.ui.notify("Plan approved via Plan Previewer! Starting execution...", "info");
					startExecution(ctx, false, planTodoListMessage);
					return;
				}
			} catch {}
		}

		// Prompt user in TUI
		const choice = await ctx.ui.select("Plan mode - what next?", [
			"Execute all steps (complete all by default)",
			"Execute step by step (pause after each step)",
			"Stay in plan mode",
			"Refine the plan",
		]);

		if (choice?.startsWith("Execute all steps") || choice?.startsWith("Execute the plan")) {
			startExecution(ctx, false, planTodoListMessage);
		} else if (choice?.startsWith("Execute step by step")) {
			startExecution(ctx, true, planTodoListMessage);
		} else if (choice === "Refine the plan") {
			const refinement = await ctx.ui.editor("Refine the plan:", "");
			if (refinement?.trim()) {
				pi.sendMessage(planTodoListMessage, { deliverAs: "followUp" });
				pi.sendUserMessage(refinement.trim(), { deliverAs: "followUp" });
			}
		}
	});

	// Restore state on session start/resume
	pi.on("session_start", async (_event, ctx) => {
		if (pi.getFlag("plan") === true) {
			planModeEnabled = true;
		}

		const entries = ctx.sessionManager.getEntries();

		// Restore persisted state
		const planModeEntry = entries
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "plan-mode")
			.pop() as { data?: PlanModeState } | undefined;

		if (planModeEntry?.data) {
			planModeEnabled = planModeEntry.data.enabled ?? planModeEnabled;
			todoItems = planModeEntry.data.todos ?? todoItems;
			executionMode = planModeEntry.data.executing ?? executionMode;
			stepByStepMode = planModeEntry.data.stepByStep ?? stepByStepMode;
			toolsBeforePlanMode = planModeEntry.data.toolsBeforePlanMode ?? toolsBeforePlanMode;
		}

		// On resume: re-scan messages to rebuild completion state
		const isResume = planModeEntry !== undefined;
		if (isResume && executionMode && todoItems.length > 0) {
			let executeIndex = -1;
			for (let i = entries.length - 1; i >= 0; i--) {
				const entry = entries[i] as { type: string; customType?: string };
				if (entry.customType === "plan-mode-execute") {
					executeIndex = i;
					break;
				}
			}

			const messages: AssistantMessage[] = [];
			for (let i = executeIndex + 1; i < entries.length; i++) {
				const entry = entries[i];
				if (entry.type === "message" && "message" in entry && isAssistantMessage(entry.message as AgentMessage)) {
					messages.push(entry.message as AssistantMessage);
				}
			}
			const allText = messages.map(getTextContent).join("\n");
			markCompletedSteps(allText, todoItems);
		}

		if (planModeEnabled) {
			enablePlanModeTools();
		}
		updateStatus(ctx);
	});
}
