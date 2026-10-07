# dsh-computer-use-mode — 电脑操作模式

中文 | [English](README.en.md)

在 DeepSeek Harness 中新增第五个模式「电脑操作模式」：保留标准模式的全部能力，并加上**屏幕截图**与**鼠标键盘控制**，用于操作没有 agent 接口的软件、以及读取只存在于屏幕上的信息。

## 快速开始

前提：Windows + 已安装 DeepSeek Harness 桌面版。

**方式一：从 Harness 界面安装（推荐）**

在插件页点「添加插件」，输入包名：

```
dsh-computer-use-mode
```

该包已发布到 npm：<https://www.npmjs.com/package/dsh-computer-use-mode>

或直接输入仓库地址（不依赖 npm）：

```
https://github.com/EvangeliMo/dsh-computer-use
```

安装后**重启 Harness**，新建任务时选择「电脑操作模式」。

**方式二：克隆后本地安装**

```powershell
git clone https://github.com/EvangeliMo/dsh-computer-use.git
cd dsh-computer-use
powershell.exe -NoProfile -ExecutionPolicy Bypass -File install.ps1
```

安装脚本会自动定位 profile（优先 `desktop`；机器上有多个 profile 且无 `desktop` 时会报错要求你显式指定 `-Profile <路径>`）。先用 `-WhatIf` 空运行可以看到它打算做什么而不写入任何东西。

