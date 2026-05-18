/* Anthropic Claude provider (Messages API). */

import { requestUrl } from 'obsidian';
import { LLMCompletionOptions, LLMProvider } from '../provider';

export interface AnthropicConfig {
    baseUrl: string;     // typically https://api.anthropic.com
    apiKey: string;
    apiVersion?: string; // default: 2023-06-01
}

export class AnthropicProvider implements LLMProvider {
    name = 'anthropic';
    constructor(private config: AnthropicConfig) { }

    isConfigured(): boolean {
        return !!(this.config.baseUrl && this.config.apiKey);
    }

    async complete(opts: LLMCompletionOptions): Promise<string> {
        if (!this.isConfigured()) {
            throw new Error('Anthropic provider not configured (baseUrl + apiKey required).');
        }
        const url = this.config.baseUrl.replace(/\/+$/, '') + '/v1/messages';

        // Anthropic's API separates the system prompt from messages.
        const systemMsgs = opts.messages.filter(m => m.role === 'system').map(m => m.content);
        const chatMsgs = opts.messages
            .filter(m => m.role !== 'system')
            .map(m => ({ role: m.role, content: m.content }));

        const body: Record<string, unknown> = {
            model: opts.model,
            max_tokens: opts.maxTokens ?? 1024,
            temperature: opts.temperature ?? 0.7,
            messages: chatMsgs,
        };
        if (systemMsgs.length > 0) body.system = systemMsgs.join('\n\n');

        const res = await requestUrl({
            url,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.config.apiKey,
                'anthropic-version': this.config.apiVersion ?? '2023-06-01',
            },
            contentType: 'application/json',
            body: JSON.stringify(body),
            throw: false,
        });

        if (res.status < 200 || res.status >= 300) {
            throw new Error(`Anthropic ${res.status} from ${url}: ${(res.text ?? '').slice(0, 200)}`);
        }
        const blocks = res.json?.content;
        if (!Array.isArray(blocks)) throw new Error('Anthropic response missing content[]');
        const text = blocks
            .filter((b: any) => b.type === 'text' && typeof b.text === 'string')
            .map((b: any) => b.text)
            .join('');
        return text;
    }
}
