# Game Activity Card

把 Steam、PlayStation 和 Nintendo Switch 的近期游玩记录放进 GitHub 主页。三平台一起按已记录时长排序：前三款大卡，随后最多四款小卡；保留平台图标、文字和边框颜色。没有平台配额，也不用旧游戏补位。

组件提供 GitHub Action、Node CLI 和 ESM 函数。无需部署服务器，可以只连接其中一个平台。本项目从 [Llugaes 的主页](https://github.com/Llugaes)拆出；实际效果可在该主页查看。

## 用在自己的主页

1. 在自己的主页仓库添加 `activity.config.json`，只填写要连接的平台。Steam ID 是 17 位数字；PSN 填本人的 Online ID：

```json
{
  "name": "YOUR_NAME",
  "timeZone": "Asia/Shanghai",
  "steamId": "YOUR_17_DIGIT_STEAM_ID",
  "psnOnlineId": "YOUR_PSN_ONLINE_ID",
  "excludedSteamApps": { "1812620": "DSX", "431960": "Wallpaper Engine" }
}
```

2. 将相应凭据保存为仓库 Actions Secrets：`STEAM_API_KEY`、`PSN_NPSSO`、`NINTENDO_SESSION_TOKEN`。不用的平台不配置；不要把凭据放进 JSON、README 或工作流正文。连接步骤见[平台设置](docs/SETUP.md)。
3. 添加工作流。只接 Steam 时，将 `platforms` 改成 `steam`，配置里只保留 `name`、`timeZone`、`steamId` 即可；只接 Switch 时设为 `switch`，配置只需 `name` 和 `timeZone`。

```yaml
name: Game activity
on:
  workflow_dispatch:
  schedule:
    - cron: '17 */6 * * *'
permissions:
  contents: write
concurrency:
  group: game-activity
  cancel-in-progress: false
jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
      - run: sudo apt-get update && sudo apt-get install -y fonts-noto-cjk
      - uses: Llugaes/game-activity-card@v1.0.0
        id: activity
        continue-on-error: true
        with:
          platforms: steam,psn,switch
        env:
          STEAM_API_KEY: ${{ secrets.STEAM_API_KEY }}
          PSN_NPSSO: ${{ secrets.PSN_NPSSO }}
          NINTENDO_SESSION_TOKEN: ${{ secrets.NINTENDO_SESSION_TOKEN }}
      - name: Save generated files
        env:
          COMMIT_NAME: ${{ github.repository_owner }}
          COMMIT_EMAIL: ${{ github.repository_owner }}@users.noreply.github.com
        run: |
          git config user.name "$COMMIT_NAME"
          git config user.email "$COMMIT_EMAIL"
          git add data/activity.json assets/player-log* assets/covers docs/ACTIVITY.md
          if [ -f state/psn-session.enc.json ]; then git add state/psn-session.enc.json; fi
          if ! git diff --cached --quiet; then
            git commit -m 'chore: 更新游戏记录'
            git push
          fi
      - if: steps.activity.outcome == 'failure'
        run: exit 1
```

为供应链固定版本，可把发行 tag 换成对应的完整 commit SHA。工作流只提交列出的数据、卡片和加密状态；某平台失败时仍保留其他平台成果，最后报告失败。示例不会提交其他工作文件。

4. README 加上图片。将 `OWNER/REPO` 换成自己的仓库；Camo 缓存可能延迟，可使用下文的固定提交引用更新功能：

```html
<a href="./docs/ACTIVITY.md">
  <picture>
    <source media="(max-width: 600px)" srcset="https://raw.githubusercontent.com/OWNER/REPO/main/assets/player-log-mobile.webp" />
    <img src="https://raw.githubusercontent.com/OWNER/REPO/main/assets/player-log.webp" alt="近14天的游戏记录" width="100%" />
  </picture>
</a>
```

## 时长怎样计算

| 平台 | 近 14 天数据 | 边界 |
| :--- | :--- | :--- |
| Steam | 平台原生 `playtime_2weeks` | 截止最后成功采集时刻；本机缓存、采集失败或超过 24 小时的冻结窗口不进入当前排行和总计 |
| PlayStation | 同账号、同来源、相邻成功快照的累计差值 | 仅计算完整落入近 14×24 小时的观测区间；初次、新游戏、计数缺失或回退重新建基线，跨窗口边界不摊分 |
| Switch | 最近 14 个平台原日期的逐日时长 | 由配置时区确定今天；保留上游日期，重复日期替换，缺日期不虚构为每日零值，数据可能延迟一天 |

PSN、Switch 的窗口内已知记录在同步失败后仍可保留，标出过期或不完整状态。PSN 尚未建立基线时显示未知；观测新增可能包含历史游玩的迟到补报，最后游玩时间只参与展示和同分排序。总计包含全部合格游戏，图片最多展示七款；总计是平台记录的和，可能包含并行运行或挂起游戏，不代表真实在线时间。详情页列出各平台采集时间、方法、累计时长和覆盖情况。

公开 JSON 只保存白名单游玩字段。Nintendo 隐藏游戏会从当前数据和保留日记录中移除，历史 Git 提交仍需仓库所有者自行管理。账号/来源变化会隔离历史；PSN 会话只以 AES-256-GCM 密文存入 `state`，不公开明文令牌。

## CLI 和模块

Node.js 22+。可以克隆此仓后 `npm ci --ignore-scripts`，或在自己的工程安装固定 Git revision：

```sh
npm install --save-exact github:Llugaes/game-activity-card#v1.0.0
npx --no-install game-activity-card render
npx --no-install game-activity-card sync --platforms steam,psn,switch
npx --no-install game-activity-card collect --platforms psn
npx --no-install game-activity-card link-readme --repo OWNER/REPO
```

`render` 离线读取自己的 JSON 和封面缓存，不读取账号凭据或访问账号 API。`collect` 仅采集和保存数据；`sync` 先采集，再下载入选封面并渲染。所有可变文件默认相对当前目录，内置图标来自安装包。更换工作区用 `--root DIR`；CI 中必须位于 `GITHUB_WORKSPACE`。

| CLI / Action 输入 | 默认 | 内容 |
| :--- | :--- | :--- |
| `--config` / `config-path` | `activity.config.json` | 名称、时区、平台身份与 Steam 排除表 |
| `--data` / `data-path` | `data/activity.json` | 公开快照及观测历史 |
| `--output` / `output-dir` | `assets` | 图片、SVG、封面缓存 |
| `--state` / `state-path` | `state/psn-session.enc.json` | PSN 加密会话 |
| `--platforms` / `platforms` | `steam,psn,switch` | 本次采集平台 |

路径必须在声明的工作区内，拒绝 `..` 和符号链接逃逸。详情默认写入 `docs/ACTIVITY.md`；可选中文名表读取 `data/steam-titles.json`。Action 输出 `data-path`、`output-dir`、`failures`，不会替调用方提交或推送。

`link-readme` 在图片已提交后运行，将上述两个 README 图片地址绑定到当前完整 SHA，避免查询参数被 GitHub 图片代理丢弃。它只改两个卡片引用；随后由调用方提交 README。PlayStation 旧版加密域和 Nintendo 账号摘要域保留兼容，换包名不会让已有凭据失效。

```js
import { collectActivity, activityWindow, renderSvg, renderWebp } from 'game-activity-card';
const view = activityWindow(data, { asOf: new Date().toISOString(), timeZone: 'Asia/Shanghai' });
const svg = renderSvg(data, embeddedCovers, false, { name: 'PLAYER', asOf: view.asOf, timeZone: view.timeZone });
const webp = await renderWebp(svg);
```

`activityWindow` 为纯函数，返回全部 `rows`、`featured`、`secondary`、`totalMinutes`、各平台 `summaries` 及缺口 `gaps`。行包含 `platform:id` 身份、近期分钟数、方法、是否过期和是否不完整。同名不同平台保留独立记录。

## 开发与来源

`npm test` 覆盖数据校验、账号/来源切换、窗口边界、混合平台排行、失败保留、Nintendo 隐藏记录、凭据密文、CLI 工作区隔离与图片解码。CI 还从独立消费者目录调用同一 Action。

参考 [Steam 官方 API](https://partner.steamgames.com/doc/webapi/IPlayerService)、[psn-api](https://github.com/achievements-app/psn-api)、[Raycast Nintendo 历史实现](https://github.com/raycast/extensions/tree/main/extensions/switch-game-play-history)、[nscard](https://github.com/ChengChung/nscard)。[lowlighter/metrics](https://github.com/lowlighter/metrics/blob/master/source/plugins/steam/README.md) 和 [steam-widget](https://github.com/felix-sharky/steam-widget) 提供现成 Steam 展示；本组件补充这里需要的三平台统一排行和独立接入方式。不声称首创。

[MIT](LICENSE)。图标来源与许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
