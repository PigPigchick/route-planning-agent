import {LETTER_TEMPLATES, validateLettersInput} from './letters-core.mjs';

export const TABLE_FIELDS = [
  ['id', '协议编号'], ['scope', '行政区域 / 区段'], ['unit', '部门 / 收函单位'],
  ['type', '函件类型'], ['points', '征询事项'], ['round', '征询轮次'], ['status', '完成情况'],
  ['previousLetter', '前次函件与意见'], ['changeSummary', '路径调整原因']
];
const typeIds = new Map(LETTER_TEMPLATES.flatMap(t => [[t.id, t.id], [t.name, t.id]]));
const rounds = new Map([['first', 'first'], ['首次', 'first'], ['repeat', 'repeat'], ['再次征询', 'repeat'], ['再次', 'repeat'], ['revised', 'revised'], ['重新征询', 'revised'], ['路径调整后重新征询', 'revised']]);
const clean = v => String(v ?? '').trim();
const aliases = {
  id: ['协议编号', '编号', '事项编号'], unit: ['部门', '单位', '协议单位', '收函单位', '收函单位正式全称', '部门/收函单位'],
  scope: ['行政区域', '行政区域/区段', '行政区段', '行政区划', '区段'], type: ['函件类型', '协议类型', '类型'],
  points: ['征询事项', '事项', '征询要点'], round: ['征询轮次', '轮次'], status: ['完成情况', '协议完成情况', '协议办理情况'],
  previousLetter: ['前次函件与意见', '前次函件'], changeSummary: ['路径调整原因', '本次路径调整原因'], replySummary: ['回函关键内容', '回复意见']
};
const header = s => clean(s).replace(/[\s·]/g, '');
export function parseTableText(text) {
  const delimiter = text.includes('\t') ? '\t' : ',';
  const rows = []; let row = [], cell = '', quoted = false;
  text = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i+1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (c === delimiter || c === '\n')) { row.push(cell); cell = ''; if (c === '\n') { if (row.some(clean)) rows.push(row); row = []; } }
    else cell += c;
  }
  if (quoted) throw new Error('粘贴表格中引号未闭合');
  row.push(cell); if (row.some(clean)) rows.push(row);
  return rows;
}
export function agreementsFromRows(rows, existing = []) {
  if (!rows?.length) throw new Error('协议清单为空');
  const hs = rows[0].map(header), cols = {};
  for (const [key, names] of Object.entries(aliases)) cols[key] = hs.findIndex(h => names.map(header).includes(h));
  if (cols.unit < 0) throw new Error('协议清单表头需有“部门”或“收函单位”列');
  const data = rows.slice(1).filter(r => r.some(v => clean(v)));
  if (!data.length || data.length > 500) throw new Error('协议清单需包含1至500行');
  const ids = new Set(), warnings = [];
  const agreements = data.map((r, i) => {
    const get = key => cols[key] < 0 ? '' : clean(r[cols[key]]);
    const id = get('id') || 'AGR-' + crypto.randomUUID();
    if (ids.has(id)) throw new Error(`第${i+2}行协议编号重复：${id}`); ids.add(id);
    const unit = get('unit'); if (!unit) throw new Error(`第${i+2}行缺少部门或收函单位`);
    const type = typeIds.get(get('type') || 'general');
    if (!type) throw new Error(`第${i+2}行函件类型无效：${get('type')}`);
    const round = rounds.get(get('round') || 'first');
    if (!round) throw new Error(`第${i+2}行征询轮次无效：${get('round')}`);
    const old = existing.find(a => a.id === id);
    const a = {...(old ? structuredClone(old) : {facts: {}, attachments: []}), id, unit, type, round,
      scope: get('scope'), points: get('points'), status: get('status') || '未发函',
      previousLetter: get('previousLetter'), changeSummary: get('changeSummary'), replySummary: cols.replySummary<0?(old?.replySummary||''):get('replySummary')};
    if (old && old.type !== type) { a.facts = {}; delete a.crossings; delete a.templateId; }
    if (!a.scope || !a.points) warnings.push(`第${i+2}行 ${unit}：${[!a.scope && '区段', !a.points && '征询事项'].filter(Boolean).join('、')}待补充`);
    if (['高速', '铁路', '航道', '军事设施保护区', '其他收资'].includes(unit)) warnings.push(`第${i+2}行“${unit}”是类别或对象，请补充正式收函单位`);
    return a;
  });
  return {agreements, warnings};
}
const projectFields = {
  '工程编号': 'id', '工程名称': 'name', '工程版本': 'version', '电压等级': 'voltage', '设计阶段': 'stage',
  '工程概况': 'overview', '发函单位': 'issuer', '发函日期': 'issueDate', '发文字号': 'documentNumber',
  '联系人': 'contactName', '联系电话': 'contactPhone', '复函地址': 'replyAddress'
};
export function workbookProjects(workbook) {
  return workbook.sheets.filter(s=>/^P\d+_工程信息$/.test(s.name)).map(s=>{
    const code=s.name.split('_')[0],values=new Map(s.rows.slice(1).map(r=>[clean(r[0]),clean(r[1])]));
    if(!workbook.sheets.some(x=>x.name===code+'_协议清单'))throw new Error(code+'缺少对应协议清单工作表');
    return {code,name:values.get('工程名称')||code};
  });
}
export function workbookToLetters(workbook, current, projectCode) {
  const projects=workbookProjects(workbook);
  if(projects.length>1&&!projectCode)throw new Error('工作簿包含多个工程，请先选择本次工程');
  if(projects.length&&projectCode&&!projects.some(p=>p.code===projectCode))throw new Error('选择的工程不在工作簿中');
  const code=projectCode||projects[0]?.code;
  const list = code?workbook.sheets.find(s=>s.name===code+'_协议清单'):workbook.sheets.find(s => s.name === '协议清单') || workbook.sheets.find(s => s.rows?.[0]?.some(h => aliases.unit.map(header).includes(header(h))));
  if (!list) throw new Error('没有找到“协议清单”工作表，或表头缺少“部门/收函单位”');
  const parsed = agreementsFromRows(list.rows, []), input = structuredClone(current);
  input.agreements = parsed.agreements; input.templateConfirmed = false;
  const info = workbook.sheets.find(s => s.name === (code?code+'_工程信息':'工程信息'));
  let selectedIds;
  let newProject = false, isTest = false;
  if (info) {
    const values = new Map(info.rows.slice(1).map(r => [clean(r[0]), clean(r[1])]));
    for (const required of ['工程编号', '工程名称', '工程版本', '路径编号']) if (!values.get(required)) throw new Error(`工程信息缺少${required}`);
    newProject = values.get('工程编号') !== input.project.id || values.get('工程版本') !== input.project.version || values.get('路径编号') !== input.route.id;
    if(!newProject&&values.get('工程名称')!==input.project.name)throw new Error('同一工程编号和版本对应的名称不同，请更新工程编号或版本');
    input.project = Object.fromEntries(Object.entries(projectFields).map(([label, key]) => [key, values.get(label) || '']));
    isTest = values.get('是否测试样例') === '是'; input.project.isDemo = isTest;
    input.route = {id: values.get('路径编号'), version: input.project.version, summary: values.get('路径描述') || ''};
    if(values.get('本次起草协议编号')){
      selectedIds=[...new Set(values.get('本次起草协议编号').split(/[,，\n]/).map(clean).filter(Boolean))];
      if(selectedIds.length>30||selectedIds.some(id=>!input.agreements.some(a=>a.id===id)))throw new Error('本次起草协议编号须对应清单中的1至30项');
    }
    if (!input.project.overview || !input.route.summary) parsed.warnings.unshift('工程概况或路径描述为空，起草前需补充');
  }
  const pendingAssets = [], attachmentSheet = workbook.sheets.find(s => s.name === '附件清单');
  if (attachmentSheet?.rows?.length > 1) {
    const hs = attachmentSheet.rows[0].map(clean), indexes = ['协议编号', '附件类型', '文件名', '测试附件内容'].map(h => hs.indexOf(h));
    const projectIndex=hs.indexOf('工程编号');
    if(code&&projectIndex<0)throw new Error('多工程工作簿的附件清单需有工程编号列，填写P01、P02等工程分组');
    if (indexes.slice(0, 3).some(i => i < 0)) throw new Error('附件清单需有协议编号、附件类型、文件名三列');
    for (const [i, row] of attachmentSheet.rows.slice(1).entries()) {
      if (!row.some(clean)) continue;
      if(code&&clean(row[projectIndex])!==code)continue;
      const [id, kind, name, content] = indexes.map(j => j < 0 ? '' : clean(row[j]));
      const a = input.agreements.find(x => x.id === id);
      if (!a) throw new Error(`附件清单第${i+2}行协议编号未找到：${id}`);
      if (!name || !kind || /[\\/]/.test(name)) throw new Error(`附件清单第${i+2}行文件名或类型无效`);
      a.attachments.push({name, kind, assetId: '', routeVersion: input.route.version});
      if (content) {
        if (!isTest || !name.toLowerCase().endsWith('.txt') || !content.includes('仅测试') || content.length > 20000) throw new Error('测试附件内容仅限“是否测试样例=是”的TXT，且需注明“仅测试”');
        pendingAssets.push({agreementId: id, attachmentIndex: a.attachments.length-1, name, content});
      }
    }
  }
  validateLettersInput(input);
  return {input, warnings: parsed.warnings, newProject, hasProject: !!info, pendingAssets, isTest,selectedIds};
}
export function letterContext(input) {
  return {contextType: 'letters', project: structuredClone(input.project), routes: [{id: input.route.id, name: '本次征询路径', summary: input.route.summary}],
    issues: [], rules: [], agreements: input.agreements.map(a => ({...structuredClone(a), template: a.type, segment: a.scope,attachments:a.attachments.map(x=>x.name)}))};
}
