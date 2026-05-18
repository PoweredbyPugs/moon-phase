/* LLM provider registry — modeled on the periodic-ritual PROVIDERS pattern.
 * Each provider declares how to build the request URL, body, headers and
 * how to extract the assistant text from the response. requestUrl carries
 * the call so we avoid CORS preflights from the app:// origin. */

import { requestUrl } from 'obsidian';
import { LLMCompletionOptions, LLMMessage, LLMProvider } from './provider';

export type ProviderId =
    | 'off'
    | 'openai'
    | 'anthropic'
    | 'openrouter'
    | 'gemini'
    | 'ollama'
    | 'openclaw';

export interface ProviderConfig {
    apiKey: string;
    baseUrl: string;
    model: string;
}

export interface ProviderDef {
    id: ProviderId;
    label: string;
    needsKey: boolean;            // strict require? (false for local/no-auth)
    defaultBaseUrl: string;
    /** Build the request URL. Used `s.baseUrl` if provided, else `defaultBaseUrl`. */
    buildUrl(s: ProviderConfig, opts: LLMCompletionOptions): string;
    buildBody(s: ProviderConfig, opts: LLMCompletionOptions): unknown;
    buildHeaders(s: ProviderConfig): Record<string, string>;
    extractText(json: any): string;
}

/* ── Helpers ── */

function joinSystem(messages: LLMMessage[]): { system: string; user: LLMMessage[] } {
    // Split off system messages (Anthropic/Gemini want them separately).
    const systems = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
    const rest = messages.filter(m => m.role !== 'system');
    return { system: systems, user: rest };
}

function chatCompletionsBody(s: ProviderConfig, opts: LLMCompletionOptions) {
    return {
        model: s.model || opts.model,
        messages: opts.messages,
        max_tokens: opts.maxTokens ?? 1024,
        temperature: opts.temperature ?? 0.7,
    };
}

function extractOpenAIShape(json: any): string {
    return json?.choices?.[0]?.message?.content ?? '';
}

/* ── Providers ── */

