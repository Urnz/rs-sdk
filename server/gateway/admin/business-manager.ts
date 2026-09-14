import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

export type BusinessStatus = 'active' | 'dormant' | 'closed';
export type EmploymentRole = 'manager' | 'worker';
export type EmploymentStatus = 'active' | 'ended';
export type BusinessPolicyMode = 'balanced' | 'growth' | 'profit' | 'survival';
export type BusinessPolicyStatus = 'pending' | 'approved' | 'rejected' | 'superseded';

export interface BusinessPolicyProposal {
    proposalId: string;
    businessId: string;
    proposerAgentId: string;
    objective: string;
    mode: BusinessPolicyMode;
    maxRewardGp: number;
    preferredSkills: Array<{ id: string; version: string }>;
    status: BusinessPolicyStatus;
    responseNote: string;
    revision: number;
    createdAt: string;
    resolvedAt: string | null;
    updatedAt: string;
}

export interface BusinessEmployment {
    employmentId: string;
    businessId: string;
    workerAgentId: string;
    role: EmploymentRole;
    title: string;
    wageGp: number;
    requiredSkill: { id: string; version: string } | null;
    status: EmploymentStatus;
    revision: number;
    startedAt: string;
    endedAt: string | null;
    updatedAt: string;
}

export interface Business {
    businessId: string;
    name: string;
    summary: string;
    ownerAgentId: string;
    propertyId: string | null;
    status: BusinessStatus;
    revision: number;
    employments: BusinessEmployment[];
    activePolicy: BusinessPolicyProposal | null;
    policyProposals: BusinessPolicyProposal[];
    createdAt: string;
    updatedAt: string;
}

export interface CreateBusiness {
    businessId: string;
    name: string;
    summary: string;
    ownerAgentId: string;
    propertyId?: string | null;
}

export interface BusinessGenesisReceipt { allocationId: string; businessId: string; ownerAgentId: string;
    propertyId: string | null; status: 'active' | 'reset'; createdAt: string; resetAt: string | null }
export interface BusinessInventoryEntry { businessId: string; itemId: number; count: number; revision: number;
    updatedAt: string }

export interface UpdateBusiness {
    name: string;
    summary: string;
    propertyId?: string | null;
    status: BusinessStatus;
}

export interface CreateEmployment {
    workerAgentId: string;
    role: EmploymentRole;
    title: string;
    wageGp: number;
    requiredSkill?: { id: string; version: string } | null;
}

export interface CreateBusinessPolicyProposal {
    proposalId: string;
    proposerAgentId: string;
    objective: string;
    mode: BusinessPolicyMode;
    maxRewardGp: number;
    preferredSkills?: Array<{ id: string; version: string }>;
}

interface BusinessRow {
    business_id: string;
    name: string;
    summary: string;
    owner_agent_id: string;
    property_id: string | null;
    status: BusinessStatus;
    revision: number;
    created_at: string;
    updated_at: string;
}

interface EmploymentRow {
    employment_id: string;
    business_id: string;
    worker_agent_id: string;
    role: EmploymentRole;
    title: string;
    wage_gp: number;
    required_skill_id: string | null;
    required_skill_version: string | null;
    status: EmploymentStatus;
    revision: number;
    started_at: string;
    ended_at: string | null;
    updated_at: string;
}

interface PolicyRow {
    proposal_id: string;
    business_id: string;
    proposer_agent_id: string;
    objective: string;
    mode: BusinessPolicyMode;
    max_reward_gp: number;
    preferred_skills_json: string;
    status: BusinessPolicyStatus;
    response_note: string;
    revision: number;
    created_at: string;
    resolved_at: string | null;
    updated_at: string;
}

function stableId(value: string, field: string): string {
    const normalized = value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(normalized)) throw new Error(`${field} is invalid`);
    return normalized;
}

function boundedText(value: string, field: string, maximum: number): string {
    const normalized = value.trim().replace(/\s+/g, ' ');
    if (!normalized || normalized.length > maximum) throw new Error(`${field} is invalid`);
    return normalized;
}

