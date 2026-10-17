export function workerResources(cpuCount,requested='auto',github=false){
 const cpus=Math.max(1,Math.floor(cpuCount)||1);
 const target=requested==='auto'?Math.min(4,Math.max(1,cpus-1)):Number(requested);
 if(!Number.isInteger(target)||target<1||target>8)throw Error('--workers는 auto 또는 1~8이어야 합니다.');
 // Explicit full-CPU comparisons are allowed; oversubscription on hosted
 // Actions machines is capped instead of creating eight CPU-bound workers.
 return {cpus,requested:String(requested),workers:github?Math.min(target,cpus):target,github};
}
