import { cp, mkdir } from 'node:fs/promises';

const destination = new URL('../dist/public/', import.meta.url);
await mkdir(destination, { recursive: true });
await cp(new URL('../public/', import.meta.url), destination, { recursive: true });
