import {agreementsFromRows, parseTableText, workbookToLetters,workbookProjects, TABLE_FIELDS} from './letter-table.mjs';
import {LETTER_TEMPLATES, validateLettersInput} from './letters-core.mjs';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const active = selector => !!$(selector)?.closest('dialog')?.open;
function bytes64(bytes) { let text = ''; for (let i=0; i<bytes.length; i+=32768) text += String.fromCharCode(...bytes.subarray(i,i+32768)); return btoa(text); }

export function openLetterTableImport(env, current, api, apply) {
  env.modal('导入工程与协议清单', `<p>${current.project.id?'完整工作簿可包含“工程信息”“协议清单”“附件清单”；只导入单位清单时，保留当前工程信息。':'请上传包含“工程信息”和“协议清单”的完整工作簿，可附“附件清单”。'}</p>
    <button type="button" id="letter-xlsx-drop" class="letter-upload-drop" aria-label="选择或拖入 Excel 工作簿" aria-describedby="letter-xlsx-hint">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/></svg>
      <strong>选择或拖入 Excel 工作簿</strong><span id="letter-xlsx-hint">点击选择文件，或将文件拖拽到此处</span><small>支持 .xlsx · 最大 6MB · 每次一个文件</small>
      <span id="letter-xlsx-selected" class="letter-upload-selected" role="status" hidden></span>
    </button>
    <input id="letter-xlsx-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>
    <button type="button" id="letter-xlsx-clear" class="letter-upload-clear" hidden>清除已选文件</button>
    <div class="letter-upload-downloads"><a class="letter-download-button" href="./assets/征询函输入模板.xlsx" download>下载 Excel 填写模板</a></div>
    <details class="letter-paste-option"><summary>或从 Excel 复制并粘贴表格</summary><label class="field"><span>粘贴包含表头的清单</span><textarea id="letter-paste-table" rows="5" placeholder="行政区域&#9;部门&#9;函件类型&#9;征询事项"></textarea></label><p class="muted">支持“行政区域、部门”两列旧清单。区段、事项等缺项会在解析后列出，按真实资料补充。</p></details>
    <div id="letter-table-error" class="error-msg" role="alert"></div>`, '<button data-action="close">取消</button><button class="primary" id="letter-parse-table">解析表格</button>', true);
  const upload=$('#letter-xlsx-drop'),fileInput=$('#letter-xlsx-file');
  let selectedFile=null,dragDepth=0;
  const validateFile=file=>{
    if(!file||!String(file.name).toLowerCase().endsWith('.xlsx'))throw new Error('请选择 .xlsx 文件；旧版 .xls 请先另存为 .xlsx');
    if(!file.size)throw new Error('文件为空，请重新选择');
    if(file.size>6*1024*1024)throw new Error('Excel文件不能超过6MB');
  };
  const hint=()=>{$('#letter-xlsx-hint').textContent=selectedFile?'点击更换文件，或拖入新文件替换':'点击选择文件，或将文件拖拽到此处';};
  const chooseFile=files=>{
    try{
      if(!files?.length)return;
      if(files.length!==1)throw new Error('每次只能导入一个 Excel 工作簿');
      validateFile(files[0]);selectedFile=files[0];
      $('#letter-xlsx-selected').textContent='已选择：'+selectedFile.name;$('#letter-xlsx-selected').hidden=false;
      $('#letter-xlsx-clear').hidden=false;
      $('#letter-table-error').textContent='';hint();
    }catch(e){selectedFile=null;fileInput.value='';$('#letter-xlsx-selected').hidden=true;$('#letter-xlsx-clear').hidden=true;$('#letter-table-error').textContent=e.message;hint();}
  };
  upload.onclick=()=>fileInput.click();
  fileInput.onchange=()=>chooseFile(fileInput.files);
  $('#letter-xlsx-clear').onclick=()=>{selectedFile=null;fileInput.value='';$('#letter-xlsx-selected').hidden=true;$('#letter-xlsx-clear').hidden=true;$('#letter-table-error').textContent='';hint();};
  upload.ondragenter=e=>{e.preventDefault();e.stopPropagation();dragDepth++;upload.classList.add('is-dragging');$('#letter-xlsx-hint').textContent='松开鼠标，选择这个文件';};
  upload.ondragover=e=>{e.preventDefault();e.stopPropagation();if(e.dataTransfer)e.dataTransfer.dropEffect='copy';};
  upload.ondragleave=e=>{e.preventDefault();e.stopPropagation();if(--dragDepth<=0){dragDepth=0;upload.classList.remove('is-dragging');hint();}};
  upload.ondrop=e=>{e.preventDefault();e.stopPropagation();dragDepth=0;upload.classList.remove('is-dragging');chooseFile(e.dataTransfer?.files);hint();};
  $('#letter-parse-table').onclick = async () => {
    const button = $('#letter-parse-table');
    try {
      button.disabled = true;
      const file = selectedFile||fileInput.files[0], pasted = $('#letter-paste-table').value;
      if (file && pasted.trim()) throw new Error('请在Excel文件与粘贴表格中选择一种输入方式');
      let workbook;
      if (file) {
        validateFile(file);
        workbook = await api('/api/v1/letter-input/parse', {name:file.name, base64:bytes64(new Uint8Array(await file.arrayBuffer()))});
      } else {
        if (!pasted.trim()) throw new Error('请选择Excel文件，或粘贴包含表头的清单');
        workbook = {sheets:[{name:'协议清单',rows:parseTableText(pasted)}]};
      }
      if (!active('#letter-parse-table')) return;
      const projects=workbookProjects(workbook);
      if(projects.length>1){chooseProject(env,workbook,projects,current,api,apply);return;}
      const parsed = workbookToLetters(workbook, current);
      previewImport(env, parsed, api, apply);
    } catch (e) { if(active('#letter-parse-table')) $('#letter-table-error').textContent = e.message; }
    finally { if(button.isConnected) button.disabled = false; }
  };
}
function chooseProject(env,workbook,projects,current,api,apply){
  env.modal('选择本次导入的工程',`<p>此工作簿有 ${projects.length} 个工程。每次只导入一个工程及其对应清单。</p><label class="field"><span>本次工程</span><select id="letter-import-project">${projects.map(p=>`<option value="${esc(p.code)}">${esc(p.code+' · '+p.name)}</option>`).join('')}</select></label><div id="letter-table-error" class="error-msg" role="alert"></div>`,'<button data-action="close">取消</button><button class="primary" id="letter-project-next">解析该工程清单</button>',true);
  $('#letter-project-next').onclick=()=>{try{previewImport(env,workbookToLetters(workbook,current,$('#letter-import-project').value),api,apply);}catch(e){$('#letter-table-error').textContent=e.message;}};
}
function previewImport(env, parsed, api, apply) {
  const {input,warnings,pendingAssets}=parsed;
  // Workbook IDs are recommendations only. A re-import must never reselect a unit.
  const selection=new Set();
  parsed.selectedIds=[];
  const rows=input.agreements.map(a=>`<tr><td><label class="checklabel"><input type="checkbox" data-import-agreement="${esc(a.id)}" aria-label="本次选择 ${esc(a.unit)}（${esc(a.id)}）">${esc(a.id)}</label></td><td>${esc(a.scope)}</td><td>${esc(a.unit)}</td><td>${esc(LETTER_TEMPLATES.find(t=>t.id===a.type)?.name)}</td><td>${esc(a.points)||'<span class="error-msg">待补充</span>'}</td></tr>`).join('');
  env.modal('确认表格解析结果',`
    <div class="letter-import-summary"><b>${esc(input.project.name)}</b><p>路径 ${esc(input.route.id)} · ${esc(input.project.version)} · 解析到 ${input.agreements.length} 项协议</p>
    <p>每次导入默认不勾选。请勾选本次需要预览和起草的单位，也可导入后在左侧勾选。</p>
    <p id="letter-import-selection-count">本次已勾选 0 项</p><p>${parsed.newProject?'确认后切换到表格中的工程，并载入本次协议清单。':'确认后替换当前路径的协议清单。'}</p></div>
    ${warnings.length?`<details class="letter-import-warnings"><summary>${warnings.length} 项需补充或核对（点击展开）</summary><ul>${warnings.slice(0,30).map(w=>`<li>${esc(w)}</li>`).join('')}</ul></details>`:''}
    <div class="letter-table-scroll"><table class="letter-input-table"><thead><tr>${['本次选择 / 协议编号','行政区域 / 区段','部门 / 收函单位','函件类型','征询事项'].map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
    ${pendingAssets.length?`<label class="checklabel letter-import-assets"><input id="letter-import-test-assets" type="checkbox">同时导入 ${pendingAssets.length} 份测试文字附件（仅测试，不是真实图纸）</label>`:''}
    <p class="muted">确认导入只保存资料；点击“生成正文”时才起草。</p><div id="letter-table-error" class="error-msg" role="alert"></div>`,
    '<button data-action="close">取消</button><button class="primary" id="letter-table-confirm">确认导入</button>',true);
  $('#dialog').onchange=e=>{
    const id=e.target.dataset.importAgreement;if(!id)return;
    if(e.target.checked&&selection.size>=30){e.target.checked=false;$('#letter-table-error').textContent='每次最多勾选30项，请分批起草';return;}
    e.target.checked?selection.add(id):selection.delete(id);
    parsed.selectedIds=input.agreements.filter(a=>selection.has(a.id)).map(a=>a.id);
    e.target.closest('tr').classList.toggle('import-selected',e.target.checked);
    $('#letter-import-selection-count').textContent='本次已勾选 '+selection.size+' 项';
    $('#letter-table-error').textContent='';
  };
  $('#letter-table-confirm').onclick=async()=>{
    const button=$('#letter-table-confirm');
    try{
      button.disabled=true;
      if(pendingAssets.length&&$('#letter-import-test-assets').checked){
        for(const asset of pendingAssets){
          if(!active('#letter-table-confirm'))return;
          const uploaded=await api('/api/v1/assets',{name:asset.name,base64:bytes64(new TextEncoder().encode('模拟测试附件 · 非真实工程资料\n'+asset.content))});
          input.agreements.find(a=>a.id===asset.agreementId).attachments[asset.attachmentIndex].assetId=uploaded.id;
        }
      }
      if(!active('#letter-table-confirm'))return;
      await apply(parsed);$('#dialog').close();env.render();
    }catch(e){if(active('#letter-table-confirm'))$('#letter-table-error').textContent=e.message;}
    finally{if(button.isConnected)button.disabled=false;}
  };
}
export function editLetterTable(env, current, apply) {
  let rows = structuredClone(current.agreements);
  env.modal('表格编辑协议清单', '<p>直接修改单元格，也可新增或删除行；点击“保存清单”后生效。</p><div class="actions"><button id="letter-table-add" type="button">＋ 新增一行</button></div><div id="letter-table-grid" class="letter-table-scroll"></div><div id="letter-table-error" class="error-msg" role="alert"></div>', '<button data-action="close">取消</button><button class="primary" id="letter-table-save">保存清单</button>', true);
  const options = (items, value) => items.map(([v,label])=>`<option value="${esc(v)}" ${v===value?'selected':''}>${esc(label)}</option>`).join('');
  const paint = () => {
    $('#letter-table-grid').innerHTML = `<table class="letter-input-table letter-edit-table"><thead><tr>${TABLE_FIELDS.map(([,label])=>`<th>${label}</th>`).join('')}<th>操作</th></tr></thead><tbody>${rows.map((a,i)=>`<tr>${TABLE_FIELDS.map(([key,label])=>`<td>${key==='type'?`<select data-row="${i}" data-col="${key}" aria-label="第${i+1}行${label}">${options(LETTER_TEMPLATES.map(t=>[t.id,t.name]),a.type)}</select>`:key==='round'?`<select data-row="${i}" data-col="${key}" aria-label="第${i+1}行${label}">${options([['first','首次'],['repeat','再次征询'],['revised','路径调整后重新征询']],a.round)}</select>`:`<textarea rows="2" data-row="${i}" data-col="${key}" aria-label="第${i+1}行${label}">${esc(a[key])}</textarea>`}</td>`).join('')}<td><button type="button" data-delete-row="${i}">删除</button></td></tr>`).join('')}</tbody></table>`;
    $('#letter-table-grid').oninput=e=>{if(e.target.dataset.col)rows[+e.target.dataset.row][e.target.dataset.col]=e.target.value;};
    $('#letter-table-grid').onchange=e=>{if(e.target.dataset.col)rows[+e.target.dataset.row][e.target.dataset.col]=e.target.value;};
    $('#letter-table-grid').onclick=e=>{const b=e.target.closest('[data-delete-row]');if(b){rows.splice(+b.dataset.deleteRow,1);paint();}};
  };
  paint();
  $('#letter-table-add').onclick = () => {if(rows.length>=500){$('#letter-table-error').textContent='最多500项协议';return;}rows.push({id:'AGR-'+crypto.randomUUID(),scope:'',unit:'',type:'general',points:'',round:'first',status:'未发函',previousLetter:'',changeSummary:''});paint();};
  $('#letter-table-save').onclick = async () => {
    try {
      const result = rows.length ? agreementsFromRows([TABLE_FIELDS.map(([,label])=>label),...rows.map(a=>TABLE_FIELDS.map(([key])=>a[key]||''))], current.agreements) : {agreements:[]};
      const input = {...structuredClone(current),agreements:result.agreements};
      validateLettersInput(input,{allowEmpty:true});
      $('#letter-table-save').disabled = true;
      await apply({input,newProject:false,hasProject:false});
      $('#dialog').close(); env.render();
    } catch(e) {$('#letter-table-error').textContent=e.message;$('#letter-table-save').disabled=false;}
  };
}
