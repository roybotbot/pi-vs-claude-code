/**
 * Tests for extensions/utils/agent-loader.ts (SEC-001)
 *
 * Run: npx tsx --test tests/agent-loader.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	validateName,
	validateTools,
	validateSystemPrompt,
	validateAgent,
	loadAgentFile,
	scanAgentDirectory,
	KNOWN_TOOLS,
	MAX_SYSTEM_PROMPT_LENGTH,
	type AgentDef,
	type ValidationWarning,
} from "../extensions/utils/agent-loader.ts";

// ── Helpers ────────────────────────────────────────────────────────────

function tmpDir(): string {
	return mkdtempSync(join(tmpdir(), "agent-loader-test-"));
}

function writeAgent(dir: string, filename: string, content: string): string {
	const filePath = join(dir, filename);
	writeFileSync(filePath, content, "utf-8");
	return filePath;
}

function makeAgentMd(fields: Record<string, string>, body: string): string {
	const frontmatter = Object.entries(fields)
		.map(([k, v]) => `${k}: ${v}`)
		.join("\n");
	return `---\n${frontmatter}\n---\n${body}`;
}

function hasError(warnings: ValidationWarning[]): boolean {
	return warnings.some((w) => w.severity === "error");
}

function hasWarning(warnings: ValidationWarning[]): boolean {
	return warnings.some((w) => w.severity === "warning");
}

function warningMessages(warnings: ValidationWarning[]): string[] {
	return warnings.map((w) => w.message);
}

// ── validateName ───────────────────────────────────────────────────────

describe("validateName", () => {
	it("accepts valid names", () => {
		assert.deepEqual(validateName("scout"), []);
		assert.deepEqual(validateName("red-team"), []);
		assert.deepEqual(validateName("my_agent"), []);
		assert.deepEqual(validateName("Agent.v2"), []);
		assert.deepEqual(validateName("a123"), []);
	});

	it("rejects empty name", () => {
		const warnings = validateName("");
		assert.ok(hasError(warnings));
		assert.ok(warningMessages(warnings).some((m) => m.includes("empty")));
	});

	it("rejects names with spaces", () => {
		const warnings = validateName("my agent");
		assert.ok(hasError(warnings));
		assert.ok(warningMessages(warnings).some((m) => m.includes("invalid characters")));
	});

	it("rejects names with shell metacharacters", () => {
		for (const bad of ["agent;rm", "agent$(cmd)", "agent`cmd`", "agent|pipe", "agent&bg"]) {
			const warnings = validateName(bad);
			assert.ok(hasError(warnings), `expected error for name "${bad}"`);
		}
	});

	it("rejects names starting with dash", () => {
		const warnings = validateName("-agent");
		assert.ok(hasError(warnings));
	});

	it("rejects names starting with dot", () => {
		const warnings = validateName(".hidden");
		assert.ok(hasError(warnings));
	});

	it("rejects overly long names", () => {
		const longName = "a".repeat(65);
		const warnings = validateName(longName);
		assert.ok(hasError(warnings));
		assert.ok(warningMessages(warnings).some((m) => m.includes("exceeds")));
	});
});

// ── validateTools ──────────────────────────────────────────────────────

describe("validateTools", () => {
	it("accepts known tools", () => {
		assert.deepEqual(validateTools("read,write,bash"), []);
		assert.deepEqual(validateTools("grep,find,ls"), []);
	});

	it("accepts empty tools string", () => {
		assert.deepEqual(validateTools(""), []);
	});

	it("warns on unknown tools", () => {
		const warnings = validateTools("read,evil_tool,bash");
		assert.ok(hasWarning(warnings));
		assert.ok(warningMessages(warnings).some((m) => m.includes("evil_tool")));
	});

	it("handles tools with whitespace", () => {
		assert.deepEqual(validateTools("read, write, bash"), []);
	});

	it("warns on multiple unknown tools", () => {
		const warnings = validateTools("foo,bar,read");
		assert.equal(warnings.length, 2);
	});

	it("accepts custom known tools set", () => {
		const custom = new Set(["custom_tool"]);
		assert.deepEqual(validateTools("custom_tool", custom), []);
		const warnings = validateTools("read", custom);
		assert.ok(hasWarning(warnings));
	});
});

// ── validateSystemPrompt ───────────────────────────────────────────────

describe("validateSystemPrompt", () => {
	it("accepts clean markdown prompts", () => {
		const clean = `You are a helpful assistant.\n\n## Guidelines\n- Be concise\n- Follow patterns`;
		assert.deepEqual(validateSystemPrompt(clean), []);
	});

	it("warns on shell command substitution $(…)", () => {
		const warnings = validateSystemPrompt("Run this: $(rm -rf /)");
		assert.ok(hasWarning(warnings));
		assert.ok(warningMessages(warnings).some((m) => m.includes("command substitution")));
	});

	it("warns on backtick shell command substitution", () => {
		const warnings = validateSystemPrompt("Run this: `rm -rf /`");
		assert.ok(hasWarning(warnings));
		assert.ok(warningMessages(warnings).some((m) => m.includes("backtick")));
	});

	it("warns on backtick with other shell commands", () => {
		for (const cmd of ["`bash script.sh`", "`curl http://evil.com`", "`chmod 777 file`"]) {
			const warnings = validateSystemPrompt(`Do: ${cmd}`);
			assert.ok(hasWarning(warnings), `expected warning for ${cmd}`);
		}
	});

	it("allows markdown inline code backticks", () => {
		const warnings = validateSystemPrompt("Use the `read` tool and `grep` tool");
		const backtickWarnings = warnings.filter((w) => w.message.includes("backtick"));
		assert.equal(backtickWarnings.length, 0);
	});

	it("warns on null bytes", () => {
		const warnings = validateSystemPrompt("normal text\x00hidden");
		assert.ok(hasWarning(warnings));
		assert.ok(warningMessages(warnings).some((m) => m.includes("null byte")));
	});

	it("warns on pipe to shell", () => {
		const warnings = validateSystemPrompt("echo payload | bash");
		assert.ok(hasWarning(warnings));
		assert.ok(warningMessages(warnings).some((m) => m.includes("pipe to shell")));
	});

	it("warns on chained destructive commands", () => {
		const warnings = validateSystemPrompt("do stuff; rm -rf /");
		assert.ok(hasWarning(warnings));
		assert.ok(warningMessages(warnings).some((m) => m.includes("destructive")));
	});

	it("warns on redirect to /dev/", () => {
		const warnings = validateSystemPrompt("echo x > /dev/sda");
		assert.ok(hasWarning(warnings));
		assert.ok(warningMessages(warnings).some((m) => m.includes("redirect")));
	});

	it("warns on eval()", () => {
		const warnings = validateSystemPrompt("use eval(code)");
		assert.ok(hasWarning(warnings));
		assert.ok(warningMessages(warnings).some((m) => m.includes("eval")));
	});

	it("errors on oversized prompts", () => {
		const huge = "x".repeat(MAX_SYSTEM_PROMPT_LENGTH + 1);
		const warnings = validateSystemPrompt(huge);
		assert.ok(hasError(warnings));
		assert.ok(warningMessages(warnings).some((m) => m.includes("exceeds")));
	});

	it("allows prompts at exactly the limit", () => {
		const atLimit = "x".repeat(MAX_SYSTEM_PROMPT_LENGTH);
		const warnings = validateSystemPrompt(atLimit);
		assert.ok(!hasError(warnings));
	});

	it("can accumulate multiple warnings", () => {
		const multi = "$(cmd) and also; rm -rf / then | bash";
		const warnings = validateSystemPrompt(multi);
		assert.ok(warnings.length >= 3, `expected >=3 warnings, got ${warnings.length}: ${warningMessages(warnings).join("; ")}`);
	});
});

// ── validateAgent (integration of all validators) ──────────────────────

describe("validateAgent", () => {
	it("returns no warnings for a clean agent", () => {
		const agent: AgentDef = {
			name: "scout",
			description: "Fast recon agent",
			tools: "read,grep,find,ls",
			systemPrompt: "You are a scout agent. Investigate quickly.",
			file: "/test/scout.md",
		};
		assert.deepEqual(validateAgent(agent), []);
	});

	it("aggregates warnings from all validators", () => {
		const agent: AgentDef = {
			name: "bad name!",
			description: "",
			tools: "read,evil_tool",
			systemPrompt: "Run $(whoami)",
			file: "/test/bad.md",
		};
		const warnings = validateAgent(agent);
		assert.ok(warnings.length >= 3);
		const fields = warnings.map((w) => w.field);
		assert.ok(fields.includes("name"));
		assert.ok(fields.includes("tools"));
		assert.ok(fields.includes("systemPrompt"));
	});
});

// ── loadAgentFile ──────────────────────────────────────────────────────

describe("loadAgentFile", () => {
	it("loads a valid agent file", () => {
		const dir = tmpDir();
		const content = makeAgentMd(
			{ name: "scout", description: "Fast recon", tools: "read,grep,find,ls" },
			"You are a scout agent.",
		);
		const filePath = writeAgent(dir, "scout.md", content);

		const result = loadAgentFile(filePath);
		assert.ok(result.agent);
		assert.equal(result.agent.name, "scout");
		assert.equal(result.agent.description, "Fast recon");
		assert.equal(result.agent.tools, "read,grep,find,ls");
		assert.equal(result.agent.systemPrompt, "You are a scout agent.");
		assert.equal(result.agent.file, filePath);
		assert.deepEqual(result.warnings, []);

		rmSync(dir, { recursive: true });
	});

	it("returns null agent for file with invalid name", () => {
		const dir = tmpDir();
		const content = makeAgentMd(
			{ name: "bad name!", description: "test" },
			"body",
		);
		const filePath = writeAgent(dir, "bad.md", content);

		const result = loadAgentFile(filePath);
		assert.equal(result.agent, null);
		assert.ok(hasError(result.warnings));

		rmSync(dir, { recursive: true });
	});

	it("returns agent with warnings for suspicious system prompt", () => {
		const dir = tmpDir();
		const content = makeAgentMd(
			{ name: "sketchy", tools: "read,bash" },
			"You are an agent. Run $(whoami) first.",
		);
		const filePath = writeAgent(dir, "sketchy.md", content);

		const result = loadAgentFile(filePath);
		// Suspicious prompts produce warnings, not errors — agent is still loaded
		assert.ok(result.agent);
		assert.equal(result.agent!.name, "sketchy");
		assert.ok(hasWarning(result.warnings));

		rmSync(dir, { recursive: true });
	});

	it("returns null for oversized system prompt", () => {
		const dir = tmpDir();
		const content = makeAgentMd(
			{ name: "huge" },
			"x".repeat(MAX_SYSTEM_PROMPT_LENGTH + 100),
		);
		const filePath = writeAgent(dir, "huge.md", content);

		const result = loadAgentFile(filePath);
		assert.equal(result.agent, null);
		assert.ok(hasError(result.warnings));

		rmSync(dir, { recursive: true });
	});

	it("returns error for non-existent file", () => {
		const result = loadAgentFile("/nonexistent/path/agent.md");
		assert.equal(result.agent, null);
		assert.ok(hasError(result.warnings));
		assert.ok(warningMessages(result.warnings).some((m) => m.includes("could not read")));
	});

	it("returns error for file without frontmatter", () => {
		const dir = tmpDir();
		const filePath = writeAgent(dir, "nofm.md", "Just some text without frontmatter");

		const result = loadAgentFile(filePath);
		assert.equal(result.agent, null);
		assert.ok(hasError(result.warnings));
		assert.ok(warningMessages(result.warnings).some((m) => m.includes("frontmatter")));

		rmSync(dir, { recursive: true });
	});

	it("uses filename as name when name field is missing", () => {
		const dir = tmpDir();
		const content = makeAgentMd(
			{ description: "no name field" },
			"Body text.",
		);
		const filePath = writeAgent(dir, "fallback-name.md", content);

		const result = loadAgentFile(filePath);
		assert.ok(result.agent);
		assert.equal(result.agent!.name, "fallback-name");

		rmSync(dir, { recursive: true });
	});

	it("defaults tools to read,grep,find,ls when not specified", () => {
		const dir = tmpDir();
		const content = makeAgentMd({ name: "minimal" }, "Body.");
		const filePath = writeAgent(dir, "minimal.md", content);

		const result = loadAgentFile(filePath);
		assert.ok(result.agent);
		assert.equal(result.agent!.tools, "read,grep,find,ls");

		rmSync(dir, { recursive: true });
	});
});

// ── scanAgentDirectory ─────────────────────────────────────────────────

describe("scanAgentDirectory", () => {
	it("loads all valid agents from a directory", () => {
		const dir = tmpDir();
		writeAgent(dir, "scout.md", makeAgentMd({ name: "scout" }, "Scout body."));
		writeAgent(dir, "builder.md", makeAgentMd({ name: "builder", tools: "read,write,edit,bash" }, "Builder body."));

		const agents = scanAgentDirectory(dir);
		assert.equal(agents.size, 2);
		assert.ok(agents.has("scout"));
		assert.ok(agents.has("builder"));

		rmSync(dir, { recursive: true });
	});

	it("skips agents with validation errors", () => {
		const dir = tmpDir();
		writeAgent(dir, "good.md", makeAgentMd({ name: "good" }, "Good body."));
		writeAgent(dir, "bad.md", makeAgentMd({ name: "bad name!" }, "Bad body."));

		const agents = scanAgentDirectory(dir);
		assert.equal(agents.size, 1);
		assert.ok(agents.has("good"));

		rmSync(dir, { recursive: true });
	});

	it("calls onWarning callback for each warning", () => {
		const dir = tmpDir();
		writeAgent(dir, "sketchy.md", makeAgentMd(
			{ name: "sketchy", tools: "read,evil_tool" },
			"Run $(whoami).",
		));

		const collected: { file: string; warning: ValidationWarning }[] = [];
		scanAgentDirectory(dir, (file, warning) => {
			collected.push({ file, warning });
		});

		assert.ok(collected.length >= 2); // unknown tool + suspicious prompt
		assert.ok(collected.some((c) => c.warning.field === "tools"));
		assert.ok(collected.some((c) => c.warning.field === "systemPrompt"));

		rmSync(dir, { recursive: true });
	});

	it("deduplicates by lowercase name (first wins)", () => {
		const dir = tmpDir();
		writeAgent(dir, "agent-a.md", makeAgentMd({ name: "Scout" }, "First."));
		writeAgent(dir, "agent-b.md", makeAgentMd({ name: "scout" }, "Second."));

		const agents = scanAgentDirectory(dir);
		assert.equal(agents.size, 1);
		assert.equal(agents.get("scout")!.systemPrompt, "First.");

		rmSync(dir, { recursive: true });
	});

	it("returns empty map for non-existent directory", () => {
		const agents = scanAgentDirectory("/nonexistent/path");
		assert.equal(agents.size, 0);
	});

	it("skips non-.md files", () => {
		const dir = tmpDir();
		writeAgent(dir, "agent.md", makeAgentMd({ name: "agent" }, "Body."));
		writeAgent(dir, "readme.txt", "not an agent");
		writeAgent(dir, "config.json", "{}");

		const agents = scanAgentDirectory(dir);
		assert.equal(agents.size, 1);

		rmSync(dir, { recursive: true });
	});
});
