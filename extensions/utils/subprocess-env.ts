/**
 * subprocess-env.ts — Minimal environment builder for subprocesses
 *
 * SEC-002: Subprocesses should only receive the env vars they need,
 * not the entire parent environment. This module builds a minimal
 * environment with system essentials + the correct API key for the
 * selected model provider, plus any extra vars declared by the agent.
 *
 * Usage:
 *   import { buildSubprocessEnv, detectCredentialFailure } from "./utils/subprocess-env.ts";
 *
 *   const env = buildSubprocessEnv(modelString, agentEnvField);
 *   spawn("pi", args, { env });
 *
 *   // After process exits with error:
 *   const diagnostic = detectCredentialFailure(stderr, agentName, env);
 *   if (diagnostic) ctx.ui.notify(diagnostic, "warning");
 */

// ── Provider → env var mapping ─────────────────────────────────────────

const PROVIDER_KEY_MAP: Record<string, string> = {
	"anthropic": "ANTHROPIC_API_KEY",
	"openai": "OPENAI_API_KEY",
	"google": "GEMINI_API_KEY",
	"openrouter": "OPENROUTER_API_KEY",
};

/** All API key env var names we know about. */
const ALL_API_KEYS = new Set(Object.values(PROVIDER_KEY_MAP));

/** System essentials that every subprocess needs to function. */
const SYSTEM_VARS = ["PATH", "HOME", "TERM", "LANG", "SHELL", "USER", "TMPDIR"];

// ── Credential failure patterns ────────────────────────────────────────

const CREDENTIAL_PATTERNS = [
	/\b401\b/i,
	/\b403\b/i,
	/unauthorized/i,
	/authentication failed/i,
	/api[_ -]?key[_ -]?(not|missing|invalid|required)/i,
	/no api key/i,
	/access denied/i,
	/permission denied/i,
	/EACCES/,
	/token[_ -]?(expired|invalid|missing|required)/i,
	/credentials?[_ -]?(not|missing|invalid|required)/i,
];

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Extract the provider prefix from a model string.
 *
 * Examples:
 *   "anthropic/claude-sonnet-4" → "anthropic"
 *   "openrouter/google/gemini-3-flash-preview" → "openrouter"
 *   "google/gemini-2.5-pro" → "google"
 */
export function extractProvider(model: string): string | null {
	if (!model) return null;
	const slash = model.indexOf("/");
	if (slash === -1) return null;
	return model.slice(0, slash).toLowerCase();
}

/**
 * Get the env var name for a provider.
 *
 * Returns null if the provider is unknown.
 */
export function getProviderKeyName(provider: string): string | null {
	return PROVIDER_KEY_MAP[provider] ?? null;
}

/**
 * Parse the `env` frontmatter field from an agent definition.
 *
 * Accepts comma-separated or space-separated var names:
 *   "NPM_TOKEN, GITHUB_TOKEN" → ["NPM_TOKEN", "GITHUB_TOKEN"]
 *   "FIRECRAWL_API_KEY" → ["FIRECRAWL_API_KEY"]
 *   "" or undefined → []
 */
export function parseAgentEnvField(envField: string | undefined): string[] {
	if (!envField) return [];
	return envField
		.split(/[,\s]+/)
		.map((s) => s.trim())
		.filter(Boolean);
}

/**
 * Build a minimal environment for a subprocess.
 *
 * @param model      Model string like "anthropic/claude-sonnet-4"
 * @param agentEnv   Optional comma-separated env var names from agent frontmatter
 * @param parentEnv  Source environment (defaults to process.env)
 * @returns          A minimal env object for spawn()
 */
export function buildSubprocessEnv(
	model: string,
	agentEnv?: string,
	parentEnv: Record<string, string | undefined> = process.env,
): Record<string, string> {
	const env: Record<string, string> = {};

	// 1. System essentials
	for (const key of SYSTEM_VARS) {
		if (parentEnv[key]) {
			env[key] = parentEnv[key]!;
		}
	}

	// 2. The API key for the selected model provider
	const provider = extractProvider(model);
	if (provider) {
		const keyName = getProviderKeyName(provider);
		if (keyName && parentEnv[keyName]) {
			env[keyName] = parentEnv[keyName]!;
		}
	}

	// 3. Extra vars declared by the agent
	const extras = parseAgentEnvField(agentEnv);
	for (const varName of extras) {
		if (parentEnv[varName]) {
			env[varName] = parentEnv[varName]!;
		}
	}

	return env;
}

/**
 * Get a human-readable list of which env vars were passed to a subprocess.
 */
export function describeEnv(env: Record<string, string>): string[] {
	return Object.keys(env).filter((k) => !SYSTEM_VARS.includes(k));
}

/**
 * Scan subprocess output for credential-related failure patterns.
 *
 * Returns a diagnostic message if a credential failure is detected,
 * or null if the output doesn't look like a credential problem.
 *
 * @param output     Combined stdout+stderr from the failed subprocess
 * @param agentName  Name of the agent that failed (for the message)
 * @param env        The env object that was passed to the subprocess
 */
export function detectCredentialFailure(
	output: string,
	agentName: string,
	env: Record<string, string>,
): string | null {
	if (!output) return null;

	const matched = CREDENTIAL_PATTERNS.some((p) => p.test(output));
	if (!matched) return null;

	const passedKeys = describeEnv(env);
	const passedList = passedKeys.length > 0
		? passedKeys.map((k) => `\`${k}\``).join(", ")
		: "no API keys";

	return (
		`Subagent "${agentName}" failed with what looks like a missing credential.\n` +
		`Only ${passedList} ${passedKeys.length === 1 ? "was" : "were"} passed to this subprocess.\n` +
		`If this agent needs additional env vars, add them to the \`env\` field in its agent .md frontmatter:\n` +
		`\n` +
		`  env: NPM_TOKEN, GITHUB_TOKEN`
	);
}
