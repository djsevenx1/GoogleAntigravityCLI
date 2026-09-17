import { providerRegistry } from '../../../modules/providers/provider.registry.js';
import { providerModelsService } from '../../../modules/providers/services/provider-models.service.js';
import { sessionsService } from '../../../modules/providers/services/sessions.service.js';
const defaultDependencies = {
    listProviders: () => providerRegistry.listProviders(),
    resolveProvider: (provider) => providerRegistry.resolveProvider(provider),
    resolveProviderSessionId: (sessionId) => sessionsService.resolveProviderSessionId(sessionId),
    resolveResumeModel: (provider, sessionId, requestedModel) => providerModelsService.resolveResumeModel(provider, sessionId, requestedModel),
    getProviderModels: (provider) => providerModelsService.getProviderModels(provider),
};
/**
 * Creates the application-facing provider runtime dispatcher.
 *
 * The provider registry owns each concrete runtime. This service supplies the
 * registry-backed model/session lookups at execution time so runtime adapters
 * never import services that resolve back through the registry.
 */
export function createProviderRuntimeService(dependencyOverrides = {}) {
    const dependencies = { ...defaultDependencies, ...dependencyOverrides };
    const createRuntimeContext = (provider) => ({
        resolveProviderSessionId: dependencies.resolveProviderSessionId,
        resolveResumeModel: (sessionId, requestedModel) => dependencies.resolveResumeModel(provider.id, sessionId, requestedModel),
        getProviderModels: async () => dependencies.getProviderModels(provider.id),
        normalizeMessage: (raw, sessionId) => provider.sessions.normalizeMessage(raw, sessionId),
        async isProviderInstalled() {
            try {
                return (await provider.auth.getStatus()).installed;
            }
            catch {
                // Preserve the runtime's original error when installation probing fails.
                return true;
            }
        },
    });
    const run = (providerName, command, options, writer) => {
        const provider = dependencies.resolveProvider(providerName);
        return provider.runtime.run(command, options, writer, createRuntimeContext(provider));
    };
    return {
        run,
        hasRuntime(providerName) {
            try {
                return Boolean(dependencies.resolveProvider(providerName).runtime);
            }
            catch {
                return false;
            }
        },
        getRunner(provider) {
            return (command, options, writer) => run(provider, command, options, writer);
        },
        async abort(providerName, sessionId) {
            return Boolean(await dependencies.resolveProvider(providerName).runtime.abort(sessionId));
        },
        resolveToolApproval(requestId, decision) {
            for (const provider of dependencies.listProviders()) {
                provider.runtime.permissions?.resolve(requestId, decision);
            }
        },
        getPendingApprovalsForSession(sessionId) {
            return dependencies.listProviders().flatMap((provider) => provider.runtime.permissions?.listPending(sessionId) ?? []);
        },
    };
}
export const providerRuntimeService = createProviderRuntimeService();
//# sourceMappingURL=provider-runtime.service.js.map