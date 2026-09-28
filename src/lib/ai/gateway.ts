/**
 * AI Gateway (§8.6)
 * ---------------------------------------------------------------------------
 * Every model call in TaskNote Plus goes through this module.
 *
 * Supported providers, in automatic priority order:
 *   1. Groq          — free tier, OpenAI-compatible, very fast
 *   2. Google AI     — Gemini free tier
 *   3. OpenRouter    — hosts explicitly free models (":free" suffix)
 *   4. Ollama        — fully local, no key, no data leaves the machine (§8.7)
 *
 * If none are configured the gateway returns { available: false } and every
 * caller MUST degrade gracefully — §8.11 requires that no core user flow
 * (capture, edit, complete a task) ever hard-depends on AI.
 */

export type ProviderId = "groq" | "google" | "openrouter" | "ollama";

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Present on assistant turns that requested tools. */
  tool_calls?: ToolCall[];
  /** Present on `role: "tool"` turns, linking the result to its request. */
  tool_call_id?: string;
  name?: string;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

/** Minimal OpenAI-style function schema, enough for chat-completions tools. */
export type ToolSpec = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type GenerateOptions = {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Ask the provider for strict JSON where supported. */
  json?: boolean;
  /** Advertise callable tools (OpenAI-compatible providers only). */
  tools?: ToolSpec[];
  toolChoice?: "auto" | "none";
  signal?: AbortSignal;
};

export type GenerateResult = {
  available: boolean;
  text: string;
  provider: ProviderId | "none";
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  error?: string;
  /** Tool calls the model asked for, if any. */
  toolCalls: ToolCall[];
};

/** True when the provider speaks the OpenAI chat-completions wire format. */
export function supportsTools(provider: ProviderId): boolean {
  return provider === "groq" || provider === "openrouter";
}

/**
 * True when ANY configured provider can call tools. Tool use is a capability of
 * the gateway, not of whichever provider happens to answer first: if Groq is
 * rate-limited and we fail over to Google mid-conversation, we still want the
 * loop to have been entered so a later round can execute a tool call.
 */
export function anyProviderSupportsTools(): boolean {
  return configuredProviders().some((p) => supportsTools(p.id));
}

type ProviderConfig = {
  id: ProviderId;
  label: string;
  model: string;
  configured: boolean;
};

/** All configured providers, in priority order. */
function configuredProviders(): ProviderConfig[] {
  const preferred = process.env.AI_PROVIDER?.trim() as ProviderId | "" | undefined;
  const all: ProviderConfig[] = [
    {
      id: "groq",
      label: "Groq",
      // Groq retires model names periodically and access is per-account, so the
      // default is overridable with GROQ_MODEL. `openai/gpt-oss-120b` is the
      // current flagship and is reachable on free-tier keys.
      model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
      configured: Boolean(process.env.GROQ_API_KEY?.trim()),
    },
    {
      id: "google",
      label: "Google AI",
      // Google retires dated snapshots for new keys (gemini-2.0-flash and
      // gemini-2.5-flash now 404 with "no longer available to new users"). The
      // `-latest` aliases are the stable choice: they track the current model
      // instead of pinning a snapshot that will be withdrawn.
      model: process.env.GOOGLE_MODEL || "gemini-flash-latest",
      configured: Boolean(process.env.GOOGLE_AI_API_KEY?.trim()),
    },
    {
      id: "openrouter",
      label: "OpenRouter",
      model: process.env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free",
      configured: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
    },
    {
      id: "ollama",
      label: "Ollama (local)",
      model: process.env.OLLAMA_MODEL || "llama3.2",
      configured: Boolean(process.env.OLLAMA_BASE_URL?.trim()),
    },
  ];

  const available = all.filter((c) => c.configured);
  if (available.length === 0) return [];

  // AI_PROVIDER expresses a PREFERENCE, not an exclusive choice: the named
  // provider is tried first, then the rest still act as fallbacks. Treating it
  // as exclusive would silently disable the free-model failover the user relies
  // on when a provider goes down.
  if (preferred) {
    const first = available.find((c) => c.id === preferred);
    if (first) return [first, ...available.filter((c) => c.id !== preferred)];
  }
  return available;
}

export function resolveProvider(): ProviderConfig | null {
  return configuredProviders()[0] ?? null;
}

export function aiStatus() {
  const providers = configuredProviders();
  const provider = providers[0] ?? null;

  // The full ordered chain the assistant will walk before giving up — all free
  // models, so the user can see there is redundancy if one goes down.
  const chain = providers.flatMap((p) =>
    [p.model, ...FALLBACK_MODELS[p.id]].filter((m, i, all) => m && all.indexOf(m) === i),
  );

  return {
    available: Boolean(provider),
    provider: provider?.id ?? ("none" as const),
    model: provider?.model ?? "",
    label: provider?.label ?? "Not configured",
    /** Every provider that has credentials, in priority order. */
    providers: providers.map((p) => ({ id: p.id, label: p.label, model: p.model })),
    /** Every model that will be attempted, in order. */
    chain,
    providerCount: providers.length,
  };
}

