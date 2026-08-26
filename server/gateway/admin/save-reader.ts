import { readFile, stat } from 'node:fs/promises';
import type { AdminItem, AdminSkill, OfflineSaveSnapshot } from './types';

const SAVE_MAGIC = 0x2004;
const MAX_SAVE_VERSION = 7;
const INVENTORY = 93;
const EQUIPMENT = 94;
const BANK = 95;
const COINS = 995;

export const SKILL_NAMES = [
    'Attack', 'Defence', 'Strength', 'Hitpoints', 'Ranged', 'Prayer', 'Magic',
    'Cooking', 'Woodcutting', 'Fletching', 'Fishing', 'Firemaking', 'Crafting',
    'Smithing', 'Mining', 'Herblore', 'Agility', 'Thieving', 'Unused 18',
    'Unused 19', 'Runecraft'
] as const;

const ITEM_NAMES: Record<number, string> = {
    303: 'Small fishing net', 315: 'Shrimps', 317: 'Raw shrimps', 436: 'Copper ore',
    438: 'Tin ore', 526: 'Bones', 590: 'Tinderbox', 841: 'Shortbow', 882: 'Bronze arrow',
    946: 'Knife', 995: 'Coins', 1171: 'Wooden shield', 1205: 'Bronze dagger',
    1265: 'Bronze pickaxe', 1277: 'Bronze sword', 1351: 'Bronze axe', 1511: 'Logs',
    1521: 'Oak logs', 1733: 'Needle', 1734: 'Thread', 1755: 'Chisel', 1925: 'Bucket',
    1931: 'Pot', 2309: 'Bread', 2347: 'Hammer', 2349: 'Bronze bar', 2351: 'Iron bar',
    2353: 'Steel bar', 301: 'Lobster pot', 377: 'Raw lobster'
};

const levelExperience = new Int32Array(99);
let xpAccumulator = 0;
for (let index = 0; index < 99; index++) {
    const level = index + 1;
    xpAccumulator += Math.floor(level + Math.pow(2, level / 10) * 300);
    levelExperience[index] = Math.floor(xpAccumulator / 4) * 10;
}

export function levelForXp(xp: number): number {
    for (let index = 98; index >= 0; index--) {
        if (xp >= (levelExperience[index] ?? 0)) return Math.min(index + 2, 99);
    }
    return 1;
}

export function combatLevel(skills: AdminSkill[]): number {
    const level = (name: string) => skills.find(skill => skill.name === name)?.level ?? 1;
    const base = 0.25 * (level('Defence') + level('Hitpoints') + Math.floor(level('Prayer') / 2));
    const melee = 0.325 * (level('Attack') + level('Strength'));
    const ranged = 0.325 * (Math.floor(level('Ranged') / 2) + level('Ranged'));
    const magic = 0.325 * (Math.floor(level('Magic') / 2) + level('Magic'));
    return Math.floor(base + Math.max(melee, ranged, magic));
}

class SaveReader {
    private offset = 0;

    constructor(private readonly data: Uint8Array) {}

    get position(): number {
        return this.offset;
    }

    set position(value: number) {
        if (value < 0 || value > this.data.length) throw new Error('Save cursor is outside the file');
        this.offset = value;
    }

    private require(bytes: number): void {
        if (this.offset + bytes > this.data.length) throw new Error('Save file ended unexpectedly');
    }

    u8(): number {
        this.require(1);
        return this.data[this.offset++]!;
    }

    u16(): number {
        this.require(2);
        const value = (this.data[this.offset]! << 8) | this.data[this.offset + 1]!;
        this.offset += 2;
        return value;
    }

    i32(): number {
        this.require(4);
        const view = new DataView(this.data.buffer, this.data.byteOffset + this.offset, 4);
        const value = view.getInt32(0, false);
        this.offset += 4;
        return value;
    }

    u64(): bigint {
        this.require(8);
        const view = new DataView(this.data.buffer, this.data.byteOffset + this.offset, 8);
        const value = view.getBigUint64(0, false);
        this.offset += 8;
        return value;
    }

