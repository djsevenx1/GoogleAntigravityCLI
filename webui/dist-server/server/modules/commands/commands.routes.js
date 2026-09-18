// @ts-nocheck -- temporary while command handlers are extracted into the injected service.
import path from "path";
import express from "express";
import { parseFrontMatter } from "../../shared/frontmatter.js";
/** Creates Commands routes around explicit filesystem, model-catalog, and runtime adapters. */
export function createCommandsRouter(dependencies) {
    const fs = dependencies.fileSystem;
    const os = { homedir: dependencies.homeDirectory };
    const APP_ROOT = dependencies.appRoot;
    const providerModelsService = dependencies.models;
    const process = dependencies.runtime;
    const router = express.Router();
    const MODEL_PROVIDERS = ["antigravity"];
    const MODEL_PROVIDER_LABELS = {
        antigravity: "Google Antigravity",
    };
    const readModelProvider = (value) => {
        if (typeof value !== "string") {
            return "antigravity";
        }
        const normalized = value.trim().toLowerCase();
        return MODEL_PROVIDERS.includes(normalized) ? normalized : "antigravity";
    };
    /**
     * Resolves the model a command should report.
     *
     * `context.model` is what the composer would send right now, so it stands in
     * for a chat that has no session row yet; the service prefers the session's own
     * recorded model whenever there is one.
     */
    const resolveCommandModel = async (modelsService, provider, context) => {
        const resolved = await modelsService.resolveSessionModel(provider, {
            sessionId: context?.sessionId,
            requestedModel: context?.model,
        });
        return resolved.model;
    };
    const executeModelsCommand = async (args, context, modelsService) => {
        const currentProvider = readModelProvider(context?.provider);
        const catalog = await modelsService.getProviderModels(currentProvider);
        const currentModel = await resolveCommandModel(modelsService, currentProvider, context);
        const availableModels = catalog.OPTIONS.map((option) => option.value);
        const availableOptions = catalog.OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
            description: option.description,
            recordId: option.recordId,
            isCustom: option.isCustom,
        }));
        return {
            type: "builtin",
            action: "models",
            data: {
                current: {
                    provider: currentProvider,
                    providerLabel: MODEL_PROVIDER_LABELS[currentProvider],
                    model: currentModel,
                },
                available: {
                    [currentProvider]: availableModels,
                },
                availableModels,
                availableOptions,
                defaultModel: catalog.DEFAULT,
                message: `Current model: ${currentModel}`,
            },
        };
    };
    /**
     * Recursively scan directory for command files (.md)
     * @param {string} dir - Directory to scan
     * @param {string} baseDir - Base directory for relative paths
     * @param {string} namespace - Namespace for commands (e.g., 'project', 'user')
     * @returns {Promise<Array>} Array of command objects
     */
    async function scanCommandsDirectory(dir, baseDir, namespace) {
        const commands = [];
        try {
            // Check if directory exists
            await fs.access(dir);
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    // Recursively scan subdirectories
                    const subCommands = await scanCommandsDirectory(fullPath, baseDir, namespace);
                    commands.push(...subCommands);
                }
                else if (entry.isFile() && entry.name.endsWith(".md")) {
                    // Parse markdown file for metadata
                    try {
                        const content = await fs.readFile(fullPath, "utf8");
                        const { data: frontmatter, content: commandContent } = parseFrontMatter(content);
                        // Calculate relative path from baseDir for command name
                        const relativePath = path.relative(baseDir, fullPath);
                        // Remove .md extension and convert to command name
                        const commandName = "/" + relativePath.replace(/\.md$/, "").replace(/\\/g, "/");
                        // Extract description from frontmatter or first line of content
                        let description = frontmatter.description || "";
                        if (!description) {
                            const firstLine = commandContent.trim().split("\n")[0];
                            description = firstLine.replace(/^#+\s*/, "").trim();
                        }
                        commands.push({
                            name: commandName,
                            path: fullPath,
                            relativePath,
                            description,
                            namespace,
                            metadata: frontmatter,
                        });
                    }
                    catch (err) {
                        console.error(`Error parsing command file ${fullPath}:`, err.message);
                    }
                }
            }
        }
        catch (err) {
            // Directory doesn't exist or can't be accessed - this is okay
            if (err.code !== "ENOENT" && err.code !== "EACCES") {
                console.error(`Error scanning directory ${dir}:`, err.message);
            }
        }
        return commands;
    }
    /**
     * Built-in commands that are always available for Google Antigravity
     */
    const builtInCommands = [
        {
            name: "/help",
            description: "查看 Google Antigravity 帮助文档与命令大全",
            namespace: "builtin",
            metadata: { type: "builtin" },
        },
        {
            name: "/boost",
            description: "反重力多智能体深度推理模式（攻坚复杂架构与疑难 Bug）",
            namespace: "builtin",
            metadata: { type: "builtin", insertable: true },
        },
        {
            name: "/plan",
            description: "任务规划模式（先制定详细步骤确认后再执行）",
            namespace: "builtin",
            metadata: { type: "builtin", insertable: true },
        },
        {
            name: "/review",
            description: "自动化代码审查与自愈自检（扫描缺陷、漏洞与代码质量）",
            namespace: "builtin",
            metadata: { type: "builtin", insertable: true },
        },
        {
            name: "/goal",
            description: "长任务自主推进模式（不达目的不罢休，支持通宵长线执行）",
            namespace: "builtin",
            metadata: { type: "builtin", insertable: true },
        },
        {
            name: "/models",
            description: "查看与切换当前可用的 AI 模型列表",
            namespace: "builtin",
            metadata: { type: "builtin" },
        },
        {
            name: "/cost",
            description: "查看当前会话 Token 用量与额度详情",
            namespace: "builtin",
            metadata: { type: "builtin" },
        },
        {
            name: "/memory",
            description: "打开并编辑项目记忆规则 (AGENTS.md / GEMINI.md)",
            namespace: "builtin",
            metadata: { type: "builtin" },
        },
        {
            name: "/browser",
            description: "启用浏览器自动化工具与网页交互调研",
            namespace: "builtin",
            metadata: { type: "builtin", insertable: true },
        },
        {
            name: "/grill-me",
            description: "方案对齐深度访谈，澄清设计决策与架构权衡",
            namespace: "builtin",
            metadata: { type: "builtin", insertable: true },
        },
        {
            name: "/schedule",
            description: "定时调度模式（单次定时提醒或 Cron 周期自动巡检任务）",
            namespace: "builtin",
            metadata: { type: "builtin", insertable: true },
        },
        {
            name: "/teamwork-preview",
            description: "多智能体团队协作预览（大型工程多 Agent 自动分工协同）",
            namespace: "builtin",
            metadata: { type: "builtin", insertable: true },
        },
        {
            name: "/learn",
            description: "经验沉淀自学习模式（将纠正或配置持久化固化为规则）",
            namespace: "builtin",
            metadata: { type: "builtin", insertable: true },
        },
        {
            name: "/config",
            description: "打开系统运行时配置与偏好设置",
            namespace: "builtin",
            metadata: { type: "builtin" },
        },
        {
            name: "/status",
            description: "查看系统运行状态、版本信息与环境拓扑",
            namespace: "builtin",
            metadata: { type: "builtin" },
        },
    ];
    /**
     * Built-in command handlers
     * Each handler returns { type: 'builtin', action: string, data: any }
     */
    const builtInHandlers = {
        "/help": async (args, context) => {
            const helpText = `# Google Antigravity 命令指南

## 内置斜杠命令 (Built-in Commands)

${builtInCommands
                .map((cmd) => `### \`${cmd.name}\`
${cmd.description}
`)
                .join("\n")}

## 自定义扩展命令 (Custom Commands)

自定义命令支持在以下目录创建 \`.md\` 模板：
- 项目级: \`.agents/commands/\` 或 \`.gemini/commands/\` (仅限当前项目)
- 全局级: \`~/.gemini/commands/\` 或 \`~/.claude/commands/\` (所有项目通用)

### 常用用法提示
- \`/boost <需求>\`: 启动多智能体深度推演与交叉验证，攻坚复杂架构与隐蔽 Bug。
- \`/plan <任务>\`: 针对复杂任务生成结构化规划与审查自检清单。
- \`/review\`: 对当前工作区所有改动进行安全漏洞与代码规范自动审查。
`;
            return {
                type: "builtin",
                action: "help",
                data: {
                    content: helpText,
                    format: "markdown",
                    commands: builtInCommands.map((command) => ({
                        name: command.name,
                        description: command.description,
                        namespace: command.namespace,
                    })),
                },
            };
        },
        "/boost": async (args) => ({
            type: "builtin",
            action: "guide",
            data: {
                content: "🚀 **反重力 Boost 模式**: 请在输入框输入 `/boost <你的复杂任务或架构难题>`，系统将自动分配多智能体并行调研与独立交叉验证。",
                format: "markdown",
            },
        }),
        "/plan": async (args) => ({
            type: "builtin",
            action: "guide",
            data: {
                content: "📋 **任务规划模式**: 请在输入框输入 `/plan <待规划任务>`，系统将在实施前先输出完整的步骤分解与确认方案。",
                format: "markdown",
            },
        }),
        "/review": async (args) => ({
            type: "builtin",
            action: "guide",
            data: {
                content: "🔍 **自动化审查模式**: 请在输入框输入 `/review` 或 `/review <文件路径>`，系统将对变更代码进行安全漏洞、边界隐患与 Clean Code 审查自检。",
                format: "markdown",
            },
        }),
        "/goal": async (args) => ({
            type: "builtin",
            action: "guide",
            data: {
                content: "🎯 **目标推进模式**: 请在输入框输入 `/goal <长线目标>`，系统将不间断自主推进，直至目标达成。",
                format: "markdown",
            },
        }),
        "/schedule": async (args) => ({
            type: "builtin",
            action: "guide",
            data: {
                content: "⏰ **定时调度模式**: 请在输入框输入 `/schedule <任务内容与时间>`，支持单次定时（如 10 分钟后提醒）或周期 Cron 巡检。",
                format: "markdown",
            },
        }),
        "/teamwork-preview": async (args) => ({
            type: "builtin",
            action: "guide",
            data: {
                content: "👥 **多智能体团队协作**: 请在输入框输入 `/teamwork-preview <复杂工程项目>`，系统将自动分配多个专业子 Agent 协同推进。",
                format: "markdown",
            },
        }),
        "/learn": async (args) => ({
            type: "builtin",
            action: "guide",
            data: {
                content: "🧠 **经验沉淀自学习**: 请在输入框输入 `/learn <需要沉淀的规范或配置>`，系统将自动固化至项目的规则知识库中。",
                format: "markdown",
            },
        }),
        "/models": (args, context) => executeModelsCommand(args, context, providerModelsService),
        "/cost": async (args, context) => {
            const tokenUsage = context?.tokenUsage || {};
            const provider = readModelProvider(context?.provider);
            const model = await resolveCommandModel(providerModelsService, provider, context);
            const reportedUsed = Number(tokenUsage.used ?? tokenUsage.totalUsed ?? tokenUsage.total_tokens ?? 0) || 0;
            const total = Number(tokenUsage.total ??
                tokenUsage.contextWindow ??
                0) || 0;
            const normalizedInputValue = tokenUsage.inputTokens ??
                tokenUsage.input ??
                tokenUsage.cumulativeInputTokens ??
                tokenUsage.breakdown?.input ??
                tokenUsage.promptTokens;
            const directInputTokens = Number(normalizedInputValue ??
                tokenUsage.input_tokens ??
                0) || 0;
            const cacheReadTokens = Number(tokenUsage.cacheReadTokens ??
                tokenUsage.cache_read_input_tokens ??
                tokenUsage.cacheReadInputTokens ??
                0) || 0;
            const cacheCreationTokens = Number(tokenUsage.cacheCreationTokens ??
                tokenUsage.cache_creation_input_tokens ??
                tokenUsage.cacheCreationInputTokens ??
                0) || 0;
            const inputTokens = normalizedInputValue == null
                ? directInputTokens + cacheReadTokens + cacheCreationTokens
                : directInputTokens;
            const outputTokens = Number(tokenUsage.outputTokens ??
                tokenUsage.output ??
                tokenUsage.output_tokens ??
                tokenUsage.cumulativeOutputTokens ??
                tokenUsage.breakdown?.output ??
                tokenUsage.completionTokens ??
                0) || 0;
            const computedUsed = inputTokens + outputTokens;
            const hasTokenBreakdown = computedUsed > 0;
            const used = Math.max(reportedUsed, computedUsed);
            return {
                type: "builtin",
                action: "cost",
                data: {
                    tokenUsage: {
                        used,
                        total,
                    },
                    ...(hasTokenBreakdown
                        ? {
                            tokenBreakdown: {
                                input: inputTokens,
                                output: outputTokens,
                            },
                        }
                        : {}),
                    provider,
                    model,
                },
            };
        },
        "/status": async (args, context) => {
            // Read version from package.json
            const packageJsonPath = path.join(APP_ROOT, "package.json");
            let version = "unknown";
            let packageName = "GoogleAntigravityCLI";
            try {
                const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
                version = packageJson.version;
                packageName = packageJson.name || "GoogleAntigravityCLI";
            }
            catch (err) {
                console.error("Error reading package.json:", err);
            }
            const uptime = process.uptime();
            const uptimeMinutes = Math.floor(uptime / 60);
            const uptimeHours = Math.floor(uptimeMinutes / 60);
            const uptimeFormatted = uptimeHours > 0
                ? `${uptimeHours}h ${uptimeMinutes % 60}m`
                : `${uptimeMinutes}m`;
            const statusProvider = readModelProvider(context?.provider);
            const model = await resolveCommandModel(providerModelsService, statusProvider, context);
            const memoryUsage = process.memoryUsage();
            return {
                type: "builtin",
                action: "status",
                data: {
                    version,
                    packageName,
                    uptime: uptimeFormatted,
                    uptimeSeconds: Math.floor(uptime),
                    model,
                    provider: statusProvider,
                    nodeVersion: process.version,
                    platform: process.platform,
                    pid: process.pid,
                    memoryUsage: {
                        rssMb: Math.round(memoryUsage.rss / 1024 / 1024),
                        heapUsedMb: Math.round(memoryUsage.heapUsed / 1024 / 1024),
                        heapTotalMb: Math.round(memoryUsage.heapTotal / 1024 / 1024),
                    },
                },
            };
        },
        "/memory": async (args, context) => {
            const projectPath = context?.projectPath;
            if (!projectPath) {
                return {
                    type: "builtin",
                    action: "memory",
                    data: {
                        error: "No project selected",
                        message: "Please select a project to access its memory file",
                    },
                };
            }
            // 优先检测 AGENTS.md，其次 GEMINI.md，最后兼容 CLAUDE.md
            const candidateFiles = ["AGENTS.md", "GEMINI.md", "CLAUDE.md"];
            let memoryPath = path.join(projectPath, "AGENTS.md");
            let exists = false;
            for (const fileName of candidateFiles) {
                const p = path.join(projectPath, fileName);
                try {
                    await fs.access(p);
                    memoryPath = p;
                    exists = true;
                    break;
                }
                catch (_) { }
            }
            return {
                type: "builtin",
                action: "memory",
                data: {
                    path: memoryPath,
                    exists,
                    message: exists
                        ? `打开项目规则记忆文件: ${path.basename(memoryPath)}`
                        : `未找到记忆文件。建议在 ${projectPath} 创建 AGENTS.md 存放项目级专属约束。`,
                },
            };
        },
        "/config": async (args, context) => {
            return {
                type: "builtin",
                action: "config",
                data: {
                    message: "Opening settings...",
                },
            };
        },
    };
    /**
     * POST /api/commands/list
     * List all available commands from project and user directories
     */
    router.post("/list", async (req, res) => {
        try {
            const { projectPath } = req.body;
            const allCommands = [...builtInCommands];
            // Scan project-level commands (.agents/commands/, .gemini/commands/, .claude/commands/)
            if (projectPath) {
                const projectDirs = [
                    path.join(projectPath, ".agents", "commands"),
                    path.join(projectPath, ".gemini", "commands"),
                    path.join(projectPath, ".claude", "commands"),
                ];
                for (const pDir of projectDirs) {
                    const cmds = await scanCommandsDirectory(pDir, pDir, "project");
                    allCommands.push(...cmds);
                }
            }
            // Scan user-level commands (~/.gemini/commands/, ~/.claude/commands/)
            const homeDir = os.homedir();
            const userDirs = [
                path.join(homeDir, ".gemini", "commands"),
                path.join(homeDir, ".claude", "commands"),
            ];
            for (const uDir of userDirs) {
                const cmds = await scanCommandsDirectory(uDir, uDir, "user");
                allCommands.push(...cmds);
            }
            // Separate built-in and custom commands
            const customCommands = allCommands.filter((cmd) => cmd.namespace !== "builtin");
            // Sort commands alphabetically by name
            customCommands.sort((a, b) => a.name.localeCompare(b.name));
            res.json({
                builtIn: builtInCommands,
                custom: customCommands,
                count: allCommands.length,
            });
        }
        catch (error) {
            console.error("Error listing commands:", error);
            res.status(500).json({
                error: "Failed to list commands",
                message: error.message,
            });
        }
    });
    /**
     * POST /api/commands/execute
     * Execute a command with argument replacement
     * This endpoint prepares the command content but doesn't execute bash commands yet
     * (that will be handled in the command parser utility)
     */
    router.post("/execute", async (req, res) => {
        try {
            const { commandName, commandPath, args = [], context = {} } = req.body;
            if (!commandName) {
                return res.status(400).json({
                    error: "Command name is required",
                });
            }
            // Handle built-in commands
            const handler = builtInHandlers[commandName];
            if (handler) {
                try {
                    const result = await handler(args, context);
                    return res.json({
                        ...result,
                        command: commandName,
                    });
                }
                catch (error) {
                    console.error(`Error executing built-in command ${commandName}:`, error);
                    return res.status(500).json({
                        error: "Command execution failed",
                        message: error.message,
                        command: commandName,
                    });
                }
            }
            // Handle custom commands
            if (!commandPath) {
                return res.status(400).json({
                    error: "Command path is required for custom commands",
                });
            }
            // Load command content
            // Security: validate commandPath is within allowed directories
            {
                const resolvedPath = path.resolve(commandPath);
                const userBase = path.resolve(path.join(os.homedir(), ".claude", "commands"));
                const projectBase = context?.projectPath
                    ? path.resolve(path.join(context.projectPath, ".claude", "commands"))
                    : null;
                const isUnder = (base) => {
                    const rel = path.relative(base, resolvedPath);
                    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
                };
                if (!(isUnder(userBase) || (projectBase && isUnder(projectBase)))) {
                    return res.status(403).json({
                        error: "Access denied",
                        message: "Command must be in .claude/commands directory",
                    });
                }
            }
            const content = await fs.readFile(commandPath, "utf8");
            const { data: metadata, content: commandContent } = parseFrontMatter(content);
            // Basic argument replacement (will be enhanced in command parser utility)
            let processedContent = commandContent;
            // Replace $ARGUMENTS with all arguments joined
            const argsString = args.join(" ");
            processedContent = processedContent.replace(/\$ARGUMENTS/g, argsString);
            // Replace $1, $2, etc. with positional arguments
            args.forEach((arg, index) => {
                const placeholder = `$${index + 1}`;
                processedContent = processedContent.replace(new RegExp(`\\${placeholder}\\b`, "g"), arg);
            });
            res.json({
                type: "custom",
                command: commandName,
                content: processedContent,
                metadata,
                hasFileIncludes: processedContent.includes("@"),
                hasBashCommands: processedContent.includes("!"),
            });
        }
        catch (error) {
            if (error.code === "ENOENT") {
                return res.status(404).json({
                    error: "Command not found",
                    message: `Command file not found: ${req.body.commandPath}`,
                });
            }
            console.error("Error executing command:", error);
            res.status(500).json({
                error: "Failed to execute command",
                message: error.message,
            });
        }
    });
    return router;
}
//# sourceMappingURL=commands.routes.js.map