# dsh-aora-ball

DSH 界面内的表情球。常驻一颗 148px 的球，跟着会话状态换表情（思考 → 工具 → 出错 → 完成），32 种表情全部接到事件上；
可以拖到屏幕任意位置、点图钉锁住，闲着的时候眼睛会跟着鼠标走，还会自己在待机 / 好奇 / 发呆之间溜达。
引擎来自 [sam70361/aora-bot](https://github.com/sam70361/aora-bot) 的 `emotion-ball`（32 种状态表情 / 纯 SVG / 零依赖），
四个 js 已内联进 `client.js`，不联网、不加载外部脚本。

## 安装

```powershell
dsh plugin --profile desktop add github:tang-coder-hub/dsh-aora-ball
```

装完重启 DSH，右下角出现球；设置 → 内置插件 → 表情球 可调尺寸 / 位置 / 开关。
把「位置模式」切成**自由拖动**，就能直接按住球拖到任意位置（位置按视口比例记住，改窗口尺寸不会跑）。

`client.js` 是已提交的构建产物，装完即可用，不需要本地跑构建。

## 状态映射

| DSH 事件 | emotionId | 表现 |
| --- | --- | --- |
| `user/message` | 31 接收任务 | 竖直弹一下 |
| `turn/start` → 900ms 后 | 30 思考中 | 头顶青蓝环带 |
| `step/start` | 30 思考中 | 环带 |
| `tool/call` · 联网类 | 36 联网加载 | 头顶转圈 |
| `tool/call` · 读写/搜索类 | 40 检索资料 | 眯眼扫视 |
| `tool/call` · 写文件/跑命令类 | 16 专注 | 眼神定住 |
| `tool/call` · 记忆类 | 37 翻找回忆 | 歪头回想 |
| `tool/call` · 2 秒内第 3 次以上 | 17 慌张 | 手忙脚乱 |
| `tool/result` 失败 · 1 / 2 / 3 连错 | 11 诶？ → 20 困惑 → 21 生气 | 递进 |
| `tool/result` 成功 | 30 思考中 | 回到环带 |
| `approval/asked` | 35 等待输入 | 半眯眼盯着你 |
| `agent/error` · 限流 | 18 无奈 | 被限流了 |
| `agent/error` · 权限/拒绝 | 38 拒绝受限 | 被挡住了 |
| `agent/error` · 网络 | 36 联网加载 | 网络出岔子 |
| `agent/error` · 中断 | 41 停止终止 | 已停止 |
| `agent/error` · 其它 | 34 出错 | 情绪下沉 |
| `turn/end` | 39 输出回复 → 33 完成 | 撒花 |
| `turn/end` · 8 步以上 | 19 满意 | 干得漂亮 |
| `turn/end` · 没用工具 | 10 开心 | 聊得开心 |
| `turn/end` · 被中断 | 41 停止 → 12 失落 | 有点失落 |
| `turn/end` + 8s | 02 待机放空 | 回落基础姿态 |
| `session/created` | 13 惊讶 | 新会话 |
| `session/title` | 37 翻找回忆 | 记一下 |
| 空闲（可开关） | 02 / 03 / 04 轮流 | 待机、好奇、发呆之间溜达 |

32 个 emotionId 全覆盖（00 睡眠 / 01 唤醒 / 05 加载苏醒 / 06 休眠 / 07 抖动唤醒 / 14 害羞 / 15 疲惫 由引擎自身 idle 与过渡驱动）。

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
| 位置模式 | 四角停靠 / 自由拖动；自由模式下按比例记住位置 |
| 距屏幕边缘 | 0–80px |
| 跟随会话状态 | 关掉后球恒定待机，不再随思考/工具/完成变化 |
| 显示文字提示 | 球上方那行小字 |
| 固定位置 | 锁住在当前位置，拖动失效（也可点球左上角的图钉） |
| 眼睛跟随鼠标 | 空闲时目光跟随光标，睡着也会被叫醒 |
| 空闲多久去睡觉 | 3 / 10 / 30 分钟或不睡（改完重启 DSH 生效） |
| 空闲时自己溜达 | 没事干时在待机 / 好奇 / 发呆之间换着站 |
| 表情墙 · 全 32 个 | 点哪个试哪个，高亮跟当前 emotionId，分组：基础 / 情绪 / 工作 / 特殊 |
| 状态服务 | 显示 8778 是否在线、当前 emotionId 与延迟 |

全部存 `localStorage["aora-ball:settings"]`，改完即时生效，不用重启。

## 交互

| 操作 | 效果 |
| --- | --- |
| 鼠标移动（空闲时） | 球眼注视光标 |
| 按住球拖动 | 移到任意位置（需「自由拖动」且未锁定） |
| 点球左上角图钉 | 锁定 / 解锁位置 |
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
* 内联的表情球引擎：上游**非商业免费，商业需授权**；球形角色形象**仅限个人学习研究**，详见 [THIRD-PARTY.md](THIRD-PARTY.md)
