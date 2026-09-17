import { useEffect, useMemo, useState } from 'react';

import type { AgentCategory, AgentContextByProvider, AgentProvider, AgentSettingsProject, AntigravityPermissionMode, AntigravityPermissionsState, ClaudePermissionsState, CodexPermissionMode, CursorPermissionsState, ProviderAuthStatus } from '@/shared/types';
import AgentCategoryContentSection from '@/modules/settings/tabs/agents-settings/sections/AgentCategoryContentSection';
import AgentCategoryTabsSection from '@/modules/settings/tabs/agents-settings/sections/AgentCategoryTabsSection';
import AgentSelectorSection from '@/modules/settings/tabs/agents-settings/sections/AgentSelectorSection';

type ProviderAuthStatusByProvider = Record<AgentProvider, ProviderAuthStatus>;

type AgentsSettingsTabProps = {
  providerAuthStatus: ProviderAuthStatusByProvider;
  onProviderLogin: (provider: AgentProvider) => void;
  antigravityPermissions?: AntigravityPermissionsState;
  onAntigravityPermissionsChange?: (value: AntigravityPermissionsState) => void;
  antigravityPermissionMode?: AntigravityPermissionMode;
  onAntigravityPermissionModeChange?: (value: AntigravityPermissionMode) => void;
  claudePermissions: ClaudePermissionsState;
  onClaudePermissionsChange: (value: ClaudePermissionsState) => void;
  cursorPermissions: CursorPermissionsState;
  onCursorPermissionsChange: (value: CursorPermissionsState) => void;
  codexPermissionMode: CodexPermissionMode;
  onCodexPermissionModeChange: (value: CodexPermissionMode) => void;
  projects: AgentSettingsProject[];
  onRefreshProviderAuth?: () => void;
};

/** Rendered by Settings for the "agents" tab, hosting per-provider account, permission, MCP and skill settings. */
export default function AgentsSettingsTab({
  providerAuthStatus,
  onProviderLogin,
  antigravityPermissions,
  onAntigravityPermissionsChange,
  antigravityPermissionMode,
  onAntigravityPermissionModeChange,
  claudePermissions,
  onClaudePermissionsChange,
  cursorPermissions,
  onCursorPermissionsChange,
  codexPermissionMode,
  onCodexPermissionModeChange,
  projects,
  onRefreshProviderAuth,
}: AgentsSettingsTabProps) {
  const [selectedAgent, setSelectedAgent] = useState<AgentProvider>('antigravity');
  const [selectedCategory, setSelectedCategory] = useState<AgentCategory>('account');
  const visibleCategories = useMemo<AgentCategory[]>(() => {
    if (selectedAgent === 'antigravity') {
      return ['account', 'proxy', 'permissions', 'mcp', 'skills'];
    }
    return ['account', 'permissions', 'mcp', 'skills'];
  }, [selectedAgent]);

  const visibleAgents = useMemo<AgentProvider[]>(() => {
    return ['antigravity'];
  }, []);

  const agentContextById = useMemo<AgentContextByProvider>(() => ({
    claude: {
      authStatus: providerAuthStatus.claude,
      onLogin: () => onProviderLogin('claude'),
    },
    cursor: {
      authStatus: providerAuthStatus.cursor,
      onLogin: () => onProviderLogin('cursor'),
    },
    codex: {
      authStatus: providerAuthStatus.codex,
      onLogin: () => onProviderLogin('codex'),
    },
    opencode: {
      authStatus: providerAuthStatus.opencode,
      onLogin: () => onProviderLogin('opencode'),
    },
    antigravity: {
      authStatus: providerAuthStatus.antigravity,
      onLogin: () => onProviderLogin('antigravity'),
    },
  }), [
    onProviderLogin,
    providerAuthStatus.claude,
    providerAuthStatus.codex,
    providerAuthStatus.cursor,
    providerAuthStatus.opencode,
    providerAuthStatus.antigravity,
  ]);

  useEffect(() => {
    if (!visibleCategories.includes(selectedCategory)) {
      setSelectedCategory(visibleCategories[0] ?? 'account');
    }
  }, [selectedCategory, visibleCategories]);

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
      {visibleAgents.length > 1 && (
        <AgentSelectorSection
          agents={visibleAgents}
          selectedAgent={selectedAgent}
          onSelectAgent={setSelectedAgent}
          agentContextById={agentContextById}
        />
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AgentCategoryTabsSection
          categories={visibleCategories}
          selectedAgent={selectedAgent}
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
        />

        <AgentCategoryContentSection
          selectedAgent={selectedAgent}
          selectedCategory={selectedCategory}
          agentContextById={agentContextById}
          antigravityPermissions={antigravityPermissions}
          onAntigravityPermissionsChange={onAntigravityPermissionsChange}
          antigravityPermissionMode={antigravityPermissionMode}
          onAntigravityPermissionModeChange={onAntigravityPermissionModeChange}
          claudePermissions={claudePermissions}
          onClaudePermissionsChange={onClaudePermissionsChange}
          cursorPermissions={cursorPermissions}
          onCursorPermissionsChange={onCursorPermissionsChange}
          codexPermissionMode={codexPermissionMode}
          onCodexPermissionModeChange={onCodexPermissionModeChange}
          projects={projects}
          onRefreshAuth={onRefreshProviderAuth}
          onSelectCategory={setSelectedCategory}
        />
      </div>
    </div>
  );
}
