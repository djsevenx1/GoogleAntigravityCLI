/**
 * 前端思考内容中文净化与格式化工具
 * 保证界面展示的思考气泡 100% 为通俗易懂的地道中文
 */

export function formatThinkingContent(raw: unknown): string {
  if (raw == null) return '';
  const text = typeof raw === 'string' ? raw : String(raw);
  const trimmed = text.trim();
  if (!trimmed) return '';

  // 1. 常见底层英文操作短语匹配替换
  const prefixPatterns: [RegExp, string][] = [
    [/^I need to check (the )?(git )?status/i, '正在检查代码仓库与工作区状态...'],
    [/^I will run (the )?command/i, '正在执行系统诊断与自检命令...'],
    [/^Let me run (the )?command/i, '正在执行自检与状态验证命令...'],
    [/^I will search for/i, '正在检索工程代码与关键配置...'],
    [/^Let me search for/i, '正在检索目标代码与关键定义...'],
    [/^I should view (the )?file/i, '正在查看目标文件内容...'],
    [/^I need to view/i, '正在查看指定源码与配置...'],
    [/^Let me check/i, '正在核验系统运行参数与配置...'],
    [/^I will edit (the )?file/i, '正在修改代码文件内容...'],
    [/^I will use replace_file_content/i, '正在应用代码修改并执行替换...'],
    [/^I will use run_command/i, '正在调用系统工具执行自动化任务...'],
    [/^Analyzing directory/i, '正在分析工程目录结构...'],
    [/^Running tests?/i, '正在运行自动化测试验证...'],
    [/^Checking git status/i, '正在核查 Git 分支与改动...'],
    [/^Searching (the )?code/i, '正在全局检索代码引用...'],
    [/^Reviewing the changes/i, '正在审查代码改动与安全性...'],
    [/^Checking (the )?(proxy|port|network)/i, '正在检测网络代理与端口通信状态...'],
  ];

  for (const [pattern, replacement] of prefixPatterns) {
    if (pattern.test(trimmed)) {
      return replacement;
    }
  }

  // 2. 统计中文字符比例，如果基本没有中文（主要是英文），自动映射为规范中文说明
  const chineseCharCount = (trimmed.match(/[\u4e00-\u9fa5]/g) || []).length;
  const totalCharCount = trimmed.replace(/\s+/g, '').length;
  const isPrimarilyEnglish = totalCharCount > 0 && (chineseCharCount / totalCharCount < 0.25);

  if (isPrimarilyEnglish) {
    if (/proxy|19999|socks|urnetwork/i.test(trimmed)) {
      return '正在检测网络代理配置与 19999 端口通信状态...';
    }
    if (/git|commit|push|branch/i.test(trimmed)) {
      return '正在进行 Git 代码版本管理与远端同步...';
    }
    if (/build|compile|tsc|vite/i.test(trimmed)) {
      return '正在执行前后端全量编译构建与类型校验...';
    }
    if (/test|verify|check|lint|validate/i.test(trimmed)) {
      return '正在执行系统安全边界审查与自动化自检...';
    }
    if (/port|listen|restart|process|kill/i.test(trimmed)) {
      return '正在协调后台进程状态与端口常驻监听...';
    }
    if (/session|history|message|chat/i.test(trimmed)) {
      return '正在同步会话上下文与历史交互记录...';
    }
    return '正在分析业务逻辑与规划下一步执行动作...';
  }

  return trimmed;
}
