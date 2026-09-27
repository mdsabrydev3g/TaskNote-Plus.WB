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
  role: "system" | "user" | "assistant";
  content: string;
};

export type GenerateOptions = {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Ask the provider for strict JSON where supported. */
  json?: boolean;
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
};

type ProviderConfig = {
  id: ProviderId;
  label: string;
  model: string;
  configured: boolean;
};

export function resolveProvider(): ProviderConfig | null {
  const forced = process.env.AI_PROVIDER?.trim() as ProviderId | "" | undefined;

  const candidates: ProviderConfig[] = [
    {
      id: "groq",
      label: "Groq",
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      configured: Boolean(process.env.GROQ_API_KEY?.trim()),
    },
    {
      id: "google",
      label: "Google AI",
      model: process.env.GOOGLE_MODEL || "gemini-2.0-flash",
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

  if (forced) {
    return candidates.find((c) => c.id === forced && c.configured) ?? null;
  }
  return candidates.find((c) => c.configured) ?? null;
}

export function aiStatus() {
  const provider = resolveProvider();
  return {
    available: Boolean(provider),
    provider: provider?.id ?? ("none" as const),
    model: provider?.model ?? "",
    label: provider?.label ?? "Not configured",
  };
}

/** Provider-agnostic entry point. Never throws — failures come back in-band. */
export async function generate(options: GenerateOptions): Promise<GenerateResult> {
  const provider = resolveProvider();
  const started = Date.now();

  if (!provider) {
    return {
      available: false,
      text: "",
      provider: "none",
      model: "",
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: 0,
      error: "No AI provider configured",
    };
  }

  try {
    switch (provider.id) {
      case "groq":
        return await callOpenAICompatible(
          "https://api.groq.com/openai/v1/chat/completions",
          process.env.GROQ_API_KEY!,
          provider,
          options,
          started,
        );
      case "openrouter":
        return await callOpenAICompatible(
          "https://openrouter.ai/api/v1/chat/completions",
          process.env.OPENROUTER_API_KEY!,
          provider,
          options,
          started,
        );
      case "google":
        return await callGoogle(provider, options, started);
      case "ollama":
        return await callOllama(provider, options, started);
    }
  } catch (error) {
    return {
      available: false,
      text: "",
      provider: provider.id,
      model: provider.model,
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : "Unknown AI error",
    };
  }
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
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`${provider.label} ${response.status}: ${detail.slice(0, 240)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  return {
    available: true,
    text: data.choices?.[0]?.message?.content?.trim() ?? "",
    provider: provider.id,
    model: provider.model,
    tokensIn: data.usage?.prompt_tokens ?? 0,
    tokensOut: data.usage?.completion_tokens ?? 0,
    latencyMs: Date.now() - started,
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
  const contents = options.messages
    .filter((m) => m.role !== "system")
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
