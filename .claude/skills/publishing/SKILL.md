---
name: publishing
description: ReadAware 发版流水线：bump 版本号 → 打 tag 推送 → 盯 release CI → 重写 GitHub release changelog → 更新官网 changelog（三语）→ 同步 landing 文档/blog。触发词："bump 版本"、"发版"、"发布新版本"、"发个版"、"bump version"、"cut a release"、"release vX.Y.Z"。
---

# ReadAware 发版流水线

一次发版 = 版本号 bump commit + `vX.Y.Z` tag 推送触发 `release.yml` 全平台构建，
CI 绿后人工整理 GitHub release changelog、更新官网三语 changelog，并检查
landing 文档是否需要跟着这次版本更新。
landing（readaware.app）是 CF Pages 跟随 push 自动部署，无需单独发布动作。

网络命令（git push、gh）一律加代理前缀
`http_proxy=http://127.0.0.1:7890 https_proxy=http://127.0.0.1:7890 no_proxy=localhost,127.0.0.1,::1`。

git push 优先走 SSH remote（`git@github.com:ahpxex/read-aware.git`）——HTTPS push
在大 pack 上传阶段卡死过。但 **SSH 不一定可用**：机器上没配公钥时会直接
`Permission denied (publickey)`（v0.3.0 那次就是），此时回落 HTTPS 即可，
发版这种量级的 push（几个 commit + 一个 tag）实测没有卡死问题。注意 SSH 不读
`http_proxy`，代理前缀只对 HTTPS 和 `gh` 生效。

## 0. Preflight

- 工作树必须干净、在 `main` 上；先 `git pull --rebase` 确认与 remote 同步。
- **查上一轮 release run 的结论**：`gh run list --workflow=release.yml --limit 3`。
  上次失败的话先 `gh run view <id> --log-failed` 找原因——若是 workflow 自身的
  bug，打新 tag 只会在同一处再死一次（v0.3.0-beta.1 与 v0.3.0-1 就这样连挂了
  两次：Windows portable-zip 步骤找 `ReadAware.exe`，而 target 目录里的产物
  一直叫 `read-aware-desktop.exe`，5db382a 才修掉）。先修流水线，再发版。
- 读当前版本：`apps/desktop/src-tauri/tauri.conf.json` 的 `version`。
- 定新版本号：用户指定了就用用户的；没指定则默认 patch +1，若本次包含明显的新
  功能可建议 minor，并把选择告诉用户（不必等确认，用户有异议会说）。
- **minor 版本代号**：每个 minor 系列有一个 verbal 代号（0.4 = El Alto），由用户
  在开新 minor 时命名。代号进 GitHub release 标题（`v0.4.0 「El Alto」`）与官网
  changelog 的版本标题；patch 沿用所在 minor 的代号。tag 与资产命名不含代号。
- tag 必须严格等于 `tauri.conf.json` 的 `version`（release 资产命名
  `ReadAware-vX.Y.Z-<platform>-<arch>.<ext>` 与 updater manifest 都由它推导）。
  landing 的下载链接是无版本号稳定别名（`releases/latest/download/...`），
  不依赖版本号。

## 1. 版本号 bump（一个 commit）

要改的文件（对照 `git show v0.2.10` 的形态）：

1. `apps/desktop/src-tauri/tauri.conf.json`
   - `version` → 新版本号
   - `bundle.android.versionCode` → `minor * 1_000_000 + patch`
     （如 0.2.11 → 2000011；0.2.10 那次漏 bump 了，此后必须保持单调递增，
     若公式值不大于现值则在现值上 +1）
2. `apps/desktop/src-tauri/gen/apple/project.yml`
   - `CFBundleShortVersionString` 与 `CFBundleVersion`
3. `apps/desktop/src-tauri/gen/apple/read-aware-desktop_iOS/Info.plist`
   - 两处版本字符串（`CFBundleShortVersionString` / `CFBundleVersion` 的 value）

landing 不用改：下载链接是 `releases/latest/download/ReadAware-<platform>-<arch>.<ext>`
稳定别名（见 `apps/landing/src/lib/releases.ts` 的 `DOWNLOADS`），GitHub 自己
把它解析到最新 stable release；stable 发版时 CI 会把安装包重复上传一份到
这些别名文件名（release.yml "Collect release assets"）。

提交信息沿用历史风格：`chore: release vX.Y.Z`。

## Pre-release（beta / rc）

tag 带 `-` 即 pre-release（如 `v0.3.0-beta.1`），流程与正式版相同，差异全部
由 CI 自动处理，安全性依赖 GitHub `releases/latest` 排除 prerelease 这一语义：

- release 自动标为 prerelease、跳过别名上传 → 桌面更新器（latest.json）、
  Android 更新器（latest-android.json）、landing 下载链接全部继续指向
  上一个 stable，现有用户完全无感。装了 beta 的用户在下个正式版发布时
  会正常升级上去。
