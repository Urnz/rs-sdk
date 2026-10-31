import {expect,test} from 'bun:test';
import CollisionMap from '#/dash3d/CollisionMap.js';
import Packet from '#/io/Packet.js';
import {ClientProt} from '#/io/ClientProt.js';
import type {LiteClient} from './LiteClient.js';
import {findPathToTile,tryMoveTo} from './movement.js';

function client(){return{localPlayer:{routeX:new Int32Array([50]),routeZ:new Int32Array([50])},minusedlevel:0,
    collision:[new CollisionMap()],ensureCollision:()=>{},mapBuildBaseX:3200,mapBuildBaseZ:3200,out:Packet.alloc(1)} as unknown as LiteClient;}

test('a game click on the current tile emits the native single-tile stop path',()=>{
    const c=client();expect(findPathToTile(c,50,50,true)).toBeTrue();
    const length=c.out.pos;c.out.pos=0;
    expect(c.out.g1()).toBe(ClientProt.MOVE_GAMECLICK);expect(c.out.g1()).toBe(5);expect(c.out.g1()).toBe(1);
    expect(c.out.g2()).toBe(3250);expect(c.out.g2()).toBe(3250);expect(c.out.pos).toBe(length);
});
test('already-in-range interactions remain packet-free and ordinary walks retain their target',()=>{
    const c=client();expect(tryMoveTo(c,50,50,0,0,0,0,0)).toBeTrue();expect(c.out.pos).toBe(0);
    expect(findPathToTile(c,51,50,false)).toBeTrue();const length=c.out.pos;c.out.pos=0;
    expect(c.out.g1()).toBe(ClientProt.MOVE_GAMECLICK);expect(c.out.g1()).toBe(5);expect(c.out.g1()).toBe(0);
    expect(c.out.g2()).toBe(3251);expect(c.out.g2()).toBe(3250);expect(c.out.pos).toBe(length);
});
