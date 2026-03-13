# Flota 发布流程（命令版）

本文是下次发版时可直接照抄的命令手册。

## 1. 发版前准备

1. 确认当前分支代码已合并完成。
2. 更新 `CHANGELOG.md` 顶部对应版本条目。
3. 本地检查构建是否通过：

```bash
npm install
npm run electron-build
```

## 2. 选择版本号并打 Tag

项目已内置 3 个命令，会自动：
- 更新 `package.json` 版本号
- 自动创建 git commit
- 自动创建 git tag（格式 `vX.Y.Z`）

### Patch（修复）

```bash
npm run release:patch
```

### Minor（功能迭代）

```bash
npm run release:minor
```

### Major（大版本）

```bash
npm run release:major
```

## 3. 推送 commit 和 tag（触发 GitHub Action）

```bash
git push origin main
git push origin --tags
```

推送 `v*` tag 后，会自动触发工作流：
- 文件：`.github/workflows/build.yml`
- 动作：三平台构建（Win/macOS/Linux）
- 自动创建 GitHub Release 并上传安装包
- Release 描述来自 `CHANGELOG.md`（非自动生成摘要）

## 4. 生成本次 Release 描述（可本地预览）

### 提取最新版本条目

```bash
npm run release:notes
```

### 按指定版本提取

```bash
npm run release:notes -- --version=3.0.0
```

### 导出到文件

```bash
npm run release:notes -- --version=3.0.0 --out=release-notes.md
```

## 5. MCP 独立包

GitHub Action 在 Linux 构建任务中会自动执行：

```bash
npm run package-mcp
```

并把 `dist-electron/mcp-server.zip` 作为 Release 附件上传。

## 6. Gitee 同步（当前为手动）

当前仓库没有 Gitee 自动发布流程，建议：

1. 从 GitHub Release 下载本次产物。
2. 在 Gitee 新建同版本 Release。
3. 将 `npm run release:notes` 生成内容粘贴到 Gitee Release 描述。
4. 上传同一批安装包附件。

## 7. 常用故障排查

### 1) Tag 推送了但没触发发布

检查 tag 是否以 `v` 开头，例如：`v3.0.1`。

### 2) better-sqlite3 报 ABI 错误

先执行：

```bash
npm run sqlite:electron
```

再重新打包。

### 3) 想验证工作流但不发版

在 GitHub Actions 页面手动触发 `Build & Release`（workflow_dispatch）。

