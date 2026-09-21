import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { assessUnknownRegister, type UnknownRegister } from '../src/theta/pre-vps-unknown-register.js';

const path = fileURLToPath(new URL('../docs/operations/THETA_UNKNOWN_REGISTER_PRE_VPS.json', import.meta.url));
const register = JSON.parse(await readFile(path, 'utf8')) as UnknownRegister;
const result = assessUnknownRegister(register);
console.log(JSON.stringify(result));
if (!result.preVpsReady) process.exitCode = 1;
