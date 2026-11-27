# UTF-8 BOM is required by Windows PowerShell 5.1 for the Chinese diagnostics.
# Same-process diagnostic for retired Windows entrypoints; no configuration or child process.
[Console]::Error.WriteLine(@'
此旧 Rental 入口须从固定历史完整检出运行。
请显式创建独立工作树并核对 HEAD 为 46db0945dee92ac916f7265e95948943fc8b641d。
git worktree add --detach <独占目录> 46db0945dee92ac916f7265e95948943fc8b641d
进入该目录核对锁定依赖、Client 和隔离开发配置，再显式运行原命令。
'@)
exit 1
