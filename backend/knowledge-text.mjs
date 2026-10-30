import {createHash} from 'node:crypto';
export const textHash=text=>createHash('sha256').update(text).digest('hex');
export function splitKnowledge(text,{size=1100,overlap=150}={}){
 const normalized=String(text||'').replace(/\u0000/g,'').replace(/\r\n?/g,'\n').replace(/[ \t]+/g,' ').trim();
 if(normalized.length<10)throw new Error('资料中没有足够的可读文字；扫描PDF请先完成OCR');
 if(normalized.length>80000)throw new Error('单份资料文字超过8万字，请按章节拆分后入库');
 const chunks=[];let start=0;
 while(start<normalized.length){let end=Math.min(start+size,normalized.length);if(end<normalized.length){const boundary=Math.max(normalized.lastIndexOf('\n',end),normalized.lastIndexOf('。',end));if(boundary>start+size/2)end=boundary+1;}
  chunks.push(normalized.slice(start,end));if(end===normalized.length)break;start=Math.max(start+1,end-overlap);
 }
 return chunks;
}
export function vectorLiteral(vector,dimensions){
 if(!Array.isArray(vector)||vector.length!==dimensions||vector.some(n=>typeof n!=='number'||!Number.isFinite(n))||!vector.some(n=>n!==0))throw new Error('向量模型返回的维度或数值无效');
 return '['+vector.join(',')+']';
}
export function knowledgeQuery(letter){return [letter.typeLabel,letter.templateRef?.name,letter.tokens?.requestItems].filter(Boolean).join('\n').slice(0,3000);}
