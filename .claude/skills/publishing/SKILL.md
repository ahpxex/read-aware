---
name: publishing
description: ReadAware 发版流水线：bump 版本号 → 打 tag 推送 → 盯 release CI → 重写 GitHub release changelog → 同步 landing 文档/blog。触发词："bump 版本"、"发版"、"发布新版本"、"发个版"、"bump version"、"cut a release"、"release vX.Y.Z"。
---

# ReadAware 发版流水线

一次发版 = 版本号 bump commit + `vX.Y.Z` tag 推送触发 `release.yml` 全平台构建，
CI 绿后人工整理 changelog，并检查 landing 文档是否需要跟着这次版本更新。
landing（readaware.app）是 CF Pages 跟随 push 自动部署，无需单独发布动作。

网络命令（git push、gh）一律加代理前缀
`http_proxy=http://127.0.0.1:7890 https_proxy=http://127.0.0.1:7890 no_proxy=localhost,127.0.0.1,::1`；
git push 必须走 SSH remote（`git@github.com:`），HTTPS push 在大 pack 上传阶段必卡死。

## 0. Preflight

- 工作树必须干净、在 `main` 上；先 `git pull --rebase` 确认与 remote 同步。
- 读当前版本：`apps/desktop/src-tauri/tauri.conf.json` 的 `version`。
- 定新版本号：用户指定了就用用户的；没指定则默认 patch +1，若本次包含明显的新
  功能可建议 minor，并把选择告诉用户（不必等确认，用户有异议会说）。
- tag 必须严格等于 `tauri.conf.json` 的 `version`（release 资产命名
  `ReadAware-vX.Y.Z-<platform>-<arch>.<ext>` 与 updater manifest 都由它推导，
  landing 的下载直链也按它拼）。

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

landing 不用改：它构建时从 `tauri.conf.json` 烤入版本号（见
`apps/landing/vite.config.ts`），随本次 push 的 CF Pages 部署自动更新。

提交信息沿用历史风格：`chore: release vX.Y.Z`。

## 2. 打 tag 并推送

```sh
git tag vX.Y.Z
git push origin main --follow-tags   # SSH remote + 代理前缀
```

tag 推上去即触发 `.github/workflows/release.yml`（android / ios / desktop
三平台矩阵 / updater-manifest 四组 job）；push main 同时触发 CF Pages
重新部署 landing。

## 3. 盯 CI（约 15 分钟）

```sh
gh run list --workflow=release.yml --limit 1   # 拿 run id
gh run watch <run-id> --exit-status            # 或后台轮询
```

- 等待期间不要闲着：并行做第 4 步的 changelog 起草和第 5 步的文档排查，
  CI 绿了直接发。
- 部分 job 失败是发生过的（v0.2.10 就失败过一个 job）。失败时
  `gh run view <run-id> --log-failed` 看原因；构建环境抖动就
  `gh run rerun <run-id> --failed`。desktop 全矩阵 + updater-manifest
  成功是硬性门槛（桌面端自动更新依赖 updater-manifest 产出的
  latest.json）；iOS/Android 单独失败可先发布桌面端，向用户说明后补。

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

## 5. 同步 landing 文档 / blog

用 `git diff vPREV..vX.Y.Z --stat` 圈出用户可感知的变更，对照检查
（文档都是 `apps/landing/src/routes/` 下的 TSX，纯手写，无框架）：

| 变更类型 | 要看的页面 |
|---|---|
| 安装/平台/签名/更新机制变化 | `docs/install.tsx` |
| 阅读/标注/AI/设置等功能变化 | `docs/getting-started.tsx` |
| 插件 API 面变化（对比 `packages/plugin-types/src/index.ts` 的 diff） | `docs/plugins/api.tsx`，必要时 `docs/plugins/index.tsx` |
| 市场提交流程变化 | `docs/plugins/publishing.tsx` |
| 值得发声的大版本 | 写 blog：`routes/blog/<slug>.tsx` + `lib/posts.ts` 注册一条 |

- 加文档页 = 路由文件 + `lib/docs-nav.ts` 一条；发 blog = 路由文件 +
  `lib/posts.ts` 一条。日期用真实日期。
- 验证：`cd apps/landing && bun run build`（含预渲染与 typecheck；预渲染
  会自动纳入新路由）。
- 有改动则单独提交（`docs(landing): ...`）并推送，CF Pages 自动部署。
  没有需要更新的就明说"本次无文档变更"，不要为改而改。

## 6. 收尾汇报

向用户汇报：版本号、release 链接、CI 结果（含重跑情况）、changelog 要点、
文档改了什么或为何不用改。插件市场仓库（ahpxex/readaware-plugins）不在
本流水线内，不要顺手动它。