**不需要 `npm install`。** 本插件不声明任何依赖：`koffi`、`fflate`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/schemastery` 都由 Harness 安装目录提供，`lib/loader.cjs` 从 `process.resourcesPath` 推导安装位置去解析它们。因此**无论从界面安装、从 npm 安装还是克隆到任意位置都能工作**，也不依赖网络。

## 这个模式提供什么

两个工具：

| 工具 | 用途 |
|---|---|
| `computer` | 单步操作。动作：`screenshot` / `screen_info` / `windows` / `focus_window` / `click` / `double_click` / `right_click` / `middle_click` / `move` / `drag` / `scroll` / `type` / `shortcut` / `key` / `cursor` / `sleep` / `waitForChange` / `waitUntilStable` |
| `computer_batch` | 一次调用执行多步序列（每步可带 `sleep` 等界面稳定），用于「点击 → 输入 → 回车」这类机械连招 |

`waitForChange` 与 `waitUntilStable` 通过持续采样屏幕来判断界面是否已稳定，避免靠猜 `sleep` 时长。

外加一段系统提示词段落，注册在 Harness 自己预留的 `TOOL_COMPUTER_USE` 插槽（order 3000），负责说明工作流与安全边界。

## 为视觉模型设计的观察流程

**第一步 — 全局概览。** 全屏截图以**原生分辨率**返回（1920×1080 的屏幕就返回 1920×1080 的图），并在图上**烧录坐标标尺**和 **1–4 象限编号**，模型不需要做心算，坐标直接写在图里。

> 这里**不做任何预先降采样**。模型自己会压缩图像（例如 DeepSeek V4.1 会自动下调分辨率），提前缩小只会丢掉 agent 想看却还没看到的细节。`fullMaxDimension`（默认 4096）只是超大虚拟桌面的安全上限，在 1920×1080 上永远不会触发。

**第二步 — 局部原生分辨率。** 用 `region` 参数重新截取一个小区域，只要最长边不超过 `nativeMaxDimension`（默认 1400），就以 `scale: 1` 原生分辨率返回——此时图像像素就是屏幕像素，小字完全可读。

**`tiles` 参数**可以把一个较大区域一次切成最多 9 块原生分辨率图，省掉多次往返。

坐标换算规则只有一个：`屏幕坐标 = region 原点 + 图像坐标 / scale`。结果里 `region`、`scale`、`size` 每次都明确回报。

## 模型不支持图像输入时会怎样

**这是最容易误判为"插件坏了"的情况，所以单独说明。**

如果当前模型不声明图像输入能力，harness（`dsh-llm`）**不会报错**，而是在发请求前把每个图像块替换成一行文字：

```
[image omitted because this model accepts text only; attachment sha256:xxxxxxxx]
```

结果是：截图成功、PNG 落盘、附件也存好了，但 agent 只收到那行文字，于是报告"看不到屏幕"，而使用者会合理怀疑是插件、磁盘或电脑的问题。

为了让这种情况**自证**而不是静默失败，`screenshot` 会在动手前先检查调用方的模型能力，不支持就直接拒绝，并且**不做无谓的截图**：

```
cannot capture the screen for model "xxx": it declares input modalities [text] and no
image support, so any capture would be replaced with a text placeholder before it
reached you and you would see nothing. Switch this session to a model that accepts
image input, ... The screen was NOT captured.
```

排查顺序：

1. 看到上面这条 → **换一个支持图像输入的模型**，不是插件问题
2. 看到 `invalid output: value is not lossless JSON` → 见下一节（这是插件曾经的真实缺陷，已修）
3. 看到 `NO IMAGE WAS ATTACHED TO THIS RESULT (...)` → 附件服务未挂载，文字里已给出原因和落盘路径
4. 看到 `image omitted to fit request image limits` → 是图像**配额**问题，与磁盘空间无关
5. 以上都没有 → 请把工具返回的原文发出来

> 注意"存储空间"几乎不可能是原因：截图写入系统临时目录，且写入失败时会在结果里**明确报告**，不会表现为"看不到屏幕"。

## 工具输出必须是无损 JSON

工具注册表会在记录结果前用严格校验器检查它，不通过就**整个调用失败**：

```
invalid output: value is not lossless JSON
```

这个校验比 `JSON.stringify` 严格得多，它拒绝：

| 被拒的值 | 原因 |
|---|---|
| `undefined`（作为对象属性） | `JSON.stringify` 会**丢掉**这个键，往返不一致 |
| `NaN` / `Infinity` / `-0` | 分别序列化成 `null` / `null` / `0` |
| `Date`、类实例 | 非纯对象原型，身份无法保持 |
| Symbol、不可枚举的自有键 | 无法表达 |

**真实事故**：`screenshot` 在某个区域**首次**截图时会执行

```js
shot.meta.changed = before === undefined ? undefined : before !== shot.meta.signature;
```

没有基准时就写入了 `changed: undefined` → 整个结果非无损 → **调用直接失败**。表现是 agent 说"我现在看不到屏幕，截屏工具报 invalid output: value is not lossless JSON"，而使用者会去怀疑磁盘或显卡。

它还有个恶劣特性：**只在特定条件下触发**。同一区域第一次截图才带这个字段，所以自测容易全绿，换台机器或换个调用顺序就崩。

修法是两层：

1. 源头：只在有基准时才设置 `changed`
2. **出口统一净化**：`jsonSafe()` 在 `execute` 返回前递归处理整个结果——`undefined` 属性**直接删除**（而不是变成 `null`，那会凭空造出一个调用方从未设置的值），非有限数归零，`Date` 转 ISO 字符串，其余按 JSON 规则规整

第 2 层让"输出是无损 JSON"成为**结构性保证**，而不是每加一个字段都要记得遵守的纪律。

`scripts/test-plugin.cjs` 里移植了注册表那个校验器（`losslessJsonProblem`），并对首次截图、重复截图、省略全部可选参数、批量、批量中途失败等场景逐一断言。**必须用移植的校验器而不是 `JSON.stringify` 来测**——后者会放过一批注册表拒绝的值，这正是这个 bug 能溜过去的原因。

## 关键实现约束（改动前请先读）

1. **坐标零换算。** 实测插件宿主进程 `DPI awareness = 2`（per-monitor）、`dpi = 120`，且 `GetSystemMetrics` == `DESKTOPHORZRES` == 1920。截图、`GetCursorPos`、`SetCursorPos` 天然处于**同一个物理像素空间**，因此本插件从不做坐标缩放。唯一的缩放发生在交给模型的图像上，且该系数明确回报。**不要**引入基于 DPI 的坐标换算——那会引入本不存在的错误。

2. **必须是 CommonJS。** `koffi` 与 `@deepseek-ai/dsh-tools` 都在安装包的 `app.asar` 内。只有 CommonJS 的 `require` 会经过 Electron 的 asar 感知解析器；ESM 的 bare import 会以 `ERR_MODULE_NOT_FOUND` 失败（已从部署位置实测）。同时**不能**把这些包复制进插件目录：那会产生第二份 `cordis` 实例，破坏服务身份。因此入口文件是 CJS，并通过 `lib/loader.cjs` 的安装路径感知解析器取得宿主模块。

3. **PNG 的 IDAT 必须是 zlib 流。** `fflate.deflateSync` 输出的是**裸 deflate**，libpng 会以 `vipspng: libpng read error` 拒绝；而裸 deflate 用 `inflateRaw` 却能正常解开，这个组合极具误导性。必须用 `fflate.zlibSync`。此项经 A/B 对照实验定位。

4. **图片经 `projectContent` 投递。** `execute` 只能返回纯 JSON，图片字节必须先异步落盘为 attachment，再由 `projectContent` 挂上 `{ type: 'image', attachment }` 块——与 `dsh-mcp-client` 相同的 seam。

## 安装

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File install.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File install.ps1 -WhatIf   # 空运行
```

