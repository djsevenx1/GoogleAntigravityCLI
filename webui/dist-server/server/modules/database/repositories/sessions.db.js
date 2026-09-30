import { getConnection } from '../../../modules/database/connection.js';
import { projectsDb } from '../../../modules/database/repositories/projects.db.js';
import { isGenericSessionName, normalizeProjectPath } from '../../../shared/utils.js';
const SESSION_ROW_COLUMNS = 'session_id, provider, provider_session_id, project_path, jsonl_path, custom_name, model, effort, forked_from_session_id, isArchived, created_at, updated_at';
const SQLITE_UTC_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
function normalizeTimestamp(value) {
    if (!value)
        return null;
    // SQLite CURRENT_TIMESTAMP is stored as UTC without a timezone suffix.
    // Normalize it here so every session reader returns canonical ISO strings
    // and the sidebar never interprets fresh rows as local-time "hours old".
    const normalizedValue = SQLITE_UTC_TIMESTAMP_REGEX.test(value)
        ? `${value.replace(' ', 'T')}Z`
        : value;
    const parsed = new Date(normalizedValue);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }
    return parsed.toISOString();
}
function normalizeSessionRow(row) {
    if (!row) {
        return row;
    }
    return {
        ...row,
        created_at: normalizeTimestamp(row.created_at) ?? row.created_at,
        updated_at: normalizeTimestamp(row.updated_at) ?? row.updated_at,
    };
}
function normalizeSessionRows(rows) {
    return rows.map((row) => normalizeSessionRow(row));
}
function normalizeProjectPathForProvider(provider, projectPath) {
    void provider;
    return normalizeProjectPath(projectPath);
}
export const sessionsDb = {
    /**
     * Upserts one session row discovered on disk by a provider synchronizer.
     *
     * The given id is the provider-native session id. Rows are keyed by
     * `provider_session_id` so a session that was first created by the app
     * (with an app-allocated `session_id`) is updated in place once its
     * transcript shows up on disk, instead of producing a duplicate row. An
     * app-created row keeps its existing name; synchronizer names only update
     * rows that were themselves created by indexing provider storage.
     */
    createSession(providerSessionId, provider, projectPath, customName, createdAt, updatedAt, jsonlPath) {
        const db = getConnection();
        const createdAtValue = normalizeTimestamp(createdAt);
        const updatedAtValue = normalizeTimestamp(updatedAt);
        const normalizedProjectPath = normalizeProjectPathForProvider(provider, projectPath);
        // First, ensure the project path is recorded in the projects table,
        // since it's a foreign key in the sessions table.
        projectsDb.createProjectPath(normalizedProjectPath);
        const existing = db
            .prepare(`SELECT session_id, custom_name, jsonl_path FROM sessions
         WHERE provider_session_id = ? AND provider = ?
         LIMIT 1`)
            .get(providerSessionId, provider);
        let targetCustomName = customName ?? null;
        let targetJsonlPath = jsonlPath ?? null;
        if (existing) {
            if (existing.custom_name) {
                if (existing.session_id !== providerSessionId) {
                    targetCustomName = existing.custom_name;
                }
                else if (isGenericSessionName(targetCustomName) && !isGenericSessionName(existing.custom_name)) {
                    targetCustomName = existing.custom_name;
                }
            }
            if (existing.jsonl_path &&
                targetJsonlPath &&
                /[/\\]chunks[/\\]/.test(targetJsonlPath) &&
                !/[/\\]chunks[/\\]/.test(existing.jsonl_path)) {
                targetJsonlPath = existing.jsonl_path;
            }
            db.prepare(`UPDATE sessions SET
           provider = ?,
           updated_at = COALESCE(?, CURRENT_TIMESTAMP),
           project_path = ?,
           jsonl_path = ?,
           isArchived = CASE WHEN ? IS NULL OR julianday(?) > julianday(updated_at) THEN 0 ELSE isArchived END,
           custom_name = CASE
             WHEN session_id <> provider_session_id AND custom_name IS NOT NULL THEN custom_name
             ELSE COALESCE(?, custom_name)
           END
         WHERE session_id = ?`).run(provider, updatedAtValue, normalizedProjectPath, targetJsonlPath, updatedAtValue, updatedAtValue, targetCustomName, existing.session_id);
            return existing.session_id;
        }
        // Sessions created outside the app (directly via the provider CLI) are
        // keyed by the provider-native id for both columns. The ON CONFLICT path
        // covers legacy rows that predate the provider_session_id mapping.
        db.prepare(`INSERT INTO sessions (session_id, provider, provider_session_id, custom_name, project_path, jsonl_path, isArchived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, COALESCE(?, CURRENT_TIMESTAMP), COALESCE(?, CURRENT_TIMESTAMP))
       ON CONFLICT(session_id) DO UPDATE SET
         provider = excluded.provider,
         provider_session_id = excluded.provider_session_id,
         updated_at = excluded.updated_at,
         project_path = excluded.project_path,
         jsonl_path = CASE
           WHEN (excluded.jsonl_path LIKE '%/chunks/%' OR excluded.jsonl_path LIKE '%\\chunks\\%')
                AND sessions.jsonl_path IS NOT NULL
                AND NOT (sessions.jsonl_path LIKE '%/chunks/%' OR sessions.jsonl_path LIKE '%\\chunks\\%')
             THEN sessions.jsonl_path
           ELSE excluded.jsonl_path
         END,
         isArchived = CASE WHEN ? IS NULL OR julianday(excluded.updated_at) > julianday(sessions.updated_at) THEN 0 ELSE sessions.isArchived END,
         custom_name = CASE
           WHEN sessions.session_id <> sessions.provider_session_id AND sessions.custom_name IS NOT NULL
             THEN sessions.custom_name
           WHEN (excluded.custom_name LIKE 'Antigravity %' OR excluded.custom_name LIKE 'Untitled %' OR excluded.custom_name LIKE 'OpenCode %')
                AND sessions.custom_name IS NOT NULL
                AND NOT (sessions.custom_name LIKE 'Antigravity %' OR sessions.custom_name LIKE 'Untitled %' OR sessions.custom_name LIKE 'OpenCode %')
             THEN sessions.custom_name
           ELSE COALESCE(excluded.custom_name, sessions.custom_name)
         END`).run(providerSessionId, provider, providerSessionId, customName ?? null, normalizedProjectPath, jsonlPath ?? null, createdAtValue, updatedAtValue, updatedAtValue);
        return providerSessionId;
    },
    /**
     * Inserts one app-allocated session row before any provider run happens.
     *
     * The session gateway uses this when the frontend starts a brand-new chat:
     * `session_id` is the stable app-facing id, while `provider_session_id`
     * stays NULL until the provider runtime announces its own id and
     * `assignProviderSessionId` records the mapping. `customName` is derived
     * from the first visible CloudCLI message by the sessions service.
     */
    createAppSession(sessionId, provider, projectPath, customName) {
        const db = getConnection();
        const normalizedProjectPath = normalizeProjectPathForProvider(provider, projectPath);
        projectsDb.createProjectPath(normalizedProjectPath);
        db.prepare(`INSERT INTO sessions (session_id, provider, provider_session_id, custom_name, project_path, jsonl_path, isArchived, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, NULL, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(sessionId, provider, customName ?? null, normalizedProjectPath);
        return sessionId;
    },
    /**
     * Inserts a session that already has its provider artifact on disk.
     *
     * Unlike `createAppSession` this writes `provider_session_id` and
     * `jsonl_path` immediately, because a fork's transcript file exists before
     * the row does — and the filesystem watcher would otherwise index it as an
     * unrelated session under its own id.
     */
    createForkedSession(input) {
        const db = getConnection();
        const normalizedProjectPath = normalizeProjectPathForProvider(input.provider, input.projectPath);
        projectsDb.createProjectPath(normalizedProjectPath);
        // The watcher may already have created a row for the new transcript. Its
        // id is the provider-native one, which is what this row claims, so replace
        // it rather than leaving two sidebar entries for one conversation.
        db.transaction(() => {
            db.prepare('DELETE FROM sessions WHERE session_id = ? AND session_id <> ?')
                .run(input.providerSessionId, input.sessionId);
            db.prepare(`INSERT INTO sessions (session_id, provider, provider_session_id, custom_name, project_path, jsonl_path, model, effort, forked_from_session_id, isArchived, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(input.sessionId, input.provider, input.providerSessionId, input.customName, normalizedProjectPath, input.jsonlPath, input.model, input.effort, input.forkedFromSessionId);
        })();
        return input.sessionId;
    },
    /**
     * Records the provider-native session id for one app-allocated session.
     *
     * If the filesystem watcher indexed the provider transcript before this
     * mapping was recorded (a duplicate row keyed by the provider id exists),
     * the duplicate is merged into the app row: its transcript path and name
     * are adopted and the duplicate row is removed. Runs in a transaction so
     * the sidebar can never observe both rows at once.
     */
    assignProviderSessionId(sessionId, providerSessionId) {
        const db = getConnection();
        const merge = db.transaction(() => {
            const duplicate = db
                .prepare(`SELECT ${SESSION_ROW_COLUMNS} FROM sessions
           WHERE (session_id = ? OR provider_session_id = ?)
             AND session_id <> ?
           LIMIT 1`)
                .get(providerSessionId, providerSessionId, sessionId);
            if (duplicate) {
                db.prepare('DELETE FROM sessions WHERE session_id = ?').run(duplicate.session_id);
                db.prepare(`UPDATE sessions SET
             provider_session_id = ?,
             jsonl_path = COALESCE(jsonl_path, ?),
             custom_name = COALESCE(custom_name, ?),
             updated_at = CURRENT_TIMESTAMP
           WHERE session_id = ?`).run(providerSessionId, duplicate.jsonl_path, duplicate.custom_name, sessionId);
                return;
            }
            db.prepare(`UPDATE sessions SET
           provider_session_id = ?,
           updated_at = CURRENT_TIMESTAMP
         WHERE session_id = ?`).run(providerSessionId, sessionId);
        });
        merge();
    },
    /**
     * Moves one session onto a different provider session and transcript.
     *
     * Only editing a message on a provider that has to branch to rewind (Codex)
     * does this — an ordinary run keeps the same provider session for its whole
     * life. `assignProviderSessionId` cannot be used for it: that one keeps the
     * existing `jsonl_path` on purpose, so a session repointed with it would
     * claim the new thread while still reading the old transcript.
     *
     * The watcher may already have indexed the new transcript under its own id.
     * That row is the same conversation this one is about to become, so it is
     * replaced rather than left behind as a second sidebar entry.
     */
    repointSessionToProviderSession(sessionId, input) {
        const db = getConnection();
        db.transaction(() => {
            db.prepare('DELETE FROM sessions WHERE session_id = ? AND session_id <> ?')
                .run(input.providerSessionId, sessionId);
            db.prepare(`UPDATE sessions SET
           provider_session_id = ?,
           jsonl_path = ?,
           updated_at = CURRENT_TIMESTAMP
         WHERE session_id = ?`).run(input.providerSessionId, input.jsonlPath, sessionId);
        })();
    },
    /**
     * Detaches a session from its provider session so the next run starts a new
     * one.
     *
     * Used when an edit replaces the very first prompt: there is no conversation
     * left to branch from, so the session starts over instead.
     */
    detachProviderSession(sessionId) {
        const db = getConnection();
        db.prepare(`UPDATE sessions SET
         provider_session_id = NULL,
         jsonl_path = NULL,
         updated_at = CURRENT_TIMESTAMP
       WHERE session_id = ?`).run(sessionId);
    },
    /**
     * Records that a session has left a provider session behind for good.
     *
     * The transcript stays on disk, which is deliberate — the abandoned attempt
     * is recoverable — but the indexer must not offer it back, and on a session
     * discovered from disk (whose app id *is* the provider id) rediscovering it
     * would repoint the row at the conversation the user edited away from.
     */
    markProviderSessionSuperseded(input) {
        const db = getConnection();
        db.prepare(`INSERT INTO superseded_provider_sessions (provider_session_id, provider, session_id, jsonl_path)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(provider_session_id, provider) DO UPDATE SET
         session_id = excluded.session_id,
         jsonl_path = excluded.jsonl_path,
         created_at = CURRENT_TIMESTAMP`).run(input.providerSessionId, input.provider, input.sessionId, input.jsonlPath);
    },
    isProviderSessionSuperseded(providerSessionId, provider) {
        const db = getConnection();
        const row = db
            .prepare(`SELECT 1 AS found FROM superseded_provider_sessions
         WHERE provider_session_id = ? AND provider = ?
         LIMIT 1`)
            .get(providerSessionId, provider);
        return Boolean(row);
    },
    /**
     * Transcripts one session has left behind, for the caller that deletes a
     * conversation from disk.
     *
     * A conversation edited more than once has lived in more than one file, and
     * the session row only ever points at the newest.
     */
    getSupersededTranscriptPaths(sessionId) {
        const db = getConnection();
        const rows = db
            .prepare(`SELECT jsonl_path FROM superseded_provider_sessions
         WHERE session_id = ? AND jsonl_path IS NOT NULL`)
            .all(sessionId);
        return rows.map((row) => row.jsonl_path);
    },
    /**
     * Forgets what a session left behind, once the session itself is gone.
     *
     * Without this the record outlives the row it was written for and keeps the
     * indexer refusing a transcript that no longer belongs to anything — a
     * conversation invisible to the app and impossible to delete through it.
     */
    clearSupersededProviderSessions(sessionId) {
        const db = getConnection();
        db.prepare('DELETE FROM superseded_provider_sessions WHERE session_id = ?').run(sessionId);
    },
    /**
     * Records the model one session runs with.
     *
     * Called both when the user picks a model for the session and on every send,
     * so the row always reflects what the session last ran with and reopening it
     * restores that model instead of a catalog default.
     */
    setSessionModel(sessionId, model) {
        const db = getConnection();
        db.prepare(`UPDATE sessions
       SET model = ?
       WHERE session_id = ?`).run(model, sessionId);
    },
    /**
     * Records the reasoning effort one session runs with.
     *
     * `default` is stored as an explicit choice rather than NULL so reopening
     * the session does not inherit a later per-provider effort preference.
     */
    setSessionEffort(sessionId, effort) {
        const db = getConnection();
        db.prepare(`UPDATE sessions
       SET effort = ?
       WHERE session_id = ?`).run(effort, sessionId);
    },
    updateSessionCustomName(sessionId, customName) {
        const db = getConnection();
        db.prepare(`UPDATE sessions
       SET custom_name = ?
       WHERE session_id = ?`).run(customName, sessionId);
    },
    getSessionById(sessionId) {
        const db = getConnection();
        const row = db
            .prepare(`SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE session_id = ?
         ORDER BY updated_at DESC
         LIMIT 1`)
            .get(sessionId);
        return normalizeSessionRow(row) ?? null;
    },
    /**
     * Resolves one session row through the provider-native id.
     *
     * The filesystem watcher only knows provider ids (they come from transcript
     * file names), so it uses this lookup to translate disk artifacts back to
     * the app-facing session row before broadcasting sidebar updates.
     */
    getSessionByProviderSessionId(providerSessionId) {
        const db = getConnection();
        const row = db
            .prepare(`SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE provider_session_id = ?
         ORDER BY updated_at DESC
         LIMIT 1`)
            .get(providerSessionId);
        return normalizeSessionRow(row) ?? null;
    },
    /**
     * Finds the newest app-created session for a project that is still waiting
     * for its provider-native id to be recorded.
     *
     * Primary intention: OpenCode can expose a new session in its shared
     * `opencode.db` before the websocket runtime reports that same provider id
     * back to our app. At that moment the sidebar already has an optimistic
     * app-owned session row, but the watcher only knows the provider-native id.
     *
     * Without this lookup, the synchronizer would insert a second row keyed by
     * the provider id, then `assignProviderSessionId()` would merge it a moment
     * later. That eventually self-heals, but on slow networks the user can still
     * briefly see two sidebar sessions for the same conversation.
     *
     * This helper lets the synchronizer claim the pending app row first, so the
     * provider id is attached before any watcher-created row exists. The result
     * is simpler than frontend dedupe and keeps the race resolved at the source.
     */
    findLatestPendingAppSession(provider, projectPath) {
        const db = getConnection();
        const normalizedProjectPath = normalizeProjectPathForProvider(provider, projectPath);
        const row = db
            .prepare(`SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE provider = ?
           AND project_path = ?
           AND provider_session_id IS NULL
           AND isArchived = 0
         ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, session_id DESC
         LIMIT 1`)
            .get(provider, normalizedProjectPath);
        return normalizeSessionRow(row) ?? null;
    },
    getAllSessions() {
        const db = getConnection();
        const rows = db
            .prepare(`SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE isArchived = 0`)
            .all();
        return normalizeSessionRows(rows);
    },
    /**
     * Returns one globally ordered page of visible conversations.
     *
     * Pagination happens after archived sessions and sessions belonging to an
     * archived project have been excluded. This keeps the sidebar feed complete
     * and correctly ordered across projects instead of flattening only the
     * per-project slices already loaded by the client.
     */
    getRecentSessionsPage(limit, offset) {
        const db = getConnection();
        const visibilityClause = `
      sessions.isArchived = 0
      AND (projects.isArchived IS NULL OR projects.isArchived = 0)
    `;
        const rows = db
            .prepare(`SELECT sessions.*
         FROM sessions
         LEFT JOIN projects ON projects.project_path = sessions.project_path
         WHERE ${visibilityClause}
         ORDER BY julianday(COALESCE(sessions.updated_at, sessions.created_at)) DESC,
                  sessions.session_id DESC
         LIMIT ? OFFSET ?`)
            .all(limit, offset);
        const countRow = db
            .prepare(`SELECT COUNT(*) AS count
         FROM sessions
         LEFT JOIN projects ON projects.project_path = sessions.project_path
         WHERE ${visibilityClause}`)
            .get();
        return {
            sessions: normalizeSessionRows(rows),
            total: Number(countRow?.count ?? 0),
        };
    },
    /**
     * Archived rows are intentionally queried separately so the caller can render
     * them in a dedicated view without reintroducing them into active session lists.
     */
    getArchivedSessions() {
        const db = getConnection();
        const rows = db
            .prepare(`SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE isArchived = 1
         ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, session_id DESC`)
            .all();
        return normalizeSessionRows(rows);
    },
    getSessionsByProjectPath(projectPath) {
        const db = getConnection();
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        const rows = db
            .prepare(`SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE project_path = ?
           AND isArchived = 0`)
            .all(normalizedProjectPath);
        return normalizeSessionRows(rows);
    },
    /**
     * Permanent project deletion must see every session row for the path,
     * including archived ones, so their transcript files can be cleaned up.
     */
    getSessionsByProjectPathIncludingArchived(projectPath) {
        const db = getConnection();
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        const rows = db
            .prepare(`SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE project_path = ?`)
            .all(normalizedProjectPath);
        return normalizeSessionRows(rows);
    },
    getSessionsByProjectPathPage(projectPath, limit, offset) {
        const db = getConnection();
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        const rows = db
            .prepare(`SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE project_path = ?
           AND isArchived = 0
         ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, session_id DESC
         LIMIT ? OFFSET ?`)
            .all(normalizedProjectPath, limit, offset);
        return normalizeSessionRows(rows);
    },
    countSessionsByProjectPath(projectPath) {
        const db = getConnection();
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        const row = db
            .prepare(`SELECT COUNT(*) AS count
         FROM sessions
         WHERE project_path = ?
           AND isArchived = 0`)
            .get(normalizedProjectPath);
        return Number(row?.count ?? 0);
    },
    deleteSessionsByProjectPath(projectPath) {
        const db = getConnection();
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        db.prepare(`DELETE FROM sessions WHERE project_path = ?`).run(normalizedProjectPath);
    },
    getSessionName(sessionId, provider) {
        const db = getConnection();
        const row = db
            .prepare(`SELECT custom_name
         FROM sessions
         WHERE session_id = ? AND provider = ?`)
            .get(sessionId, provider);
        return row?.custom_name ?? null;
    },
    /**
     * Soft-delete and restore both use the same flag update so callers keep the
     * row, metadata, and file path intact while toggling visibility.
     */
    updateSessionIsArchived(sessionId, isArchived) {
        const db = getConnection();
        db.prepare(`UPDATE sessions
       SET isArchived = ?
       WHERE session_id = ?`).run(isArchived ? 1 : 0, sessionId);
    },
    deleteSessionById(sessionId) {
        const db = getConnection();
        return db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId).changes > 0;
    },
    /**
     * Lists every indexed session that claims a transcript file on disk.
     *
     * Only rows with a `jsonl_path` are returned, which deliberately excludes
     * app-created sessions still waiting for their first provider write and
     * OpenCode rows (whose transcripts all live inside one shared sqlite file).
     * Used by the session synchronizer to find rows whose transcript has been
     * deleted underneath the index.
     */
    getSessionsWithTranscriptPath() {
        const db = getConnection();
        return db
            .prepare(`SELECT session_id, jsonl_path
         FROM sessions
         WHERE jsonl_path IS NOT NULL AND jsonl_path <> ''`)
            .all();
    },
};
//# sourceMappingURL=sessions.db.js.map