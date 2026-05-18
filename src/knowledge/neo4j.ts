/* Neo4j knowledge backend — connects to a local Neo4j instance and queries
 * the Interpretation node corpus via a full-text index + structural filters.
 * Matches the schema produced by the Stella ingest pipeline. */

import neo4j, { Driver, Session } from 'neo4j-driver';
import {
    KnowledgeBackend, KnowledgeChunk, KnowledgeSearchOptions, KnowledgeStats,
} from './backend';

export interface Neo4jConfig {
    uri: string;        // bolt://localhost:7687
    user: string;       // neo4j
    password: string;
    indexName?: string; // default: 'interpretation_text'
}

export class Neo4jKnowledgeBackend implements KnowledgeBackend {
    name = 'neo4j';
    private driver: Driver | null = null;
    private indexName: string;

    constructor(private config: Neo4jConfig) {
        this.indexName = config.indexName || 'interpretation_text';
    }

    isConfigured(): boolean {
        return !!(this.config.uri && this.config.user && this.config.password);
    }

    private async getDriver(): Promise<Driver> {
        if (this.driver) return this.driver;
        this.driver = neo4j.driver(
            this.config.uri,
            neo4j.auth.basic(this.config.user, this.config.password),
            { disableLosslessIntegers: true },
        );
        await this.driver.verifyConnectivity();
        return this.driver;
    }

    async search(opts: KnowledgeSearchOptions): Promise<KnowledgeChunk[]> {
        const limit = Math.max(1, Math.min(50, opts.limit ?? 5));
        const driver = await this.getDriver();
        const session: Session = driver.session();
        try {
            // Build dynamic structural filters
            const matches: string[] = [];
            const where: string[] = [];
            const params: Record<string, unknown> = { query: opts.query || '*', limit };

            // Use the full-text index as the primary candidate generator
            const baseMatch = `CALL db.index.fulltext.queryNodes($indexName, $query) YIELD node AS i, score`;
            params.indexName = this.indexName;

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

            const cypher = [
                baseMatch,
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

            const result = await session.run(cypher, params);
            return result.records.map(r => ({
                text: String(r.get('text') ?? ''),
                author: r.get('author') ?? undefined,
                sourceTitle: r.get('title') ?? undefined,
                trustTier: r.get('tier') ?? undefined,
                layer: r.get('layer') ?? undefined,
                tradition: r.get('tradition') ?? undefined,
                tags: r.get('tags') ?? undefined,
                score: r.get('score') ?? undefined,
            }));
        } finally {
            await session.close();
        }
    }

    async stats(): Promise<KnowledgeStats> {
        const driver = await this.getDriver();
        const session = driver.session();
        try {
            const r = await session.run(`
                MATCH (i:Interpretation) WITH count(i) AS interp
                OPTIONAL MATCH (a:Author) WITH interp, count(DISTINCT a) AS authors
                RETURN interp, authors
            `);
            const rec = r.records[0];
            return {
                interpretationCount: Number(rec?.get('interp') ?? 0),
                authorCount: Number(rec?.get('authors') ?? 0),
                backend: 'neo4j',
            };
        } finally {
            await session.close();
        }
    }

    async close(): Promise<void> {
        if (this.driver) {
            await this.driver.close();
            this.driver = null;
        }
    }
}