安装脚本会：备份 profile 配置到带时间戳的目录 → 把插件**真实复制**到 `profiles\desktop\node_modules\dsh-computer-use` → 在 profile 的 `bundles` 里追加 `dsh-computer-use`。

**刻意不使用 junction**：应用的重启恢复流程（"禁用第三方插件、备份 profile 补丁、重启"）会跟随 junction 并删除其目标，此前曾因此损毁插件源码。

**不修改安装目录内任何文件**，因此 Harness 升级或重装都不会冲掉本插件。

### ⚠️ profile manifest 的 BOM 会直接导致启动崩溃

`~/.dsh/profiles/desktop/package.json` 是模式清单，dsh-host 用裸 `JSON.parse()` 读取它。**只要文件开头有 UTF-8 BOM（`EF BB BF`），host 就在启动早期抛 `Unexpected token '\uFEFF'` 并立刻退出**，弹窗显示"应用无法启动或已意外停止"，而弹窗建议的"重新安装"**完全无效**——重装只覆盖程序目录，不碰 `~/.dsh`。

本插件的 `install.ps1` 第一版踩过这个坑：它用 `Set-Content -Encoding UTF8` 回写清单，而 Windows PowerShell 5.1 下该 cmdlet **必定写入 BOM**。现已改为

```powershell
[System.IO.File]::WriteAllText($path, $json, (New-Object System.Text.UTF8Encoding($false)))
```

并在写入后立即检查前三字节，发现 BOM 就抛错中止。**改动写清单的代码时，不要换回 `Set-Content` / `Out-File`。**

再次崩溃时的应急修复：

```powershell
$p = "$env:USERPROFILE\.dsh\profiles\desktop\package.json"
$t = [System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8).TrimStart([char]0xFEFF)
[System.IO.File]::WriteAllText($p, $t, (New-Object System.Text.UTF8Encoding($false)))
```

### 回滚

```powershell
Copy-Item '<backup-dir>\*' "$env:USERPROFILE\.dsh\profiles\desktop" -Force
Remove-Item "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-computer-use" -Recurse -Force
```

## 测试

需要以宿主运行时执行，以保证模块解析与生产一致：

