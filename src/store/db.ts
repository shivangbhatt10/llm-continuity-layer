import { DatabaseSync } from "node:sqlite";
import type { Capsule } from "../core/schema.js";

export interface VersionedCapsule extends Capsule {
  version: number;
}

export interface CapsuleSummary {
  conversation_id: string;
  title: string;
  version: number;
  created_at: number;
}

export interface SessionSummary extends CapsuleSummary {
  source: string;
}

export interface SessionSearchResult extends SessionSummary {
  matchSnippet: string;
}

export interface ConversationStore {
  saveCapsule(capsule: Capsule): VersionedCapsule;
  getLatestCapsule(conversationId: string): VersionedCapsule | null;
  getLatestOverallCapsule?(): VersionedCapsule | null;
  getCapsuleByVersion(conversationId: string, version: number): VersionedCapsule | null;
  listCapsules(): CapsuleSummary[];
  listSessions?(limit?: number): SessionSummary[];
  searchSessions?(query: string, limit?: number): SessionSearchResult[];
  close(): void;
}

export class SQLiteStore implements ConversationStore {
  private db: DatabaseSync;

  constructor(dbPath: string = ":memory:") {
    this.db = new DatabaseSync(dbPath);
    this.initSchema();
  }

  close(): void {
    this.db.close();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS capsules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        title TEXT NOT NULL,
        source TEXT NOT NULL,
        types TEXT NOT NULL,
        sections TEXT NOT NULL,
        next_step TEXT NOT NULL,
        recent_turns TEXT NOT NULL,
        artifacts TEXT NOT NULL,
        meta TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(conversation_id, version)
      );
      CREATE INDEX IF NOT EXISTS idx_capsules_conv_ver ON capsules(conversation_id, version);
    `);
  }

  saveCapsule(capsule: Capsule): VersionedCapsule {
    // 1. Determine next auto-incrementing version for this conversation
    const versionStmt = this.db.prepare(
      `SELECT MAX(version) as max_v FROM capsules WHERE conversation_id = ?`
    );
    const row = versionStmt.get(capsule.conversation_id) as { max_v: number | null } | undefined;
    const currentMax = row && row.max_v !== null ? Number(row.max_v) : 0;
    const nextVersion = currentMax + 1;

    // 2. Insert serialized capsule record
    const insertStmt = this.db.prepare(`
      INSERT INTO capsules (
        conversation_id,
        version,
        title,
        source,
        types,
        sections,
        next_step,
        recent_turns,
        artifacts,
        meta,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertStmt.run(
      capsule.conversation_id,
      nextVersion,
      capsule.title,
      capsule.source,
      JSON.stringify(capsule.types),
      JSON.stringify(capsule.sections),
      capsule.next_step,
      JSON.stringify(capsule.recent_turns),
      JSON.stringify(capsule.artifacts),
      JSON.stringify(capsule.meta),
      capsule.created_at || Date.now()
    );

    return {
      ...capsule,
      version: nextVersion,
    };
  }

  getLatestCapsule(conversationId: string): VersionedCapsule | null {
    const stmt = this.db.prepare(`
      SELECT * FROM capsules 
      WHERE conversation_id = ? 
      ORDER BY version DESC 
      LIMIT 1
    `);
    const row = stmt.get(conversationId) as Record<string, unknown> | undefined;
    if (!row) return null;

    return this.hydrateCapsule(row);
  }

  getCapsuleByVersion(conversationId: string, version: number): VersionedCapsule | null {
    const stmt = this.db.prepare(`
      SELECT * FROM capsules 
      WHERE conversation_id = ? AND version = ?
      LIMIT 1
    `);
    const row = stmt.get(conversationId, version) as Record<string, unknown> | undefined;
    if (!row) return null;

    return this.hydrateCapsule(row);
  }

