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
    // 1. Google 地区限制与风控拦截 (User location is not supported / 403 Forbidden / robot.png)
    if (/location is not supported/i.test(text) ||
        /FAILED_PRECONDITION/i.test(text) ||
        /region is not supported/i.test(text) ||
        /country is not supported/i.test(text) ||
        /code 403/i.test(text) ||
        /Error 403/i.test(text) ||
        /Forbidden/i.test(text) ||
        /robot\.png/i.test(text)) {
        return `⚠️【Google 地区或节点风控拦截 (User Location / 403 Forbidden)】
检测到当前出口节点被 Google 服务限制或判定为受限 IP 区域。

💡 解决办法：
1. 请确认【设置】->【网络代理】中的 SOCKS5 代理已开启（19999 端口常驻守护）；
2. 系统已在后台自动触发自愈并轮换节点；
3. 直接在输入框发送“继续”，即可无缝恢复对话。`;
    }
    // 2. 流中断与卡顿超时 (subscriber fell behind updates / interrupted)
    if (/subscriber fell behind updates/i.test(text) ||
        /stalled for/i.test(text) ||
        /connection to the agent was interrupted/i.test(text) ||
        /stream was interrupted/i.test(text)) {
        return '🌐【会话数据流短暂卡顿】本次输出数据吞吐量较大，底层通信流发生短暂抖动已自动恢复。会话上下文已完整保留，请直接发送“继续”即可接着处理。';
    }
    // 3. 速率与额度用尽 (RESOURCE_EXHAUSTED / 429)
    if (/RESOURCE_EXHAUSTED/i.test(text) || /Individual quota reached/i.test(text) || /429/i.test(text)) {
        return '⚠️【请求速率上限提醒 (429)】当前模型短期请求过于频繁，触发了 Google 云端速率限制，请稍候 1~2 分钟或切换到 Gemini 2.5 Flash 快速模型继续。';
    }
    // 4. 网络断开 / EOF / 握手失败
    if (/connection reset/i.test(text) || /unexpected EOF/i.test(text) || /broken pipe/i.test(text) || /socket hang up/i.test(text)) {
        return '🌐【网络连接抖动】与 Google 云端通信链路发生短暂闪断，系统已自动重连。请直接回复“继续”重新触发。';
    }
    // 5. 会话上下文丢失
    if (/trajectory not found|conversation not found/i.test(text)) {
        return '🔄【会话状态重置】未检索到该会话历史上下文，系统已自动平滑开启全新交互轮次。';
    }
    // 6. 凭据过期 (401 / UNAUTHENTICATED)
    if (/UNAUTHENTICATED/i.test(text) || /token expired/i.test(text) || /401/i.test(text)) {
        return '🔑【账号授权过期】当前 Google 账号登录凭据已过期，请前往【设置】->【智能体】重新登录授权。';
    }
    // 7. 防御性过滤：如果包含原始 HTML 标签，绝不把大篇网页代码抛给用户
    if (/<!DOCTYPE html>|<html|<title>Error/i.test(text)) {
        return '⚠️【Google 云端服务响应异常】云端服务返回了拦截页面（可能是节点临时受限），系统已尝试自动切换通道，请发送“继续”重试。';
    }
    return text;
}
//# sourceMappingURL=antigravity-chinese-filter.js.map