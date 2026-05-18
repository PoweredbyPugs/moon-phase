/* Knowledge backend interface — pluggable so different stores (Neo4j,
 * vault-native, off) can be swapped behind the same plugin surface. */

export interface KnowledgeChunk {
    text: string;
    author?: string;
    sourceTitle?: string;
    tradition?: string;
    layer?: string;
    trustTier?: number;
    tags?: string;
    score?: number;     // search relevance, if available
}

export interface KnowledgeSearchOptions {
    query: string;
    planet?: string;
    sign?: string;
    house?: number;
    aspect?: string;
    layer?: string;
    tradition?: string;
    author?: string;
    trustTier?: number;
    limit?: number;
}

export interface KnowledgeStats {
    interpretationCount: number;
    authorCount?: number;
    sourceCount?: number;
    backend: string;
}

export interface KnowledgeBackend {
    name: string;
    isConfigured(): boolean;
    search(opts: KnowledgeSearchOptions): Promise<KnowledgeChunk[]>;
    stats(): Promise<KnowledgeStats>;
    close(): Promise<void>;
}

/* ── Null backend: graceful no-op when knowledge is disabled ── */

export class NullKnowledgeBackend implements KnowledgeBackend {
    name = 'off';
    isConfigured(): boolean { return false; }
    async search(): Promise<KnowledgeChunk[]> { return []; }
    async stats(): Promise<KnowledgeStats> {
        return { interpretationCount: 0, backend: 'off' };
    }
    async close(): Promise<void> { /* no-op */ }
}

/* ── Formatting helper shared by all backends ── */

export function formatChunks(chunks: KnowledgeChunk[], query: string): string {
    if (chunks.length === 0) return `No knowledge results for "${query}".`;
    const lines: string[] = [`# Knowledge search: "${query}"`, ''];
    for (const c of chunks) {
        const tags = [
            c.author && `*${c.author}*`,
            c.sourceTitle && `_${c.sourceTitle}_`,
            c.layer,
            c.trustTier && `tier ${c.trustTier}`,
        ].filter(Boolean).join(' · ');
        lines.push(`### ${tags || '(unattributed)'}`);
        const truncated = c.text.length > 800 ? c.text.slice(0, 800) + '…' : c.text;
        lines.push(truncated);
        lines.push('');
    }
    return lines.join('\n');
}
