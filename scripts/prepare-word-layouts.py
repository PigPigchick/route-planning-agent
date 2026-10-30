"""Distill the user-selected outgoing consultation DOC reference, never reply PDFs.
The converted Hanjiang reference is retained in the task QA directory. Rebuilding
is a development operation; runtime exports use the shipped content-free DOCX.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
import json
from hashlib import sha256
from lxml import etree as E
from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

ROOT = Path(__file__).resolve().parents[1]
QA = ROOT / 'outputs/征询函版式纠正_2026-10-30/qa'
SOURCE = ROOT / 'outputs/Word函件版式优化_2026-10-29/qa/highway-reference.docx'
DEST = ROOT / 'backend/templates/letter-plain.docx'
ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
doc = Document(SOURCE)
roles = {'title': 1, 'recipient': 3, 'body': 4, 'caption': 3, 'attachment': 3, 'replyAddress': 3, 'signature': 3, 'date': 3, 'contact': 3, 'notice': 3}
patterns = {key: deepcopy(doc.paragraphs[index]._p) for key, index in roles.items()}
for child in list(doc._element.body):
    if child.tag != qn('w:sectPr'):
        doc._element.body.remove(child)
for sec in doc.sections:
    for tag in ['headerReference', 'footerReference']:
        for ref in list(sec._sectPr.findall(qn('w:' + tag))):
            rid = ref.get(qn('r:id')); sec._sectPr.remove(ref)
            if rid in doc.part.rels: doc.part.drop_rel(rid)
for key, element in patterns.items():
    rpr = element.find('w:r/w:rPr', ns)
    for child in list(element):
        if child.tag != qn('w:pPr'):
            element.remove(child)
    run = OxmlElement('w:r')
    if rpr is not None:
        run.append(deepcopy(rpr))
    text = OxmlElement('w:t'); text.text = '{{' + key + '}}'
    run.append(text); element.append(run)
    # Yellow marks belong to historical manual editing, not the reusable form.
    for tag in ['highlight', 'shd']:
        for node in list(element.iter(qn('w:' + tag))):
            node.getparent().remove(node)
    doc._element.body.insert(len(doc._element.body) - 1, element)
for name in ['author', 'last_modified_by', 'title', 'subject', 'comments', 'keywords', 'category']:
    setattr(doc.core_properties, name, '')
settings = doc.settings.element
update = settings.find(qn('w:updateFields'))
if update is None:
    update = OxmlElement('w:updateFields'); settings.append(update)
update.set(qn('w:val'), 'true')
# Header/footer parts and PAGE fields remain those of the selected DOC.
temp = QA / 'consultation-sanitized.docx'; doc.save(temp)
with ZipFile(SOURCE) as original, ZipFile(temp) as src, ZipFile(DEST, 'w', ZIP_DEFLATED) as out:
    for info in src.infolist():
        content = src.read(info.filename)
        if info.filename.startswith(('word/header', 'word/footer')) or info.filename in ['word/styles.xml', 'word/theme/theme1.xml']:
            content = original.read(info.filename)
        if info.filename == 'docProps/custom.xml':
            tree = E.fromstring(content)
            for child in list(tree): tree.remove(child)
            content = E.tostring(tree, encoding='UTF-8', xml_declaration=True, standalone=True)
        if info.filename == 'word/fontTable.xml':
            tree = E.fromstring(content)
            for name, fallback in [('方正小标宋_GBK','Songti SC'), ('仿宋_GB2312', 'STFangsong'), ('仿宋_GB2312;仿宋', 'STFangsong'), ('宋体', 'Songti SC')]:
                nodes = tree.xpath('w:font[@w:name=$name]', namespaces=ns, name=name)
                if not nodes:
                    node = OxmlElement('w:font'); node.set(qn('w:name'), name); tree.append(node); nodes = [node]
                old = nodes[0].find('w:altName', ns)
                if old is not None: nodes[0].remove(old)
                alt = OxmlElement('w:altName'); alt.set(qn('w:val'), fallback); nodes[0].insert(0, alt)
            content = E.tostring(tree, encoding='UTF-8', xml_declaration=True, standalone=True)
        out.writestr(info, content)
print(json.dumps({'template': str(DEST), 'sourceSha256': sha256(SOURCE.read_bytes()).hexdigest()}, ensure_ascii=False))
