import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
const check=(v:unknown)=>{if(!v)throw Error('Packed housing site evidence is invalid');};
const sha=(v:Uint8Array)=>createHash('sha256').update(v).digest('hex');

/** Bounded read of one actual packed ZIP entry. No extraction, World startup or new dependency. */
export function readPackedMapEntry(zip:Buffer,name:string){
    check(zip.length<=64*1024*1024&&/^[lm]\d+_\d+$/.test(name));let end=-1;
    for(let n=zip.length-22;n>=Math.max(0,zip.length-65557);n--)if(zip.readUInt32LE(n)===0x06054b50&&n+22+zip.readUInt16LE(n+20)===zip.length){end=n;break;}
    check(end>=0);check(zip.readUInt16LE(end+4)===0&&zip.readUInt16LE(end+6)===0);
    const count=zip.readUInt16LE(end+10);check(count<=10000&&zip.readUInt16LE(end+8)===count);
    let at=zip.readUInt32LE(end+16);const centralEnd=at+zip.readUInt32LE(end+12);check(centralEnd===end);
    let found:Buffer|null=null;
    for(let n=0;n<count;n++){
        check(at+46<=centralEnd&&zip.readUInt32LE(at)===0x02014b50);
        const flags=zip.readUInt16LE(at+8),method=zip.readUInt16LE(at+10),crc=zip.readUInt32LE(at+16),compressed=zip.readUInt32LE(at+20),size=zip.readUInt32LE(at+24),
            length=zip.readUInt16LE(at+28),extra=zip.readUInt16LE(at+30),comment=zip.readUInt16LE(at+32),local=zip.readUInt32LE(at+42);
        check(at+46+length+extra+comment<=centralEnd);
        if(zip.subarray(at+46,at+46+length).toString('utf8')===name){
            check(!found&&!(flags&1)&&[0,8].includes(method)&&size<=1024*1024&&compressed<=1024*1024&&local+30<at);
            check(zip.readUInt32LE(local)===0x04034b50&&zip.readUInt16LE(local+8)===method);
            const offset=local+30+zip.readUInt16LE(local+26)+zip.readUInt16LE(local+28);check(offset+compressed<=at);
            const raw=zip.subarray(offset,offset+compressed),value=method===8?inflateRawSync(raw,{maxOutputLength:1024*1024}):raw;
            check(value.length===size);let actual=0xffffffff;
            for(const byte of value){actual^=byte;for(let bit=0;bit<8;bit++)actual=actual&1?(actual>>>1)^0xedb88320:actual>>>1;}
            check(((actual^0xffffffff)>>>0)===crc);found=Buffer.from(value);
        }
        at+=46+length+extra+comment;
    }
    check(at===centralEnd&&found);return found!;
}

/** Reopen actual packed location and land flags, including bridge-level adjustment.
 * This proves existing bed anchors, not routes, ownership, sleep or run acceptance. */
export function inspectPackedFounderBeds(root:string){
    const pack=join(root,'server/engine/data/pack'),data=readFileSync(join(pack,'server/loc.dat')),index=readFileSync(join(pack,'server/loc.idx')),
        zip=readFileSync(join(pack,'.cache/maps-server.zip')),count=index.readUInt16BE(0),needle=Buffer.from('\xfabrownbed\n\0','latin1');
    check(index.length===2+count*2&&data.readUInt16BE(0)===count);let offset=2;const ids:number[]=[];
    for(let id=0;id<count;id++){const size=index.readUInt16BE(2+id*2);check(offset+size<=data.length);if(data.subarray(offset,offset+size).includes(needle))ids.push(id);offset+=size;}
    check(offset===data.length&&ids.length===1);
    const locations=readPackedMapEntry(zip,'l46_52'),land=readPackedMapEntry(zip,'m46_52'),flags=new Uint8Array(4*4096);
    let cursor=0;
    for(let level=0;level<4;level++)for(let x=0;x<64;x++)for(let z=0;z<64;z++)for(;;){
        check(cursor<land.length);const opcode=land[cursor++]!;if(opcode===0)break;if(opcode===1){check(cursor<land.length);cursor++;break;}
        if(opcode<=49){check(cursor<land.length);cursor++;}else if(opcode<=81)flags[level*4096+x*64+z]=opcode-49;
    }
    check(cursor===land.length);cursor=0;
    const smart=()=>{check(cursor<locations.length);const first=locations[cursor++]!;if(first<128)return first;check(cursor<locations.length);return(first*256+locations[cursor++]!)-32768;};
    let type=-1;const beds:Array<{x:number;z:number;level:number}>=[];
    for(;;){const delta=smart();if(!delta)break;type+=delta;check(type<count);let coordinate=0;
        for(;;){const delta=smart();if(!delta)break;coordinate+=delta-1;check(coordinate>=0&&coordinate<16384&&cursor<locations.length);cursor++;
            const x=coordinate>>6&63,z=coordinate&63,rawLevel=coordinate>>12&3,level=rawLevel-((flags[4096+x*64+z]!&2)?1:0);
            if(type===ids[0]&&level>=0)beds.push({x:46*64+x,z:52*64+z,level});
        }
    }
    check(cursor===locations.length);
    const proposed=[{x:2973,z:3328,level:0},{x:2973,z:3330,level:0},{x:2973,z:3332,level:0},{x:2977,z:3332,level:0}];
    check(proposed.every(p=>beds.some(b=>b.x===p.x&&b.z===p.z&&b.level===p.level)));
    return{protocol:'si-c07-packed-bed-sites-v1',debugName:'brownbed',typeId:ids[0]!,map:'46_52',
        proposedBeds:proposed.map((p,n)=>({bedSlotId:`falador.south-house.bed-${n+1}`,...p})),
        sources:[['server/loc.dat',data],['server/loc.idx',index],['.cache/maps-server.zip',zip]].map(([path,bytes])=>({path:`server/engine/data/pack/${path}`,sha256:sha(bytes as Buffer)})),
        evidenceScope:'Actual packed anchors and bridge-adjusted levels only; no spawn, route, title or live capacity grant.'};
}
