import express from 'express';
function userId(req) {
    return Number(req.user?.id);
}
function queryString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}
/** Creates thin Settings transport handlers around the application service. */
export function createSettingsRouter(service) {
    const router = express.Router();
    const respond = (operation) => async (req, res, next) => {
        try {
            res.json(await operation(req));
        }
        catch (error) {
            next(error);
        }
    };
    router.get('/api-keys', respond((req) => service.listApiKeys(userId(req))));
    router.post('/api-keys', respond((req) => service.createApiKey(userId(req), req.body?.keyName)));
    router.delete('/api-keys/:keyId', respond((req) => service.deleteApiKey(userId(req), Number(req.params.keyId))));
    router.patch('/api-keys/:keyId/toggle', respond((req) => service.toggleApiKey(userId(req), Number(req.params.keyId), req.body?.isActive)));
    router.get('/credentials', respond((req) => service.listCredentials(userId(req), queryString(req.query.type))));
    router.post('/credentials', respond((req) => service.createCredential(userId(req), req.body ?? {})));
    router.delete('/credentials/:credentialId', respond((req) => service.deleteCredential(userId(req), Number(req.params.credentialId))));
    router.patch('/credentials/:credentialId/toggle', respond((req) => service.toggleCredential(userId(req), Number(req.params.credentialId), req.body?.isActive)));
    router.get('/notification-preferences', respond((req) => service.getNotificationPreferences(userId(req))));
    router.put('/notification-preferences', respond((req) => service.updateNotificationPreferences(userId(req), req.body ?? {})));
    router.get('/push/vapid-public-key', respond(() => service.getVapidPublicKey()));
    router.post('/push/subscribe', respond((req) => service.subscribeToPush(userId(req), req.body ?? {})));
    router.post('/push/unsubscribe', respond((req) => service.unsubscribeFromPush(userId(req), req.body?.endpoint)));
    return router;
}
//# sourceMappingURL=settings.routes.js.map