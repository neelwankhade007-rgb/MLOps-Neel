param([string]$Root='benchmarks/reports/final-evaluation')
$ErrorActionPreference='Stop'
$d='D:/DevTools/Nexus/tmp'
$env:TEMP=$d;$env:TMP=$d
function Note($message) { Add-Content "$Root/execution.log" "$(Get-Date -Format o) $message"; Write-Output $message }
function Headroom {
  $mem=(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory
  Note "free memory $mem KiB"
  if($mem -lt 1572864){throw 'Host below 1.5 GiB before next independent stage'}
}
function Qualified($rate) {
  foreach($suffix in '', '-recovered'){
    $cap="$Root/raw/capacity-$rate$suffix/analysis/capacity.csv"
    if(!(Test-Path $cap)){continue}
    $t=@(Import-Csv $cap)
    if($t.Count -eq 4 -and @($t | Where-Object qualified -ne 'True').Count -eq 0){return $true}
  }
  return $false
}
$deadline=(Get-Date).AddMinutes(50)
do {
  Start-Sleep -Seconds 5
  $busy=Get-NetTCPConnection -State Listen -LocalPort 8000,9090 -ErrorAction SilentlyContinue
} while($busy -and (Get-Date) -lt $deadline)
if($busy){throw 'Capacity process still owns benchmark listeners'}
if(!(Qualified 5)){Note 'Formal comparisons blocked: 5 RPS common block is not qualified';return}
$owned=@()
try {
  Headroom
  foreach($item in @(@('backend','8000:8000'),@('prometheus','9090:9090'))){
    $n=$item[0]
    $owned+=Start-Process -FilePath (Get-Command kubectl).Source -ArgumentList @('-n','mlops','port-forward','--address','127.0.0.1',"service/$n",$item[1]) -RedirectStandardOutput "$d/phase3-formal-$n.out" -RedirectStandardError "$d/phase3-formal-$n.err" -PassThru -WindowStyle Hidden
  }
  Start-Sleep -Seconds 2
  $image='grafana/k6@sha256:d41bb79cd8de5a7ad619b53570e3712633e8bff0937010a5c6c57a4747e7a276'
  $common=@('--expected-adaptive-policy','observed','--restart-gateway','--deployment','titanic-api-v1','--credential-file','D:/DevTools/Nexus/neelwa410-credentials.dpapi.json','--k6','D:/DevTools/k6/k6.exe','--node-k6-image',$image,'--warmup','30','--measurement','60','--cooldown','20')
  function Stage([string]$Name,[string[]]$Options) {
    $path="$Root/raw/$Name"
    if(Test-Path "$path/analysis/validation.json"){Note "$Name already evaluated";return}
    if(Test-Path $path){throw "$Name has raw evidence without validation; inspect before resuming"}
    Headroom
    Note "Starting $Name ($($Options -join ' '))"
    & .venv/Scripts/python -u benchmarks/k6/run.py @common @Options --output $path
    $code=$LASTEXITCODE
    if(Test-Path $path){& .venv/Scripts/python benchmarks/k6/analyze.py --input $path; $analysis=$LASTEXITCODE}else{$analysis=1}
    & .venv/Scripts/python benchmarks/k6/export_evaluation.py $Root
    & .venv/Scripts/python benchmarks/k6/export_scenarios.py $Root
    Note "$Name completed runner=$code analysis=$analysis"
    if($code -or $analysis){throw "$Name did not finish cleanly; raw evidence retained"}
    if($Name -like 'steady-*'){
      $rows=@(Import-Csv "$path/analysis/capacity.csv")
      if($rows.Count -ne 4 -or @($rows | Where-Object qualified -ne 'True').Count){
        throw "$Name did not meet the common-load gates"
      }
    }
  }
  foreach($rep in 1,2){Stage "steady-5-rep-$($rep+1)" @('--plan','pilot','--rate','5','--repetition-offset',"$rep")}
  $peak=0
  foreach($candidate in 20,10){if(Qualified $candidate){$peak=$candidate;break}}
  if($peak){
    Stage 'burst' @('--plan','burst','--rates','5',"$peak",'--repetitions','2','--capacity-input',"$Root/raw")
  } else {
    Note 'Burst deferred: no second qualified rate'
  }
  $pod=(kubectl -n mlops get pods -l app=inference-service -o json | ConvertFrom-Json).items |
     Sort-Object {$_.status.podIP} | Select-Object -First 1
  $name=$pod.metadata.name
  Note "Intervention target $name UID $($pod.metadata.uid)"
  Stage 'contention' @('--plan','contention','--rates','5','--contention-pod',$name,'--stimulus','cpu-250m','--repetitions','2','--capacity-input',"$Root/raw")
  Stage 'failure' @('--plan','failure','--rates','5','--contention-pod',$name,'--stimulus','process-pause','--repetitions','2','--capacity-input',"$Root/raw")
} finally {foreach($p in $owned){if(!$p.HasExited){Stop-Process -Id $p.Id}}}