/**
 * Fallback chat models per provider. Groq in particular retires model names
 * with little notice, and a key may lack access to the configured default.
 * Every entry here must be usable on a FREE tier — the assistant is meant to
 * run at no cost, so we never fall back onto a paid model.
 */
const FALLBACK_MODELS: Record<ProviderId, string[]> = {
  // Ordered fastest/cheapest first. The gpt-oss models are REASONING models:
  // they spend the token budget on hidden `reasoning` content, so with a small
  // max_tokens they return an empty `content` and finish_reason "length". They
  // are kept last so a normal model answers first, and the empty-response guard
  // in generate() advances past them if the budget is tight.
  groq: [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "qwen/qwen3.8-27b",
    "gemma2-9b-it",
    "allam-2-7b",
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
  ],
  // `-latest` aliases first so a retired snapshot cannot take the chain down,
  // then a couple of explicit current models as a cross-check.
  google: [
    "gemini-flash-latest",
    "gemini-flash-lite-latest",
    "gemini-3.8-flash",
    "gemini-3.5-flash",
    "gemini-2.5-flash-lite",
  ],
  openrouter: [
    "meta-llama/llama-3.3-70b-instruct:free",
    "google/gemma-2-9b-it:free",
    "mistralai/mistral-7b-instruct:free",
    "qwen/qwen-2.5-72b-instruct:free",
    "deepseek/deepseek-chat-v3.1:free",
  ],
  ollama: [],
};

/** True when the error means "this specific model is unusable here". */
function isModelUnavailable(message: string): boolean {
  return /model_not_found|does not exist|not have access|not found|404|decommissioned|deprecated|no longer supported/i.test(
    message,
  );
}

/**
 * True when retrying the SAME provider on a DIFFERENT model is worth it:
 * rate limits, timeouts and capacity errors are often per-model on free tiers,
 * so another model on the same key can still succeed.
 */
function isRetriable(message: string): boolean {
  return (
    isModelUnavailable(message) ||
    /\b429\b|rate.?limit|too many requests|quota|overloaded|capacity|timeout|timed out|aborted|503|502|500|unavailable/i.test(
      message,
    )
  );
}

/** Wall-clock ceiling for one provider call, so a hung model cannot stall the UI. */
const REQUEST_TIMEOUT_MS = 25_000;