```powershell
$dsh = "D:\Apps\Deepseek Harness\DeepSeek Harness.exe"   # 注意：目录名含空格
$env:ELECTRON_RUN_AS_NODE="1"
& $dsh scripts\test-native.cjs       # 原生层 20 项
& $dsh scripts\test-plugin.cjs       # 插件层 21 项
& $dsh scripts\verify-deployed.cjs   # 部署副本实载
& $dsh scripts\check-patch-refs.cjs  # preset 引用的包名是否都存在
```

`test-native.cjs` 只移动鼠标、不点击、不输入，因此可以安全运行。测试产出的 PNG 在 `test-output/`，可用 `read_image` 查看标尺与象限标注效果。

`check-patch-refs.cjs` 需要传入 asar 路径，例如：
`node scripts\check-patch-refs.cjs "D:\Apps\Deepseek Harness\resources\app.asar" cordis.patch.yml`
它可以提前发现 preset 里写错的包名——这类错误会让 bundle 加载失败。作为对照，官方 `standard.patch.yml` 跑同一检查也通过。

## 实测结论（宿主进程内，用带日志的窗体探针验证）

用一个自带日志的 WinForms 探针当靶子，它把自己收到的每一次点击、每一个字符、每一次滚轮写入日志文件——"操作是否真的生效"靠文件证据，不靠猜。

### ✅ 输入注入完全可用

| 功能 | 证据 |
|---|---|
| 鼠标移动 | 请求 (600,700)，回读光标落在物理 (600,700) |
| 单击 / 右键 / 双击 | 窗体记录 `MOUSE Left @client 310,152`，与请求坐标吻合 |
| 拖拽 | 拖标题栏，窗口从 (450,288) 移到 (322,220)，位移与请求一致 |
| 滚轮 | `WHEEL delta=240 / -240` |
| 英文/数字/符号 | 33 个字符全部正确 |
| **中文 Unicode** | 电/脑/操/作/测/试/：/你/好/，/世/界 全部正确，含全角标点 |
| 回车 / 退格 | 回车提交完整整行、退格 `U+0008` |
| 组合键 | `ctrl+shift+a`，修饰键状态正确上报 |
| 按键连发 | 右方向键 ×3，恰好 3 次事件 |
| 窗口枚举 / 聚焦 | 正确读出真实标题并成功置顶 |

> ⚠️ **我此前关于输入注入的结论是错的。** 我曾报告 `SetCursorPos` 返回 `false`、事件到不了系统，并推测是令牌或策略拦截。真实原因是我**在沙箱化的 shell 里做的诊断**——受限令牌无法操作输入桌面。真实宿主进程（正常令牌）没有任何问题。**不要把沙箱内测到的 Win32 失败当作产品缺陷。**

### 📐 三套坐标空间（已用像素级比对确认）

本环境有 **125% 显示缩放**，界面里同时存在三个坐标系：

| 坐标系 | 尺寸 | 谁在用 |
|---|---|---|
| 物理像素 | 1920×1080 | `computer` 工具、GDI 截图、`GetSystemMetrics` |
| 逻辑像素 | 1536×864（×0.8） | 普通 32 位未声明 DPI 感知的程序 |
| 截图图像 | 等于工具的坐标 | 1:1 对应 `computer` 的坐标 |

验证方法：把探针窗体涂成品红色，在截图里量出包围盒，再算出其真实屏幕位置，两边比对。

**结论：在截图里量到的像素点可以直接当 `click` 坐标用，无需换算。** 因为截图与工具同处物理像素空间，而输入注入也在物理像素空间（宿主进程是 per-monitor DPI aware）。只有当操作目标是未声明 DPI 感知的老程序、且需要按"它自己的逻辑坐标"下判断时，才需要 ×0.8。

### 图像如何送进模型（最容易踩错的一环）

图像经 **`output.render`**（同步）投递，且附件引用必须作为**可枚举的普通 JSON 字段写在输出值内部**（`images` 数组，已在 output schema 里声明）。

这不是风格选择，是被调度器的执行顺序强制的。`dsh-tools` 的顺序是：

