/**
 * Tests for extensions/utils/subprocess-env.ts (SEC-002)
 *
 * Run: npx tsx --test tests/subprocess-env.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	extractProvider,
	getProviderKeyName,
	parseAgentEnvField,
	buildSubprocessEnv,
	describeEnv,
	detectCredentialFailure,
} from "../extensions/utils/subprocess-env.ts";

// ── extractProvider ────────────────────────────────────────────────────

describe("extractProvider", () => {
	it("extracts anthropic from model string", () => {
		assert.equal(extractProvider("anthropic/claude-sonnet-4"), "anthropic");
	});

	it("extracts openrouter from compound model string", () => {
		assert.equal(extractProvider("openrouter/google/gemini-3-flash-preview"), "openrouter");
	});

	it("extracts google", () => {
		assert.equal(extractProvider("google/gemini-2.5-pro"), "google");
	});

	it("extracts openai", () => {
		assert.equal(extractProvider("openai/gpt-4o"), "openai");
	});

	it("returns null for model without slash", () => {
		assert.equal(extractProvider("claude-sonnet-4"), null);
	});

	it("returns null for empty string", () => {
		assert.equal(extractProvider(""), null);
	});

	it("is case-insensitive", () => {
		assert.equal(extractProvider("Anthropic/claude-sonnet-4"), "anthropic");
	});
});

// ── getProviderKeyName ─────────────────────────────────────────────────

describe("getProviderKeyName", () => {
	it("maps anthropic to ANTHROPIC_API_KEY", () => {
		assert.equal(getProviderKeyName("anthropic"), "ANTHROPIC_API_KEY");
	});

	it("maps openai to OPENAI_API_KEY", () => {
		assert.equal(getProviderKeyName("openai"), "OPENAI_API_KEY");
	});

	it("maps google to GEMINI_API_KEY", () => {
		assert.equal(getProviderKeyName("google"), "GEMINI_API_KEY");
	});

	it("maps openrouter to OPENROUTER_API_KEY", () => {
		assert.equal(getProviderKeyName("openrouter"), "OPENROUTER_API_KEY");
	});

	it("returns null for unknown provider", () => {
		assert.equal(getProviderKeyName("mistral"), null);
	});
});

// ── parseAgentEnvField ─────────────────────────────────────────────────

describe("parseAgentEnvField", () => {
	it("parses comma-separated vars", () => {
		assert.deepEqual(parseAgentEnvField("NPM_TOKEN, GITHUB_TOKEN"), ["NPM_TOKEN", "GITHUB_TOKEN"]);
	});

	it("parses single var", () => {
		assert.deepEqual(parseAgentEnvField("FIRECRAWL_API_KEY"), ["FIRECRAWL_API_KEY"]);
	});

	it("handles space-separated vars", () => {
		assert.deepEqual(parseAgentEnvField("NPM_TOKEN GITHUB_TOKEN"), ["NPM_TOKEN", "GITHUB_TOKEN"]);
	});

	it("handles mixed separators", () => {
		assert.deepEqual(parseAgentEnvField("A, B C"), ["A", "B", "C"]);
	});

	it("returns empty array for undefined", () => {
		assert.deepEqual(parseAgentEnvField(undefined), []);
	});

	it("returns empty array for empty string", () => {
		assert.deepEqual(parseAgentEnvField(""), []);
	});

	it("trims whitespace", () => {
		assert.deepEqual(parseAgentEnvField("  NPM_TOKEN ,  GITHUB_TOKEN  "), ["NPM_TOKEN", "GITHUB_TOKEN"]);
	});
});

// ── buildSubprocessEnv ─────────────────────────────────────────────────

describe("buildSubprocessEnv", () => {
	const fakeParent: Record<string, string> = {
		PATH: "/usr/bin:/usr/local/bin",
		HOME: "/home/test",
		TERM: "xterm-256color",
		LANG: "en_US.UTF-8",
		SHELL: "/bin/zsh",
		USER: "test",
		TMPDIR: "/tmp",
		ANTHROPIC_API_KEY: "sk-ant-secret",
		OPENAI_API_KEY: "sk-openai-secret",
		GEMINI_API_KEY: "AIza-secret",
		OPENROUTER_API_KEY: "sk-or-secret",
		FIRECRAWL_API_KEY: "fc-secret",
		NPM_TOKEN: "npm-secret",
		AWS_SECRET_ACCESS_KEY: "aws-secret",
		GITHUB_TOKEN: "ghp-secret",
		SOME_RANDOM_VAR: "random",
	};

	it("includes system essentials", () => {
		const env = buildSubprocessEnv("anthropic/claude-sonnet-4", undefined, fakeParent);
		assert.equal(env.PATH, fakeParent.PATH);
		assert.equal(env.HOME, fakeParent.HOME);
		assert.equal(env.TERM, fakeParent.TERM);
		assert.equal(env.LANG, fakeParent.LANG);
		assert.equal(env.SHELL, fakeParent.SHELL);
		assert.equal(env.USER, fakeParent.USER);
		assert.equal(env.TMPDIR, fakeParent.TMPDIR);
	});

	it("includes only the correct API key for anthropic", () => {
		const env = buildSubprocessEnv("anthropic/claude-sonnet-4", undefined, fakeParent);
		assert.equal(env.ANTHROPIC_API_KEY, "sk-ant-secret");
		assert.equal(env.OPENAI_API_KEY, undefined);
		assert.equal(env.GEMINI_API_KEY, undefined);
		assert.equal(env.OPENROUTER_API_KEY, undefined);
	});

	it("includes only the correct API key for openai", () => {
		const env = buildSubprocessEnv("openai/gpt-4o", undefined, fakeParent);
		assert.equal(env.OPENAI_API_KEY, "sk-openai-secret");
		assert.equal(env.ANTHROPIC_API_KEY, undefined);
	});

	it("includes only the correct API key for google", () => {
		const env = buildSubprocessEnv("google/gemini-2.5-pro", undefined, fakeParent);
		assert.equal(env.GEMINI_API_KEY, "AIza-secret");
		assert.equal(env.ANTHROPIC_API_KEY, undefined);
	});

	it("includes only the correct API key for openrouter", () => {
		const env = buildSubprocessEnv("openrouter/google/gemini-3-flash", undefined, fakeParent);
		assert.equal(env.OPENROUTER_API_KEY, "sk-or-secret");
		assert.equal(env.ANTHROPIC_API_KEY, undefined);
	});

	it("excludes all non-essential vars", () => {
		const env = buildSubprocessEnv("anthropic/claude-sonnet-4", undefined, fakeParent);
		assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
		assert.equal(env.GITHUB_TOKEN, undefined);
		assert.equal(env.NPM_TOKEN, undefined);
		assert.equal(env.FIRECRAWL_API_KEY, undefined);
		assert.equal(env.SOME_RANDOM_VAR, undefined);
	});

	it("includes extra vars from agent env field", () => {
		const env = buildSubprocessEnv("anthropic/claude-sonnet-4", "FIRECRAWL_API_KEY, NPM_TOKEN", fakeParent);
		assert.equal(env.ANTHROPIC_API_KEY, "sk-ant-secret");
		assert.equal(env.FIRECRAWL_API_KEY, "fc-secret");
		assert.equal(env.NPM_TOKEN, "npm-secret");
		// Still excludes non-requested vars
		assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
		assert.equal(env.GITHUB_TOKEN, undefined);
	});

	it("skips extra vars that don't exist in parent", () => {
		const env = buildSubprocessEnv("anthropic/claude-sonnet-4", "NONEXISTENT_VAR", fakeParent);
		assert.equal(env.NONEXISTENT_VAR, undefined);
		assert.equal(Object.keys(env).includes("NONEXISTENT_VAR"), false);
	});

	it("handles unknown provider gracefully", () => {
		const env = buildSubprocessEnv("mistral/mistral-large", undefined, fakeParent);
		// System essentials are still there
		assert.equal(env.PATH, fakeParent.PATH);
		assert.equal(env.HOME, fakeParent.HOME);
		// No API keys
		assert.equal(env.ANTHROPIC_API_KEY, undefined);
		assert.equal(env.OPENAI_API_KEY, undefined);
	});

	it("handles model without slash", () => {
		const env = buildSubprocessEnv("claude-sonnet-4", undefined, fakeParent);
		assert.equal(env.PATH, fakeParent.PATH);
		// No provider extracted, no key included
		assert.equal(env.ANTHROPIC_API_KEY, undefined);
	});

	it("handles missing parent vars gracefully", () => {
		const sparseParent: Record<string, string> = {
			PATH: "/usr/bin",
			ANTHROPIC_API_KEY: "key",
		};
		const env = buildSubprocessEnv("anthropic/claude-sonnet-4", undefined, sparseParent);
		assert.equal(env.PATH, "/usr/bin");
		assert.equal(env.ANTHROPIC_API_KEY, "key");
		assert.equal(env.HOME, undefined);
		assert.equal(env.TERM, undefined);
	});
});

// ── describeEnv ────────────────────────────────────────────────────────

describe("describeEnv", () => {
	it("lists non-system vars", () => {
		const env: Record<string, string> = {
			PATH: "/usr/bin",
			HOME: "/home/test",
			ANTHROPIC_API_KEY: "key",
			NPM_TOKEN: "token",
		};
		const keys = describeEnv(env);
		assert.ok(keys.includes("ANTHROPIC_API_KEY"));
		assert.ok(keys.includes("NPM_TOKEN"));
		assert.ok(!keys.includes("PATH"));
		assert.ok(!keys.includes("HOME"));
	});

	it("returns empty for system-only env", () => {
		const env: Record<string, string> = {
			PATH: "/usr/bin",
			HOME: "/home/test",
		};
		assert.deepEqual(describeEnv(env), []);
	});
});

// ── detectCredentialFailure ────────────────────────────────────────────

describe("detectCredentialFailure", () => {
	const sampleEnv: Record<string, string> = {
		PATH: "/usr/bin",
		HOME: "/home/test",
		ANTHROPIC_API_KEY: "key",
	};

	it("detects 401 unauthorized", () => {
		const msg = detectCredentialFailure("HTTP 401 Unauthorized", "builder", sampleEnv);
		assert.ok(msg);
		assert.ok(msg.includes("builder"));
		assert.ok(msg.includes("ANTHROPIC_API_KEY"));
	});

	it("detects 403 forbidden", () => {
		const msg = detectCredentialFailure("Error: 403 Forbidden", "scout", sampleEnv);
		assert.ok(msg);
		assert.ok(msg.includes("scout"));
	});

	it("detects authentication failed", () => {
		const msg = detectCredentialFailure("fatal: Authentication failed for repo", "builder", sampleEnv);
		assert.ok(msg);
	});

	it("detects API key missing", () => {
		const msg = detectCredentialFailure("Error: API key not found for provider", "expert", sampleEnv);
		assert.ok(msg);
	});

	it("detects No API key", () => {
		const msg = detectCredentialFailure("No API key found for anthropic.", "expert", sampleEnv);
		assert.ok(msg);
	});

	it("detects token expired", () => {
		const msg = detectCredentialFailure("npm ERR! token expired", "builder", sampleEnv);
		assert.ok(msg);
	});

	it("detects credentials missing", () => {
		const msg = detectCredentialFailure("Error: credentials not found", "builder", sampleEnv);
		assert.ok(msg);
	});

	it("returns null for non-credential errors", () => {
		const msg = detectCredentialFailure("SyntaxError: Unexpected token", "builder", sampleEnv);
		assert.equal(msg, null);
	});

	it("returns null for empty output", () => {
		assert.equal(detectCredentialFailure("", "builder", sampleEnv), null);
	});

	it("includes frontmatter hint in message", () => {
		const msg = detectCredentialFailure("401 Unauthorized", "builder", sampleEnv);
		assert.ok(msg!.includes("env:"));
		assert.ok(msg!.includes("frontmatter"));
	});

	it("shows correct passed keys in message", () => {
		const envWithExtras: Record<string, string> = {
			PATH: "/usr/bin",
			ANTHROPIC_API_KEY: "key",
			FIRECRAWL_API_KEY: "fc",
		};
		const msg = detectCredentialFailure("401 Unauthorized", "expert", envWithExtras);
		assert.ok(msg!.includes("ANTHROPIC_API_KEY"));
		assert.ok(msg!.includes("FIRECRAWL_API_KEY"));
	});

	it("handles env with no API keys", () => {
		const bareEnv: Record<string, string> = { PATH: "/usr/bin", HOME: "/home" };
		const msg = detectCredentialFailure("401 Unauthorized", "agent", bareEnv);
		assert.ok(msg!.includes("no API keys"));
	});
});
