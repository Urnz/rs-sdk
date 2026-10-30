import {expect,test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {inspectPackedFounderBeds,readPackedMapEntry} from '../packed-housing-sites.js';
const root=resolve(import.meta.dir,'../..'),path=join(root,'server/engine/data/pack/.cache/maps-server.zip');
test('actual packed bed inventory binds four distinct existing anchors, source bytes and bridge-adjusted levels',()=>{
    const r=inspectPackedFounderBeds(root);expect(r.proposedBeds).toHaveLength(4);expect(new Set(r.proposedBeds.map(b=>`${b.x}:${b.z}:${b.level}`)).size).toBe(4);
    expect(r.proposedBeds.every(b=>b.level===0)).toBeTrue();expect(r.sources).toHaveLength(3);expect(r.sources.every(s=>/^[a-f0-9]{64}$/.test(s.sha256))).toBeTrue();
});
test('truncated archive, absent entry and traversal names fail closed without extracting files',()=>{
    const zip=readFileSync(path);expect(()=>readPackedMapEntry(zip.subarray(0,-1),'l46_52')).toThrow();
    expect(()=>readPackedMapEntry(zip,'l999_999')).toThrow();expect(()=>readPackedMapEntry(zip,'../l46_52')).toThrow();
});
test('a changed packed entry CRC cannot become a valid physical site proof',()=>{
    const zip=readFileSync(path),name=Buffer.from('l46_52');let position=-1,central=-1;
    while((position=zip.indexOf(name,position+1))>=0)if(position>=46&&zip.readUInt32LE(position-46)===0x02014b50){central=position-46;break;}
    expect(central).toBeGreaterThan(0);zip.writeUInt32LE((zip.readUInt32LE(central+16)^1)>>>0,central+16);
    expect(()=>readPackedMapEntry(zip,'l46_52')).toThrow();
});
