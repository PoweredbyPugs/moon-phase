/* Neo4j knowledge backend — uses Neo4j's HTTP transactional API via
 * Obsidian's requestUrl. No native driver dependency (keeps the plugin
 * bundle small — ~30KB vs 1.4MB for neo4j-driver).
 *
 * Endpoint: POST <httpUri>/db/<database>/tx/commit
 *   body: { statements: [{ statement, parameters }] }
 *   auth: HTTP Basic
 *
 * The schema matches what the Stella ingest pipeline produces:
 *   (:Interpretation {text, source_title, tradition, trust_tier, chunk_id})
 *   (:Planet {id}), (:Sign {id}), (:House {number}), (:Author {name}), (:Layer {id})
 *   Full-text index "interpretation_text" on Interpretation.text. */

import { requestUrl } from 'obsidian';
import {
    KnowledgeBackend, KnowledgeChunk, KnowledgeSearchOptions, KnowledgeStats,
} from './backend';

export interface Neo4jConfig {
    httpUri: string;        // http://localhost:7474
    database?: string;      // default: 'neo4j'
    user: string;
    password: string;
    indexName?: string;     // default: 'interpretation_text'
}

interface CypherStatement {
    statement: string;
    parameters?: Record<string, unknown>;
}

interface CypherResponse {
    results?: Array<{
        columns: string[];
        data: Array<{ row: unknown[] }>;
    }>;
    errors?: Array<{ code: string; message: string }>;
}

export class Neo4jKnowledgeBackend implements KnowledgeBackend {
    name = 'neo4j';
    private indexName: string;
    private database: string;

    constructor(private config: Neo4jConfig) {
        this.indexName = config.indexName || 'interpretation_text';
        this.database = config.database || 'neo4j';
    }

    isConfigured(): boolean {
        return !!(this.config.httpUri && this.config.user && this.config.password);
    }

    private async runCypher(stmt: CypherStatement): Promise<Array<Record<string, unknown>>> {
        if (!this.isConfigured()) throw new Error('Neo4j backend not configured');
        const base = this.config.httpUri.replace(/\/+$/, '');
        const url = `${base}/db/${this.database}/tx/commit`;
        const auth = btoa(`${this.config.user}:${this.config.password}`);
        const res = await requestUrl({
            url,
            method: 'POST',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
            contentType: 'application/json',
            body: JSON.stringify({ statements: [stmt] }),
            throw: false,
        });
        if (res.status < 200 || res.status >= 300) {
            throw new Error(`Neo4j HTTP ${res.status}: ${(res.text ?? '').slice(0, 300)}`);
        }
        const body = res.json as CypherResponse;
        if (body.errors && body.errors.length > 0) {
            throw new Error(`Neo4j: ${body.errors[0].code} — ${body.errors[0].message}`);
        }
        const result = body.results?.[0];
        if (!result) return [];
        // Reshape: each row's columns → keyed object
        return result.data.map(d => {
            const obj: Record<string, unknown> = {};
            result.columns.forEach((col, i) => { obj[col] = d.row[i]; });
            return obj;
        });
    }

    async search(opts: KnowledgeSearchOptions): Promise<KnowledgeChunk[]> {
        const limit = Math.max(1, Math.min(50, opts.limit ?? 5));

        // Build dynamic structural filters layered on a full-text index match
        const matches: string[] = [];
        const where: string[] = [];
        const params: Record<string, unknown> = {
            indexName: this.indexName,
            query: opts.query || '*',
            limit,
        };

        if (opts.planet) {
            matches.push('MATCH (i)-[:DESCRIBES]->(p:Planet)');
            where.push('toLower(p.id) = $planet');
            params.planet = opts.planet.toLowerCase();
        }
        if (opts.sign) {
            matches.push('MATCH (i)-[:DESCRIBES]->(s:Sign)');
            where.push('toLower(s.id) = $sign');
            params.sign = opts.sign.toLowerCase();
        }
        if (Number.isFinite(opts.house)) {
            matches.push('MATCH (i)-[:INTERPRETS_HOUSE]->(h:House)');
            where.push('h.number = $house');
            params.house = opts.house;
        }
        if (opts.aspect) {
            where.push('i.tags CONTAINS $aspect');
            params.aspect = opts.aspect.toLowerCase();
        }
        if (opts.layer) {
            matches.push('MATCH (i)-[:IN_LAYER]->(l:Layer)');
            where.push('l.id = $layer');
            params.layer = opts.layer.toLowerCase();
        }
        if (opts.tradition) {
            where.push('i.tradition = $tradition');
            params.tradition = opts.tradition.toLowerCase();
        }
        if (opts.author) {
            matches.push('MATCH (i)-[:AUTHORED_BY]->(a:Author)');
            where.push('toLower(a.name) CONTAINS $author');
            params.author = opts.author.toLowerCase();
        }
        if (Number.isFinite(opts.trustTier)) {
            where.push('i.trust_tier = $trustTier');
            params.trustTier = opts.trustTier;
        }
        // sourceTitle is an extra filter not in the public interface but used by
        // the hexagram lookup to pin DeKorne. Threaded via (opts as any).sourceTitle.
        const sourceTitle = (opts as any).sourceTitle;
        if (sourceTitle) {
            where.push('i.source_title CONTAINS $sourceTitle');
            params.sourceTitle = sourceTitle;
        }

        const cypher = [
            `CALL db.index.fulltext.queryNodes($indexName, $query) YIELD node AS i, score`,
            ...matches,
            'OPTIONAL MATCH (i)-[:AUTHORED_BY]->(auth:Author)',
            'OPTIONAL MATCH (i)-[:IN_LAYER]->(ly:Layer)',
            where.length ? `WHERE ${where.join(' AND ')}` : '',
            'RETURN i.text AS text, auth.name AS author, i.source_title AS title,',
            '       i.trust_tier AS tier, ly.id AS layer, i.tradition AS tradition,',
            '       i.tags AS tags, score',
            'ORDER BY score DESC',
            'LIMIT $limit',
        ].filter(Boolean).join('\n');

        const rows = await this.runCypher({ statement: cypher, parameters: params });
        return rows.map(r => ({
            text: String(r.text ?? ''),
            author: (r.author as string) ?? undefined,
            sourceTitle: (r.title as string) ?? undefined,
            trustTier: (r.tier as number) ?? undefined,
            layer: (r.layer as string) ?? undefined,
            tradition: (r.tradition as string) ?? undefined,
            tags: (r.tags as string) ?? undefined,
            score: (r.score as number) ?? undefined,
        }));
    }

    async stats(): Promise<KnowledgeStats> {
        const rows = await this.runCypher({
            statement: `
                MATCH (i:Interpretation) WITH count(i) AS interp
                OPTIONAL MATCH (a:Author) WITH interp, count(DISTINCT a) AS authors
                RETURN interp, authors
            `,
        });
        const r = rows[0] ?? {};
        return {
            interpretationCount: Number(r.interp ?? 0),
            authorCount: Number(r.authors ?? 0),
            backend: 'neo4j',
        };
    }

    async close(): Promise<void> {
        // HTTP backend has no persistent connection to close
    }
}
