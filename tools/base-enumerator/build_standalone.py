from pathlib import Path
import json,re
root=Path(__file__).resolve().parent
catalog=(root/'data/catalog.json').read_text();demo=(root/'demo.json').read_text();universal=(root/'universal.json').read_text()
def strip_module(s):
    s=re.sub(r'^(?:import .*?;|export \{.*?\} from .*?;)\n','',s,flags=re.M)
    return re.sub(r'\bexport (?=(?:const|class|(?:async\s+)?function))','',s)
common=['rules.mjs','trading.mjs','search.mjs','evaluator.mjs','core.mjs']
evaluation_worker='\n'.join(strip_module((root/name).read_text()) for name in common+['evaluation-jobs.mjs','evaluation-worker.mjs'])
worker='\n'.join(strip_module((root/name).read_text()) for name in common+['layouts.mjs','conditions.mjs','runner.mjs','parallel.mjs','worker.mjs'])
worker='const EVALUATION_WORKER_SOURCE='+json.dumps(evaluation_worker,ensure_ascii=False)+';\n'+worker
worker=worker.replace("new Worker(new URL('./evaluation-worker.mjs',import.meta.url),{type:'module'})","(()=>{const u=URL.createObjectURL(new Blob([EVALUATION_WORKER_SOURCE],{type:'text/javascript'}));const w=new Worker(u);URL.revokeObjectURL(u);return w;})()")
worker=worker.replace('let catalog=null,run=',f'let catalog={catalog},run=')
app=strip_module((root/'app.mjs').read_text())
app=app.replace("await fetch('./data/catalog.json').then(r=>r.json())",catalog)
app=app.replace("await fetch('./batch-demo.json').then(r=>r.json())",'('+ (root/'batch-demo.json').read_text()+')')
app=app.replace("await fetch('./demo.json').then(r=>r.json())",'structuredClone(DEMO)')
app=app.replace("await fetch('./universal.json').then(r=>r.json())",'structuredClone(UNIVERSAL)')
app=app.replace("new Worker('./worker.mjs',{type:'module'})","(()=>{const u=URL.createObjectURL(new Blob([WORKER_SOURCE],{type:'text/javascript'}));const w=new Worker(u);URL.revokeObjectURL(u);return w;})()")
script='const DEMO='+demo+';\nconst UNIVERSAL='+universal+';\nconst WORKER_SOURCE='+json.dumps(worker,ensure_ascii=False)+';\n'+app
script=script.replace('</script','<\\/script')
page=(root/'index.html').read_text().replace('<link rel="stylesheet" href="style.css">','<style>'+(root/'style.css').read_text()+'</style>')
page=page.replace('<script type="module" src="app.mjs"></script>','<script type="module">'+script+'</script>')
(root/'standalone.html').write_text(page)
print('Built standalone.html:',len(page.encode()),'bytes')