- 版本号的 prerelease 标识必须**纯数字**（如 `0.3.0-1`）：MSI 打包硬性要求
  "numeric-only and cannot be greater than 65535"，`-beta.1` 这种带词的会挂
  Windows job（v0.3.0-beta.1 实测挂过，只能删了重发）。iOS 会自动剥掉后缀
  （只是 Warn），Android versionName 无所谓。release 标题/changelog 里再写
  "Beta N"。
- Android `versionCode` 照公式算并保持单调递增；之后的正式版若公式值已被
  beta 占用则 +1。
- changelog 从简（标注 beta preview + 亮点 + Full Changelog 链接即可），
  跳过第 5、6 步（官网 changelog 与文档同步，留给正式版）。

## 2. 打 tag 并推送

```sh
git tag vX.Y.Z
git push origin main       # 先推 commit
git push origin vX.Y.Z     # 再显式推 tag —— 见下
```

**必须显式推 tag，不能靠 `--follow-tags`。** `--follow-tags` 只推 annotated
tag，而 `git tag vX.Y.Z` 建的是 lightweight tag，两者一组合 tag 根本不会上去
——commit 推成功、workflow 完全不触发，而 `git push` 的输出看起来一切正常
（v0.3.0 实测踩过）。推完**一定要验证**：

```sh
git ls-remote --tags origin | grep 'vX.Y.Z$'   # 没输出就是没推上去
```

（想用 `--follow-tags` 的话，tag 得建成 annotated：`git tag -a vX.Y.Z -m "..."`。
此处保留 lightweight + 显式推，与既往 tag 的形态一致。）

tag 推上去即触发 `.github/workflows/release.yml`（android / ios / desktop
三平台矩阵 / updater-manifest 四组 job）；push main 同时触发 CF Pages
重新部署 landing。

## 3. 盯 CI（约 15 分钟）

```sh
gh run list --workflow=release.yml --limit 1   # 拿 run id
gh run watch <run-id> --exit-status            # 或后台轮询
```

- 等待期间不要闲着：并行做第 4 步的 changelog 起草、第 5 步的官网 changelog
  条目、第 6 步的文档排查，CI 绿了直接发。
- 部分 job 失败是发生过的（v0.2.10 就失败过一个 job）。失败时
  `gh run view <run-id> --log-failed` 看原因；构建环境抖动就
  `gh run rerun <run-id> --failed`。desktop 全矩阵 + updater-manifest
  成功是硬性门槛（桌面端自动更新依赖 updater-manifest 产出的
  latest.json）；iOS/Android 单独失败可先发布桌面端，向用户说明后补。
- **失败原因在 workflow 自身时，rerun 救不了**：rerun 永远用 tag 所指
  commit 上的 workflow 定义。正确流程：`gh run cancel` 掉还在跑的 run →
  修 `release.yml` 并 commit push → `git tag -f vX.Y.Z` 移 tag 到修复
  commit → `git push origin :refs/tags/vX.Y.Z` 删远程 tag →
  `git push origin vX.Y.Z` 重推触发新 run。tag 已经公开过才需要顾虑
  移动语义；发版失败当场重指同一版本号是安全的。

## 4. 重写 release changelog

CI 的每个 job 都带 `generate_release_notes: true`，会把 release body 追加成
多份重复的 "Full Changelog" 链接——所以这一步是**整体替换** body，不是补充。

1. 收集提交：`git log vPREV..vX.Y.Z --oneline --no-merges`。
2. 按用户视角分组改写成人话（不要照抄 commit subject）：
   - **New** — 新功能
   - **Improved** — 体验/性能改进
   - **Fixed** — 修复
   - 纯内部重构、ci、chore 不进 changelog（除非用户可感知）。
3. 末尾保留一行：
   `**Full Changelog**: https://github.com/ahpxex/read-aware/compare/vPREV...vX.Y.Z`
4. 写入：`gh release edit vX.Y.Z --notes-file <scratchpad 里的文件>`。

## 5. 官网 changelog（全语言，正式版必做）

`readaware.app/changelog`（+ `/zh` `/ja`）由 `apps/landing/src/lib/changelog.ts`
渲染，是手写的**给人读的**版本，不是 GitHub release 的翻译：可以丢掉一次发版
里不可感知的部分，只留用户真会注意到的。GitHub release 保持完整记录，两者
互不替代。

- **加一个版本 = 在 `CHANGELOG` 数组开头加一条**（`version` / `date` /
  `text.<全部 8 语>`：en / zh / zh-hant / ja / fr / de / ru / es——类型强制，
  缺语言直接 typecheck 失败），不需要动任何路由文件——页面渲染整个数组。
- 术语对齐 `apps/web/src/i18n/locales/` 的产品词表（书架 / 智能助理 / 上下文 /
  词典 / 命令面板 …）。
