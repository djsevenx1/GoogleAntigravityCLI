import type { AgentCategory, AgentContextByProvider, AgentProvider, AgentSettingsProject, AntigravityPermissionMode, AntigravityPermissionsState, ClaudePermissionsState, CodexPermissionMode, CursorPermissionsState, McpProject, SkillsProject } from '@/shared/types';
import { McpServers } from '@/modules/mcp';
import { ProviderSkills } from '@/modules/skills';
import AccountContent from '@/modules/settings/tabs/agents-settings/sections/content/AccountContent';
import PermissionsContent from '@/modules/settings/tabs/agents-settings/sections/content/PermissionsContent';
import AntigravityProxySection from '@/modules/settings/tabs/agents-settings/sections/content/AntigravityProxySection';

type AgentCategoryContentSectionProps = {
  selectedAgent: AgentProvider;
  selectedCategory: AgentCategory;
  agentContextById: AgentContextByProvider;
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
  onRefreshAuth?: () => void;
  onSelectCategory?: (category: AgentCategory) => void;
};

/** Rendered by AgentsSettingsTab to show the panel for the selected provider and category. */
export default function AgentCategoryContentSection({
  selectedAgent,
  selectedCategory,
  agentContextById,
  antigravityPermissions = { permissionMode: 'default', skipPermissions: false },
  onAntigravityPermissionsChange = () => {},
  antigravityPermissionMode = 'default',
  onAntigravityPermissionModeChange = () => {},
  claudePermissions,
  onClaudePermissionsChange,
  cursorPermissions,
  onCursorPermissionsChange,
  codexPermissionMode,
  onCodexPermissionModeChange,
  projects,
  onRefreshAuth,
  onSelectCategory,
}: AgentCategoryContentSectionProps) {
  return (
    <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-3 md:p-4">
      {selectedCategory === 'account' && (
        <AccountContent
          agent={selectedAgent}
          authStatus={agentContextById[selectedAgent].authStatus}
          onLogin={agentContextById[selectedAgent].onLogin}
          onRefreshAuth={onRefreshAuth}
          onNavigateToProxy={() => onSelectCategory?.('proxy')}
        />
      )}

      {selectedCategory === 'proxy' && selectedAgent === 'antigravity' && (
        <AntigravityProxySection
          onNavigateToAccounts={() => onSelectCategory?.('account')}
        />
      )}

      {selectedCategory === 'permissions' && selectedAgent === 'antigravity' && (
        <PermissionsContent
          agent="antigravity"
          permissionMode={antigravityPermissionMode}
          onPermissionModeChange={onAntigravityPermissionModeChange}
          skipPermissions={antigravityPermissions.skipPermissions}
          onSkipPermissionsChange={(value) => {
            onAntigravityPermissionsChange({ ...antigravityPermissions, skipPermissions: value });
          }}
        />
      )}

      {selectedCategory === 'permissions' && selectedAgent === 'claude' && (
        <PermissionsContent
          agent="claude"
          skipPermissions={claudePermissions.skipPermissions}
          onSkipPermissionsChange={(value) => {
            onClaudePermissionsChange({ ...claudePermissions, skipPermissions: value });
          }}
          allowedTools={claudePermissions.allowedTools}
          onAllowedToolsChange={(value) => {
            onClaudePermissionsChange({ ...claudePermissions, allowedTools: value });
          }}
          disallowedTools={claudePermissions.disallowedTools}
          onDisallowedToolsChange={(value) => {
            onClaudePermissionsChange({ ...claudePermissions, disallowedTools: value });
          }}
        />
      )}

      {selectedCategory === 'permissions' && selectedAgent === 'cursor' && (
        <PermissionsContent
          agent="cursor"
          skipPermissions={cursorPermissions.skipPermissions}
          onSkipPermissionsChange={(value) => {
            onCursorPermissionsChange({ ...cursorPermissions, skipPermissions: value });
          }}
          allowedCommands={cursorPermissions.allowedCommands}
          onAllowedCommandsChange={(value) => {
            onCursorPermissionsChange({ ...cursorPermissions, allowedCommands: value });
          }}
          disallowedCommands={cursorPermissions.disallowedCommands}
          onDisallowedCommandsChange={(value) => {
            onCursorPermissionsChange({ ...cursorPermissions, disallowedCommands: value });
          }}
        />
      )}

      {selectedCategory === 'permissions' && selectedAgent === 'codex' && (
        <PermissionsContent
          agent="codex"
          permissionMode={codexPermissionMode}
          onPermissionModeChange={onCodexPermissionModeChange}
        />
      )}

      {selectedCategory === 'mcp' && (
        // AgentSettingsProject.name is populated from the DB projectId by
        // normalizeProjectForSettings, so we can map it straight through.
        <McpServers
          selectedProvider={selectedAgent}
          currentProjects={projects.map<McpProject>((project) => ({
            projectId: project.name,
            displayName: project.displayName,
            fullPath: project.fullPath,
            path: project.path,
          }))}
        />
      )}

      {selectedCategory === 'skills' && selectedAgent !== 'opencode' && (
        <ProviderSkills
          selectedProvider={selectedAgent}
          currentProjects={projects.map<SkillsProject>((project) => ({
            projectId: project.name,
            displayName: project.displayName,
            fullPath: project.fullPath,
            path: project.path,
          }))}
        />
      )}
    </div>
  );
}
