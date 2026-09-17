import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { McpProvider } from '@/modules/providers/shared/mcp/mcp.provider.js';
import type { McpScope, ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';
import {
  AppError,
  readJsonConfig,
  readObjectRecord,
  readOptionalString,
  readStringArray,
  readStringRecord,
  writeJsonConfig,
} from '@/shared/utils.js';
import { resolveAntigravityStateDir } from './antigravity-auth.provider.js';

export class AntigravityMcpProvider extends McpProvider {
  constructor() {
    super('antigravity', ['user', 'project'], ['stdio', 'http']);
  }

  private getUserConfigPaths(): string[] {
    const stateDir = resolveAntigravityStateDir();
    return [
      path.join(stateDir, 'mcp_config.json'),
      path.join(stateDir, 'mcp.json'),
      path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json'),
    ];
  }

  private getProjectConfigPaths(workspacePath: string): string[] {
    return [
      path.join(workspacePath, '.agents', 'mcp_config.json'),
      path.join(workspacePath, '.antigravity', 'mcp.json'),
      path.join(workspacePath, 'mcp_config.json'),
    ];
  }

  protected async readScopedServers(scope: McpScope, workspacePath: string): Promise<Record<string, unknown>> {
    const candidatePaths = scope === 'user'
      ? this.getUserConfigPaths()
      : this.getProjectConfigPaths(workspacePath);

    const merged: Record<string, unknown> = {};
    // Read in reverse order so higher-priority paths override
    for (let i = candidatePaths.length - 1; i >= 0; i--) {
      const filePath = candidatePaths[i];
      if (fs.existsSync(filePath)) {
        const config = await readJsonConfig(filePath);
        const servers = readObjectRecord(config.mcpServers) ?? {};
        Object.assign(merged, servers);
      }
    }
    return merged;
  }

  protected async writeScopedServers(
    scope: McpScope,
    workspacePath: string,
    servers: Record<string, unknown>,
  ): Promise<void> {
    const primaryPath = scope === 'user'
      ? path.join(resolveAntigravityStateDir(), 'mcp_config.json')
      : path.join(workspacePath, '.agents', 'mcp_config.json');

    const config = await readJsonConfig(primaryPath);
    config.mcpServers = servers;
    await writeJsonConfig(primaryPath, config);

    // Also sync mcp.json if it already exists in user or project dir
    const legacyPath = scope === 'user'
      ? path.join(resolveAntigravityStateDir(), 'mcp.json')
      : path.join(workspacePath, '.antigravity', 'mcp.json');
    if (fs.existsSync(legacyPath)) {
      const legacyConfig = await readJsonConfig(legacyPath);
      legacyConfig.mcpServers = servers;
      await writeJsonConfig(legacyPath, legacyConfig);
    }
  }

  protected buildServerConfig(input: UpsertProviderMcpServerInput): Record<string, unknown> {
    if (input.transport === 'stdio') {
      if (!input.command?.trim()) {
        throw new AppError('command is required for stdio MCP servers.', {
          code: 'MCP_COMMAND_REQUIRED',
          statusCode: 400,
        });
      }

      return {
        command: input.command,
        args: input.args ?? [],
        env: input.env ?? {},
        ...(input.cwd ? { cwd: input.cwd } : {}),
      };
    }

    if (!input.url?.trim()) {
      throw new AppError('url is required for http MCP servers.', {
        code: 'MCP_URL_REQUIRED',
        statusCode: 400,
      });
    }

    return {
      serverUrl: input.url,
      url: input.url,
      headers: input.headers ?? {},
    };
  }

  protected normalizeServerConfig(
    scope: McpScope,
    name: string,
    rawConfig: unknown,
  ): ProviderMcpServer | null {
    const config = readObjectRecord(rawConfig);
    if (!config) {
      return null;
    }

    if (config.command !== undefined) {
      const command = readOptionalString(config.command);
      if (!command) {
        return null;
      }

      return {
        provider: 'antigravity',
        name,
        scope,
        transport: 'stdio',
        command,
        args: readStringArray(config.args) ?? [],
        env: readStringRecord(config.env),
        cwd: readOptionalString(config.cwd),
      };
    }

    const url = readOptionalString(config.serverUrl) || readOptionalString(config.url);
    if (url) {
      return {
        provider: 'antigravity',
        name,
        scope,
        transport: 'http',
        url,
        headers: readStringRecord(config.headers),
      };
    }

    return null;
  }
}
