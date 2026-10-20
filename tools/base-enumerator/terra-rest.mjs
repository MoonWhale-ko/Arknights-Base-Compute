const EPS=1e-8;
// Bounded deterministic improvement, using the same recovery/skill evaluator
// as the final simulation. Fixed supporters retain both room and order.
export function improveRest(model,placements,morale,worked,{reserved,distance,waiting,maxEvaluations=96}={}){
 const fixed=new Set(reserved??[]),dorms=placements.filter(p=>p.room.type==='DORMITORY');
 if(!dorms.length||!waiting?.length)return placements;
 let best=placements.map(p=>({...p,ops:[...p.ops]})),evaluations=0;
 const weight=id=>1/Math.max(1,distance?.get(id)??8);
 const merit=rows=>{
  evaluations++;const s=model.snapshotEvaluator(model,rows,morale,worked),out=[0,0];
  for(const p of rows.filter(p=>p.room.type==='DORMITORY'))for(const op of p.ops){const deficit=Math.max(0,op.maxMorale-morale[op.id]);out[0]+=weight(op.id)*Math.min(deficit,Math.max(0,s.rates[op.id])*12);out[1]+=weight(op.id)*Math.min(deficit,Math.max(0,s.rates[op.id]));}
  // Fiammetta exchanges with the last entrant, before ordinary recovery.
  for(const p of rows.filter(p=>p.room.type==='DORMITORY')){const target=p.ops.at(-1),provider=p.ops.find(o=>o.skills.some(s=>s.kind==='exchange')&&morale[o.id]>=o.maxMorale-EPS);if(provider&&target&&provider.id!==target.id)out[0]+=weight(target.id)*Math.max(0,target.maxMorale-morale[target.id]);}
  return out;
 };
 const better=(a,b)=>a[0]>b[0]+EPS||Math.abs(a[0]-b[0])<=EPS&&a[1]>b[1]+EPS;
 let value=merit(best);
 for(let pass=0;pass<2&&evaluations<maxEvaluations;pass++){
  let improved=false;
  const slots=best.flatMap((p,room)=>p.room.type==='DORMITORY'?p.ops.flatMap((o,index)=>fixed.has(o.id)?[]:[{room,index}]):[]);
  const tryRows=rows=>{if(evaluations>=maxEvaluations)return;const v=merit(rows);if(better(v,value)){best=rows;value=v;improved=true;}};
  for(let i=0;i<slots.length&&evaluations<maxEvaluations;i++)for(let j=i+1;j<slots.length&&evaluations<maxEvaluations;j++){
   const a=slots[i],b=slots[j],rows=best.map(p=>({...p,ops:[...p.ops]}));[rows[a.room].ops[a.index],rows[b.room].ops[b.index]]=[rows[b.room].ops[b.index],rows[a.room].ops[a.index]];tryRows(rows);
  }
  const occupied=new Set(best.flatMap(p=>p.ops.map(o=>o.id))),outside=waiting.filter(o=>!occupied.has(o.id)).slice(0,16);
  for(const op of outside)for(const a of slots){if(evaluations>=maxEvaluations)break;const rows=best.map(p=>({...p,ops:[...p.ops]}));if(rows.some(p=>p.ops.some(o=>o.id===op.id)))continue;rows[a.room].ops[a.index]=op;tryRows(rows);}
  for(let source=0;source<best.length&&evaluations<maxEvaluations;source++){
   if(best[source].room.type!=='DORMITORY')continue;
   for(const op of [...best[source].ops]){if(fixed.has(op.id))continue;
    for(let destination=0;destination<best.length&&evaluations<maxEvaluations;destination++){
     if(source===destination||best[destination].room.type!=='DORMITORY'||best[destination].ops.length>=best[destination].room.capacity||!best[source].ops.some(o=>o.id===op.id))continue;
     const rows=best.map(p=>({...p,ops:[...p.ops]}));rows[source].ops=rows[source].ops.filter(o=>o.id!==op.id);rows[destination].ops.push(op);tryRows(rows);
    }
   }
  }
  if(!improved)break;
 }
 return best;
}
