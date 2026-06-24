# opencode go账号助手

这是给 CPA OpenCode Go 安全 MVP 使用的 Tampermonkey 脚本。它不需要本机 helper，也不需要远端浏览器。

## 安装

1. 安装 Tampermonkey。
2. 从 GitHub raw 地址安装或新建脚本并粘贴 `opencode-go-account-helper.user.js`。
3. 打开 `https://opencode.ai/` 并登录目标账号。
4. 打开 `https://opencode.ai/` 后，页面右下角会自动显示「opencode go账号助手」。
5. 填写 CPA 地址，例如 `https://cpa.tlytelec.com:18443`，脚本会自动拼接 management API 路径。
6. 填写 CPA 管理密钥。

Greasy Fork 导入地址：

```text
https://raw.githubusercontent.com/kogekiplay/opencode-go-account-helper-userscript/main/opencode-go-account-helper.user.js
```

## 功能

- 同步当前账号的 workspaceId、邮箱、页面中可见或 `/keys` 页面可见的 API key。
- OpenCode Go 用量由 CPA 后端使用已保存 Cookie 刷新，脚本不解析页面额度。
- Cookie 上传默认开启，可手动取消「允许上传 Cookie」。
- 从 CPA 拉取已保存账号列表，并显示每个账号的 Workspace、Cookie、API key、provider 同步状态。
- 可对任意已保存 Cookie 的账号执行「切换账号」，脚本会写入对应 Cookie 并打开该账号的 OpenCode Go 工作区页面。
- 面板会记住上次展开或折叠状态；点击右上角关闭按钮后会收起为右下角小按钮。

## 安全边界

- 脚本不做自动注册。
- 脚本不做协议级自动领奖。
- 切号和打开对应工作区前一定会弹出浏览器确认框。
- Cookie 默认上传，可在脚本面板中取消勾选。
- CPA 管理密钥只保存在 Tampermonkey 脚本存储里，不会写入 opencode.ai 页面。

## 限制

- `document.cookie` 无法读取 HttpOnly Cookie。
- `GM_cookie` 是否能读取或写入 HttpOnly Cookie 取决于浏览器和 Tampermonkey 环境。
- OpenCode 页面结构变化后，API key 解析可能需要调整。
