const docKinds = {
 description: '路径描述',
 comparison: '方案比选',
 upper: '北方案合规',
 lower: '南方案合规',
 assembly: '综合报告',
};

export function rraDocumentKinds(task, page, routeId) {
 const kinds = page === 'comparison' ? ['comparison','assembly'] : page === 'description' ? ['description']
  : task?.routeBindings?.find(item => item.routeId === routeId)?.id === 'lower' ? ['lower','upper'] : ['upper','lower'];
 const docs = (task?.result?.files || []).filter(file => /\.docx$/i.test(file.name));
 return kinds.filter(kind => docs.some(file => {
  if (kind === 'upper' || kind === 'lower') return file.label === '合规分析' && file.path.split('/').includes(kind);
  return file.label === docKinds[kind];
 }));
}

function chapters(blocks) {
 const sections = [];
 for (const block of blocks) {
  if (block.type === 'heading') {
   sections.push({title:block.text, blocks:[]});
  } else {
   if (!sections.length) sections.push({title:'报告正文', blocks:[]});
   sections.at(-1).blocks.push(block);
  }
 }
 return sections;
}

export function mountRraReader(host, task, kinds, {request, modal, esc, toast, baseUrl}) {
 const prefix = '/api/v1/tasks/' + encodeURIComponent(task.id) + '/rra-document/';
 const fileBase = baseUrl.replace(/\/$/,'') + prefix;
 let kind = kinds[0], doc, sections = [], chapter = 0, sequence = 0;
 const documentPath = action => prefix + kind + '/' + action;
 const filePath = action => fileBase + kind + '/' + action;

 function image(name, label = '报告图件') {
  if (!/^image\d+\.(?:png|jpe?g)$/i.test(name)) return '';
  const src = esc(filePath('image') + '?name=' + encodeURIComponent(name));
  return `<a href="${src}" target="_blank" rel="noopener" aria-label="查看原图"><img loading="lazy" src="${src}" alt="${esc(label)}"></a>`;
 }

 function renderBlock(block) {
  if (block.type === 'image') return `<figure>${image(block.file)}</figure>`;
  if (block.type === 'caption') return `<p class="rra-caption">${esc(block.text)}</p>`;
  if (block.type === 'table') return `<div class="table-wrap"><table aria-label="报告明细"><tbody>${block.rows.map(row =>
   '<tr>' + row.map(cell => `<td>${(cell.images || []).map(name => image(name,cell.text)).join('')}${esc(cell.text)}</td>`).join('') + '</tr>'
  ).join('')}</tbody></table></div>`;
  return `<div class="rra-paragraph"><p>${esc(block.text)}</p>${kind !== 'assembly' && block.type === 'paragraph'
   ? `<button type="button" class="textbtn" data-rra-edit="${esc(block.id)}">审校此段</button>` : ''}</div>`;
 }

 function paint(message = '', retry = false) {
  const current = sections[chapter];
  const version = doc?.version ? '审校版 · 第 ' + doc.version + ' 版' : '生成稿';
  host.innerHTML = `<div class="rra-reader-bar">
   <nav aria-label="报告类型">${kinds.map(key => `<button type="button" class="small" data-rra-kind="${key}" aria-pressed="${key === kind}">${docKinds[key]}</button>`).join('')}</nav>
   ${doc ? `<span class="tag gray">${version}</span>${doc.version && kind !== 'assembly'
    ? `<a href="${esc(filePath('docx'))}" download>审校 Word</a><a href="${esc(filePath('pdf'))}" download>审校 PDF</a>` : ''}
    <button type="button" class="textbtn" data-rra-read>刷新正文</button>` : ''}
   </div>
   ${message ? `<p class="${retry ? 'error-msg' : 'muted'}" role="status">${esc(message)} ${retry ? '<button class="textbtn" type="button" data-rra-read>重试</button>' : ''}</p>` : ''}
   ${current ? `<label class="rra-chapters"><span>章节</span>
    <select aria-label="报告章节" data-rra-chapter>${sections.map((section,index) =>
     `<option value="${index}" ${chapter === index ? 'selected' : ''}>${esc(section.title)}</option>`).join('')}</select></label>
    <article class="rra-paper"><h3>${esc(current.title)}</h3>${current.blocks.map(renderBlock).join('') || '<p class="muted">本节暂无正文。</p>'}</article>` : ''}`;
 }

 async function load() {
  const ticket = ++sequence;
  doc = undefined;
  sections = [];
  paint('正在读取报告正文…');
  try {
   const result = await request(documentPath('read'));
   if (!host.isConnected || ticket !== sequence) return;
   doc = result;
   sections = chapters(result.blocks);
   chapter = Math.min(chapter, Math.max(0, sections.length - 1));
   paint(sections.length ? '' : '报告里暂无可显示的内容。');
  } catch (error) {
   if (host.isConnected && ticket === sequence) paint(error.message, true);
  }
 }

 function edit(block) {
  const snapshot = {id:block.id, version:doc.version, source:doc.source};
  const savePath = documentPath('save'), suggestionPath = documentPath('suggest');
  modal('段落审校', `<label class="field"><span>段落正文</span><textarea id="rra-edit-text" rows="8" maxlength="16000">${esc(block.text)}</textarea></label>
   <details class="rra-suggestion"><summary>智能审校</summary>
    <label class="field"><span>修改要求</span><textarea id="rra-edit-instruction" rows="2" maxlength="1500" placeholder="例如精简重复表述，保留工程量和待核条件"></textarea></label>
    <button id="rra-edit-suggest" type="button">生成建议</button>
   </details><p id="rra-edit-status" role="status" aria-live="polite"></p>`,
   '<button data-action="close">取消</button><button id="rra-edit-save" type="button" class="primary">保存审校</button>', true);
  const dialog = document.querySelector('#dialog'), text = dialog.querySelector('#rra-edit-text');
  const status = dialog.querySelector('#rra-edit-status'), save = dialog.querySelector('#rra-edit-save');
  const suggest = dialog.querySelector('#rra-edit-suggest'), instruction = dialog.querySelector('#rra-edit-instruction');
  async function send(suggestion) {
   if (!text.value.trim() || (suggestion && !instruction.value.trim())) {
    status.textContent = suggestion ? '请填写正文与修改要求。' : '段落正文不能为空。';
    return;
   }
   text.disabled = save.disabled = suggest.disabled = true;
   status.textContent = suggestion ? '正在生成建议…' : '正在保存…';
   try {
    const payload = {...snapshot, text:text.value};
    if (suggestion) {
     const result = await request(suggestionPath, {...payload, instruction:instruction.value}, {timeout:125000});
     text.value = result.text;
     status.textContent = '建议已填入正文，可继续编辑或保存。';
    } else {
     const result = await request(savePath, payload);
     if (dialog.open && text.isConnected) dialog.close();
     toast('已保存审校 · 第 ' + result.version + ' 版');
     if (host.isConnected) await load();
    }
   } catch (error) {
    status.textContent = error.message;
   } finally {
    text.disabled = save.disabled = suggest.disabled = false;
   }
  }
  save.onclick = () => send(false);
  suggest.onclick = () => send(true);
 }

 host.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.rraKind && button.dataset.rraKind !== kind) {
   kind = button.dataset.rraKind;
   chapter = 0;
   load();
  } else if (button.hasAttribute('data-rra-read')) {
   load();
  } else if (doc && button.dataset.rraEdit !== undefined) {
   const block = doc.blocks.find(block => block.type === 'paragraph' && block.id === button.dataset.rraEdit);
   if (block) edit(block);
  }
 });
 host.addEventListener('change', event => {
  if (!event.target.matches('[data-rra-chapter]')) return;
  chapter = Number(event.target.value);
  paint();
  host.querySelector('[data-rra-chapter]')?.focus();
 });
 return load();
}
