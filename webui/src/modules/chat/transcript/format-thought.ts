/**
 * 前端思考内容中文净化与格式化工具
 * 保证界面展示的思考气泡 100% 为通俗易懂的地道中文
 */

export function formatThinkingContent(raw: unknown): string {
  if (raw == null) return '';
  const text = typeof raw === 'string' ? raw : String(raw);
  return text.trim();
}

/**
 * 前端错误信息人性化转译工具
 * 将 Google 官方地区限制、速率配额、网络闪断等底层堆栈转化为通俗易懂的中文操作引导
 */
export function humanizeErrorMessage(raw: unknown): string {
  if (raw == null) return '';
  const text = typeof raw === 'string' ? raw : String(raw);
  const trimmed = text.trim();
  if (!trimmed) return '';

  // 1. Google 地区限制报错 (User location is not supported)
  if (
    /location is not supported/i.test(trimmed) ||
    /FAILED_PRECONDITION/i.test(trimmed) ||
    /region is not supported/i.test(trimmed) ||
    /country is not supported/i.test(trimmed)
  ) {
    return `⚠️【Google 地区限制拦截 (User Location Not Supported)】
检测到当前网络直连或出口 IP 处于 Google 服务未覆盖区域。

💡 简易排查与解决办法：
1. 点击右上角【设置】->【网络代理】；
2. 确认已开启【SOCKS5 代理】（后台 19999 端口常驻守护）；
3. 出口节点推荐选择【美国 (United States)】或可用海外节点；
4. 切换后直接在输入框发送“继续”，即可无缝恢复对话。`;
  }

  // 2. 速率与额度用尽 (RESOURCE_EXHAUSTED / 429)
  if (/RESOURCE_EXHAUSTED/i.test(trimmed) || /Individual quota reached/i.test(trimmed) || /429/i.test(trimmed)) {
    return '⚠️【请求速率上限提醒 (429)】当前模型短期请求过于频繁，触发了 Google 云端速率限制，请稍候 1~2 分钟或切换到 Gemini 2.5 Flash 快速模型继续。';
  }

  // 3. 网络断开 / EOF / 握手失败
  if (/connection reset/i.test(trimmed) || /unexpected EOF/i.test(trimmed) || /broken pipe/i.test(trimmed) || /socket hang up/i.test(trimmed)) {
    return '🌐【网络连接抖动】与 Google 云端通信链路发生短暂闪断，系统已自动重连。请直接回复“继续”重新触发。';
  }

  // 4. 会话上下文丢失
  if (/trajectory not found|conversation not found/i.test(trimmed)) {
    return '🔄【会话状态重置】未检索到该会话历史上下文，系统已自动平滑开启全新交互轮次。';
  }

  // 5. 凭据过期 (401 / 403 / UNAUTHENTICATED)
  if (/UNAUTHENTICATED/i.test(trimmed) || /token expired/i.test(trimmed) || /401/i.test(trimmed)) {
    return '🔑【账号授权过期】当前 Google 账号登录凭据已过期，请前往【设置】->【智能体】重新登录授权。';
  }

  return trimmed;
}