function timestamp(value: string, field: string): string {
    if (!Number.isFinite(Date.parse(value))) throw new Error(`${field} is invalid`);
    return value;
}

function exactSkillId(value: string): string {
    const normalized = boundedText(value, 'requiredSkill.id', 120);
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(normalized)) throw new Error('requiredSkill.id is invalid');
    return normalized;
}

function skillReference(value: CreateEmployment['requiredSkill']): { id: string; version: string } | null {
    if (!value) return null;
    const id = exactSkillId(value.id);
    const version = boundedText(value.version, 'requiredSkill.version', 32);
    if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(version)) {
        throw new Error('requiredSkill.version is invalid');
    }
    return { id, version };
}

function employment(row: EmploymentRow): BusinessEmployment {
    return {
        employmentId: row.employment_id,
        businessId: row.business_id,
        workerAgentId: row.worker_agent_id,
        role: row.role,
        title: row.title,
        wageGp: row.wage_gp,
        requiredSkill: row.required_skill_id && row.required_skill_version
            ? { id: row.required_skill_id, version: row.required_skill_version }
            : null,
        status: row.status,
        revision: row.revision,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        updatedAt: row.updated_at
    };
}

function policy(row: PolicyRow): BusinessPolicyProposal {
    return {
        proposalId: row.proposal_id,
        businessId: row.business_id,
        proposerAgentId: row.proposer_agent_id,
        objective: row.objective,
        mode: row.mode,
        maxRewardGp: row.max_reward_gp,
        preferredSkills: JSON.parse(row.preferred_skills_json) as Array<{ id: string; version: string }>,
        status: row.status,
        responseNote: row.response_note,
        revision: row.revision,
        createdAt: row.created_at,
        resolvedAt: row.resolved_at,
        updatedAt: row.updated_at
    };
}

export class BusinessManagerStore {
    private readonly database: Database;