export const PROVIDERS: Record<Exclude<ProviderId, 'off'>, ProviderDef> = {
    openai: {
        id: 'openai',
        label: 'OpenAI',
        needsKey: true,
        defaultBaseUrl: 'https://api.openai.com',
        buildUrl: (s) => `${(s.baseUrl || 'https://api.openai.com').replace(/\/+$/, '')}/v1/chat/completions`,
        buildBody: chatCompletionsBody,
        buildHeaders: (s) => ({
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${s.apiKey}`,
        }),
        extractText: extractOpenAIShape,
    },

    anthropic: {
        id: 'anthropic',
        label: 'Anthropic Claude',
        needsKey: true,
        defaultBaseUrl: 'https://api.anthropic.com',
        buildUrl: (s) => `${(s.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '')}/v1/messages`,
        buildBody: (s, opts) => {
            const { system, user } = joinSystem(opts.messages);
            const body: Record<string, unknown> = {
                model: s.model || opts.model,
                max_tokens: opts.maxTokens ?? 1024,
                temperature: opts.temperature ?? 0.7,
                messages: user,
            };
            if (system) body.system = system;
            return body;
        },
        buildHeaders: (s) => ({
            'Content-Type': 'application/json',
            'x-api-key': s.apiKey,
            'anthropic-version': '2023-06-01',
        }),
        extractText: (json) => {
            const blocks = json?.content;
            if (!Array.isArray(blocks)) return '';
            return blocks.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
        },
    },

    openrouter: {
        id: 'openrouter',
        label: 'OpenRouter',
        needsKey: true,
        defaultBaseUrl: 'https://openrouter.ai/api',
        buildUrl: (s) => `${(s.baseUrl || 'https://openrouter.ai/api').replace(/\/+$/, '')}/v1/chat/completions`,
        buildBody: chatCompletionsBody,
        buildHeaders: (s) => ({
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${s.apiKey}`,
            // Attribution headers per OpenRouter docs — optional but nice.
            'HTTP-Referer': 'https://github.com/PoweredbyPugs/moon-phase',
            'X-Title': 'Obsidian Moon',
        }),
        extractText: extractOpenAIShape,
    },

    gemini: {
        id: 'gemini',
        label: 'Google Gemini',
        needsKey: true,
        defaultBaseUrl: 'https://generativelanguage.googleapis.com',
        buildUrl: (s, opts) => {
            const base = (s.baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
            const model = s.model || opts.model;
            return `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(s.apiKey)}`;
        },
        buildBody: (_s, opts) => {
            const { system, user } = joinSystem(opts.messages);
            const body: Record<string, unknown> = {
                contents: user.map(m => ({
                    role: m.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: m.content }],
                })),
                generationConfig: {
                    maxOutputTokens: opts.maxTokens ?? 1024,
                    temperature: opts.temperature ?? 0.7,
                },
            };
            if (system) body.system_instruction = { parts: [{ text: system }] };
            return body;
        },
        buildHeaders: () => ({ 'Content-Type': 'application/json' }),
        extractText: (json) => {
            const parts = json?.candidates?.[0]?.content?.parts;
            if (!Array.isArray(parts)) return '';
            return parts.map((p: any) => p.text ?? '').join('');
        },
    },

    ollama: {
        id: 'ollama',
        label: 'Ollama (local)',
        needsKey: false,
        defaultBaseUrl: 'http://localhost:11434',
        buildUrl: (s) => `${(s.baseUrl || 'http://localhost:11434').replace(/\/+$/, '')}/v1/chat/completions`,
        buildBody: chatCompletionsBody,
        buildHeaders: (s) => ({
            'Content-Type': 'application/json',
            ...(s.apiKey ? { 'Authorization': `Bearer ${s.apiKey}` } : {}),
        }),
        extractText: extractOpenAIShape,
    },

    openclaw: {
        id: 'openclaw',
        label: 'OpenClaw (local agent gateway)',
        needsKey: false,   // depends on gateway mode; we send the key when set
        defaultBaseUrl: 'http://127.0.0.1:18789',
        buildUrl: (s) => `${(s.baseUrl || 'http://127.0.0.1:18789').replace(/\/+$/, '')}/v1/chat/completions`,
        buildBody: (s, opts) => ({
            // OpenClaw routes to a specific agent via the `model` field.
            // Common forms: "openclaw/default", "openclaw/main", "openclaw/<agentId>".
            model: s.model || opts.model || 'openclaw/default',
            messages: opts.messages,
            max_tokens: opts.maxTokens ?? 1024,
            temperature: opts.temperature ?? 0.7,
        }),
        buildHeaders: (s) => ({
            'Content-Type': 'application/json',
            ...(s.apiKey ? { 'Authorization': `Bearer ${s.apiKey}` } : {}),
        }),
        extractText: extractOpenAIShape,
    },
};

/* ── Adapter so the registry plays nice with the existing LLMProvider interface ── */

export class RegistryLLMProvider implements LLMProvider {
    readonly name: ProviderId;
    constructor(private def: ProviderDef, private config: ProviderConfig) {
        this.name = def.id;
    }

    isConfigured(): boolean {
        if (this.def.needsKey && !this.config.apiKey) return false;
        return !!this.config.model;
    }

    async complete(opts: LLMCompletionOptions): Promise<string> {
        if (!this.isConfigured()) {
            throw new Error(`${this.def.label} not configured: missing ${this.def.needsKey ? 'API key or ' : ''}model`);
        }
        const url = this.def.buildUrl(this.config, opts);
        const body = this.def.buildBody(this.config, opts);
        const headers = this.def.buildHeaders(this.config);

        const res = await requestUrl({
            url,
            method: 'POST',
            headers,
            contentType: 'application/json',
            body: JSON.stringify(body),
            throw: false,
        });
        if (res.status < 200 || res.status >= 300) {
            throw new Error(`${this.def.label} ${res.status}: ${(res.text ?? '').slice(0, 300)}`);
        }
        return this.def.extractText(res.json) ?? '';
    }
}
