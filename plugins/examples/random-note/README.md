# 随机笔记插件示例

该示例展示了如何使用 Flota 插件 SDK 创建一个简单的命令型插件：

- 在应用启动时被加载到隔离的 Worker 线程中运行
- 通过受限的 `@flota/sdk` 访问笔记读取权限
- 注册一个命令 `随机打开一篇笔记`
- 将命令渲染到笔记工具栏并提供默认快捷键
- 在用户触发命令时打开一篇随机笔记

## 目录结构

```
random-note/
├── index.js          # 插件入口文件
├── manifest.json     # 插件元数据与权限声明
├── package.json      # 可选，用于单独调试或打包
└── README.md         # 插件说明
```

## 运行时权限

该插件只申请了两个权限：

- `notes:read`：读取笔记列表以便随机选择
- `ui:open-note`：请求宿主应用打开指定笔记

尝试申请未在 manifest 中声明的权限会在安装阶段被拒绝。

## 命令注册

插件通过调用 `registerCommand` 注册命令，并声明其 UI 挂载点、图标与默认快捷键。命令信息会同步到主进程并显示在插件商店详情页中。宿主会自动渲染工具栏按钮，并允许用户在快捷键设置中自定义绑定。

```javascript
const { onActivate, registerCommand, notes, ui } = require('@flota/sdk')

onActivate(() => {
	registerCommand(
		{
			id: 'random-note.open',
			title: '随机打开一篇笔记',
			surfaces: ['toolbar:notes'],
			icon: 'rocket',
			shortcut: {
				default: 'Ctrl+Alt+R',
				description: '随时抽取一篇随机笔记'
			}
		},
		async () => {
			const note = await notes.getRandom()
			if (note) {
				await ui.openNote(note.id)
			}
		}
	)
})
```

## 测试

1. 将 Flota 应用切换到开发模式并启动插件商店
2. 在商店中找到“随机笔记”插件并点击安装
3. 安装成功后启用插件，然后在“命令”区域点击“随机打开一篇笔记”测试效果

> 提示：示例插件主要用于展示插件框架的使用方式，并非生产级实现。
