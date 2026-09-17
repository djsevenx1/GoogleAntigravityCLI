/**
 * Centralized tool configuration registry
 * Defines display behavior for all tool types 
 */

export type ToolDisplayConfig = {
  input: {
    type: 'one-line' | 'collapsible' | 'plan' | 'hidden';
    // One-line config
    icon?: string;
    label?: string;
    getValue?: (input: any) => string;
    getSecondary?: (input: any) => string | undefined;
    action?: 'copy' | 'open-file' | 'jump-to-results' | 'none';
    style?: string;
    wrapText?: boolean;
    colorScheme?: {
      primary?: string;
      secondary?: string;
      background?: string;
      border?: string;
      icon?: string;
    };
    // Collapsible config
    title?: string | ((input: any) => string);
    defaultOpen?: boolean;
    contentType?: 'diff' | 'markdown' | 'file-list' | 'todo-list' | 'text' | 'task' | 'question-answer';
    getContentProps?: (input: any, helpers?: any) => any;
    actionButton?: 'file-button' | 'none';
  };
  result?: {
    hidden?: boolean;
    hideOnSuccess?: boolean;
    type?: 'one-line' | 'collapsible' | 'plan' | 'special';
    title?: string | ((result: any) => string);
    defaultOpen?: boolean;
    // Special result handlers
    contentType?: 'markdown' | 'file-list' | 'todo-list' | 'text' | 'success-message' | 'task' | 'question-answer';
    getMessage?: (result: any) => string;
    getContentProps?: (result: any) => any;
  };
};

export function getFileBasename(filePath?: string): string {
  if (!filePath || typeof filePath !== 'string') return '';
  const clean = filePath.replace(/[\\/]+$/, '');
  const parts = clean.split(/[\\/]/);
  return parts.pop() || clean;
}

export function translateActionPhrase(text?: string): string {
  if (!text || typeof text !== 'string') return '';
  const trimmed = text.trim();
  if (/[\u4e00-\u9fa5]/.test(trimmed)) {
    return trimmed;
  }

  const dict: Record<string, string> = {
    'analyzing directory': '分析目录',
    'directory analysis': '分析目录',
    'searching the web': '搜索网页',
    'web search': '网页搜索',
    'checking git status': '检查Git状态',
    'git status check': '检查Git状态',
    'running tests': '运行测试',
    'test execution': '运行测试',
    'searching code': '搜索代码',
    'code search': '搜索代码',
    'building server': '编译服务端',
    'restarting server': '重启服务',
    'restarting server process': '重启服务进程',
    'checking server process': '检查服务进程',
    'checking server status': '检查服务状态',
    'checking parent watchdog': '检查守护进程',
    'checking cli log': '查看CLI日志',
    'viewing cli log header': '查看CLI日志头',
    'checking state directory': '检查状态目录',
    'list files in state directory': '列出状态目录文件',
    'checking active accounts': '检查活跃账号',
    'inspecting active token': '检查活跃Token',
    'inspecting token.token keys': '检查Token结构',
    'checking accounts detail': '检查账号详情',
    'checking live quota': '检查实时配额',
    'querying quota for all accounts': '查询所有账号配额',
    'testing node-fetch': '测试网络代理',
    'testing token fresh sync': '测试Token刷新同步',
    'testing quota retrieval': '测试配额获取',
    'testing account switching': '测试账号切换',
    'inspecting transcript error context': '检查上下文错误',
    'finding tool components': '查找工具组件',
    'viewing attached screenshot': '查看用户截图',
    'viewing account service': '查看账号服务',
    'viewing service methods': '查看服务方法',
    'viewing switchaccount implementation': '查看账号切换实现',
    'viewing switchaccount': '查看账号切换',
    'viewing runtime provider': '查看运行环境',
    'viewing runantigravityturnonce': '查看单次运行逻辑',
    'viewing tool handling and stderr': '查看工具处理与错误',
    'viewing process close handling': '查看进程关闭处理',
    'viewing spawn loop': '查看重试循环',
    'viewing end of spawnantigravity': '查看运行结束逻辑',
    'viewing quota functions': '查看配额方法',
    'viewing proxy configuration': '查看代理配置',
    'viewing zh-cn chat.json': '查看中文翻译',
    'inspecting error details in log': '查看日志错误详情',
  };

  const lower = trimmed.toLowerCase();
  if (dict[lower]) return dict[lower];

  if (/^viewing |^checking |^inspecting |^reading /i.test(lower)) {
    const obj = lower.replace(/^(viewing|checking|inspecting|reading)\s+/i, '');
    return `查看 ${obj}`;
  }
  if (/^searching |^finding /i.test(lower)) {
    const obj = lower.replace(/^(searching|finding)\s+/i, '');
    return `搜索 ${obj}`;
  }
  if (/^updating |^editing |^modifying /i.test(lower)) {
    const obj = lower.replace(/^(updating|editing|modifying)\s+/i, '');
    return `修改 ${obj}`;
  }
  if (/^running |^executing /i.test(lower)) {
    const obj = lower.replace(/^(running|executing)\s+/i, '');
    return `执行 ${obj}`;
  }

  return trimmed;
}

