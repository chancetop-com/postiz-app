# 渠道兼容讨论事实补充

日期：2026-11-11。用途：为 [决定 OAuth 弹窗回传与六平台限制的保留方式](../issues/04-channel-oauth-contract.md) 提供静态证据；决议只记录在该票的 Answer。

核查源：当前 fork `501e87dbfb2ca6e44662baec308afa468a922b38`；锁定目标 `v2.25.3` / `a5affe62c74e39c1e7ac960d50d8418b807d532c`。只读子代理使用 CodeGraph 核对当前源码，并从既有隔离副本读取目标提交原始文件；未把诊断 merge 结果当作目标版本。下述行号除标明 S 外均为当前 fork，均未运行验证。

## 渠道标识与入口

- `add.provider.component.tsx:687` 只对 social 列表应用六项过滤，`:748` 使用 item.name 显示名称；article 列表及存量渠道不受这个过滤器约束。
- `youtube.provider.ts:54–56`：YouTube；`linkedin.provider.ts:23–24`：LinkedIn；`tiktok.provider.ts:22–24`：Tiktok；`facebook.provider.ts:16–18`：Facebook Page；`instagram.provider.ts:23–26`：Instagram (Facebook Business)；`instagram.standalone.provider.ts:24–26`：Instagram (Standalone)。这些文件位于 `libraries/nestjs-libraries/src/integrations/social/`。
- `linkedin.page.provider.ts:23–24` 的 LinkedIn Page 是独立 identifier `linkedin-page`，不在六项中。
- S `tiktok.business.provider.ts:39–41` 的 identifier 是 `tiktok-business`，添加列表名称是 TikTok；S `tiktok.provider.ts:35–37` 保留原 `tiktok` / Tiktok。S callback 页面显示 TikTok Business，并增加 auth_code→code 适配（S `continue.integration.tsx:74–81,274`）。因此应以 identifier 区分，而非显示名称。

## popup 与回调路径

以下组件路径前缀为 `apps/frontend/src/components/`。

- `launches/add.provider.component.tsx:474–528`：invite、mobile 分支先早退，再判断 iframe 并走 relay popup；普通窗口直接导航。Web3、extension、customFields 在其它分支（`:530–633,646–667`），不能归入同一覆盖保证。
- `launches/launches.component.tsx:456`：refreshChannel 重连仍直接修改当前 window.location。
- `apps/frontend/src/app/(app)/channel-relay/page.tsx:10` 起：从 query 取 redirect、从 hash 取会话，写 sessionStorage/channel_popup_mode 后跳转；缺 redirect/auth 返回空白，redirect 未校验。
- `launches/continue.integration.tsx:43` 起：popup 回传优先于 returnURL/logged/inline；postMessage 使用 `*`，opener 缺失也尝试 close，flag 未清。`launches/launches.component.tsx:370` 起接收端只检查 type 再 mutate，不检查 origin/source/provider。
- `continue.integration.tsx:137–150,210–216,249–255`：412、406、常规成功与二步保存成功均进入同一回传 helper；`:199–207` 中间选择不提前回传。普通失败设置 error，不发送消息；error 视图只有 logged 情况下三秒跳 launches（`:153–162,379–412`）。
- `new-launch/providers/continue-provider/with-continue-provider.tsx:65,94–98`：中间选择为单选后保存。当前六项中 YouTube、Facebook Page、Instagram (Facebook Business) 有此流程。

## 对旧证据的修正

`continue.integration.tsx:237–246` 的二步保存失败仅设置 error/errorMessage，不清 twoStepState；render 在`:321` 先匹配 twoStepState && Provider，到`:379` 才判断 error。因此在存在 Provider 的二步失败路径上，选择 UI 可能继续显示，错误被遮住。

这是对 [前端逐项证据](customization-frontend-evidence.md) 中“2步保存失败也留错误页”的修正；其余普通失败与二步失败不能混为一谈。结论来自静态分支顺序，尚无浏览器运行证据。
