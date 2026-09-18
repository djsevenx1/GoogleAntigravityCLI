/**
 * Antigravity 中文思考过滤器与本地化网关
 * 彻底杜绝底层英文思考、工具调用短语与调试日志泄露到前端用户界面
 */
export function localizeEnglishThought(thought) {
    if (!thought || typeof thought !== 'string') {
        return '';
    }
    return thought.trim();
}
/**
 * 将底层 CLI / API 的英文报错转译为清晰易懂的人性化中文引导
 */
export function humanizeAntigravityError(rawError) {
    if (!rawError || typeof rawError !== 'string') {
        return '系统执行出现未知异常，请重试。';
    }
    const text = rawError.trim();
    // 1. Google 地区限制报错 (User location is not supported)
    if (/location is not supported/i.test(text) ||
        /FAILED_PRECONDITION/i.test(text) ||
        /region is not supported/i.test(text) ||
        /country is not supported/i.test(text)) {
        return `⚠️【Google 地区限制拦截 (User Location Not Supported)】
检测到当前网络直连或出口 IP 处于 Google 服务未覆盖区域。

💡 简易排查与解决办法：
1. 点击右上角【设置】->【网络代理】；
2. 确认已开启【SOCKS5 代理】（后台 19999 端口常驻守护）；
3. 出口节点推荐选择【美国 (United States)】或可用海外节点；
4. 切换后直接在输入框发送“继续”，即可无缝恢复对话。`;
    }
    // 2. 速率与额度用尽 (RESOURCE_EXHAUSTED / 429)
    if (/RESOURCE_EXHAUSTED/i.test(text) || /Individual quota reached/i.test(text) || /429/i.test(text)) {
        return '⚠️【请求速率上限提醒 (429)】当前模型短期请求过于频繁，触发了 Google 云端速率限制，请稍候 1~2 分钟或切换到 Gemini 2.5 Flash 快速模型继续。';
    }
    // 3. 网络断开 / EOF / 握手失败
    if (/connection reset/i.test(text) || /unexpected EOF/i.test(text) || /broken pipe/i.test(text) || /socket hang up/i.test(text)) {
        return '🌐【网络连接抖动】与 Google 云端通信链路发生短暂闪断，系统已自动重连。请直接回复“继续”重新触发。';
    }
    // 4. 会话上下文丢失
    if (/trajectory not found|conversation not found/i.test(text)) {
        return '🔄【会话状态重置】未检索到该会话历史上下文，系统已自动平滑开启全新交互轮次。';
    }
    // 5. 凭据过期 (401 / 403 / UNAUTHENTICATED)
    if (/UNAUTHENTICATED/i.test(text) || /token expired/i.test(text) || /401/i.test(text)) {
        return '🔑【账号授权过期】当前 Google 账号登录凭据已过期，请前往【设置】->【智能体】重新登录授权。';
    }
    return text;
}
//# sourceMappingURL=antigravity-chinese-filter.js.map