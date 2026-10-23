# dsh-aora-ball

DSH 界面内的表情球。右下角常驻一颗 148px 的球，跟着会话状态换表情（思考 → 工具 → 出错 → 完成）。
引擎来自 [sam70361/aora-bot](https://github.com/sam70361/aora-bot) 的 `emotion-ball`（32 种状态表情 / 纯 SVG / 零依赖），
四个 js 已内联进 `client.js`，不联网、不加载外部脚本。

## 安装

```powershell
dsh plugin --profile desktop add github:tang-coder-hub/dsh-aora-ball
```

装完重启 DSH，右下角出现球；设置 → 内置插件 → 表情球 可调尺寸 / 位置 / 开关。

`client.js` 是已提交的构建产物，装完即可用，不需要本地跑构建。

## 状态映射

| DSH 事件 | emotionId | 表现 |
| --- | --- | --- |
| `user/message` | 31 接收任务 | 竖直弹一下 |
| `turn/start` → 900ms 后 | 30 思考中 | 头顶青蓝环带 |
| `tool/call` | 32 处理中 | 抖动忙碌 |
| `tool/result` / `step/end` → 200ms 后 | 30 思考中 | 回到环带 |
| `approval/asked` | 35 等待输入 | 半眯眼盯着你 |
| `agent/error` | 34 出错 | 情绪下沉 |
| `turn/end` | 33 任务完成 | 撒花 |
| `turn/end` + 7s | 02 待机放空 | 回落基础姿态 |

引擎自带 idle 策略：静置更久会自动掉进 00 睡眠。

## 状态服务（内置）

插件自己在 `127.0.0.1:8778` 起一个极小的状态服务（`node:http`，零依赖）：

* host 侧 `index.js` 把会话事件翻成 `{emotionId, tips}`，直接写内存；
* client 侧每 700ms `GET /state` 读回来驱动球；
* 端口被占用时（比如你另开了自己的服务）自动降级成 `POST` 到那个服务；
* 服务挂了不影响 DSH：两边都静默失败，球停在待机。

手动试表情：

```powershell
curl.exe -X POST http://127.0.0.1:8778/state -H "content-type: application/json" -d "{\"emotionId\":\"33\",\"tips\":\"任务完成\"}"
curl.exe http://127.0.0.1:8778/state
```

## 设置面板

设置 → 内置插件 → **表情球**（和「图像生成」「OpenCode 调色板」同一排页签）。

| 项 | 作用 |
| --- | --- |
| 显示表情球 | 总开关，等价于双击球 / Alt+B |
| 球的尺寸 | 80–280px，整体缩放（眼睛、环带、提示一起） |
| 停在哪个角 | 右下 / 左下 / 右上 / 左上 |
| 距屏幕边缘 | 0–80px |
| 跟随会话状态 | 关掉后球恒定待机，不再随思考/工具/完成变化 |
| 显示文字提示 | 球上方那行小字 |
| 试表情 / 重置表情 | 手动切 8 种状态，验证渲染用 |
| 状态服务 | 显示 8778 是否在线、当前 emotionId 与延迟 |

全部存 `localStorage["aora-ball:settings"]`，改完即时生效，不用重启。

## 交互

| 操作 | 效果 |
| --- | --- |
| 鼠标移动 | 球眼注视光标 |
| 双击球 | 隐藏 / 显示（记忆在 localStorage） |
| `Alt+B` | 同上（球藏起来后用它叫回来） |

## 卸载

```powershell
dsh plugin --profile desktop remove dsh-aora-ball
```

## 改引擎或改大小

* `engine/` 是上游 `emotion-ball` 的四个源文件（rings / emotions / ball / engine，未改动）；
* `client.tpl.js` 是本插件的模板，`client.js` 由 `build.mjs` 把 `engine/` 内联进去生成：

```powershell
node build.mjs
```

* 初始尺寸改 `client.tpl.js` 里的 `BASE`（默认 148）；运行时实际大小由设置面板的滑块决定（走 `transform: scale()`，不用改代码）。


## 许可

* 插件自身代码（`index.js` / `client.tpl.js` / `build.mjs` / `cordis.patch.yml`）：**MIT**，见 [LICENSE](LICENSE)
* 内联的表情球引擎：上游**非商业免费，商业需授权**；球形角色形象**仅限个人学习研究**，详见 [NOTICE.md](NOTICE.md)
