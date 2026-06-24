# opencode go账号助手

这是给 CPA OpenCode Go 安全 MVP 使用的 Tampermonkey 脚本。它不需要本机 helper，也不需要远端浏览器。

## 安装

1. 安装 Tampermonkey。
2. 从 GitHub raw 地址安装或新建脚本并粘贴 `opencode-go-account-helper.user.js`。
3. 打开 `https://opencode.ai/` 并登录目标账号。
4. 从 Tampermonkey 菜单打开「opencode go账号助手」。
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
- 从 CPA 拉取已保存账号列表。
- 用户确认后写入 Cookie 并刷新页面来切换账号。

## 安全边界

- 脚本不做自动注册。
- 脚本不做协议级自动领奖。
- 切号一定会弹出浏览器确认框。
- Cookie 默认上传，可在脚本面板中取消勾选。
- CPA 管理密钥只保存在 Tampermonkey 脚本存储里，不会写入 opencode.ai 页面。

## 限制

- `document.cookie` 无法读取 HttpOnly Cookie。
- `GM_cookie` 是否能读取或写入 HttpOnly Cookie 取决于浏览器和 Tampermonkey 环境。
- OpenCode 页面结构变化后，API key 解析可能需要调整。
