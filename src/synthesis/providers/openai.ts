/* OpenAI-compatible LLM provider — covers openai.com, Ollama (which exposes
 * an OpenAI-compatible API), and any other Chat-Completions clone. */

import { requestUrl } from 'obsidian';
import { LLMCompletionOptions, LLMProvider } from '../provider';

export interface OpenAIConfig {
    baseUrl: string;        // e.g. https://api.openai.com or http://localhost:11434
    apiKey: string;
    chatPath?: string;      // defaults to /v1/chat/completions
}

export class OpenAIProvider implements LLMProvider {
    name = 'openai';
    constructor(private config: OpenAIConfig) { }

    isConfigured(): boolean {
        return !!(this.config.baseUrl && (this.config.apiKey || /localhost|127\.0\.0\.1|ollama/i.test(this.config.baseUrl)));
    }

    async complete(opts: LLMCompletionOptions): Promise<string> {
        if (!this.isConfigured()) {
            throw new Error('OpenAI provider not configured (baseUrl + apiKey required).');
        }
        const path = this.config.chatPath || '/v1/chat/completions';
        const url = this.config.baseUrl.replace(/\/+$/, '') + path;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this.config.apiKey) headers['Authorization'] = `Bearer ${this.config.apiKey}`;

        const body = {
            model: opts.model,
            messages: opts.messages,
            max_tokens: opts.maxTokens ?? 1024,
            temperature: opts.temperature ?? 0.7,
        };

        const res = await requestUrl({
            url,
            method: 'POST',
            headers,
            contentType: 'application/json',
            body: JSON.stringify(body),
            throw: false,
        });

        if (res.status < 200 || res.status >= 300) {
            throw new Error(`LLM ${res.status} from ${url}: ${(res.text ?? '').slice(0, 200)}`);
        }
        const choice = res.json?.choices?.[0]?.message?.content;
        if (typeof choice !== 'string') {
            throw new Error('LLM response missing choices[0].message.content');
        }
        return choice;
    }
}