    varInt(): number {
        let byte = this.u8();
        let result = 0;
        while ((byte & 0x80) !== 0) {
            result = (result | (byte & 0x7f)) << 7;
            byte = this.u8();
        }
        return (result | byte) >>> 0;
    }
}

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index++) {
    let crc = index;
    for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    CRC_TABLE[index] = crc >>> 0;
}

function crc32(data: Uint8Array): number {
    let crc = 0xffffffff;
    for (const byte of data) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff]!;
    return (~crc) >>> 0;
}

function itemName(id: number): string {
    return ITEM_NAMES[id] ?? `Item #${id}`;
}

function readInventory(reader: SaveReader, capacity: number): AdminItem[] {
    const items: AdminItem[] = [];
    for (let slot = 0; slot < capacity; slot++) {
        const id = reader.u16() - 1;
        if (id === -1) continue;
        let count = reader.u8();
        if (count === 255) count = reader.i32();
        items.push({ id, name: itemName(id), count, slot });
    }
    return items;
}

export async function readPlayerSave(path: string): Promise<OfflineSaveSnapshot> {
    const fileStat = await stat(path);
    const bytes = new Uint8Array(await readFile(path));
    const savedAt = fileStat.mtime.toISOString();
    try {
        if (bytes.length < 8) throw new Error('Save file is too short');
        const storedCrc = new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 4, 4).getUint32(0, false);
        const actualCrc = crc32(bytes.subarray(0, bytes.length - 4));
        if (storedCrc !== actualCrc) throw new Error('Save checksum is invalid');

        const reader = new SaveReader(bytes);
        if (reader.u16() !== SAVE_MAGIC) throw new Error('Save magic is invalid');
        const version = reader.u16();
        if (version > MAX_SAVE_VERSION) throw new Error(`Unsupported save version ${version}`);

        const position = { x: reader.u16(), z: reader.u16(), level: reader.u8() };
        for (let index = 0; index < 7 + 5; index++) reader.u8();
        reader.u8(); // gender
        reader.u16(); // run energy
        if (version >= 2) reader.i32(); else reader.u16();

        const skills: AdminSkill[] = [];
        for (let index = 0; index < SKILL_NAMES.length; index++) {
            const experience = reader.i32();
            reader.u8(); // current boosted/drained level; the base level is stable for admin reporting
            skills.push({ name: SKILL_NAMES[index]!, level: levelForXp(experience), experience });
        }

        const varpCount = reader.u16();
        if (version >= 7) {
            for (let index = 0; index < varpCount; index++) {
                reader.u16();
                reader.varInt();
            }
        } else {
            for (let index = 0; index < varpCount; index++) reader.i32();
        }

        let inventory: AdminItem[] = [];
        let equipment: AdminItem[] = [];
        let bank: AdminItem[] = [];
        const inventoryCount = reader.u8();
        for (let index = 0; index < inventoryCount; index++) {
            const type = reader.u16();
            const capacity = version >= 5 ? reader.u16() : (type === INVENTORY ? 28 : type === EQUIPMENT ? 14 : 496);
            if (capacity < 0 || capacity > 2048) throw new Error(`Invalid inventory capacity ${capacity}`);
            const items = readInventory(reader, capacity);
            if (type === INVENTORY) inventory = items;
            if (type === EQUIPMENT) equipment = items;
            if (type === BANK) bank = items;
        }

        const enabledSkills = skills.filter((_, index) => index !== 18 && index !== 19);
        const totalLevel = enabledSkills.reduce((sum, skill) => sum + skill.level, 0);
        const totalXp = enabledSkills.reduce((sum, skill) => sum + skill.experience, 0);
        const coins = [...inventory, ...bank].filter(item => item.id === COINS)
            .reduce((sum, item) => sum + item.count, 0);

        return {
            valid: true,
            version,
            savedAt,
            position,
            skills: enabledSkills,
            totalLevel,
            totalXp,
            combatLevel: combatLevel(skills),
            inventory,
            equipment,
            bank,
            coins
        };
    } catch (error) {
        return {
            valid: false,
            version: 0,
            savedAt,
            position: { x: 0, z: 0, level: 0 },
            skills: [],
            totalLevel: 0,
            totalXp: 0,
            combatLevel: 0,
            inventory: [],
            equipment: [],
            bank: [],
            coins: 0,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}
