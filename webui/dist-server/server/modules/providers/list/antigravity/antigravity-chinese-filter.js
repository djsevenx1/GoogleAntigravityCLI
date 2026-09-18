/**
 * Antigravity 中文思考过滤器与本地化网关
 * 彻底杜绝底层英文思考、工具调用短语与调试日志泄露到前端用户界面
 */
export function localizeEnglishThought(thought) {
    if (!thought || typeof thought !== 'string') {
        return '正在分析任务并规划执行动作...';
    }
    const trimmed = thought.trim();
    if (!trimmed) {
        return '正在思考中...';
    }
    // 1. 精准高频模式匹配替换
    const exactPatterns = [
        [/^I need to check (the )?(status|config|file|code).*/i, '正在检查相关配置与代码状态...'],
        [/^I will check (the )?(status|config|file|code).*/i, '正在检查相关配置与代码状态...'],
        [/^Let me check (the )?(status|config|file|code).*/i, '正在核对相关配置文件与运行状态...'],
        [/^Let me inspect (the )?(file|code|dir|directory).*/i, '正在审查目标代码与文件结构...'],
        [/^I will inspect (the )?(file|code|dir|directory).*/i, '正在分析目标文件与代码细节...'],
        [/^I will examine (the )?(file|code|dir|directory).*/i, '正在详细分析文件内容与代码逻辑...'],
        [/^Let's examine (the )?(file|code|dir|directory).*/i, '正在分析关键代码与工程配置...'],
        [/^I will search for .*/i, '正在检索目标代码与配置引用...'],
        [/^Let me search for .*/i, '正在全文检索相关代码与定义...'],
        [/^I need to find .*/i, '正在查找相关文件与依赖项...'],
        [/^I will read the file .*/i, '正在读取并分析文件源码...'],
        [/^Let me read (the )?file .*/i, '正在查看目标文件内容...'],
        [/^I will edit (the )?file .*/i, '正在编写并替换代码逻辑...'],
        [/^I will modify (the )?file .*/i, '正在修改并优化目标代码...'],
        [/^I will create (the )?file .*/i, '正在创建并写入所需代码文件...'],
        [/^I will run (the )?command .*/i, '正在执行系统自检与调试命令...'],
        [/^Let me run (the )?command .*/i, '正在运行自检与状态验证命令...'],
        [/^Running (the )?(test|build|lint|command).*/i, '正在运行自动化构建与校验流程...'],
        [/^Testing (the )?(api|endpoint|service|server).*/i, '正在测试服务接口与网络通信...'],
        [/^Restarting (the )?(server|service|daemon).*/i, '正在平滑重启服务进程并验证端口...'],
        [/^Checking (the )?(proxy|port|network|connection).*/i, '正在检测代理端口与网络链路连通性...'],
        [/^Checking if .*/i, '正在验证系统状态与服务指标...'],
        [/^Looking at (the )?.*/i, '正在查看代码上下文与业务契约...'],
        [/^The user (wants|asked|requested) .*/i, '正在理解并对齐用户指令要求...'],
        [/^Based on the (user|request|history) .*/i, '正在综合上下文需求制定解决方案...'],
        [/^Now I will .*/i, '正在执行下一步核心任务...'],
        [/^Next, I will .*/i, '正在推进后续逻辑实现...'],
        [/^Wait, I see .*/i, '正在排查潜在隐患并进行自愈修正...'],
        [/^Ah, I see .*/i, '已定位核心问题根因，正在制定自愈方案...'],
    ];
    for (const [pattern, replacement] of exactPatterns) {
        if (pattern.test(trimmed)) {
            return replacement;
        }
    }
    // 2. 统计中文字符比例，如果中文字符极少（英文为主），则进行主题分类替换
    const chineseCharCount = (trimmed.match(/[\u4e00-\u9fa5]/g) || []).length;
    const totalCharCount = trimmed.replace(/\s+/g, '').length;
    const isPrimarilyEnglish = totalCharCount > 0 && (chineseCharCount / totalCharCount < 0.25);
    if (isPrimarilyEnglish) {
        if (/proxy|19999|socks|urnetwork/i.test(trimmed)) {
            return '正在检测与优化 19999 代理常驻链路状态...';
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
        return '正在深入分析系统架构并执行自动化自检...';
    }
    return trimmed;
}
//# sourceMappingURL=antigravity-chinese-filter.js.map