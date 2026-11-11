# Codex++ 原生生图修复

## 安装

需要 Codex++ 2.6.2 和 Node.js 运行时。

1. 下载仓库 ZIP，将文件解压到 `%APPDATA%\Codex++\user_scripts\native-imagegen-compat\`，确认该目录下有 `codexpp.json`。
2. 在 Codex++ 中热重载拓展，打开本拓展的设置。
3. 填写要修复的供应商 ID，打开“启用生图兼容修复”。

若提示找不到 Node，设置环境变量 `CODEX_PLUS_NODE` 为本机 `node.exe` 的完整路径，然后重启 Codex++。

## 修复方式

适用于纯 API 模式下，已提供 `image_gen` 工具，但模型仍报告工具不可用的情况。

拓展为选定的 `pureApi` 供应商设置以下请求身份头：

```text
User-Agent: CodexPlusPlus/2.6.2
originator: CodexPlusPlus
```

关闭菜单中的“原生生图兼容修复”可恢复原值。停用或卸载拓展前，先关闭这个开关。