```js
const detached = snapshotToolValue(tool.name, candidate); // JSON 往返快照
const value = deepFreeze(detached);                        // 深冻结
rendered = tool.output.render(exec.arguments, value);      // 最后才 render
```

**`render` 拿到的不是 `execute` 返回的那个对象，而是它的 JSON 快照的冻结副本。** 因此：

- 用 `Symbol` 属性挂载 → 快照时被剥掉
- 用 `WeakMap` 以返回值为键 → 键对象已被替换，查不到
- 用 `projectContent`（最初的做法）→ 调度器不查这条路径

三种做法都表现为**同一个极具误导性的症状**：文字说明正常到达（"已捕获 1920×1080 图像"），**但图像从未进入模型上下文**。模型于是会描述一个它没看见的屏幕。

`read_image` 之所以可靠，正是因为它把引用放在 `value.image` 里——可枚举、在 schema 内、能过快照。

**改动此处时请运行 `test-plugin.cjs` 的 `the image reference SURVIVES the dispatcher snapshot` 用例**，它复刻了快照+冻结链路，任何走旁路的做法都会当场失败。

### 输出 schema 里的字段不会自动送达模型

同一个机制的另一面：**模型看到的内容完全由 `output.render` 决定。** schema 校验只保证值合法；`windows`、`steps` 这类数组即使声明了、填了值，如果 `render` 没把它们打印进文本块，模型就收不到。

症状很隐蔽：agent 会知道"找到 5 个窗口"，却**说不出其中任何一个的名字**。

所以凡是要给模型看的数据，都必须出现在 `render` 的输出里：

| 动作 | render 中必须包含 |
|---|---|
| `windows` | 完整列表（handle / 尺寸 / 位置 / 标题），而不只是数量 |
| `computer_batch` | 每步结果摘要（`cursor` 坐标、`screen_info` 数值等），而不只是"完成 3 个动作" |
| `screen_info` / `cursor` | 几何数值与指针位置 |
| `screenshot` | 文字说明 + 由 `images` 数组转换的图像块 |

`test-plugin.cjs` 的 `windows action RENDERS the list, not just counts it` 专门守这条：它逐条核对每个窗口的 handle 与标题都出现在渲染文本中。

### 窗口截图的边框：必须用 DWM 边框

`GetWindowRect` 包含 DWM 保留的**不可见调整边框**（每边约 8px），按它裁剪会在右侧和下方留下黑边。`DWMWA_EXTENDED_FRAME_BOUNDS` 返回的才是用户看得见的边框。

`windows` 报告与窗口截图**都**使用 DWM 边框（经 `visibleBounds()`），两者必须一致——否则坐标读数会对不上，测试 `window capture matches the DWM frame, not GetWindowRect` 会失败。

### 窗口枚举的过滤规则

`IsWindowVisible` 会放过大量幽灵窗口：IME 隐藏窗口（同一标题重复 4-5 次）、UWP 已挂起窗口、零面积的通知窗口。过滤链：

1. `IsWindowVisible` — 基础可见性
2. `DWMWA_CLOAKED` — DWM 标记为对用户隐藏（UWP 挂起、IME 候选窗）
3. `WS_EX_TOOLWINDOW` — 工具面板类窗口
4. 空标题
5. **零面积** — `495x0` 这类不是有效截图目标
6. **离屏** — 完全不在虚拟桌面范围内

注意**不过滤** `WS_EX_NOREDIRECTIONBITMAP`（GPU 合成窗口）：DSH 自己的窗口就带这个标志，过滤掉它会让 agent 无法查看自己所在的宿主程序。这类窗口会被标记为 `gpu-composited` 并在文字里提示"直接截图可能返回空白，改截屏幕区域"。实测中 DSH 窗口走的是屏幕回退路径，能正常看到内容。

### 分辨率策略：不做预防性降采样

