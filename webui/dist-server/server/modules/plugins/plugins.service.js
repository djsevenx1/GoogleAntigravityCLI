import { AppError } from '../../shared/utils.js';
function validatePluginName(pluginName) {
    if (!/^[a-zA-Z0-9_-]+$/.test(pluginName)) {
        throw new AppError('Invalid plugin name', { code: 'INVALID_PLUGIN_NAME', statusCode: 400 });
    }
}
function normalizePluginManifest(value) {
    if (typeof value !== 'object' || value === null) {
        throw new AppError('Plugin manifest is invalid', {
            code: 'INVALID_PLUGIN_MANIFEST',
            statusCode: 400,
        });
    }
    const manifest = value;
    if (typeof manifest.name !== 'string') {
        throw new AppError('Plugin manifest is missing its name', {
            code: 'INVALID_PLUGIN_MANIFEST',
            statusCode: 400,
        });
    }
    return manifest;
}
/** Creates plugin-management workflows around loader and process adapters. */
export function createPluginsService(dependencies) {
    async function startServerIfAvailable(plugin) {
        if (!plugin.server || dependencies.isServerRunning(plugin.name))
            return;
        const pluginDirectory = dependencies.getPluginDirectory(plugin.name);
        if (!pluginDirectory)
            return;
        try {
            await dependencies.startServer(plugin.name, pluginDirectory, plugin.server);
        }
        catch (error) {
            dependencies.logError(`Failed to start plugin server for ${plugin.name}`, error);
        }
    }
    return {
        list() {
            return {
                plugins: dependencies.scanPlugins().map((plugin) => ({
                    ...plugin,
                    serverRunning: plugin.server ? dependencies.isServerRunning(plugin.name) : false,
                })),
            };
        },
        getManifest(pluginName) {
            validatePluginName(pluginName);
            const plugin = dependencies.scanPlugins().find((candidate) => candidate.name === pluginName);
            if (!plugin)
                throw new AppError('Plugin not found', { code: 'PLUGIN_NOT_FOUND', statusCode: 404 });
            return plugin;
        },
        resolveAsset(pluginName, assetPath) {
            validatePluginName(pluginName);
            if (!assetPath)
                throw new AppError('No asset path specified', { code: 'PLUGIN_ASSET_REQUIRED', statusCode: 400 });
            const resolvedPath = dependencies.resolveAsset(pluginName, assetPath);
            if (!resolvedPath || !dependencies.assetIsFile(resolvedPath)) {
                throw new AppError('Asset not found', { code: 'PLUGIN_ASSET_NOT_FOUND', statusCode: 404 });
            }
            return { path: resolvedPath, contentType: dependencies.contentType(resolvedPath) };
        },
        async setEnabled(pluginName, enabled) {
            validatePluginName(pluginName);
            if (typeof enabled !== 'boolean') {
                throw new AppError('"enabled" must be a boolean', { code: 'INVALID_PLUGIN_ENABLED', statusCode: 400 });
            }
            const plugin = this.getManifest(pluginName);
            const config = dependencies.readConfig();
            config[pluginName] = { ...config[pluginName], enabled };
            dependencies.saveConfig(config);
            if (plugin.server && enabled)
                await startServerIfAvailable(plugin);
            if (plugin.server && !enabled && dependencies.isServerRunning(pluginName)) {
                await dependencies.stopServer(pluginName);
            }
            return { success: true, name: pluginName, enabled };
        },
        async install(urlInput) {
            const url = typeof urlInput === 'string' ? urlInput.trim() : '';
            if (!url || (!url.startsWith('https://') && !url.startsWith('git@'))) {
                throw new AppError('URL must start with https:// or git@', { code: 'INVALID_PLUGIN_URL', statusCode: 400 });
            }
            const plugin = normalizePluginManifest(await dependencies.install(url));
            await startServerIfAvailable(plugin);
            return { success: true, plugin };
        },
        async update(pluginName) {
            validatePluginName(pluginName);
            const wasRunning = dependencies.isServerRunning(pluginName);
            if (wasRunning)
                await dependencies.stopServer(pluginName);
            const plugin = normalizePluginManifest(await dependencies.update(pluginName));
            if (wasRunning)
                await startServerIfAvailable(plugin);
            return { success: true, plugin };
        },
        async prepareRpc(pluginName) {
            validatePluginName(pluginName);
            let port = dependencies.getServerPort(pluginName);
            if (!port) {
                const plugin = this.getManifest(pluginName);
                if (!plugin.server)
                    throw new AppError('Plugin server is not running', { code: 'PLUGIN_SERVER_UNAVAILABLE', statusCode: 503 });
                if (!plugin.enabled)
                    throw new AppError('Plugin is disabled', { code: 'PLUGIN_DISABLED', statusCode: 503 });
                const pluginDirectory = dependencies.joinPath(dependencies.getPluginsDirectory(), plugin.dirName ?? plugin.name);
                port = await dependencies.startServer(pluginName, pluginDirectory, plugin.server);
            }
            const secrets = dependencies.readConfig()[pluginName]?.secrets ?? {};
            return { port, secrets };
        },
        async uninstall(pluginName) {
            validatePluginName(pluginName);
            if (dependencies.isServerRunning(pluginName))
                await dependencies.stopServer(pluginName);
            await dependencies.uninstall(pluginName);
            return { success: true, name: pluginName };
        },
    };
}
//# sourceMappingURL=plugins.service.js.map