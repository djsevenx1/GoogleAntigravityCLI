import { getConnection } from '../../../modules/database/connection.js';
const toCustomProviderModelRecord = (row) => ({
    recordId: row.id,
    provider: row.provider,
    modelId: row.model_id,
    model: row.model_name,
    sortOrder: row.sort_order,
});
const readCustomProviderModelRow = (provider, recordId) => {
    const row = getConnection().prepare(`
    SELECT id, provider, model_id, model_name, sort_order
    FROM provider_models
    WHERE provider = ? AND id = ?
  `).get(provider, recordId);
    return row ?? null;
};
/**
 * Custom provider-model persistence API consumed by the Providers module.
 *
 * Every row in this repository is user-created. Predefined models are owned by
 * provider adapters and never enter this table. Model-id changes are propagated
 * to stored sessions, while deletion replaces affected session selections with
 * the predefined default supplied by the Providers service.
 */
export const providerModelsDb = {
    listCustomProviderModels(provider) {
        const rows = getConnection().prepare(`
      SELECT id, provider, model_id, model_name, sort_order
      FROM provider_models
      WHERE provider = ?
      ORDER BY sort_order ASC, lower(model_name) ASC, id ASC
    `).all(provider);
        return rows.map(toCustomProviderModelRecord);
    },
    getCustomProviderModel(provider, recordId) {
        const row = readCustomProviderModelRow(provider, recordId);
        return row ? toCustomProviderModelRecord(row) : null;
    },
    findCustomProviderModelByModelId(provider, modelId) {
        const row = getConnection().prepare(`
      SELECT id, provider, model_id, model_name, sort_order
      FROM provider_models
      WHERE provider = ? AND model_id = ?
    `).get(provider, modelId);
        return row ? toCustomProviderModelRecord(row) : null;
    },
    createCustomProviderModel(provider, input) {
        const db = getConnection();
        const nextOrder = db.prepare(`
      SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
      FROM provider_models
      WHERE provider = ?
    `).get(provider);
        const result = db.prepare(`
      INSERT INTO provider_models (provider, model_id, model_name, sort_order)
      VALUES (?, ?, ?, ?)
    `).run(provider, input.id, input.model, nextOrder.next_order);
        const row = readCustomProviderModelRow(provider, Number(result.lastInsertRowid));
        if (!row) {
            throw new Error('Created provider model could not be read back.');
        }
        return toCustomProviderModelRecord(row);
    },
    updateCustomProviderModel(provider, recordId, input) {
        const db = getConnection();
        const update = db.transaction(() => {
            const previous = readCustomProviderModelRow(provider, recordId);
            if (!previous) {
                return null;
            }
            db.prepare(`
        UPDATE provider_models
        SET model_id = ?, model_name = ?, updated_at = CURRENT_TIMESTAMP
        WHERE provider = ? AND id = ?
      `).run(input.id, input.model, provider, recordId);
            if (previous.model_id !== input.id) {
                db.prepare(`
          UPDATE sessions
          SET model = ?, updated_at = CURRENT_TIMESTAMP
          WHERE provider = ? AND model = ?
        `).run(input.id, provider, previous.model_id);
            }
            return readCustomProviderModelRow(provider, recordId);
        });
        const row = update();
        return row ? toCustomProviderModelRecord(row) : null;
    },
    deleteCustomProviderModel(provider, recordId, fallbackModelId) {
        const db = getConnection();
        const remove = db.transaction(() => {
            const row = readCustomProviderModelRow(provider, recordId);
            if (!row) {
                return null;
            }
            // The effort is cleared alongside the model because it was chosen for the
            // deleted model; replaced sessions resume on the fallback model's default.
            db.prepare(`
        UPDATE sessions
        SET model = ?, effort = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE provider = ? AND model = ?
      `).run(fallbackModelId, provider, row.model_id);
            db.prepare(`
        DELETE FROM provider_models
        WHERE provider = ? AND id = ?
      `).run(provider, recordId);
            return row;
        });
        const row = remove();
        return row ? toCustomProviderModelRecord(row) : null;
    },
};
//# sourceMappingURL=provider-models.js.map