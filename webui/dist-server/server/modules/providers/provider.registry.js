import { AntigravityProvider } from '../../modules/providers/list/antigravity/antigravity.provider.js';
import { AppError } from '../../shared/utils.js';
const providers = {
    antigravity: new AntigravityProvider(),
};
/**
 * Central registry for resolving concrete provider implementations by id.
 */
export const providerRegistry = {
    listProviders() {
        return Object.values(providers);
    },
    resolveProvider(provider) {
        const key = provider;
        const resolvedProvider = providers[key];
        if (!resolvedProvider) {
            throw new AppError(`Unsupported provider "${provider}".`, {
                code: 'UNSUPPORTED_PROVIDER',
                statusCode: 400,
            });
        }
        return resolvedProvider;
    },
};
//# sourceMappingURL=provider.registry.js.map