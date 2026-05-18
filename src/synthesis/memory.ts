/* Memory loop — save validated readings to a vault folder so they can be
 * recalled later. No vector DB, no graph, just markdown files with frontmatter
 * (queryable via Dataview or the Obsidian search API). */

import { App, normalizePath, TFile, TFolder } from 'obsidian';

export interface MemoryRecord {
    chart: string;
    kind: 'chart-reading' | 'discover' | 'interpret-placement';
    timestamp: string;       // ISO
    sourceNote?: string;     // path of the note this reading was inserted into
    placement?: string;      // for interpret-placement records
    notes?: string;          // user's reflection / validation tag
    body: string;            // the LLM output (markdown)
}

export async function saveMemoryRecord(app: App, folder: string, record: MemoryRecord): Promise<TFile> {
    const dir = normalizePath(folder);
    let existing = app.vault.getAbstractFileByPath(dir);
    if (!existing) {
        await app.vault.createFolder(dir);
        existing = app.vault.getAbstractFileByPath(dir);
    }
    if (!(existing instanceof TFolder)) {
        throw new Error(`Memory path "${dir}" exists and is not a folder.`);
    }

    const ts = record.timestamp.replace(/[:.]/g, '-');
    const slug = record.placement
        ? slugify(record.placement)
        : `${record.kind}`;
    const filename = `${record.chart || 'general'}-${ts}-${slug}.md`.replace(/-+/g, '-');
    const filepath = normalizePath(`${dir}/${filename}`);

    const frontmatter = [
        '---',
        `obsidianmoon-memory: true`,
        `chart: ${record.chart || ''}`,
        `kind: ${record.kind}`,
        `timestamp: ${record.timestamp}`,
        record.placement ? `placement: "${record.placement.replace(/"/g, '\\"')}"` : null,
        record.sourceNote ? `source: "${record.sourceNote}"` : null,
        record.notes ? `notes: "${record.notes.replace(/"/g, '\\"')}"` : null,
        '---',
    ].filter(Boolean).join('\n');

    const content = `${frontmatter}\n\n${record.body}\n`;
    return app.vault.create(filepath, content);
}

export async function listMemoryRecords(app: App, folder: string): Promise<TFile[]> {
    const dir = normalizePath(folder);
    const f = app.vault.getAbstractFileByPath(dir);
    if (!(f instanceof TFolder)) return [];
    return f.children.filter((c): c is TFile =>
        c instanceof TFile && c.name.endsWith('.md'));
}

function slugify(s: string): string {
    return s.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
}
