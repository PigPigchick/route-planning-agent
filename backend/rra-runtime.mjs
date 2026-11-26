import {stat} from 'node:fs/promises';
import path from 'node:path';

export async function findRraRuntime(root) {
 const base = path.join(root, 'services', 'rra');
 for (const folder of [path.join(base, 'runtime'), base]) {
  const module = path.join(folder, 'road_description', 'service.py');
  if (await stat(module).then(info => info.isFile(), error => {
   if (error.code === 'ENOENT') return false;
   throw error;
  })) return folder;
 }
 return null;
}
