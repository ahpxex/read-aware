---
name: publishing
description: ReadAware 发版流水线：bump 版本号 → 打 tag 推送 → 盯 release CI → 重写 GitHub release changelog → 机翻更新官网 changelog（全 8 语）→ 同步 landing 文档/blog（push 自动部署）。触发词："bump 版本"、"发版"、"发布新版本"、"发个版"、"bump version"、"cut a release"、"release vX.Y.Z"。
---

# ReadAware 发版流水线

一次发版 = 版本号 bump commit + `vX.Y.Z` tag 推送触发 `release.yml` 全平台构建，
CI 绿后人工整理 GitHub release changelog、更新官网 changelog（英文手写、其余
7 语机翻+复核），并检查 landing 文档是否需要跟着这次版本更新。
landing（readaware.app）是 Workers 部署（2026-08-26 从 CF Pages 切过来）；
push main 触发 `.github/workflows/landing.yml`（paths 过滤 apps/landing/** 与
workspace 依赖包）自动 build + `wrangler deploy`（`gh run list
--workflow=landing.yml` 可盯）。手动兜底：`cd apps/landing && bun run deploy`。

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
- 定新版本号：用户指定了就用用户的；**没指定则必须先问用户 bump 到哪个版本，
  拿到答复才动手**——不许自己推断、不许"先做了再说"（2026-08-21 实测教训：
  agent 按功能量级自作主张 bump 到 0.6.0-1，用户要的其实是 0.5.0-2）。
  问的时候可以给出建议项（如 patch +1 / beta 序号 +1 / minor），但决定权在用户。
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
4. `apps/landing/src/lib/releases.ts` 的 `CURRENT_RELEASE_TAG`
   - 官网 CTA 旁展示的版本号，硬编码常量（曾经走 GitHub API 实时取，
     被限流时就不显示，看起来"时有时无"——所以改成随发版 bump）。
     这一处可以放进 bump commit，也可以随第 5 步官网 changelog 一起提交。

landing 的**下载链接**不用改：`releases/latest/download/ReadAware-<platform>-<arch>.<ext>`
稳定别名（见 `apps/landing/src/lib/releases.ts` 的 `DOWNLOADS`），GitHub 自己
把它解析到最新 stable release；stable 发版时 CI 会把安装包重复上传一份到
这些别名文件名（release.yml "Collect release assets"）。
pre-release 不 bump `CURRENT_RELEASE_TAG`（官网始终展示最新 stable）。

提交信息沿用历史风格：`chore: release vX.Y.Z`。

## Pre-release（beta / rc）

tag 带 `-` 即 pre-release（如 `v0.3.0-beta.1`），流程与正式版相同，差异全部
由 CI 自动处理，安全性依赖 GitHub `releases/latest` 排除 prerelease 这一语义：

- release 自动标为 prerelease、跳过别名上传 → 桌面更新器（latest.json）、
  Android 更新器（latest-android.json）、landing 下载链接全部继续指向
  上一个 stable，Stable 通道用户完全无感。装了 beta 的用户在下个正式版
  发布时会正常升级上去。
- **Beta 更新通道**（设置 → About → Update channel）的用户会收到
  pre-release：客户端经 GitHub API 取全部 release 里 semver 最大者
  （`features/update/lib/release-feed.ts`），纯数字 prerelease 标识
  （`0.4.0-1 < 0.4.0-2 < 0.4.0`）排序正确，stable 追上后 beta 用户自动
  回到 stable。
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
三平台矩阵 / updater-manifest 四组 job）；第 5/6 步改动 landing 后 push 会
另触发 landing.yml 自动部署站点。

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

## 5. 官网 changelog（全 8 语，正式版必做；英文手写，其余机翻）

`readaware.app/changelog`（8 语路由：`/changelog` + `/zh` `/zh-hant` `/ja`
`/de` `/es` `/fr` `/ru`）的数据在
**`apps/landing/src/i18n/resources/<locale>.site.json` 的 `changelog.entries`**
（2026-08 从旧的 `lib/changelog.ts` CHANGELOG 数组迁移过来；每条 =
`{version, date, summary, groups: [{kind: new|improved|fixed, items:
[{title, body}]}]}`）。这是手写的**给人读的**版本，不是 GitHub release 的
翻译：丢掉不可感知的部分，只留用户真会注意到的。

流程（**agent 只手写英文，7 个非英语语言一律机翻，不许自己手写**）：

1. 在 `en.site.json` 的 `changelog.entries` 开头加英文条目（通常是第 4 步
   release changelog 的精简改写；title 是无标点引导短语，body 完整句子，
   照抄既有条目的形态）。
2. `bun scripts/translate-changelog.ts --version X.Y.Z` —— 走 pi CLI +
   智谱 coding plan（provider `zai-coding-cn`，模型梯队 glm-5.3 →
   glm-5.3-flash，~45-55s/语言），带结构校验、单次超时 + 重试（托管端点
   会间歇性无限卡死，2026-08-30 在 Ollama Cloud 实测过；别裸调）、以目标
   语言**既有条目**为风格锚点，直接写回 7 个 locale 文件。串行跑（同 key
   并发长生成会互相饿死），全量约 6 分钟，正好与盯 CI 重叠。
   前提：`pi auth check --provider zai-coding-cn` 是 ready。
3. **复核机翻 diff**（这步不能省）：术语对齐 `apps/web/src/i18n/locales/`
   的产品词表（书架 / 智能助理 / 划线 / 命令面板 …）、中日文全角标点、
   翻译腔。有带偏的就地改 —— 复核是人/主 agent 的活，翻译不是。
4. 零散文本（首页 `home`、chrome、pricing 也都在 `<locale>.site.json`）要
   机翻时用 `bun run translate <file|-> --to all --style changelog|docs`
   （`packages/agent/src/translate-run.ts`，内置词表，输出到 stdout 由你
   粘回；加 `--provider zai-coding-cn --model glm-5.3`，缺省是 deepseek API）。
- pre-release 跳过这一步（和文档同步一样，留给正式版）。
- 验证：`cd apps/landing && bun run build`，确认预渲染含 8 个 changelog
  路由；push 后盯 landing.yml 部署绿、再按下方 curl 姿势验证线上内容。

## 6. 同步 landing 文档 / blog

用 `git diff vPREV..vX.Y.Z --stat` 圈出用户可感知的变更，对照检查。
**文档正文已迁到数据文件**：`apps/landing/src/i18n/resources/<locale>.docs.json`
的 `pages.<page>.body`（markdown，全 8 语；routes 下的 TSX 只是壳）。改文档 =
改 `en.docs.json` 对应 body，再机翻同步其余 7 语（同第 5 步的纪律：机翻 +
人工复核，别手写翻译；`bun run translate - --style docs` 或照
`scripts/translate-changelog.ts` 的调法喂 pi CLI）。给译文写自动校验时用
**结构判据**（以 `## ` 开头、含段落分隔），别按英文长度比例卡——CJK 压缩率
2-3 倍，0.5.0 时按 40% 长度卡过一次，把整批完美译文全判了不合格。
另外 coding plan 连发后会限流出空响应，重试间隔要留 15s+。

| 变更类型 | 要看的页面 |
|---|---|
| 安装/平台/签名/更新机制变化 | `docs/install.tsx` |
| 阅读/标注/AI/设置等功能变化 | `docs/getting-started.tsx` |
| 插件 API 面变化（对比 `packages/plugin-types/src/index.ts` 的 diff） | `docs/plugins/api.tsx`，必要时 `docs/plugins/index.tsx` |
| 市场提交流程变化 | `docs/plugins/publishing.tsx` |
| 值得发声的大版本 | 写 blog：`routes/blog/<slug>.tsx` + `lib/posts.ts` 注册一条 |

**多语言是文档更新的一部分，不是可选项——但翻译是模型的活，复核才是你的活。**
docs 全 8 语（resources 数据）；blog 是 en/zh/ja 三语：正文在
`<locale>.site.json` 的 `blog.posts.<slug>`，路由只是 8 行壳
（`routes/blog/<slug>.tsx` + zh/ja 镜像，抄现有文件改 slug 即可，
feed/sitemap/索引页全自动）。zh/ja 先机翻再校对；**整篇博客（4K+）一次性
翻译会超出模型舒适输出长度直接超时（0.5.0 实测），要按 ## 分节逐段翻，
每段带上一段译文做滚动风格锚点**。日期用真实日期。

- 验证：`cd apps/landing && bun run build`（含预渲染与 typecheck）。
- 有改动则单独提交（`docs(landing): ...`）并推送——landing.yml 会自动
  build + 部署（`gh run watch` 盯绿）。没有需要更新的就明说"本次无文档
  变更"，不要为改而改。
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
