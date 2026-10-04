import { rm, mkdir, cp } from 'node:fs/promises';
const root=new URL('../',import.meta.url),dist=new URL('dist/',root);
await rm(dist,{recursive:true,force:true});
await mkdir(dist,{recursive:true});
for(const path of ['index.html','favicon.svg','donation-qr.svg','og.png','src'])await cp(new URL(path,root),new URL(path,dist),{recursive:true});
console.log('PRISM built to dist/. Static assets only; no keys or backend secrets.');
