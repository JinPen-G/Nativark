# User-approved local credential dialog. The password is never written to disk or stdout.
# Only the existing localhost API receives it; the parent process privately captures the session.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$taskForm = New-Object System.Windows.Forms.Form
$taskForm.Text = 'Rental OS - 本地演示数据授权'
$taskForm.ClientSize = New-Object System.Drawing.Size(480, 250)
$taskForm.StartPosition = 'CenterScreen'
$taskForm.FormBorderStyle = 'FixedDialog'
$taskForm.MaximizeBox = $false
$taskForm.MinimizeBox = $false
$taskForm.TopMost = $true
$taskLabel = New-Object System.Windows.Forms.Label
$taskLabel.Location = New-Object System.Drawing.Point(24, 20)
$taskLabel.Size = New-Object System.Drawing.Size(432, 90)
$taskLabel.Text = "为本机演示租户新增订单：demo / admin`r`n仅提交到 http://127.0.0.1:3000/api/auth/login`r`n密码不保存、不发送到对话；不会修改现有订单。`r`n请输入当前后台登录密码："
$taskForm.Controls.Add($taskLabel)
$taskPassword = New-Object System.Windows.Forms.TextBox
$taskPassword.Location = New-Object System.Drawing.Point(24, 115)
$taskPassword.Size = New-Object System.Drawing.Size(432, 28)
$taskPassword.UseSystemPasswordChar = $true
$taskForm.Controls.Add($taskPassword)
$taskOk = New-Object System.Windows.Forms.Button
$taskOk.Text = '验证并继续'
$taskOk.Location = New-Object System.Drawing.Point(240, 178)
$taskOk.Size = New-Object System.Drawing.Size(105, 36)
$taskOk.DialogResult = [System.Windows.Forms.DialogResult]::OK
$taskForm.Controls.Add($taskOk)
$taskCancel = New-Object System.Windows.Forms.Button
$taskCancel.Text = '取消'
$taskCancel.Location = New-Object System.Drawing.Point(351, 178)
$taskCancel.Size = New-Object System.Drawing.Size(105, 36)
$taskCancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$taskForm.Controls.Add($taskCancel)
$taskForm.AcceptButton = $taskOk
$taskForm.CancelButton = $taskCancel
$taskForm.Add_Shown({ $taskPassword.Select() })
try {
  if ($taskForm.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { [Console]::Error.WriteLine('本机密码输入已取消；未创建订单。'); exit 2 }
  if ([string]::IsNullOrWhiteSpace($taskPassword.Text)) { [Console]::Error.WriteLine('未输入密码；未创建订单。'); exit 2 }
  $taskPayload = @{ tenantCode = 'demo'; account = 'admin'; password = $taskPassword.Text } | ConvertTo-Json -Compress
  try {
    $taskResponse = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/auth/login' -Method Post -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($taskPayload)) -TimeoutSec 30
  } catch { [Console]::Error.WriteLine('本地登录验证失败；未创建订单，也未保存密码。'); exit 3 }
  if ($null -ne $taskResponse.data) { $taskResponse = $taskResponse.data }
  if ($taskResponse.tenant.tenantId -ne 'tenant_001' -or $taskResponse.tenant.tenantCode -ne 'demo' -or -not $taskResponse.accessToken) {
    [Console]::Error.WriteLine('登录范围不是固定演示租户；未创建订单。'); exit 4
  }
  # Captured only by the Node child-process pipe, not printed by the orchestration tool.
  [Console]::Out.Write(($taskResponse | ConvertTo-Json -Depth 20 -Compress))
} finally {
  $taskPassword.Clear()
  $taskPayload = $null
  $taskForm.Dispose()
}