/**
 * Input keys that identify what a call operated on, most specific first. Used
 * to summarize a tool this registry has no entry for.
 */
const DESCRIPTIVE_INPUT_KEYS = [
  'toolAction', 'toolSummary', 'Instruction', 'Description',
  'command', 'cmd', 'CommandLine',
  'file_path', 'path', 'filePath', 'AbsolutePath', 'TargetFile', 'target_file',
  'DirectoryPath', 'SearchDirectory',
  'pattern', 'Pattern', 'query', 'Query', 'url', 'Url',
  'prompt', 'Prompt', 'name', 'selector', 'text', 'skill', 'id',
] as const;

/** Builds a one-line summary of an unmapped tool's input. */
function summarizeToolInput(input: unknown): string {
  if (typeof input === 'string') {
    return input.length > 80 ? `${input.slice(0, 80)}…` : input || '操作';
  }
  if (!input || typeof input !== 'object') {
    return '操作';
  }

  const record = input as Record<string, unknown>;

  // Check toolAction / toolSummary first
  if (typeof record.toolAction === 'string' && record.toolAction.trim()) {
    const action = translateActionPhrase(record.toolAction);
    const target = record.AbsolutePath || record.TargetFile || record.CommandLine || record.Query || record.Pattern || '';
    if (typeof target === 'string' && target.trim()) {
      const base = getFileBasename(target);
      return `${action} (${base || target.slice(0, 35)})`;
    }
    return action;
  }

  for (const key of DESCRIPTIVE_INPUT_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      const single = value.replace(/\s+/g, ' ').trim();
      const base = getFileBasename(single);
      const displayVal = (key.includes('Path') || key.includes('File')) && base ? base : single;
      return displayVal.length > 80 ? `${displayVal.slice(0, 80)}…` : displayVal;
    }
  }

  const keys = Object.keys(record);
  return keys.length > 0 ? keys.slice(0, 3).join(', ') : '操作';
}

/**
 * Headers for the surfaces every provider is normalized onto.
 */
export const UNIFIED_TOOL_LABELS: Record<string, string> = {
  TodoWrite: '待办清单',
  TodoRead: '待办清单',
  AskUserQuestion: '提问确认',
  ask_question: '提问确认',
  view_file: '查看文件',
  replace_file_content: '修改文件',
  write_to_file: '写入文件',
  run_command: '运行命令',
  grep_search: '代码搜索',
  find_by_name: '查找文件',
  list_dir: '浏览目录',
  schedule: '定时计划',
  manage_task: '任务管理',
  read_url_content: '读取网页',
  search_web: '网络搜索',
  generate_image: '生成图片',
  invoke_subagent: '子智能体',
  manage_subagents: '智能体管理',
  define_subagent: '定义智能体',
  send_message: '发送消息',
  Bash: '运行命令',
  Read: '查看文件',
  Edit: '修改文件',
  Write: '写入文件',
  Grep: '代码搜索',
  Glob: '查找文件',
};

export function formatToolDisplayName(toolName: string): string {
  const unifiedLabel = UNIFIED_TOOL_LABELS[toolName];
  if (unifiedLabel) {
    return unifiedLabel;
  }

  const mcpMatch = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(toolName);
  if (!mcpMatch) {
    return toolName;
  }
  return `${mcpMatch[2]} (${mcpMatch[1]})`;
}

