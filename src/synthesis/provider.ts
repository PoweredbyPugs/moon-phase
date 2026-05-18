/* LLM provider interface — abstracts OpenAI, Anthropic, Ollama, generic
 * OpenAI-compatible endpoints behind a single completion call. */

export interface LLMMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface LLMCompletionOptions {
    model: string;
    messages: LLMMessage[];
    maxTokens?: number;
    temperature?: number;
}

export interface LLMProvider {
    name: string;
    isConfigured(): boolean;
    complete(opts: LLMCompletionOptions): Promise<string>;
}

/* Null provider: returns a friendly stub when no LLM is configured. */
export class NullLLMProvider implements LLMProvider {
    name = 'off';
    isConfigured(): boolean { return false; }
    async complete(_opts: LLMCompletionOptions): Promise<string> {
        return '_(LLM not configured — set one up in the LLM settings tab.)_';
    }
}