- **先机翻出底稿再校对**：`bun run translate <file|-> --to all --style changelog`
  （`packages/agent/src/translate-run.ts`，走 deepseek-v4-flash，key 取
  `DEEPSEEK_API_KEY` 或 pi CLI auth，~20 秒出全部 7 语）。英文定稿后把 JSON/文本
  喂给它，拿回的译文**必须过一遍**——重点核对术语（脚本内置词表，遇到带偏的
  就地补词表）、title 后无标点、语感翻译腔。文档镜像（仅 en/zh/ja 存在）同理
  可用 `--style docs`。首页文案在 `apps/landing/src/lib/home-content.ts`，
  站点 chrome 在 `lib/i18n.ts` 的 `UI_STRINGS`——两处也都是全 8 语。
- 内容通常是第 4 步 release changelog 的精简改写，可以直接拿英文那份改。
  分组 `new` / `improved` / `fixed` 与第 4 步一致；组标题不写在数据里
  （在 `UI_STRINGS`）。
- `new` 的条目可带 `title`（加粗引导词），`improved` / `fixed` 只写 `body`。
  **`title` 后面不要自己写标点**——分隔符由渲染器按语言给（英文 `. `，
  中日文全角 `：`），写了会重复。同理，中日文 `body` 的开头不要再用冒号。
- pre-release 跳过这一步（和文档同步一样，留给正式版）。
- 验证：`cd apps/landing && bun run build`，确认预渲染路由数含
  `/changelog` `/zh/changelog` `/ja/changelog`。

## 6. 同步 landing 文档 / blog（三语）

用 `git diff vPREV..vX.Y.Z --stat` 圈出用户可感知的变更，对照检查
（文档都是 `apps/landing/src/routes/` 下的 TSX，纯手写，无框架）：

| 变更类型 | 要看的页面 |
|---|---|
| 安装/平台/签名/更新机制变化 | `docs/install.tsx` |
| 阅读/标注/AI/设置等功能变化 | `docs/getting-started.tsx` |
| 插件 API 面变化（对比 `packages/plugin-types/src/index.ts` 的 diff） | `docs/plugins/api.tsx`，必要时 `docs/plugins/index.tsx` |
| 市场提交流程变化 | `docs/plugins/publishing.tsx` |
| 值得发声的大版本 | 写 blog：`routes/blog/<slug>.tsx` + `lib/posts.ts` 注册一条 |

**多语言是文档更新的一部分，不是可选项。** 站点三语：英文为源
（`routes/docs|blog/`），简体中文与日文是逐页镜像
（`routes/zh/...`、`routes/ja/...`）。流程：

1. 先改英文源页。
2. 把同一处改动同步翻译到 zh/ja 镜像页（可各派一个 subagent 并行；
   术语对齐 `apps/web/src/i18n/locales/zh-Hans|ja/` 的产品词表；
   翻译只动人类可见文本，代码结构/className/逻辑保持一致）。
3. 新增文档页 = 英文路由文件 + zh/ja 镜像 + `lib/docs-nav.ts` 三个语言
   各加一条；发 blog = 三个语言的路由文件 + `lib/posts.ts` 一条
   （其中 `text.en/zh/ja` 的标题与描述都在这一条里）。日期用真实日期。
4. 预渲染会自动纳入全部新路由并生成 hreflang 互链，无需额外配置。

- 验证：`cd apps/landing && bun run build`（含预渲染与 typecheck）。
- 有改动则单独提交（`docs(landing): ...`）并推送，CF Pages 自动部署。
  没有需要更新的就明说"本次无文档变更"，不要为改而改。
- changelog（GitHub release）只写英文，不用翻译；官网 changelog（第 5 步）
  才是三语的。
- **验证部署要看内容，不能看状态码。** CF Pages 对未知路径走 SPA 回退，
  新页面在部署完成前就返回 200，轮询 200 等于没等；更糟的是这几次提前请求
  会把回退结果喂进 CDN 缓存，之后一段时间持续返回旧首页，看起来像"部署
  失败"，其实文件早就在了（v0.3.0 实测）。判据用页面标题或版本号字样，
  被缓存住就带 `?bust=$RANDOM` 重取。
- **curl 验证的正确姿势**：`curl -sL --compressed -x http://127.0.0.1:7890 <url>`。
  三个坑都踩过（v0.4.0）：直连被墙返回空 body、`/changelog` 是 308 跳
  `/changelog/`（不带 `-L` 只有空响应）、不带 `--compressed` 可能拿到压缩
  字节。空 grep ≠ 未部署——先看 `-w '%{http_code} %{size_download}'`。

## 7. 收尾汇报

向用户汇报：版本号、release 链接、CI 结果（含重跑情况）、changelog 要点、
官网 changelog 与文档改了什么或为何不用改。插件市场仓库（ahpxex/readaware-plugins）不在
本流水线内，不要顺手动它。