/** Provider-agnostic entry point. Never throws — failures come back in-band. */
export async function generate(options: GenerateOptions): Promise<GenerateResult> {
  const providers = configuredProviders();
  const started = Date.now();

  if (providers.length === 0) {
    return {
      available: false,
      text: "",
      provider: "none",
      model: "",
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: 0,
      error: "No AI provider configured",
      toolCalls: [],
    };
  }

  let lastError = "Unknown AI error";
  let lastProvider = providers[0];

  // Walk every provider, and within each provider every free model, until one
  // answers. This is what makes the assistant survive a dead, rate-limited or
  // hung model without the user noticing.
  for (const provider of providers) {
    lastProvider = provider;

    const attempts = [provider.model, ...FALLBACK_MODELS[provider.id]].filter(
      (m, i, all) => m && all.indexOf(m) === i,
    );

    for (const model of attempts) {
      const attempt: ProviderConfig = { ...provider, model };

      // Per-request timeout so a hung model cannot stall the whole reply.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const signal = options.signal ?? controller.signal;

      try {
        const withSignal: GenerateOptions = { ...options, signal };
        let outcome: GenerateResult | null = null;
        switch (provider.id) {
          case "groq":
            outcome = await callOpenAICompatible(
              "https://api.groq.com/openai/v1/chat/completions",
              process.env.GROQ_API_KEY!,
              attempt,
              withSignal,
              started,
            );
            break;
          case "openrouter":
            outcome = await callOpenAICompatible(
              "https://openrouter.ai/api/v1/chat/completions",
              process.env.OPENROUTER_API_KEY!,
              attempt,
              withSignal,
              started,
            );
            break;
          case "google":
            outcome = await callGoogle(attempt, withSignal, started);
            break;
          case "ollama":
            outcome = await callOllama(attempt, withSignal, started);
            break;
        }

        // An HTTP 200 that carries neither prose nor a tool call is a silent
        // failure, not an answer — some free models do this when they hit an
        // internal guard. Returning it would strand the user on an empty reply,
        // so keep walking the chain instead.
        if (outcome && outcome.available) {
          if (outcome.text.length > 0 || outcome.toolCalls.length > 0) return outcome;
          lastError = `${provider.label} ${model}: empty response`;
          continue;
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Unknown AI error";
        // A rate limit, timeout or missing model is worth trying elsewhere.
        // An auth failure would fail identically, so stop this provider and
        // let the next configured provider be tried.
        if (!isRetriable(lastError)) break;
      } finally {
        clearTimeout(timer);
      }
    }
  }

  return {
    available: false,
    text: "",
    provider: lastProvider.id,
    model: lastProvider.model,
    tokensIn: 0,
    tokensOut: 0,
    latencyMs: Date.now() - started,
    error: lastError,
    toolCalls: [],
  };
}

async function callOpenAICompatible(
  url: string,
  apiKey: string,
  provider: ProviderConfig,
  options: GenerateOptions,
  started: number,
): Promise<GenerateResult> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(provider.id === "openrouter"
        ? { "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000" }
        : {}),
    },
    body: JSON.stringify({
      model: provider.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.4,
      max_tokens: options.maxTokens ?? 1200,
      ...(options.json ? { response_format: { type: "json_object" } } : {}),
      ...(options.tools && options.tools.length > 0
        ? { tools: options.tools, tool_choice: options.toolChoice ?? "auto" }
        : {}),
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`${provider.label} ${response.status}: ${detail.slice(0, 240)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{
      message?: { content?: string | null; tool_calls?: ToolCall[] };
      finish_reason?: string;
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const message = data.choices?.[0]?.message;
  const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];

  return {
    available: true,
    text: (message?.content ?? "").trim(),
    provider: provider.id,
    model: provider.model,
    tokensIn: data.usage?.prompt_tokens ?? 0,
    tokensOut: data.usage?.completion_tokens ?? 0,
    latencyMs: Date.now() - started,
    toolCalls,
  };
}

async function callGoogle(
  provider: ProviderConfig,
  options: GenerateOptions,
  started: number,
): Promise<GenerateResult> {
  const apiKey = process.env.GOOGLE_AI_API_KEY!;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${provider.model}:generateContent?key=${apiKey}`;

  const systemParts = options.messages.filter((m) => m.role === "system").map((m) => m.content);
  // generateContent has no tool-call shape, so drop `tool` turns entirely rather
  // than mapping them to "user" — mislabelling a tool result as a user message
  // would make failover mid-tool-loop read as if the user said it.
  const contents = options.messages
    .filter((m) => m.role !== "system" && m.role !== "tool")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents,
      ...(systemParts.length > 0
        ? { systemInstruction: { parts: [{ text: systemParts.join("\n\n") }] } }
        : {}),
      generationConfig: {
        temperature: options.temperature ?? 0.4,
        maxOutputTokens: options.maxTokens ?? 1200,
        ...(options.json ? { responseMimeType: "application/json" } : {}),
      },
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Google AI ${response.status}: ${detail.slice(0, 240)}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };

  return {
    available: true,
    text:
      data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim() ?? "",
    provider: provider.id,
    model: provider.model,
    tokensIn: data.usageMetadata?.promptTokenCount ?? 0,
    tokensOut: data.usageMetadata?.candidatesTokenCount ?? 0,
    latencyMs: Date.now() - started,
    // Google's generateContent does not use the OpenAI tool-call shape.
    toolCalls: [],
  };
}

async function callOllama(
  provider: ProviderConfig,
  options: GenerateOptions,
  started: number,
): Promise<GenerateResult> {
  const base = process.env.OLLAMA_BASE_URL!.replace(/\/$/, "");
  const response = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: provider.model,
      messages: options.messages,
      stream: false,
      options: { temperature: options.temperature ?? 0.4 },
      ...(options.json ? { format: "json" } : {}),
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Ollama ${response.status}: ${detail.slice(0, 240)}`);
  }

  const data = (await response.json()) as {
    message?: { content?: string };
    prompt_eval_count?: number;
    eval_count?: number;
  };

  return {
    available: true,
    text: data.message?.content?.trim() ?? "",
    provider: provider.id,
    model: provider.model,
    tokensIn: data.prompt_eval_count ?? 0,
    tokensOut: data.eval_count ?? 0,
    latencyMs: Date.now() - started,
    toolCalls: [],
  };
}

/**
 * Extract the first JSON object from a model response. Free models often wrap
 * JSON in prose or fences even when asked not to, so this is deliberately
 * tolerant rather than strict.
 */
export function parseJsonLoose<T>(text: string): T | null {
  if (!text) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1] : text;

  const objectMatch = /\{[\s\S]*\}/.exec(candidate);
  if (!objectMatch) return null;

  try {
    return JSON.parse(objectMatch[0]) as T;
  } catch {
    return null;
  }
}
