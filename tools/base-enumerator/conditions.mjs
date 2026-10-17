import {VERSION,stable,cleanInput} from './core.mjs';
// Full canonical JSON is the identity: no short-hash collision can match a result.
export function conditionKey(catalog,raw){
 const input=cleanInput({...raw,options:{...raw.options,development:Object.values(raw.progress??{}).some(p=>p.owned)?'current':'all-operators'}},catalog),options={...input.options};delete options.searchStrategy;delete options.development;delete options.ownedMin;delete options.ownedMax;
 const operators=Object.entries(input.progress).sort(([a],[b])=>a.localeCompare(b)).map(([id,p])=>({id,elite:p.elite,skills:catalog.characters[id].chains.map(chain=>chain.filter(s=>p.elite>s.elite||p.elite===s.elite&&p.level>=s.level).at(-1)?.id??null)}));
 const facilities=Object.entries(input.base.rooms).map(([id,r])=>({...r,recipe:input.products[id]??null,support:[...(input.dormSupport[id]??[])],residents:input.residents.filter(x=>x.room===id).map(x=>x.id).sort(),candidates:input.candidates[id]??null})).sort((a,b)=>stable(a).localeCompare(stable(b)));
 return stable({version:VERSION,catalog:catalog.fingerprint,operators,facilities,options});
}
export function matchesResult(catalog,input,row){return row.type==='condition-result'&&row.conditionKey===conditionKey(catalog,input)&&row.searchComplete===true&&row.best!==null;}