export const TOOL_CONFIGS: Record<string, ToolDisplayConfig> = {
  // ============================================================================
  // ANTIGRAVITY / GOOGLE CODE ASSIST TOOLS
  // ============================================================================

  view_file: {
    input: {
      type: 'one-line',
      label: '查看文件',
      icon: 'V',
      getValue: (input) => {
        const file = getFileBasename(input.AbsolutePath || input.path || input.filePath);
        const act = input.toolAction ? translateActionPhrase(input.toolAction) : '';
        if (act && !act.startsWith('查看')) {
          return `${act} (${file || '文件'})`;
        }
        return file ? `查看 ${file}` : (act || '查看文件');
      },
      action: 'open-file',
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300',
        border: 'border-blue-400 dark:border-blue-500',
        icon: 'text-blue-500 dark:text-blue-400',
      },
    },
    result: {
      hidden: true,
    },
  },

  run_command: {
    input: {
      type: 'one-line',
      label: '运行命令',
      icon: 'terminal',
      getValue: (input) => {
        const cmd = input.CommandLine || input.command || '';
        const act = input.toolAction ? translateActionPhrase(input.toolAction) : '';
        if (act && !act.startsWith('运行') && !act.startsWith('执行')) {
          return `${act} (${cmd.slice(0, 35)})`;
        }
        return cmd ? `执行: ${cmd.slice(0, 45)}` : (act || '运行命令');
      },
      getSecondary: (input) => input.toolSummary || input.Description,
      action: 'copy',
      style: 'terminal',
      wrapText: true,
      colorScheme: {
        primary: 'text-zinc-800 dark:text-zinc-200 font-mono',
        secondary: 'text-muted-foreground',
        border: 'border-emerald-500/50 dark:border-emerald-500/40',
        icon: 'text-emerald-600 dark:text-emerald-400',
      },
    },
    result: {
      hideOnSuccess: true,
      type: 'special',
    },
  },

  grep_search: {
    input: {
      type: 'one-line',
      label: '代码搜索',
      icon: 'G',
      getValue: (input) => {
        const q = input.Query || input.query || '';
        const act = input.toolAction ? translateActionPhrase(input.toolAction) : '';
        if (act && !act.startsWith('搜索')) {
          return `${act} ("${q.slice(0, 25)}")`;
        }
        return q ? `搜索 "${q.slice(0, 35)}"` : (act || '代码搜索');
      },
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300',
        border: 'border-purple-400 dark:border-purple-500',
        icon: 'text-purple-500 dark:text-purple-400',
      },
    },
    result: {
      type: 'collapsible',
      title: '搜索结果',
      defaultOpen: false,
      contentType: 'text',
      getContentProps: (result) => ({ content: String(result?.content || ''), format: 'plain' }),
    },
  },

  replace_file_content: {
    input: {
      type: 'collapsible',
      label: '修改文件',
      icon: 'E',
      title: (input) => {
        const file = getFileBasename(input.TargetFile || input.file_path);
        const desc = input.Description || input.Instruction || input.toolAction;
        const descZh = desc ? translateActionPhrase(desc) : '';
        return descZh ? `修改 ${file}: ${descZh.slice(0, 35)}` : `修改 ${file || '文件'}`;
      },
      getValue: (input) => {
        const file = getFileBasename(input.TargetFile || input.file_path);
        const desc = input.Description || input.Instruction || input.toolAction;
        const descZh = desc ? translateActionPhrase(desc) : '';
        return descZh ? `修改 ${file}: ${descZh.slice(0, 25)}` : `修改 ${file || '文件'}`;
      },
      defaultOpen: false,
      contentType: 'diff',
      actionButton: 'none',
      getContentProps: (input) => ({
        oldContent: input.TargetContent || input.old_string,
        newContent: input.ReplacementContent || input.new_string,
        filePath: input.TargetFile || input.file_path,
        badge: '修改',
        badgeColor: 'blue',
      }),
      colorScheme: {
        border: 'border-amber-500 dark:border-amber-400',
        icon: 'text-amber-500 dark:text-amber-400',
      },
    },
    result: {
      hideOnSuccess: true,
    },
  },

  write_to_file: {
    input: {
      type: 'collapsible',
      label: '写入文件',
      icon: 'W',
      title: (input) => {
        const file = getFileBasename(input.TargetFile || input.file_path);
        return `写入 ${file || '文件'}`;
      },
      getValue: (input) => {
        const file = getFileBasename(input.TargetFile || input.file_path);
        const desc = input.Description || input.toolAction;
        const descZh = desc ? translateActionPhrase(desc) : '';
        return descZh ? `写入 ${file}: ${descZh.slice(0, 25)}` : `写入 ${file || '文件'}`;
      },
      defaultOpen: false,
      contentType: 'text',
      getContentProps: (input) => ({
        content: input.CodeContent || input.content || '',
        format: 'code',
      }),
      colorScheme: {
        border: 'border-emerald-500 dark:border-emerald-400',
        icon: 'text-emerald-500 dark:text-emerald-400',
      },
    },
    result: {
      hideOnSuccess: true,
    },
  },

  find_by_name: {
    input: {
      type: 'one-line',
      label: '查找文件',
      icon: 'F',
      getValue: (input) => {
        const p = input.Pattern || input.pattern || '';
        return p ? `查找 "${p}"` : '查找文件';
      },
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300',
        border: 'border-indigo-400 dark:border-indigo-500',
        icon: 'text-indigo-500 dark:text-indigo-400',
      },
    },
    result: {
      type: 'collapsible',
      title: '查找结果',
      defaultOpen: false,
      contentType: 'text',
      getContentProps: (result) => ({ content: String(result?.content || ''), format: 'plain' }),
    },
  },

  list_dir: {
    input: {
      type: 'one-line',
      label: '浏览目录',
      icon: 'D',
      getValue: (input) => {
        const dir = getFileBasename(input.DirectoryPath) || input.DirectoryPath || '当前目录';
        return `浏览: ${dir}`;
      },
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300',
        border: 'border-slate-400 dark:border-slate-500',
        icon: 'text-slate-500 dark:text-slate-400',
      },
    },
    result: {
      hideOnSuccess: true,
    },
  },

  ask_question: {
    input: {
      type: 'collapsible',
      label: '提问确认',
      icon: '?',
      title: (input: any) => {
        const questions = Array.isArray(input?.questions) ? input.questions : [];
        if (questions.length > 0 && questions[0]?.question) {
          return `确认: ${questions[0].question.slice(0, 40)}`;
        }
        return '提问确认';
      },
      getValue: (input: any) => {
        const questions = Array.isArray(input?.questions) ? input.questions : [];
        if (questions.length > 0 && questions[0]?.question) {
          return questions[0].question.slice(0, 35);
        }
        return '提问确认';
      },
      defaultOpen: true,
      contentType: 'question-answer',
      getContentProps: (input: any) => ({
        questions: input.questions || [],
        answers: input.answers || {},
      }),
      colorScheme: {
        border: 'border-cyan-500 dark:border-cyan-400',
        icon: 'text-cyan-500 dark:text-cyan-400',
      },
    },
    result: {
      hideOnSuccess: true,
    },
  },

  manage_task: {
    input: {
      type: 'one-line',
      label: '后台任务',
      icon: 'T',
      getValue: (input) => {
        const actionMap: Record<string, string> = {
          list: '查看任务列表',
          status: '检查任务状态',
          kill: '终止任务',
          send_input: '发送指令',
        };
        const act = actionMap[input.Action] || input.Action || '任务管理';
        const summary = input.toolSummary ? translateActionPhrase(input.toolSummary) : '';
        return summary ? `${act} (${summary})` : act;
      },
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300',
        border: 'border-teal-400 dark:border-teal-500',
        icon: 'text-teal-500 dark:text-teal-400',
      },
    },
    result: {
      type: 'collapsible',
      title: '任务输出',
      defaultOpen: false,
      contentType: 'text',
      getContentProps: (result) => ({ content: String(result?.content || ''), format: 'plain' }),
    },
  },

  read_url_content: {
    input: {
      type: 'one-line',
      label: '读取网页',
      icon: 'W',
      getValue: (input) => `读取: ${(input.Url || input.url || '').slice(0, 40)}`,
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300',
        border: 'border-sky-400 dark:border-sky-500',
        icon: 'text-sky-500 dark:text-sky-400',
      },
    },
    result: {
      type: 'collapsible',
      title: '网页内容',
      defaultOpen: false,
      contentType: 'text',
      getContentProps: (result) => ({ content: String(result?.content || ''), format: 'plain' }),
    },
  },

  search_web: {
    input: {
      type: 'one-line',
      label: '网络搜索',
      icon: 'S',
      getValue: (input) => `搜索: "${(input.query || '').slice(0, 30)}"`,
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300',
        border: 'border-sky-400 dark:border-sky-500',
        icon: 'text-sky-500 dark:text-sky-400',
      },
    },
    result: {
      type: 'collapsible',
      title: '搜索结果',
      defaultOpen: false,
      contentType: 'text',
      getContentProps: (result) => ({ content: String(result?.content || ''), format: 'plain' }),
    },
  },

  invoke_subagent: {
    input: {
      type: 'collapsible',
      label: '子智能体',
      icon: 'A',
      title: (input) => {
        const role = input.Subagents?.[0]?.Role || input.Subagents?.[0]?.TypeName || '子任务';
        return `智能体任务: ${role}`;
      },
      getValue: (input) => {
        const role = input.Subagents?.[0]?.Role || input.Subagents?.[0]?.TypeName || '子任务';
        return `调用: ${role}`;
      },
      defaultOpen: false,
      contentType: 'markdown',
      getContentProps: (input) => ({
        content: input.Subagents?.[0]?.Prompt || JSON.stringify(input, null, 2),
      }),
      colorScheme: {
        border: 'border-purple-500 dark:border-purple-400',
        icon: 'text-purple-500 dark:text-purple-400',
      },
    },
    result: {
      type: 'collapsible',
      title: '智能体结果',
      contentType: 'markdown',
      getContentProps: (result) => ({ content: String(result?.content || '') }),
    },
  },

  manage_subagents: {
    input: {
      type: 'one-line',
      label: '智能体管理',
      icon: 'M',
      getValue: (input) => `操作: ${input.Action || '管理'}`,
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300',
        border: 'border-purple-400 dark:border-purple-500',
        icon: 'text-purple-500 dark:text-purple-400',
      },
    },
    result: {
      hideOnSuccess: true,
    },
  },

  // ============================================================================
  // COMMAND TOOLS
  // ============================================================================

  Bash: {
    input: {
      type: 'one-line',
      icon: 'terminal',
      getValue: (input) => input.command,
      getSecondary: (input) => input.description,
      action: 'copy',
      style: 'terminal',
      wrapText: true,
      colorScheme: {
        primary: 'text-green-400 font-mono',
        secondary: 'text-gray-400',
        background: '',
        border: 'border-green-500 dark:border-green-400',
        icon: 'text-green-500 dark:text-green-400'
      }
    },
    result: {
      hideOnSuccess: true,
      type: 'special'
    }
  },

  // Claude exposes a separate PowerShell tool on Windows. It is the same
  // interaction as Bash, so it gets the same command row rather than falling
  // through to the generic parameter dump.
  PowerShell: {
    input: {
      type: 'one-line',
      icon: 'terminal',
      getValue: (input) => input.command,
      getSecondary: (input) => input.description,
      action: 'copy',
      style: 'terminal',
      wrapText: true,
      colorScheme: {
        primary: 'text-green-400 font-mono',
        secondary: 'text-gray-400',
        background: '',
        border: 'border-green-500 dark:border-green-400',
        icon: 'text-green-500 dark:text-green-400'
      }
    },
    result: {
      hideOnSuccess: true,
      type: 'special'
    }
  },

  // ============================================================================
  // WEB TOOLS
  // ============================================================================

  WebSearch: {
    input: {
      type: 'one-line',
      label: 'Search',
      getValue: (input) => input.query || '',
      action: 'none',
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300',
        border: 'border-sky-400 dark:border-sky-500',
        icon: 'text-sky-500 dark:text-sky-400'
      }
    },
    result: {
      type: 'collapsible',
      title: 'Search results',
      defaultOpen: false,
      contentType: 'text',
      getContentProps: (result) => ({ content: String(result?.content || ''), format: 'plain' })
    }
  },

  WebFetch: {
    input: {
      type: 'one-line',
      label: 'Fetch',
      getValue: (input) => input.url || '',
      action: 'none',
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300',
        border: 'border-sky-400 dark:border-sky-500',
        icon: 'text-sky-500 dark:text-sky-400'
      }
    },
    result: {
      type: 'collapsible',
      title: 'Fetched page',
      defaultOpen: false,
      contentType: 'text',
      getContentProps: (result) => ({ content: String(result?.content || ''), format: 'plain' })
    }
  },

  // ============================================================================
  // FILE OPERATION TOOLS
  // ============================================================================

  Read: {
    input: {
      type: 'one-line',
      label: 'Read',
      getValue: (input) => input.file_path || '',
      action: 'open-file',
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300',
        background: '',
        border: 'border-gray-300 dark:border-gray-600',
        icon: 'text-gray-500 dark:text-gray-400'
      }
    },
    result: {
      hidden: true
    }
  },

  Edit: {
    input: {
      type: 'collapsible',
      title: (input) => {
        const filename = input.file_path?.split('/').pop() || input.file_path || 'file';
        return `${filename}`;
      },
      defaultOpen: false,
      contentType: 'diff',
      actionButton: 'none',
      getContentProps: (input) => ({
        oldContent: input.old_string,
        newContent: input.new_string,
        filePath: input.file_path,
        badge: 'Edit',
        badgeColor: 'gray'
      })
    },
    result: {
      hideOnSuccess: true
    }
  },

  Write: {
    input: {
      type: 'collapsible',
      title: (input) => {
        const filename = input.file_path?.split('/').pop() || input.file_path || 'file';
        return `${filename}`;
      },
      defaultOpen: false,
      contentType: 'diff',
      actionButton: 'none',
      getContentProps: (input) => ({
        oldContent: '',
        newContent: input.content,
        filePath: input.file_path,
        badge: 'New',
        badgeColor: 'green'
      })
    },
    result: {
      hideOnSuccess: true
    }
  },

  ApplyPatch: {
    input: {
      type: 'collapsible',
      title: (input) => {
        const filename = input.file_path?.split('/').pop() || input.file_path || 'file';
        return `${filename}`;
      },
      defaultOpen: false,
      contentType: 'diff',
      actionButton: 'none',
      getContentProps: (input) => ({
        oldContent: input.old_string,
        newContent: input.new_string,
        filePath: input.file_path,
        badge: 'Patch',
        badgeColor: 'gray'
      })
    },
    result: {
      hideOnSuccess: true
    }
  },

  // ============================================================================
  // SEARCH TOOLS
  // ============================================================================

  Grep: {
    input: {
      type: 'one-line',
      label: 'Grep',
      getValue: (input) => input.pattern,
      getSecondary: (input) => input.path ? `in ${input.path}` : undefined,
      action: 'jump-to-results',
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300',
        secondary: 'text-gray-500 dark:text-gray-400',
        background: '',
        border: 'border-gray-400 dark:border-gray-500',
        icon: 'text-gray-500 dark:text-gray-400'
      }
    },
    result: {
      type: 'collapsible',
      defaultOpen: false,
      title: (result) => {
        const toolData = result.toolUseResult || {};
        const count = toolData.numFiles || toolData.filenames?.length || 0;
        return `Found ${count} ${count === 1 ? 'file' : 'files'}`;
      },
      contentType: 'file-list',
      getContentProps: (result) => {
        const toolData = result.toolUseResult || {};
        return {
          files: toolData.filenames || []
        };
      }
    }
  },

  Glob: {
    input: {
      type: 'one-line',
      label: 'Glob',
      getValue: (input) => input.pattern,
      getSecondary: (input) => input.path ? `in ${input.path}` : undefined,
      action: 'jump-to-results',
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300',
        secondary: 'text-gray-500 dark:text-gray-400',
        background: '',
        border: 'border-gray-400 dark:border-gray-500',
        icon: 'text-gray-500 dark:text-gray-400'
      }
    },
    result: {
      type: 'collapsible',
      defaultOpen: false,
      title: (result) => {
        const toolData = result.toolUseResult || {};
        const count = toolData.numFiles || toolData.filenames?.length || 0;
        return `Found ${count} ${count === 1 ? 'file' : 'files'}`;
      },
      contentType: 'file-list',
      getContentProps: (result) => {
        const toolData = result.toolUseResult || {};
        return {
          files: toolData.filenames || []
        };
      }
    }
  },

  // ============================================================================
  // TODO TOOLS
  // ============================================================================

  // Every provider's running checklist normalizes onto this tool — Claude's
  // TodoWrite and its incremental Task tracker, Codex's update_plan and
  // todo_list — so one renderer covers all of them.
  TodoWrite: {
    input: {
      type: 'collapsible',
      // Naming the step in flight makes a collapsed checklist say what the
      // agent is doing right now, not just how far along it is.
      title: (input) => {
        const todos = Array.isArray(input?.todos) ? input.todos : [];
        if (todos.length === 0) {
          return 'Updating checklist';
        }

        const done = todos.filter((todo: any) => todo?.status === 'completed').length;
        const active = todos.find((todo: any) => todo?.status === 'in_progress');
        if (active) {
          return `${String(active.activeForm || active.content)} — ${done}/${todos.length}`;
        }
        return done === todos.length
          ? `Done — ${done}/${todos.length}`
          : `${done}/${todos.length} done`;
      },
      defaultOpen: true,
      contentType: 'todo-list',
      getContentProps: (input) => ({
        todos: input.todos
      })
    },
    // The checklist itself already shows the new state, so a separate
    // acknowledgement row would only repeat it. Failures still surface.
    result: {
      hideOnSuccess: true
    }
  },

  TodoRead: {
    input: {
      type: 'one-line',
      label: 'TodoRead',
      getValue: () => 'reading list',
      action: 'none',
      colorScheme: {
        primary: 'text-gray-500 dark:text-gray-400',
        border: 'border-violet-400 dark:border-violet-500'
      }
    },
    result: {
      type: 'collapsible',
      contentType: 'todo-list',
      getContentProps: (result) => {
        try {
          const content = String(result.content || '');
          let todos = null;
          if (content.startsWith('[')) {
            todos = JSON.parse(content);
          }
          return { todos, isResult: true };
        } catch (e) {
          console.warn('Failed to parse todo list content:', e);
          return { todos: [], isResult: true };
        }
      }
    }
  },

  // ============================================================================
  // TASK TOOLS (TaskCreate, TaskUpdate, TaskList, TaskGet)
  // ============================================================================

  TaskCreate: {
    input: {
      type: 'one-line',
      label: 'Task',
      getValue: (input) => input.subject || 'Creating task',
      getSecondary: (input) => input.status || undefined,
      action: 'none',
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300',
        border: 'border-violet-400 dark:border-violet-500',
        icon: 'text-violet-500 dark:text-violet-400'
      }
    },
    result: {
      hideOnSuccess: true
    }
  },

  TaskUpdate: {
    input: {
      type: 'one-line',
      label: 'Task',
      getValue: (input) => {
        const parts = [];
        if (input.taskId) parts.push(`#${input.taskId}`);
        if (input.status) parts.push(input.status);
        if (input.subject) parts.push(`"${input.subject}"`);
        return parts.join(' → ') || 'updating';
      },
      action: 'none',
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300',
        border: 'border-violet-400 dark:border-violet-500',
        icon: 'text-violet-500 dark:text-violet-400'
      }
    },
    result: {
      hideOnSuccess: true
    }
  },

  TaskList: {
    input: {
      type: 'one-line',
      label: 'Tasks',
      getValue: () => 'listing tasks',
      action: 'none',
      colorScheme: {
        primary: 'text-gray-500 dark:text-gray-400',
        border: 'border-violet-400 dark:border-violet-500',
        icon: 'text-violet-500 dark:text-violet-400'
      }
    },
    result: {
      type: 'collapsible',
      defaultOpen: true,
      title: 'Task list',
      contentType: 'task',
      getContentProps: (result) => ({
        content: String(result?.content || '')
      })
    }
  },

  TaskGet: {
    input: {
      type: 'one-line',
      label: 'Task',
      getValue: (input) => input.taskId ? `#${input.taskId}` : 'fetching',
      action: 'none',
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300',
        border: 'border-violet-400 dark:border-violet-500',
        icon: 'text-violet-500 dark:text-violet-400'
      }
    },
    result: {
      type: 'collapsible',
      defaultOpen: true,
      title: 'Task details',
      contentType: 'task',
      getContentProps: (result) => ({
        content: String(result?.content || '')
      })
    }
  },

  // ============================================================================
  // SUBAGENT TASK TOOL
  // ============================================================================

  // Claude's async subagent tool. A row that actually spawned an agent is
  // rendered by SubagentPanel; this config only supplies the name and preview
  // used by tool grouping.
  Agent: {
    input: {
      type: 'collapsible',
      title: (input) => input.description || input.subagent_type || 'Subagent',
      defaultOpen: false,
      contentType: 'markdown',
      getContentProps: (input) => ({ content: input.prompt || '' })
    },
    result: {
      hideOnSuccess: true
    }
  },

  Task: {
    input: {
      type: 'collapsible',
      title: (input) => {
        const subagentType = input.subagent_type || 'Agent';
        const description = input.description || 'Running task';
        return `Subagent / ${subagentType}: ${description}`;
      },
      defaultOpen: false,
      contentType: 'markdown',
      getContentProps: (input) => {
        // If only prompt exists (and required fields), show just the prompt
        // Otherwise show all available fields
        const hasOnlyPrompt = input.prompt &&
          !input.model &&
          !input.resume;

        if (hasOnlyPrompt) {
          return {
            content: input.prompt || ''
          };
        }

        // Format multiple fields
        const parts = [];

        if (input.model) {
          parts.push(`**Model:** ${input.model}`);
        }

        if (input.prompt) {
          parts.push(`**Prompt:**\n${input.prompt}`);
        }

        if (input.resume) {
          parts.push(`**Resuming from:** ${input.resume}`);
        }

        return {
          content: parts.join('\n\n')
        };
      },
      colorScheme: {
        border: 'border-purple-500 dark:border-purple-400',
        icon: 'text-purple-500 dark:text-purple-400'
      }
    },
    result: {
      type: 'collapsible',
      title: 'Subagent result',
      defaultOpen: false,
      contentType: 'markdown',
      getContentProps: (result) => {
        // Handle agent results which may have complex structure
        if (result && result.content) {
          let content = result.content;
          // If content is a JSON string, try to parse it (agent results may arrive serialized)
          if (typeof content === 'string') {
            try {
              const parsed = JSON.parse(content);
              if (Array.isArray(parsed)) {
                content = parsed;
              }
            } catch {
              // Not JSON — use as-is
              return { content };
            }
          }
          // If content is an array (typical for agent responses with multiple text blocks)
          if (Array.isArray(content)) {
            const textContent = content
              .filter((item: any) => item.type === 'text')
              .map((item: any) => item.text)
              .join('\n\n');
            return { content: textContent || 'No response text' };
          }
          return { content: String(content) };
        }
        // Fallback to string representation
        return { content: String(result || 'No response') };
      }
    }
  },

  // ============================================================================
  // INTERACTIVE TOOLS
  // ============================================================================

  // Both providers normalize the ask-the-user round trip onto this tool —
  // Claude's AskUserQuestion and Codex's request_user_input — and the backend
  // folds the chosen answers into the input, so the question and the answer
  // render as one card instead of a question card and an opaque result blob.
  AskUserQuestion: {
    input: {
      type: 'collapsible',
      // A single answered question puts the choice straight in the header;
      // that is the part the user came back to read.
      title: (input: any) => {
        const questions = Array.isArray(input?.questions) ? input.questions : [];
        const answers = input?.answers || {};
        if (questions.length === 1) {
          const header = questions[0]?.header || 'Question';
          const answer = answers[questions[0]?.question];
          return answer ? `${header} — ${answer}` : header;
        }

        const answered = questions.filter((question: any) => answers[question?.question]).length;
        return answered > 0
          ? `${questions.length} questions — ${answered} answered`
          : `${questions.length} questions`;
      },
      defaultOpen: true,
      contentType: 'question-answer',
      getContentProps: (input: any) => ({
        questions: input.questions || [],
        answers: input.answers || {}
      }),
    },
    // The result only restates the selection the input now carries.
    result: {
      hideOnSuccess: true
    }
  },

  // ============================================================================
  // PLAN TOOLS
  // ============================================================================

  exit_plan_mode: {
    input: {
      type: 'plan',
      title: 'Implementation plan',
      defaultOpen: true,
      contentType: 'markdown',
      getContentProps: (input) => ({
        content: input.plan?.replace(/\\n/g, '\n') || input.plan
      })
    },
    result: {
      hidden: true
    }
  },

  // Also register as ExitPlanMode (the actual tool name used by Claude)
  ExitPlanMode: {
    input: {
      type: 'plan',
      title: 'Implementation plan',
      defaultOpen: true,
      contentType: 'markdown',
      getContentProps: (input) => ({
        content: input.plan?.replace(/\\n/g, '\n') || input.plan
      })
    },
    result: {
      hidden: true
    }
  },

  // An `exec` row only survives translation when nothing in the script was
  // recognized, so show the script as code instead of pretending it is a
  // command that ran.
  exec: {
    input: {
      type: 'collapsible',
      title: 'Sandbox script',
      defaultOpen: false,
      contentType: 'text',
      getContentProps: (input) => ({
        content: typeof input === 'string' ? input : JSON.stringify(input, null, 2),
        format: 'code'
      })
    },
    result: {
      type: 'collapsible',
      title: 'Output',
      contentType: 'text',
      getContentProps: (result) => ({ content: String(result?.content || ''), format: 'plain' })
    }
  },

  // ============================================================================
  // DEFAULT FALLBACK
  // ============================================================================

  Default: {
    input: {
      type: 'collapsible',
      // A tool with no config still deserves a line that says what it did.
      // Every row reading "Parameters" is what made unmapped provider tools
      // unreadable in the transcript.
      title: (input) => summarizeToolInput(input),
      defaultOpen: false,
      contentType: 'text',
      getContentProps: (input) => ({
        content: typeof input === 'string' ? input : JSON.stringify(input, null, 2),
        format: 'code'
      })
    },
    result: {
      type: 'collapsible',
      title: 'Output',
      contentType: 'text',
      getContentProps: (result) => {
        let content = result?.content || '';

        // Handle MCP format: array of objects with type and text fields
        if (typeof content === 'string') {
          try {
            const parsed = JSON.parse(content);
            if (Array.isArray(parsed)) {
              const textParts = parsed
                .filter((p: any) => p.type === 'text' && p.text)
                .map((p: any) => p.text);
              if (textParts.length > 0) {
                content = textParts.join('\n');
              }
            }
          } catch {
            // Not JSON or not MCP format, use as-is
          }
        } else if (Array.isArray(content)) {
          const textParts = content
            .filter((p: any) => p.type === 'text' && p.text)
            .map((p: any) => p.text);
          if (textParts.length > 0) {
            content = textParts.join('\n');
          } else {
            content = JSON.stringify(content, null, 2);
          }
        } else if (typeof content === 'object' && content !== null) {
          content = JSON.stringify(content, null, 2);
        }

        return {
          content: String(content),
          format: 'plain'
        };
      }
    }
  }
};

/**
 * Get configuration for a tool, with fallback to default
 */
export function getToolConfig(toolName: string): ToolDisplayConfig {
  return TOOL_CONFIGS[toolName] || TOOL_CONFIGS.Default;
}

/**
 * Check if a tool result should be hidden
 */
export function shouldHideToolResult(toolName: string, toolResult: any): boolean {
  const config = getToolConfig(toolName);

  if (!config.result) return false;

  // Hidden/success-only configs suppress noisy successful output, but errors
  // still need to be visible so failed tool calls are diagnosable.
  if (toolResult?.isError) return false;

  // Always hidden
  if (config.result.hidden) return true;

  // Hide on success only
  if (config.result.hideOnSuccess && toolResult) {
    return true;
  }

  return false;
}
