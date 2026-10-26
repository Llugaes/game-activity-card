# 平台连接

只连接要公开的平台。Secrets 保存在自己的仓库，截图、聊天和公开配置都不用粘贴凭据。

## Steam

在[官方 API key 页面](https://steamcommunity.com/dev/apikey)创建自己的 key，保存为 Actions Secret `STEAM_API_KEY`。配置 `steamId`；游戏详情须对 API 可见。`excludedSteamApps` 可以排除 DSX、Wallpaper Engine 等工具。可选中文名称放在 `data/steam-titles.json`，格式为 `{"APP_ID":"游戏名"}`。

## PlayStation

按 [psn-api 的手动认证指引](https://psn-api.achievements.app/authentication/authenticating-manually)登录本人账号并获取 NPSSO，保存为 `PSN_NPSSO`，配置 `psnOnlineId`。组件读取前核对本人 Online ID，自动刷新令牌并保存加密会话；授权撤销后需本人重新授权。普通更新不必重新登录。

Sony 返回累计时长，首次接入后开始记录观测区间。刚接入、新游戏和计数回退的首段无法凭空补齐，详情会说明覆盖不足。后续同步自动建立自己的历史。

## Nintendo Switch

组件使用 Nintendo Store 的游玩历史接口。借鉴现有社区接入，不要求添加好友或安装主机改动。

在已登录 `gh` 的本机运行：

```sh
npx --no-install game-activity-card connect-nintendo --repo OWNER/REPO
```

打开终端给出的本机地址，点击 Nintendo 官方登录入口。登录后，右键复制“选择此账号”按钮的链接，粘贴回本机页面。组件检查 PKCE/state，将凭据直接通过 `gh` 保存为该仓库 `NINTENDO_SESSION_TOKEN`，不在终端显示明文。然后手动运行工作流，`platforms` 选 `switch` 或全部平台。

服务只监听 `127.0.0.1`，检查 Host、Origin、回调 state，30 分钟后关闭。这个本机帮助入口需要用户主动运行；云端同步不启动它。

[任天堂说明](https://en-americas-support.nintendo.com/app/answers/detail/a_id/68647/p/1128)：游玩日记录可能延迟一天，主机需睡眠联网才能上传。组件接收晚到修正，保留平台原日期；上游返回的隐藏游戏不会进入当前公开数据。重新授权且无法取得相同账号标识时会建立独立历史。

## 本机 Steam 缓存导入

只用于还没连接云端 Steam API 的初始检查：

```sh
npx --no-install game-activity-card import-steam --steam-root "STEAM_INSTALL_DIRECTORY"
```

仅读取配置账号的游玩白名单字段，拒绝覆盖已经连接的云端数据。本机快照会显示在详情，当前跨平台榜单不采用冻结的本机两周数。
