$conns = Get-NetTCPConnection -LocalPort 3001 -ErrorAction SilentlyContinue
foreach ($c in $conns) {
  $procId = $c.OwningProcess
  if ($procId -and $procId -ne 0) { Stop-Process -Id $procId -Force }
}
Write-Output "done"