图像由**模型自己**下采样，所以本插件**默认以屏幕真实分辨率交付**——1920×1080 的桌面就送 1920×1080 的图，agent 自己决定要看哪块、要不要局部放大。

早期版本会主动把全屏压到 1152px（scale 0.6），这是基于"模型图像输入分辨率低、需要先缩小"的**错误前提**。代价是丢弃了细节，而模型本来可以自己决定保留多少。

`fullMaxDimension`（默认 4096）现在是**安全上限而非目标**，只在虚拟桌面异常大时才生效。`scale` 参数仍可用，但用于"我就是想要一张小图"这种明确需求。

坐标标尺与象限标记保留：它们解决的是另一个问题——**告诉 agent 某个东西在哪**，而不是省 token。

### 已知限制

1. **前台命令启动的 GUI 进程会被回收。** 用 `Start-Process` 弹出的窗口在命令结束后随之消失。要让 agent 常驻操作某个 GUI 程序，必须用**后台任务**启动，不能随手 `Start-Process`。
2. **UAC / 安全桌面截不到**，也无法向提权窗口注入输入（UIPI）。
3. **无附件服务时降级**：截图仍会落盘并在文字里说明原因与文件路径，可用 `read_image` 兜底读取。

## 配置项

在 `cordis.patch.yml` 的 `preset-computer` → `computer-use.config` 下调整：

| 字段 | 默认 | 含义 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `thumbnailMaxDimension` | `1152` | 全屏概览图最长边；1920 屏对应 scale 0.6 |
| `nativeMaxDimension` | `1400` | 区域截图超过此值才降采样 |
| `pngLevel` | `6` | PNG deflate 级别 1–9 |
| `maxBatchActions` | `40` | 单次 `computer_batch` 的动作上限 |
| `outputDirectory` | `''` | 截图落盘目录；留空用系统临时目录 |

## 文件结构

```
dsh-computer-use/
├── package.json          # type: commonjs（必须）
├── cordis.patch.yml      # 挂载插件 + 声明 preset-computer
├── install.ps1           # 安装脚本
├── lib/
│   ├── index.js          # 插件主体：两个工具 + 提示词段落
│   └── loader.cjs        # 安装路径感知的模块解析（穿透 asar）
├── src/
│   ├── win32.cjs         # koffi 绑定 user32/gdi32/dwmapi
│   ├── capture.cjs       # GDI 截屏
│   └── png.cjs           # 自包含 PNG 编码器 + 标尺 + 象限
└── scripts/
    ├── test-native.cjs        # 原生层 20 项
    ├── test-plugin.cjs        # 插件层 38 项
    ├── verify-deployed.cjs    # 部署副本 vs 源码逐字节比对 + 实载
    └── check-patch-refs.cjs   # preset 引用的包名是否都存在
```

## 从沙箱内推送代码时的两个坑

DSH 的沙箱会隔离 Windows 的 TLS 凭据存储，因此在沙箱里执行 `git push` 会遇到两个**看似网络故障、实为环境限制**的报错：

| 现象 | 原因 | 处理 |
|---|---|---|
| `curl https://github.com` 返回 `000` | schannel 拿不到凭据 | 用 OpenSSL 后端 |
| `schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS` | 同上 | 同上 |

但**网络本身没有被封**——`http://` 明文请求正常，到 `github.com:443` 的 TCP 连接也通。只有 Windows 原生 TLS（schannel）的凭据存储不可达。Git for Windows 自带 OpenSSL 与 CA 证书包，绕开即可：

```powershell
git -c http.sslBackend=openssl push -u origin main
```

诊断时注意区分"连不上"和"仓库不存在"：
- `Failed to connect` / `SEC_E_NO_CREDENTIALS` → TLS 后端问题
- `remote: Repository not found.` → TLS 已通，只是 GitHub 上还没建仓库（认证失败会报 `authentication failed`，不是这句）

在**普通终端**里（非沙箱）通常不需要这个参数，schannel 可正常工作。
