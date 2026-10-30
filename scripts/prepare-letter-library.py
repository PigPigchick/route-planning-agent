"""Inventory and extract user-provided reference letters locally; never call a model."""
from pathlib import Path
import sys,json,re,hashlib,zipfile,subprocess,os
from collections import Counter

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'outputs/函件资料入库_2026-10-31'
LOCAL=ROOT/'.local-data/letter-library-2026-10-31'
OUT.mkdir(parents=True,exist_ok=True);(LOCAL/'originals').mkdir(parents=True,exist_ok=True)
sources=[Path(p) for p in sys.argv[1:]]
supported={'.pdf','.doc','.docx','.jpg','.jpeg','.png'}
records=[];ignored=[];hashes={}
previous={r['sha256']:r for r in json.loads((LOCAL/'extracted.json').read_text())} if (LOCAL/'extracted.json').exists() else {}

def classify(name,source):
    if name.startswith(('~$','.')) or '__MACOSX' in source:return None
    if re.search(r'路径盖章图|线路盖章图',name):return 'support'
    if re.search(r'路径图|走向.*图|平断面|转角坐标|坐标表|杆塔明细|核查结果|保护区.*图|红线.*图',name):return None
    incoming='/复函/' in source or re.search(r'复函|回复|反馈意见',name)
    if incoming:return 'incoming'
    if '函' in name and re.match(r'附件\s*\d',name):return 'support'
    if re.search(r'函|请示',name):return 'outgoing'
    return None

def add(data,name,source):
    ext=Path(name).suffix.lower();direction=classify(name,source)
    if ext not in supported or not direction:
        ignored.append({'source':source,'reason':'非函件正文或辅助附件'});return
    if len(data)>20*1024*1024:
        ignored.append({'source':source,'reason':'文件超过20MB，待单独核对'});return
    sha=hashlib.sha256(data).hexdigest()
    if sha in hashes:hashes[sha]['sources'].append(source);return
    path=LOCAL/'originals'/(sha[:24]+ext);path.write_bytes(data);os.chmod(path,0o600)
    record={'source':source,'sources':[source],'name':name,'path':str(path),'sha256':sha,'direction':direction}
    records.append(record);hashes[sha]=record

for root in sources:
    for file in sorted(root.rglob('*')):
        if not file.is_file() or file.name.startswith(('.','~$')):continue
        source=root.name+'/'+str(file.relative_to(root))
        if file.suffix.lower()=='.zip':
            with zipfile.ZipFile(file) as z:
                for info in z.infolist():
                    if info.is_dir():continue
                    name=info.filename
                    if not info.flag_bits&0x800:
                        try:name=name.encode('cp437').decode('gb18030')
                        except (UnicodeError,LookupError):pass
                    if info.file_size>20*1024*1024:continue
                    if Path(name).suffix.lower() in supported:add(z.read(info),Path(name).name,source+'!/'+name)
        else:add(file.read_bytes(),file.name,source)

ocr=ROOT/'.tools/ocr-letter'
def letter_type(record):
    s=record['source']
    for pattern,kind in [(r'民航|机场|航空','aviation'),(r'压覆|压矿|矿产|矿区','mineral'),(r'军分区|军区|部队|火箭军|舰队','military'),(r'地震','seismic'),(r'铁路|铁投','railway'),(r'高速|公路|S12','highway'),(r'河道|航道|水利|水务|韩江|梅潭河|小金河','water'),(r'接地极','grounding')]:
        if re.search(pattern,s):return kind
    return 'general'

for i,record in enumerate(records):
    path=Path(record['path']);text='';method='text';error=''
    old=previous.get(record['sha256'],{})
    if old.get('text') and not old.get('error') and len(re.findall(r'[\u4e00-\u9fff]',old['text']))>=70:
        record.update({k:old[k] for k in ['text','method','error','characters','ocrConfidence'] if k in old})
        record['type']=letter_type(record)
        continue
    try:
        if path.suffix in ['.jpg','.jpeg','.png']:raise ValueError('image needs OCR')
        r=subprocess.run([sys.executable,str(ROOT/'backend/knowledge_extract.py'),str(path)],capture_output=True,text=True,timeout=50)
        if r.returncode:raise ValueError(r.stderr.splitlines()[-1] if r.stderr else '解析失败')
        text=json.loads(r.stdout)['text']
    except Exception as e:error=str(e)
    if len(re.findall(r'[\u4e00-\u9fff]',text))<70 and path.suffix in ['.pdf','.jpg','.jpeg','.png']:
        try:
            r=subprocess.run([str(ocr),str(path)],capture_output=True,text=True,timeout=160)
            if r.returncode:raise ValueError(r.stderr[:250])
            data=json.loads(r.stdout);text=data['text'];record['ocrConfidence']=data.get('confidence',[]);method='ocr';error=''
        except Exception as e:error=str(e)
    record.update({'text':text,'type':letter_type(record),'method':method,'error':error if len(re.findall(r'[\u4e00-\u9fff]',text))<30 else '', 'characters':len(text)})
    if len(re.findall(r'[\u4e00-\u9fff]',text))<30:record['error']=record['error'] or '未识别到足够正文，待补充清晰原件'
    if '�' in text:record['error']='提取文字含替代字符，待核对编码'
    print(json.dumps({'progress':i+1,'total':len(records),'direction':record['direction'],'method':method,'characters':len(text),'error':record['error']},ensure_ascii=False),flush=True)
    (LOCAL/'extracted.json').write_text(json.dumps(records,ensure_ascii=False,indent=2))

(LOCAL/'extracted.json').write_text(json.dumps(records,ensure_ascii=False,indent=2))
summary={'sourceFiles':sum(len(r['sources']) for r in records),'uniqueLetters':len(records),'directions':dict(Counter(r['direction'] for r in records)),'readable':sum(not r['error'] for r in records),'ocr':sum(r['method']=='ocr' for r in records),'errors':[{'source':r['source'],'reason':r['error']} for r in records if r['error']],'ignored':len(ignored)}
(OUT/'本机资料提取汇总.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
(OUT/'函件文件清单.json').write_text(json.dumps([{k:v for k,v in r.items() if k not in ['text']} for r in records],ensure_ascii=False,indent=2))
(LOCAL/'ignored.json').write_text(json.dumps(ignored,ensure_ascii=False,indent=2))
print('SUMMARY '+json.dumps(summary,ensure_ascii=False),flush=True)
