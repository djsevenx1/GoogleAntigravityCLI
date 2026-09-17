import { AppError } from '../../shared/utils.js';
function requiredString(value, fieldName, code) {
    const normalizedValue = typeof value === 'string' ? value.trim() : '';
    if (!normalizedValue) {
        throw new AppError(`${fieldName} is required`, { code, statusCode: 400 });
    }
    return normalizedValue;
}
function assertFound(found, resourceName, code) {
    if (!found) {
        throw new AppError(`${resourceName} not found`, { code, statusCode: 404 });
    }
}
/** Creates settings workflows with repositories and notification effects injected. */
export function createSettingsService(dependencies) {
    return {
        listApiKeys(userId) {
            const apiKeys = dependencies.apiKeys.list(userId).map((key) => ({
                ...key,
                api_key: `${key.api_key.substring(0, 10)}...`,
            }));
            return { apiKeys };
        },
        createApiKey(userId, keyNameInput) {
            const keyName = requiredString(keyNameInput, 'Key name', 'API_KEY_NAME_REQUIRED');
            return { success: true, apiKey: dependencies.apiKeys.create(userId, keyName) };
        },
        deleteApiKey(userId, keyId) {
            assertFound(dependencies.apiKeys.remove(userId, keyId), 'API key', 'API_KEY_NOT_FOUND');
            return { success: true };
        },
        toggleApiKey(userId, keyId, isActive) {
            if (typeof isActive !== 'boolean') {
                throw new AppError('isActive must be a boolean', {
                    code: 'INVALID_ACTIVE_STATE',
                    statusCode: 400,
                });
            }
            assertFound(dependencies.apiKeys.toggle(userId, keyId, isActive), 'API key', 'API_KEY_NOT_FOUND');
            return { success: true };
        },
        listCredentials(userId, credentialType) {
            return { credentials: dependencies.credentials.list(userId, credentialType) };
        },
        createCredential(userId, input) {
            const credentialName = requiredString(input.credentialName, 'Credential name', 'CREDENTIAL_NAME_REQUIRED');
            const credentialType = requiredString(input.credentialType, 'Credential type', 'CREDENTIAL_TYPE_REQUIRED');
            const credentialValue = requiredString(input.credentialValue, 'Credential value', 'CREDENTIAL_VALUE_REQUIRED');
            const description = typeof input.description === 'string'
                ? input.description.trim() || null
                : null;
            return {
                success: true,
                credential: dependencies.credentials.create(userId, credentialName, credentialType, credentialValue, description),
            };
        },
        deleteCredential(userId, credentialId) {
            assertFound(dependencies.credentials.remove(userId, credentialId), 'Credential', 'CREDENTIAL_NOT_FOUND');
            return { success: true };
        },
        toggleCredential(userId, credentialId, isActive) {
            if (typeof isActive !== 'boolean') {
                throw new AppError('isActive must be a boolean', {
                    code: 'INVALID_ACTIVE_STATE',
                    statusCode: 400,
                });
            }
            assertFound(dependencies.credentials.toggle(userId, credentialId, isActive), 'Credential', 'CREDENTIAL_NOT_FOUND');
            return { success: true };
        },
        getNotificationPreferences(userId) {
            return { success: true, preferences: dependencies.notifications.getPreferences(userId) };
        },
        updateNotificationPreferences(userId, preferences) {
            return {
                success: true,
                preferences: dependencies.notifications.updatePreferences(userId, preferences),
            };
        },
        getVapidPublicKey() {
            return { publicKey: dependencies.getVapidPublicKey() };
        },
        subscribeToPush(userId, input) {
            const endpoint = requiredString(input.endpoint, 'Endpoint', 'PUSH_SUBSCRIPTION_REQUIRED');
            const keys = typeof input.keys === 'object' && input.keys !== null
                ? input.keys
                : {};
            const p256dh = requiredString(keys.p256dh, 'p256dh', 'PUSH_SUBSCRIPTION_REQUIRED');
            const auth = requiredString(keys.auth, 'auth', 'PUSH_SUBSCRIPTION_REQUIRED');
            dependencies.pushSubscriptions.save(userId, endpoint, p256dh, auth);
            const currentPreferences = dependencies.notifications.getPreferences(userId);
            if (!currentPreferences?.channels?.webPush) {
                dependencies.notifications.updatePreferences(userId, {
                    ...currentPreferences,
                    channels: { ...currentPreferences?.channels, webPush: true },
                });
            }
            const event = dependencies.notifications.createEnabledEvent();
            void dependencies.notifications.notifyUser(userId, event);
            return { success: true };
        },
        unsubscribeFromPush(userId, endpointInput) {
            const endpoint = requiredString(endpointInput, 'Endpoint', 'PUSH_ENDPOINT_REQUIRED');
            dependencies.pushSubscriptions.remove(endpoint);
            const currentPreferences = dependencies.notifications.getPreferences(userId);
            if (currentPreferences?.channels?.webPush) {
                dependencies.notifications.updatePreferences(userId, {
                    ...currentPreferences,
                    channels: { ...currentPreferences.channels, webPush: false },
                });
            }
            return { success: true };
        },
    };
}
//# sourceMappingURL=settings.service.js.map