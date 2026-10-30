import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {SAMPLE} from '../dist/engine.mjs';
import {createLettersInput,planLetters} from '../dist/letters-core.mjs';
import {resolveExportPython} from '../backend/python-runtime.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),out=path.join(root,'outputs/征询函统一格式_2026-10-30');
await fs.mkdir(path.join(out,'qa'),{recursive:true});const python=await resolveExportPython(root);
const input=createLettersInput(SAMPLE,SAMPLE.routes[0]);
Object.assign(input.project,{issuer:'示例建设单位',issueDate:'2026-10-30',contactName:'测试联系人',contactPhone:'测试电话',replyAddress:'测试复函地址'});
input.agreements=input.agreements.slice(0,1);
const general=planLetters(input)[0];general.status='draft';
const a=input.agreements[0];Object.assign(a,{unit:'示例高速公路管理单位',type:'highway',points:'请就上述线路跨越高速公路的方案、管理要求及后续办理程序提出意见。',facts:{},crossings:[{facilityName:'测试高速公路',spanStart:'NA1',spanEnd:'NA2',angleDeg:78,spanLengthM:168,horizontalDistanceM:47.34,clearanceM:29,chainage:'跨越高速匝道'},{facilityName:'测试高速公路',spanStart:'NA2',spanEnd:'NA3',angleDeg:80,spanLengthM:688,horizontalDistanceM:78.05,clearanceM:27.5,chainage:'K24+750m'}]});
const highway=planLetters(input)[0];highway.simulation=true;highway.status='simulated';
for(const [name,letter] of [['征询函_普通Word版式样例',general],['公路征询函_普通Word版式样例',highway]]){
 const payload={output:path.join(out,name+'.docx'),format:'docx',letters:[letter],assets:{}};
 const result=spawnSync(python,[path.join(root,'backend/export_letters.py')],{input:JSON.stringify(payload),encoding:'utf8'});
 if(result.status)throw new Error(result.stderr);console.log(payload.output);
 await fs.writeFile(path.join(out,'qa',name+'.json'),JSON.stringify(payload,null,2));
}
