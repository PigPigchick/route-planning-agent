export const AGENTS = {
 comparison: {name:'路径方案比选',short:'方案比选',icon:'route',description:'综合经济与空间约束，辅助选择更优路径'},
 compliance: {name:'路径合规分析',short:'合规分析',icon:'shield',description:'关联地物与规则，形成有依据的审查意见'},
 description: {name:'路径描述章节',short:'路径描述',icon:'file',description:'将工程对象与空间关系转为可编辑章节'},
 letters: {name:'协议征询函',short:'征询函件',icon:'mail',description:'根据协议清单与模板，生成征询函件草稿'}
};
export const SAMPLE = {
 project:{id:'PRJ-2026-018',name:'粤东—云峰 500kV 输电线路工程',voltage:'500kV',stage:'可行性研究',start:'粤东变电站',end:'云峰变电站',version:'v1.0',dataDate:'2026-10-20',isDemo:true},
 routes:[
 {id:'A',name:'方案 A · 北线方案',length:42.6,towers:98,forest:12.8,demolition:1260,sensitive:2,redline:0,crossings:6,unitCost:245,areaRate:0.32,crossingCost:18,terrain:'丘陵 62%、平地 38%',via:['清溪镇','青山林地','北江支流','云峰镇']},
 {id:'B',name:'方案 B · 中线方案',length:39.8,towers:92,forest:8.4,demolition:2180,sensitive:1,redline:0,crossings:8,unitCost:245,areaRate:0.32,crossingCost:18,terrain:'丘陵 45%、平地 55%',via:['清溪镇','石岭村','北江支流','云峰镇']},
 {id:'C',name:'方案 C · 南线方案',length:45.2,towers:105,forest:15.6,demolition:860,sensitive:3,redline:1,crossings:5,unitCost:245,areaRate:0.32,crossingCost:18,terrain:'丘陵 71%、平地 29%',via:['清溪镇','南山林场','生态约束区','云峰镇']}
 ],
 issues:[
 {id:'C-01',routeIds:['A','B'],title:'道路跨越资料待补充',type:'missing',segment:'S-03',object:'县道 X204 跨越点',source:'跨越对象清单 v1.0',ruleId:'R-01',detail:'现有资料缺少道路等级、设计标高和净空测量值，尚不具备计算核验条件。',need:['道路等级与管理单位','跨越点设计标高','净空测量资料']},
 {id:'C-02',routeIds:['A','C'],title:'生态保护范围邻近核查',type:'review',segment:'S-05',object:'青山林地边界',source:'生态约束图层 v1.0',ruleId:'R-02',detail:'路径邻近生态约束图层边界，需要核对图层时效、保护范围和坐标基准，不能据此判定已满足要求。',need:['现行有效的保护范围图层','坐标基准与边界确认记录']},
 {id:'C-03',routeIds:['A','B','C'],title:'河道跨越外部协调',type:'coordination',segment:'S-08',object:'北江支流跨越点',source:'协议事项清单 v1.0',ruleId:'R-03',detail:'本区段涉及河道跨越，应确认管理单位与征询要点，关联函件后继续跟踪。',need:['河道管理单位确认','征询范围与附件示意图']},
 {id:'C-04',routeIds:['C'],title:'约束红线交叉待核实',type:'review',segment:'S-06',object:'生态约束区交叉点',source:'演示空间叠加结果 v1.0',ruleId:'R-02',detail:'演示叠加结果提示 1 处红线交叉，该方案暂不参与推荐；应核实权威边界及交叉关系。',need:['权威红线图层','空间交叉关系复核']}
 ],
 agreements:[{id:'L-01',unit:'示例林业主管部门',type:'林地协调',segment:'S-05',template:'林业征询模板 v2.0',points:'路径与林地的空间关系、管理要求、后续办理程序',attachments:['路径示意图','林地区段与征询事项清单']},{id:'L-02',unit:'示例交通管理单位',type:'道路跨越',segment:'S-03',template:'交通征询模板 v2.0',points:'道路等级、跨越净空、施工组织与安全要求',attachments:['路径示意图','道路跨越位置表']},{id:'L-03',unit:'示例水务管理单位',type:'河道跨越',segment:'S-08',template:'水务征询模板 v1.0',points:'河道管理范围、防洪要求及需补充的办理材料',attachments:['路径示意图','河道跨越事项清单']}],
 rules:[{id:'R-01',name:'跨越资料完整性检查',version:'v1.0',kind:'资料校验',text:'缺少设施等级、标高或净空数据时保留待核状态。',source:'业务规则示例；正式条款待业务方关联'},{id:'R-02',name:'生态约束空间关系复核',version:'v1.0',kind:'空间审查',text:'红线交叉不参与推荐；邻近边界需核对图层及适用范围。',source:'演示筛查规则，不替代正式规范审查'},{id:'R-03',name:'外部协调事项完整性',version:'v1.0',kind:'协调检查',text:'征询单位、事项、附件与落款须经人工确认。',source:'业务模板示例'}]
};
export function clone(v){return JSON.parse(JSON.stringify(v));}
export function validateContext(c){
 const errors=[];
 if(!c?.project?.id||!c?.project?.name)errors.push('缺少工程编号或名称');
 if(!Array.isArray(c?.routes)||!c.routes.length||c.routes.length>20)errors.push('路径应为 1–20 条');
 const ids=new Set();
 for(const r of c?.routes||[]){if(!r.id||ids.has(r.id))errors.push('路径编号缺失或重复');ids.add(r.id);if(!r.name)errors.push('路径名称缺失'); for(const k of ['length','towers','forest','demolition','sensitive','redline','crossings','unitCost','areaRate','crossingCost'])if(typeof r[k]!=='number'||!Number.isFinite(r[k])||r[k]<0)errors.push(`${r.id} 的 ${k} 必须为非负数`);if(r.length===0)errors.push('路径长度必须大于 0');if(!Array.isArray(r.via)||typeof r.terrain!=='string')errors.push('路径须提供经过点 via 和地形 terrain');}
 for(const key of ['issues','agreements','rules'])if(!Array.isArray(c?.[key]))errors.push(`缺少 ${key} 数组`);
 for(const i of c?.issues||[])if(!i.id||!i.title||!Array.isArray(i.routeIds)||i.routeIds.some(id=>!ids.has(id))||!Array.isArray(i.need)||!i.detail||!i.source||!i.segment)errors.push('审查问题字段不完整');
 for(const a of c?.agreements||[])if(!a.id||!a.unit||!a.type||!a.template||!a.points||!Array.isArray(a.attachments))errors.push('协议事项字段不完整');
 for(const r of c?.rules||[])if(!r.id||!r.name||!r.version||!r.text||!r.source)errors.push('规则字段不完整');
 if(errors.length)throw new Error([...new Set(errors)].join('；')); return c;
}
export function calculate(r){const line= Math.round(r.length*r.unitCost*100)/100, demolition=Math.round(r.demolition*r.areaRate*100)/100,crossing=r.crossings*r.crossingCost; return {line,demolition,crossing,total:Math.round((line+demolition+crossing)*100)/100};}
export function rankRoutes(routes,weights={economy:50,ecology:30,construction:20}){
 if(Object.values(weights).some(x=>!Number.isFinite(x)||x<0)||weights.economy+weights.ecology+weights.construction!==100)throw new Error('比选权重合计须为 100%');
 const costs=routes.map(r=>calculate(r).total), maxCost=Math.max(...costs);
 return routes.map(r=>{const calc=calculate(r),economy=100* Math.min(...costs)/Math.max(calc.total,0.01),ecology=Math.max(0,100-r.forest*2-r.sensitive*8),construction=Math.max(0,100-r.crossings*4-r.towers*.12);return {...r,calc,score:Math.round((economy*weights.economy+ecology*weights.ecology+construction*weights.construction))/100,eligible:r.redline===0};}).sort((a,b)=>Number(b.eligible)-Number(a.eligible)||b.score-a.score);
}
export function describe(c,r){return `${c.project.name}（${r.name}）起于${c.project.start||'起点待补充'}，止于${c.project.end||'终点待补充'}，依次经过${r.via.join('、')}。线路全长 ${r.length.toFixed(1)} km，拟设杆塔 ${r.towers} 基；沿线地形构成为${r.terrain}。涉及林地区段 ${r.forest.toFixed(1)} km，房屋拆迁面积约 ${r.demolition.toLocaleString()} m²，主要跨越点 ${r.crossings} 处。空间叠加资料提示生态敏感点 ${r.sensitive} 处、红线交叉 ${r.redline} 处，相关边界和跨越条件须经设计人员复核。本段依据工程快照 ${c.project.version} 生成，数值直接引用工程对象与确定性计算结果。`;}
export function makeTask(c,agentType,routeIds,weights){
 validateContext(c); if(!AGENTS[agentType])throw new Error('未知智能体类型');
 if(!Array.isArray(routeIds)||!routeIds.length||routeIds.some(id=>!c.routes.some(r=>r.id===id)))throw new Error('请选择有效路径');
 const routes=c.routes.filter(r=>routeIds.includes(r.id)),r=routes[0];
 if(agentType==='comparison'&&routes.length<2)throw new Error('方案比选至少选择两条路径');
 const stamp=new Date().toISOString();const task={id:'TASK-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),agentType,routeIds,projectId:c.project.id,projectVersion:c.project.version,mode:'demo',status:'awaiting_confirmation',createdAt:stamp,steps:[],result:null,confirmations:[],revision:1};
 if(agentType==='comparison'){
 const descriptions=routes.map(r=>({routeId:r.id,text:describe(c,r)})),ranked=rankRoutes(routes,weights),best=ranked.find(r=>r.eligible);
 task.steps=[{name:'读取统一工程快照',detail:`${routes.length} 条路径 · ${c.project.version}`},{name:'调用路径描述智能体',detail:`已生成 ${descriptions.length} 份路径描述`},{name:'执行确定性指标计算',detail:'长度 × 单价 + 拆迁面积 × 补偿单价 + 跨越数量 × 单项费用'},{name:'综合分析并生成建议',detail:'综合经济、生态与施工指标'},{name:'等待设计人员确认',detail:'确认后方可纳入最终成果'}];
 task.result={title:'路径方案比选建议',descriptions,ranked,weights:weights||{economy:50,ecology:30,construction:20},recommended:best?.id||null,text:best?`建议优先开展${best.name}的深化研究，演示综合评分为 ${best.score.toFixed(2)} 分，估算费用 ${best.calc.total.toFixed(2)} 万元。该建议基于已录入指标、显式权重与规则筛查，仍需结合地物核实、跨越条件、协议反馈及现场踏勘确认。${ranked.some(x=>!x.eligible)?'存在红线交叉提示的方案暂不纳入推荐。':''}`:'现有路径均存在红线交叉提示，暂不推荐路径，须先开展人工核实与方案调整。'};
 } else if(agentType==='description'){
 task.steps=[{name:'读取路径与工程对象',detail:r.name},{name:'还原路径空间语义',detail:r.via.join(' → ')},{name:'生成章节草稿',detail:'基础描述与地物参数分段输出'},{name:'等待人工校核',detail:'来源字段可追溯'}];
 task.result={title:'线路路径描述',text:describe(c,r),chapters:[{title:'1. 工程概况',text:`${c.project.name}，电压等级 ${c.project.voltage}，当前处于${c.project.stage}阶段。`},{title:'2. 线路路径描述',text:describe(c,r)},{title:'3. 沿线地形与地物',text:`${r.terrain}。林地区段 ${r.forest} km，拆迁面积 ${r.demolition} m²。数据来源：统一工程对象 ${c.project.version}。`},{title:'4. 主要跨越与协调事项',text:`涉及跨越 ${r.crossings} 处。${c.issues.filter(i=>i.routeIds.includes(r.id)).map(i=>`${i.segment}：${i.title}`).join('；')}。相关条件尚需核实。`}]};
 } else if(agentType==='compliance'){
 const issues=c.issues.filter(i=>i.routeIds.includes(r.id));task.steps=[{name:'匹配路径经过对象',detail:r.name},{name:'关联适用规则',detail:`规则包 ${c.rules.length} 条`},{name:'整理问题与证据',detail:`${issues.length} 项待复核`},{name:'等待人工复核',detail:'缺少资料不判定为合规'}];task.result={title:'路径合规性分析',issues,text:`针对${r.name}已整理 ${issues.length} 项待处理事项。${issues.map(i=>`${i.segment} ${i.title}：${i.detail}`).join('\n')}\n本输出为资料完整性与规则筛查草稿。正式合规结论须以有效条款、经确认的空间数据和人工审查记录为依据。`};
 } else {
 if(!c.agreements.length)throw new Error('协议清单为空，请先导入协议事项');task.steps=[{name:'读取协议清单',detail:`${c.agreements.length} 家单位`},{name:'匹配函件模板',detail:'依据协议类型与事项匹配'},{name:'生成函件草稿',detail:'称谓、正文、征询要点与附件'},{name:'等待人工定稿',detail:'单位、落款、日期及附件需确认'}];
 task.result={title:'路径协议征询函',letters:c.agreements.map(a=>({...a,text:`关于征询${c.project.name}\n路径方案意见的函\n\n${a.unit}：\n\n我方正在开展${c.project.name}路径研究。现就${r.name}涉及的${a.type}事项（${a.segment}）征询贵单位意见。\n\n请就${a.points}予以指导。相关位置与区段详见附件。\n\n附件：\n${a.attachments.map((x,i)=>`${i+1}. ${x}（实际文件待补充）`).join('\n')}\n\n项目单位：待人工填写\n日期：待人工填写`}))};
 }
 return task;
}
export function confirmTask(task,{note,reviewer,expectedRevision,editedText}){if(task.status!=='awaiting_confirmation')throw new Error('该任务已确认或状态不支持确认');if(expectedRevision!==task.revision)throw new Error('任务版本已变化，请刷新后再确认');if(!note?.trim()||!reviewer?.trim())throw new Error('请填写复核人员和复核意见');if(editedText&&task.agentType==='description'){task.result.text=editedText;task.result.chapters[1].text=editedText;}task.confirmations.push({reviewer,note,at:new Date().toISOString(),revision:task.revision});task.status='confirmed';task.revision++;return task;}
