import { IS_PLATFORM } from '../../shared/utils.js';
/**
 * Resolves the runtime label exposed by Browser Use status and session APIs.
 * The Browser Use service and CLI environment-mode regression coverage consume
 * this after the server or CLI entrypoint has completed environment bootstrapping.
 */
export function getBrowserUseRuntime() {
    return IS_PLATFORM ? 'cloud' : 'local';
}
//# sourceMappingURL=browser-use-runtime.js.map