    constructor(path: string) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        this.database.run('PRAGMA foreign_keys = ON');
        this.database.run(`CREATE TABLE IF NOT EXISTS business (
            business_id TEXT PRIMARY KEY, name TEXT NOT NULL, summary TEXT NOT NULL,
            owner_agent_id TEXT NOT NULL, property_id TEXT, status TEXT NOT NULL
            CHECK (status IN ('active', 'dormant', 'closed')), revision INTEGER NOT NULL CHECK (revision >= 1),
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
        this.database.run(`CREATE TABLE IF NOT EXISTS business_employment (
            employment_id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES business(business_id),
            worker_agent_id TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('manager', 'worker')),
            title TEXT NOT NULL, wage_gp INTEGER NOT NULL CHECK (wage_gp >= 0),
            required_skill_id TEXT, required_skill_version TEXT,
            status TEXT NOT NULL CHECK (status IN ('active', 'ended')),
            revision INTEGER NOT NULL CHECK (revision >= 1), started_at TEXT NOT NULL,
            ended_at TEXT, updated_at TEXT NOT NULL,
            CHECK ((required_skill_id IS NULL) = (required_skill_version IS NULL)))`);
        this.database.run(`CREATE UNIQUE INDEX IF NOT EXISTS business_active_worker
            ON business_employment(business_id, worker_agent_id) WHERE status = 'active'`);
        this.database.run(`CREATE TABLE IF NOT EXISTS business_policy_proposal (
            proposal_id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES business(business_id),
            proposer_agent_id TEXT NOT NULL, objective TEXT NOT NULL,
            mode TEXT NOT NULL CHECK (mode IN ('balanced', 'growth', 'profit', 'survival')),
            max_reward_gp INTEGER NOT NULL CHECK (max_reward_gp >= 0), preferred_skills_json TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'superseded')),
            response_note TEXT NOT NULL, revision INTEGER NOT NULL CHECK (revision >= 1),
            created_at TEXT NOT NULL, resolved_at TEXT, updated_at TEXT NOT NULL)`);
        this.database.run(`CREATE UNIQUE INDEX IF NOT EXISTS business_active_policy
            ON business_policy_proposal(business_id) WHERE status = 'approved'`);
        this.database.run(`CREATE TABLE IF NOT EXISTS business_genesis_creation (
            allocation_id TEXT PRIMARY KEY,business_id TEXT NOT NULL UNIQUE,owner_agent_id TEXT NOT NULL,
            property_id TEXT,status TEXT NOT NULL CHECK(status IN ('active','reset')),
            created_at TEXT NOT NULL,reset_at TEXT)`);
        this.database.run(`CREATE TABLE IF NOT EXISTS business_inventory (
            business_id TEXT NOT NULL REFERENCES business(business_id),item_id INTEGER NOT NULL,
            count INTEGER NOT NULL CHECK(count>=0),revision INTEGER NOT NULL CHECK(revision>=1),
            updated_at TEXT NOT NULL,PRIMARY KEY(business_id,item_id))`);
        this.database.run(`CREATE TABLE IF NOT EXISTS business_genesis_inventory (
            allocation_id TEXT PRIMARY KEY,business_id TEXT NOT NULL,item_id INTEGER NOT NULL,count INTEGER NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('active','reset')),created_at TEXT NOT NULL,reset_at TEXT)`);
    }

    close(): void { this.database.close(true); }

    list(limit = 100): Business[] {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('Business list limit is invalid');
        return (this.database.query(`SELECT * FROM business ORDER BY created_at DESC, business_id LIMIT ?1`)
            .all(limit) as BusinessRow[]).map(row => this.toBusiness(row));
    }

    get(businessIdInput: string): Business | null {
        const businessId = stableId(businessIdInput, 'businessId');
        const row = this.database.query('SELECT * FROM business WHERE business_id = ?1')
            .get(businessId) as BusinessRow | null;
        return row ? this.toBusiness(row) : null;
    }

    create(input: CreateBusiness, now = new Date().toISOString()): Business {
        const businessId = stableId(input.businessId, 'businessId');
        const name = boundedText(input.name, 'name', 120);
        const summary = boundedText(input.summary, 'summary', 320);
        const ownerAgentId = stableId(input.ownerAgentId, 'ownerAgentId');
        const propertyId = input.propertyId ? stableId(input.propertyId, 'propertyId') : null;
        const createdAt = timestamp(now, 'now');
        try {
            this.database.run(`INSERT INTO business (business_id, name, summary, owner_agent_id,
                property_id, status, revision, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, 'active', 1, ?6, ?6)`,
            [businessId, name, summary, ownerAgentId, propertyId, createdAt]);
        } catch (error) {
            if (String(error).includes('UNIQUE constraint failed')) throw new Error('Business id already exists');
            throw error;
        }
        return this.get(businessId)!;
    }

    createGenesis(allocationIdInput: string, input: CreateBusiness,
        now = new Date().toISOString()): BusinessGenesisReceipt {
        const allocationId = stableId(allocationIdInput, 'allocationId'), businessId = stableId(input.businessId, 'businessId');
        const ownerAgentId = stableId(input.ownerAgentId, 'ownerAgentId');
        const propertyId = input.propertyId ? stableId(input.propertyId, 'propertyId') : null;
        const existing = this.database.query('SELECT * FROM business_genesis_creation WHERE allocation_id=?1')
            .get(allocationId) as { allocation_id:string;business_id:string;owner_agent_id:string;property_id:string|null;
                status:'active'|'reset';created_at:string;reset_at:string|null } | null;
        if (existing) {
            if (existing.business_id !== businessId || existing.owner_agent_id !== ownerAgentId
                || existing.property_id !== propertyId) throw new Error('Genesis business allocation id was reused');
            return { allocationId, businessId, ownerAgentId, propertyId, status: existing.status,
                createdAt: existing.created_at, resetAt: existing.reset_at };
        }
        const name = boundedText(input.name, 'name', 120), summary = boundedText(input.summary, 'summary', 320);
        const transaction = this.database.transaction(() => {
            this.database.run(`INSERT INTO business (business_id,name,summary,owner_agent_id,property_id,status,
                revision,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,'active',1,?6,?6)`,
            [businessId, name, summary, ownerAgentId, propertyId, now]);
            this.database.run(`INSERT INTO business_genesis_creation
                VALUES(?1,?2,?3,?4,'active',?5,NULL)`, [allocationId,businessId,ownerAgentId,propertyId,now]);
        });
        transaction.immediate();
        return { allocationId,businessId,ownerAgentId,propertyId,status:'active',createdAt:now,resetAt:null };
    }

    resetGenesisBusiness(allocationIdInput: string, now = new Date().toISOString()): BusinessGenesisReceipt | null {
        const allocationId = stableId(allocationIdInput, 'allocationId');
        const row = this.database.query('SELECT * FROM business_genesis_creation WHERE allocation_id=?1')
            .get(allocationId) as { allocation_id:string;business_id:string;owner_agent_id:string;property_id:string|null;
                status:'active'|'reset';created_at:string;reset_at:string|null } | null;
        if (!row) return null;
        if (row.status === 'reset') return { allocationId,businessId:row.business_id,ownerAgentId:row.owner_agent_id,
            propertyId:row.property_id,status:'reset',createdAt:row.created_at,resetAt:row.reset_at };
        const business = this.get(row.business_id);
        if (!business || business.revision !== 1 || business.employments.length || business.policyProposals.length) {
            throw new Error('Genesis business changed after creation and cannot be reset automatically');
        }
        const inventory = this.listInventory(row.business_id);
        if (inventory.some(item => item.count > 0)) throw new Error('Genesis business inventory must be reset first');
        const transaction = this.database.transaction(() => {
            this.database.run('DELETE FROM business_inventory WHERE business_id=?1', [row.business_id]);
            const removed = this.database.run('DELETE FROM business WHERE business_id=?1 AND revision=1', [row.business_id]);
            if (removed.changes !== 1) throw new Error('Genesis business changed before reset');
            this.database.run(`UPDATE business_genesis_creation SET status='reset',reset_at=?2
                WHERE allocation_id=?1 AND status='active'`, [allocationId,now]);
        }); transaction.immediate();
        return { allocationId,businessId:row.business_id,ownerAgentId:row.owner_agent_id,propertyId:row.property_id,
            status:'reset',createdAt:row.created_at,resetAt:now };
    }

    listInventory(businessIdInput: string): BusinessInventoryEntry[] {
        const businessId = stableId(businessIdInput, 'businessId');
        return (this.database.query(`SELECT * FROM business_inventory WHERE business_id=?1 ORDER BY item_id`)
            .all(businessId) as Array<{business_id:string;item_id:number;count:number;revision:number;updated_at:string}>)
            .map(row => ({ businessId:row.business_id,itemId:row.item_id,count:row.count,
                revision:row.revision,updatedAt:row.updated_at }));
    }

    creditGenesisInventory(allocationIdInput:string,businessIdInput:string,itemId:number,count:number,
        now=new Date().toISOString()):BusinessInventoryEntry {
        const allocationId=stableId(allocationIdInput,'allocationId'),businessId=stableId(businessIdInput,'businessId');
        if(!this.get(businessId))throw new Error('Genesis inventory business does not exist');
        if(!Number.isSafeInteger(itemId)||itemId<0||itemId>65534||!Number.isSafeInteger(count)||count<1||count>2147483647)
            throw new Error('Genesis business inventory amount is invalid');
        const existing=this.database.query('SELECT * FROM business_genesis_inventory WHERE allocation_id=?1').get(allocationId) as
            {business_id:string;item_id:number;count:number;status:'active'|'reset'}|null;
        if(existing){if(existing.business_id!==businessId||existing.item_id!==itemId||existing.count!==count)
            throw new Error('Genesis inventory allocation id was reused');
            const current=this.listInventory(businessId).find(item=>item.itemId===itemId);
            if(existing.status==='active'&&current)return current;throw new Error('Genesis inventory allocation was already reset')}
        const transaction=this.database.transaction(()=>{
            this.database.run(`INSERT INTO business_inventory VALUES(?1,?2,?3,1,?4)
                ON CONFLICT(business_id,item_id) DO UPDATE SET count=count+excluded.count,
                revision=revision+1,updated_at=excluded.updated_at`,[businessId,itemId,count,now]);
            this.database.run(`INSERT INTO business_genesis_inventory VALUES(?1,?2,?3,?4,'active',?5,NULL)`,
                [allocationId,businessId,itemId,count,now]);
        });transaction.immediate();
        return this.listInventory(businessId).find(item=>item.itemId===itemId)!;
    }

    resetGenesisInventory(allocationIdInput:string,now=new Date().toISOString()):BusinessInventoryEntry|null {
        const allocationId=stableId(allocationIdInput,'allocationId');
        const row=this.database.query('SELECT * FROM business_genesis_inventory WHERE allocation_id=?1').get(allocationId) as
            {business_id:string;item_id:number;count:number;status:'active'|'reset'}|null;
        if(!row)return null;
        const current=this.listInventory(row.business_id).find(item=>item.itemId===row.item_id)??null;
        if(row.status==='reset')return current;
        if(!current||current.count<row.count)throw new Error('Genesis business inventory was consumed and cannot be reset');
        const transaction=this.database.transaction(()=>{
            this.database.run(`UPDATE business_inventory SET count=count-?3,revision=revision+1,updated_at=?4
                WHERE business_id=?1 AND item_id=?2 AND count>=?3`,[row.business_id,row.item_id,row.count,now]);
            this.database.run(`UPDATE business_genesis_inventory SET status='reset',reset_at=?2
                WHERE allocation_id=?1 AND status='active'`,[allocationId,now]);
        });transaction.immediate();
        return this.listInventory(row.business_id).find(item=>item.itemId===row.item_id)??null;
    }

    update(businessIdInput: string, expectedRevision: number, input: UpdateBusiness,
        now = new Date().toISOString()): Business {
        const businessId = stableId(businessIdInput, 'businessId');
        const current = this.get(businessId);
        if (!current) throw new Error('Business does not exist');
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
            throw new Error('Business revision is invalid');
        }
        const name = boundedText(input.name, 'name', 120);
        const summary = boundedText(input.summary, 'summary', 320);
        const propertyId = input.propertyId ? stableId(input.propertyId, 'propertyId') : null;
        if (!['active', 'dormant', 'closed'].includes(input.status)) throw new Error('Business status is invalid');
        if (current.status === 'closed') throw new Error('Closed business is read-only');
        const updatedAt = timestamp(now, 'now');
        const transaction = this.database.transaction(() => {
            const result = this.database.run(`UPDATE business SET name = ?3, summary = ?4, property_id = ?5,
                status = ?6, revision = revision + 1, updated_at = ?7
                WHERE business_id = ?1 AND revision = ?2`,
            [businessId, expectedRevision, name, summary, propertyId, input.status, updatedAt]);
            if (result.changes !== 1) throw new Error('Business changed before update; refresh and try again');
            if (input.status === 'closed') {
                this.endAllEmployments(businessId, updatedAt);
                this.closePolicies(businessId, updatedAt);
            }
        });
        transaction.immediate();
        return this.get(businessId)!;
    }

    hire(businessIdInput: string, input: CreateEmployment, now = new Date().toISOString(),
        employmentId: string = randomUUID()): BusinessEmployment {
        const businessId = stableId(businessIdInput, 'businessId');
        const current = this.get(businessId);
        if (!current || current.status !== 'active') throw new Error('Only an active business may hire');
        const workerAgentId = stableId(input.workerAgentId, 'workerAgentId');
        if (workerAgentId === current.ownerAgentId) throw new Error('Owner is not represented as an employment');
        if (!['manager', 'worker'].includes(input.role)) throw new Error('Employment role is invalid');
        const title = boundedText(input.title, 'title', 120);
        if (!Number.isSafeInteger(input.wageGp) || input.wageGp < 0 || input.wageGp > 2_147_483_647) {
            throw new Error('Employment wage is invalid');
        }
        const requiredSkill = skillReference(input.requiredSkill);
        const startedAt = timestamp(now, 'now');
        try {
            this.database.run(`INSERT INTO business_employment (employment_id, business_id, worker_agent_id,
                role, title, wage_gp, required_skill_id, required_skill_version, status, revision,
                started_at, ended_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
                'active', 1, ?9, NULL, ?9)`, [employmentId, businessId, workerAgentId, input.role,
                title, input.wageGp, requiredSkill?.id ?? null, requiredSkill?.version ?? null, startedAt]);
        } catch (error) {
            if (String(error).includes('UNIQUE constraint failed')) {
                throw new Error('Agent already has an active employment at this business');
            }
            throw error;
        }
        return this.getEmployment(employmentId)!;
    }

    endEmployment(businessIdInput: string, employmentId: string, expectedRevision: number,
        now = new Date().toISOString()): BusinessEmployment {
        const businessId = stableId(businessIdInput, 'businessId');
        const current = this.getEmployment(employmentId);
        if (!current || current.businessId !== businessId) throw new Error('Employment does not exist');
        if (current.status === 'ended') return current;
        const endedAt = timestamp(now, 'now');
        const result = this.database.run(`UPDATE business_employment SET status = 'ended', ended_at = ?4,
            revision = revision + 1, updated_at = ?4
            WHERE employment_id = ?1 AND business_id = ?2 AND revision = ?3 AND status = 'active'`,
        [employmentId, businessId, expectedRevision, endedAt]);
        if (result.changes !== 1) throw new Error('Employment changed before update; refresh and try again');
        return this.getEmployment(employmentId)!;
    }

    proposePolicy(businessIdInput: string, input: CreateBusinessPolicyProposal,
        now = new Date().toISOString()): BusinessPolicyProposal {
        const businessId = stableId(businessIdInput, 'businessId');
        const business = this.get(businessId);
        if (!business) throw new Error('Business does not exist');
        if (!/^[0-9a-f-]{36}$/i.test(input.proposalId)) throw new Error('Policy proposal id is invalid');
        const proposerAgentId = stableId(input.proposerAgentId, 'proposerAgentId');
        const objective = boundedText(input.objective, 'objective', 320);
        if (!['balanced', 'growth', 'profit', 'survival'].includes(input.mode)) {
            throw new Error('Business policy mode is invalid');
        }
        if (!Number.isSafeInteger(input.maxRewardGp) || input.maxRewardGp < 0
            || input.maxRewardGp > 2_147_483_647) throw new Error('Business policy reward limit is invalid');
        const preferredSkills = [...new Map((input.preferredSkills ?? []).map(item => {
            const skill = skillReference(item);
            if (!skill) throw new Error('Business policy skill is invalid');
            return [`${skill.id}@${skill.version}`, skill] as const;
        })).values()];
        if (preferredSkills.length > 20) throw new Error('Business policy has too many preferred skills');
        const createdAt = timestamp(now, 'now');
        const isExactReplay = (candidate: BusinessPolicyProposal) => candidate.businessId === businessId
            && candidate.proposerAgentId === proposerAgentId && candidate.objective === objective
            && candidate.mode === input.mode && candidate.maxRewardGp === input.maxRewardGp
            && JSON.stringify(candidate.preferredSkills) === JSON.stringify(preferredSkills);
        const existing = this.getPolicyProposal(input.proposalId);
        if (existing) {
            if (!isExactReplay(existing)) throw new Error('Policy proposal id was reused with different content');
            return existing;
        }
        if (business.status !== 'active') throw new Error('Only an active business accepts policy proposals');
        try {
            this.database.run(`INSERT INTO business_policy_proposal (proposal_id, business_id,
                proposer_agent_id, objective, mode, max_reward_gp, preferred_skills_json, status,
                response_note, revision, created_at, resolved_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', '', 1, ?8, NULL, ?8)`,
            [input.proposalId, businessId, proposerAgentId, objective, input.mode, input.maxRewardGp,
                JSON.stringify(preferredSkills), createdAt]);
        } catch (error) {
            const raced = this.getPolicyProposal(input.proposalId);
            if (raced && isExactReplay(raced)) return raced;
            if (raced) throw new Error('Policy proposal id was reused with different content');
            throw error;
        }
        return this.getPolicyProposal(input.proposalId)!;
    }

    resolvePolicy(businessIdInput: string, proposalId: string, expectedRevision: number,
        decision: 'approve' | 'reject', responseNote: string,
        now = new Date().toISOString()): BusinessPolicyProposal {
        const businessId = stableId(businessIdInput, 'businessId');
        const current = this.getPolicyProposal(proposalId);
        if (!current || current.businessId !== businessId) throw new Error('Business policy proposal does not exist');
        const note = boundedText(responseNote, 'responseNote', 240);
        const status: BusinessPolicyStatus = decision === 'approve' ? 'approved' : 'rejected';
        if (current.status === status && current.responseNote === note) return current;
        if (current.status !== 'pending') throw new Error('Business policy proposal is already resolved');
        const resolvedAt = timestamp(now, 'now');
        const transaction = this.database.transaction(() => {
            if (status === 'approved') {
                this.database.run(`UPDATE business_policy_proposal SET status = 'superseded',
                    response_note = 'Superseded by a newer approved policy.', revision = revision + 1,
                    resolved_at = ?2, updated_at = ?2 WHERE business_id = ?1 AND status = 'approved'`,
                [businessId, resolvedAt]);
            }
            const result = this.database.run(`UPDATE business_policy_proposal SET status = ?4,
                response_note = ?5, revision = revision + 1, resolved_at = ?6, updated_at = ?6
                WHERE proposal_id = ?1 AND business_id = ?2 AND revision = ?3 AND status = 'pending'`,
            [proposalId, businessId, expectedRevision, status, note, resolvedAt]);
            if (result.changes !== 1) throw new Error('Business policy changed before resolution; refresh and try again');
        });
        transaction.immediate();
        return this.getPolicyProposal(proposalId)!;
    }

    private getEmployment(employmentId: string): BusinessEmployment | null {
        if (!/^[0-9a-f-]{36}$/i.test(employmentId)) throw new Error('Employment id is invalid');
        const row = this.database.query('SELECT * FROM business_employment WHERE employment_id = ?1')
            .get(employmentId) as EmploymentRow | null;
        return row ? employment(row) : null;
    }

    private endAllEmployments(businessId: string, now: string): void {
        this.database.run(`UPDATE business_employment SET status = 'ended', ended_at = ?2,
            revision = revision + 1, updated_at = ?2 WHERE business_id = ?1 AND status = 'active'`,
        [businessId, now]);
    }

    private closePolicies(businessId: string, now: string): void {
        this.database.run(`UPDATE business_policy_proposal SET status = 'rejected',
            response_note = 'Business closed before approval.', revision = revision + 1,
            resolved_at = ?2, updated_at = ?2 WHERE business_id = ?1 AND status = 'pending'`,
        [businessId, now]);
    }

    private getPolicyProposal(proposalId: string): BusinessPolicyProposal | null {
        if (!/^[0-9a-f-]{36}$/i.test(proposalId)) throw new Error('Policy proposal id is invalid');
        const row = this.database.query('SELECT * FROM business_policy_proposal WHERE proposal_id = ?1')
            .get(proposalId) as PolicyRow | null;
        return row ? policy(row) : null;
    }

    private toBusiness(row: BusinessRow): Business {
        const employments = (this.database.query(`SELECT * FROM business_employment
            WHERE business_id = ?1 ORDER BY status, started_at, employment_id`)
            .all(row.business_id) as EmploymentRow[]).map(employment);
        const policyProposals = (this.database.query(`SELECT * FROM business_policy_proposal
            WHERE business_id = ?1 ORDER BY created_at DESC, proposal_id DESC`)
            .all(row.business_id) as PolicyRow[]).map(policy);
        return {
            businessId: row.business_id,
            name: row.name,
            summary: row.summary,
            ownerAgentId: row.owner_agent_id,
            propertyId: row.property_id,
            status: row.status,
            revision: row.revision,
            employments,
            activePolicy: policyProposals.find(item => item.status === 'approved') ?? null,
            policyProposals,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
}
