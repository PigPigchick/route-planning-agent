import {test} from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveExportPython} from './backend/python-runtime.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
test('征询函普通 Word 版式、九种类型、多档参数、ZIP 和复函原件保留通过五项检查',async()=>{
 const python=await resolveExportPython(root);
 await promisify(execFile)(python,[path.join(root,'backend/test_word_layout.py')],{cwd:root});
});

test('资料清单Word保留全部缺项、失败原因、待同步提示并正确装配表格',async()=>{
 const python=await resolveExportPython(root);
 await promisify(execFile)(python,[path.join(root,'backend/test_materials_word.py')],{cwd:root});
});
