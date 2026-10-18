import { rm, mkdir, cp, readFile, writeFile, readdir } from 'node:fs/promises';
import { stampSitemap, buildDate } from './sitemap.mjs';
import { stripFullLineComments } from './strip-comments.mjs';
const root=new URL('../',import.meta.url),dist=new URL('dist/',root);
await rm(dist,{recursive:true,force:true});
await mkdir(dist,{recursive:true});
for(const path of ['index.html','favicon.svg','donation-qr.svg','og.jpg','robots.txt','sitemap.xml','src','visual-upgrade'])await cp(new URL(path,root),new URL(path,dist),{recursive:true});
// Stamp the deployed sitemap with the build date (v1.257) — see sitemap.mjs.
const sitemapUrl=new URL('sitemap.xml',dist);
await writeFile(sitemapUrl,stampSitemap(await readFile(sitemapUrl,'utf8'),buildDate()));
// Strip full-line // comments from the DEPLOYED JavaScript only (v1.257):
// the source keeps its documentation; a browser gains nothing from
// downloading it (about half of domain.js's gzipped wire size). Same line
// count, same code — see strip-comments.mjs and tests/comment-strip.test.mjs.
const distSrc=new URL('src/',dist);
let savedBytes=0;
for(const file of await readdir(distSrc)){
  if(!file.endsWith('.js'))continue;
  const url=new URL(file,distSrc);
  const source=await readFile(url,'utf8');
  const {code}=stripFullLineComments(source);
  savedBytes+=Buffer.byteLength(source)-Buffer.byteLength(code);
  await writeFile(url,code);
}
console.log(`PRISM built to dist/. Static assets only; no keys or backend secrets. Deployed JS is ${savedBytes} bytes lighter (full-line comments stripped from the deployed copy; source unchanged).`);
