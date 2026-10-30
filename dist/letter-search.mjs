const normalize=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu,'');

// Keep source indexes: row actions must still edit the original agreement after sorting.
export function rankAgreements(agreements,query,typeLabels={}){
 const terms=[...new Set(String(query??'').trim().split(/[\s,，、;；]+/u).map(normalize).filter(Boolean))];
 return agreements.map((agreement,index)=>{
  const scope=String(agreement.scope??''),unit=String(agreement.unit??'');
  const fields=[[unit,6],[scope,4],[scope+unit,5],[scope.replace(/[市区县]$/u,'')+unit,5],[agreement.points,2],[agreement.id,3],[typeLabels[agreement.type]||agreement.type,2]].map(([value,weight])=>[normalize(value),weight]);
  let score=0,hits=0;
  for(const term of terms){
   let best=0;
   for(const [value,weight] of fields){
    if(value===term)best=Math.max(best,weight*120);
    else if(value.includes(term))best=Math.max(best,weight*100);
    else if(term.length>=3){
     const pairs=[...new Set(Array.from({length:term.length-1},(_,i)=>term.slice(i,i+2)))];
     const coverage=pairs.filter(pair=>value.includes(pair)).length/pairs.length;
     if(coverage>=0.5)best=Math.max(best,weight*30*coverage);
    }
   }
   if(best){score+=best;hits++;}
  }
  // Full coverage of a multi-part query takes precedence over a single-word hit.
  if(terms.length>1&&hits===terms.length)score+=10000;
  return {agreement,index,score};
 }).sort((a,b)=>b.score-a.score||a.index-b.index);
}

export function searchSummary(rows,query){
 if(!String(query??'').trim())return '';
 const count=rows.filter(row=>row.score>0).length;
 return count?`匹配 ${count} 项 · 按相关度排序`:'未找到匹配项，保留原清单';
}