  listCapsules(): CapsuleSummary[] {
    const stmt = this.db.prepare(`
      SELECT conversation_id, title, MAX(version) as version, MAX(created_at) as created_at
      FROM capsules
      GROUP BY conversation_id
      ORDER BY created_at DESC
    `);
    const rows = stmt.all() as Array<{
      conversation_id: string;
      title: string;
      version: number;
      created_at: number;
    }>;

    return rows.map((r) => ({
      conversation_id: String(r.conversation_id),
      title: String(r.title),
      version: Number(r.version),
      created_at: Number(r.created_at),
    }));
  }

  getLatestOverallCapsule(): VersionedCapsule | null {
    const stmt = this.db.prepare(`
      SELECT * FROM capsules 
      ORDER BY created_at DESC, id DESC 
      LIMIT 1
    `);
    const row = stmt.get() as Record<string, unknown> | undefined;
    if (!row) return null;

    return this.hydrateCapsule(row);
  }

  listSessions(limit: number = 10): SessionSummary[] {
    const stmt = this.db.prepare(`
      SELECT c.conversation_id, c.title, c.source, c.version, c.created_at
      FROM capsules c
      INNER JOIN (
        SELECT conversation_id, MAX(version) as max_version
        FROM capsules
        GROUP BY conversation_id
      ) m ON c.conversation_id = m.conversation_id AND c.version = m.max_version
      ORDER BY c.created_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(limit) as Array<{
      conversation_id: string;
      title: string;
      source: string;
      version: number;
      created_at: number;
    }>;

    return rows.map((r) => ({
      conversation_id: String(r.conversation_id),
      title: String(r.title),
      source: String(r.source),
      version: Number(r.version),
      created_at: Number(r.created_at),
    }));
  }

  searchSessions(query: string, limit: number = 10): SessionSearchResult[] {
    const term = `%${query.toLowerCase()}%`;
    const stmt = this.db.prepare(`
      SELECT c.conversation_id, c.title, c.source, c.version, c.created_at, c.sections, c.next_step
      FROM capsules c
      INNER JOIN (
        SELECT conversation_id, MAX(version) as max_version
        FROM capsules
        GROUP BY conversation_id
      ) m ON c.conversation_id = m.conversation_id AND c.version = m.max_version
      WHERE LOWER(c.title) LIKE ? 
         OR LOWER(c.sections) LIKE ? 
         OR LOWER(c.next_step) LIKE ?
      ORDER BY c.created_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(term, term, term, limit) as Array<{
      conversation_id: string;
      title: string;
      source: string;
      version: number;
      created_at: number;
      sections: string;
      next_step: string;
    }>;

    return rows.map((r) => {
      let snippet = "";
      const q = query.toLowerCase();
      try {
        const sectionsObj = JSON.parse(r.sections) as Record<string, string>;
        for (const [secTitle, secBody] of Object.entries(sectionsObj)) {
          if (secBody.toLowerCase().includes(q)) {
            snippet = `${secTitle}: ${secBody.slice(0, 140)}...`;
            break;
          }
        }
      } catch {
        // ignore JSON parse error
      }
      if (!snippet && r.next_step.toLowerCase().includes(q)) {
        snippet = `Next Step: ${r.next_step.slice(0, 140)}...`;
      }
      if (!snippet) {
        snippet = `Title: ${r.title}`;
      }

      return {
        conversation_id: String(r.conversation_id),
        title: String(r.title),
        source: String(r.source),
        version: Number(r.version),
        created_at: Number(r.created_at),
        matchSnippet: snippet,
      };
    });
  }

  private hydrateCapsule(row: Record<string, unknown>): VersionedCapsule {
    return {
      conversation_id: String(row.conversation_id),
      version: Number(row.version),
      title: String(row.title),
      source: String(row.source),
      types: JSON.parse(String(row.types)),
      sections: JSON.parse(String(row.sections)),
      next_step: String(row.next_step),
      recent_turns: JSON.parse(String(row.recent_turns)),
      artifacts: JSON.parse(String(row.artifacts)),
      created_at: Number(row.created_at),
      meta: JSON.parse(String(row.meta)),
    };
  }
}
