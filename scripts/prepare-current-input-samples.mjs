import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {readLetterWorkbook} from '../backend/letter-xlsx.mjs';
import {emptyLettersInput} from '../dist/workspace-state.mjs';
import {workbookToLetters} from '../dist/letter-table.mjs';
import {readLettersDocument} from '../dist/letter-input-document.mjs';
import {validateLettersInput} from '../dist/letters-core.mjs';

const root=process.cwd();
const source='/Users/cenjiaxin/Downloads/能建智能体项目测试/输出输入参考/输入参考/四份协议清单_手动填写样例_2026-10-28';
const destination=path.join(root,'outputs/四份协议清单_当前版本输入样例_2026-10-29');
await fs.mkdir(destination,{recursive:true});
const results=[];
for(const code of ['P01','P02','P03','P04']){
 const excel=code+'_征询函输入测试样例.xlsx';
 const bytes=await fs.readFile(path.join(source,excel));
 const workbook=await readLetterWorkbook(root,{name:excel,base64:bytes.toString('base64')});
 const parsed=workbookToLetters(workbook,emptyLettersInput());
 const single=readLettersDocument(JSON.parse(await fs.readFile(path.join(source,code+'_单函填写输入.json'),'utf8')));
 const platform=readLettersDocument(JSON.parse(await fs.readFile(path.join(source,code+'_平台工程输入.json'),'utf8')));
 assert.equal(parsed.input.project.id,single.project.id);assert.equal(platform.project.id,single.project.id);
 const input=structuredClone(parsed.input);
 // Preserve the originally prepared complete test item, including its special facts.
 input.project=structuredClone(single.project);input.route=structuredClone(single.route);
 input.agreements=input.agreements.map(a=>structuredClone(single.agreements.find(x=>x.id===a.id)||a));
 input.templateConfirmed=false;
 validateLettersInput(input);assert.deepEqual(readLettersDocument(input),input);
 assert.equal(input.agreements.length,parsed.input.agreements.length);
 assert.ok(Buffer.byteLength(JSON.stringify(input))<2*1024*1024);
 const jsonName=code+'_完整工程输入.json';
 await fs.writeFile(path.join(destination,jsonName),JSON.stringify(input,null,2)+'\n','utf8');
 await fs.copyFile(path.join(source,excel),path.join(destination,excel));
 await fs.copyFile(path.join(source,code+'_模拟路径图_仅测试.txt'),path.join(destination,code+'_模拟路径图_仅测试.txt'));
 results.push({code,project:input.project.name,projectId:input.project.id,version:input.project.version,routeId:input.route.id,agreements:input.agreements.length,recommendedId:single.agreements[0].id,recommendedUnit:single.agreements[0].unit,jsonName,excel,metadata:'校验通过',oldJsonFormats:'两种旧JSON均可转换',incomplete:input.agreements.filter(a=>!a.scope||!a.points).length});
}
await fs.copyFile(path.join(source,'征询函输入测试样例.xlsx'),path.join(destination,'四工程_Excel合集.xlsx'));
await fs.writeFile(path.join(destination,'使用说明.txt'),`四工程完整输入样例（2026-10-29）

推荐导入方法：
1. 先使用当前更新后的本机平台。
2. 右上角“当前工程”→“导入工程 JSON”，选择 P01～P04 中一份“完整工程输入.json”。
3. 四个文件分别包含工程编号、工程名称、工程版本、路径编号、发函信息和完整协议清单。导入后默认不勾选单位，请自行选择本次需要起草的事项。
4. 也可以在“当前工程”→“导入 Excel”选择对应工程的工作簿，或使用“四工程_Excel合集.xlsx”后选择本次工程。Excel内容及原样式保留。

“协议清单”下方的“JSON 输入 / 导入”用于更新当前工程；切换至另一个工程时，请使用右上角“当前工程”的导入入口。

各工程保留一个原先准备完整的测试事项，可先选择：
${results.map(r=>`${r.code}：${r.recommendedId}，${r.recommendedUnit}；完整清单 ${r.agreements} 条。`).join('\n')}

其余事项中原本缺少的区段、征询事项等仍保持未填写，未编造真实资料。
TXT为模拟路径图，仅供测试；从JSON导入时需要在对应事项的“附件”中手动上传，不能作为真实工程图纸。
发函单位、联系人、电话、地址等沿用原样例的测试信息，正式使用须替换。
本包仅校验输入和导入，不代表全部事项已起草、复核或导出。\n`,'utf8');
const table='| 工程 | 名称 | 协议条数 | 工程编号 | 版本 | 路径编号 | 结果 |\n|---|---|---:|---|---|---|---|\n'+results.map(r=>`| ${r.code} | ${r.project} | ${r.agreements} | ${r.projectId} | ${r.version} | ${r.routeId} | ${r.metadata} |`).join('\n');
await fs.writeFile(path.join(destination,'输入校验结果.md'),'# 输入校验结果\n\n'+table+'\n\n已分别通过当前平台的 Excel 解析、函件 JSON 校验及平台 JSON 转换校验。未调用大模型。\n','utf8');
await fs.writeFile(path.join(destination,'输入校验结果.json'),JSON.stringify(results,null,2)+'\n','utf8');
console.log(JSON.stringify({destination,projects:results.map(({code,agreements,metadata})=>({code,agreements,metadata}))},null,2));
