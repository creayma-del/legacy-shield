import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const filePath = resolve('dist/lib/inject.iife.js');
const content = readFileSync(filePath, 'utf8');
writeFileSync(filePath, content.replace(/\nexport \{\};\n/g, '\n'), 'utf8');
