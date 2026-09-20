import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BusinessManagerStore } from "../../server/gateway/admin/business-manager.js";
import {
  businessRoleAllowsSkill,
  businessRoleHasPermission,
  businessRoleMayAssignRole,
  loadDefaultBusinessRoleCatalog,
  resolveBusinessRole,
  validateBusinessRoleCatalog,
} from "../index.js";

const databasePath = async (name: string) =>
  join(await mkdtemp(join(tmpdir(), `${name}-`)), "businesses.sqlite");

describe("data-driven Business role definitions", () => {
  test("separates manager, generic worker and shop-clerk authority", () => {
    const catalog = loadDefaultBusinessRoleCatalog();
    const manager = resolveBusinessRole(catalog, "business.manager.v1");
    const worker = resolveBusinessRole(catalog, "business.worker.v1");
    const clerk = resolveBusinessRole(catalog, "business.shop-clerk.v1");

    expect(catalog.verifiedSkillKeys).toContain(
      "shopping.lumbridge.buy-hammers@1.0.0",
    );
    expect(catalog.verifiedSkillKeys).not.toContain(
      "procedure.shop.buy-item@0.1.0",
    );
    expect(businessRoleHasPermission(manager, "treasury", "pay")).toBeTrue();
    expect(businessRoleHasPermission(worker, "treasury", "pay")).toBeFalse();
    expect(
      businessRoleMayAssignRole(manager, clerk.roleDefinitionId),
    ).toBeTrue();
    expect(
      businessRoleMayAssignRole(clerk, worker.roleDefinitionId),
    ).toBeFalse();
    expect(
      businessRoleAllowsSkill(
        clerk,
        { id: "shopping.lumbridge.buy-hammers", version: "1.0.0" },
        null,
      ),
    ).toBeTrue();
    expect(
      businessRoleAllowsSkill(
        clerk,
        { id: "shopping.lumbridge.buy-hammers", version: "9.9.9" },
        null,
      ),
    ).toBeFalse();
    expect(
      businessRoleAllowsSkill(
        worker,
        { id: "mining.varrock-east.copper-to-bank", version: "1.0.0" },
        { id: "mining.varrock-east.copper-to-bank", version: "1.0.0" },
      ),
    ).toBeTrue();
  });

  test("rejects unknown permissions, dangling delegation and digest tampering", () => {
    const catalog = loadDefaultBusinessRoleCatalog(),
      manager = catalog.roles[0]!;
    const definition = { schemaVersion: 1, roles: catalog.roles };
    expect(() =>
      validateBusinessRoleCatalog({
        ...definition,
        roles: [
          {
            ...manager,
            permissions: { ...manager.permissions, treasury: ["mint"] },
          },
          ...catalog.roles.slice(1),
        ],
      }),
    ).toThrow("treasury is invalid");
    expect(() =>
      validateBusinessRoleCatalog({
        ...definition,
        roles: [
          {
            ...manager,
            hiringPolicy: {
              ...manager.hiringPolicy,
              assignableRoleDefinitionIds: ["business.missing.v1"],
            },
          },
          ...catalog.roles.slice(1),
        ],
      }),
    ).toThrow("unknown role");
    expect(() =>
      resolveBusinessRole(
        { ...catalog, digest: "0".repeat(64) },
        manager.roleDefinitionId,
      ),
    ).toThrow("digest mismatch");
  });

  test("stores a detailed role while preserving the legacy compatibility projection", async () => {
    const store = new BusinessManagerStore(await databasePath("business-role"));
    try {
      store.create({
        businessId: "lumbridge-store",
        name: "Lumbridge Store",
        summary: "Finite shop.",
        ownerAgentId: "shop-owner",
      });
      const clerk = store.hire("lumbridge-store", {
        workerAgentId: "shop-clerk",
        role: "worker",
        roleDefinitionId: "business.shop-clerk.v1",
        title: "Shop clerk",
        wageGp: 25,
        requiredSkill: {
          id: "shopping.lumbridge.buy-hammers",
          version: "1.0.0",
        },
      });
      expect(clerk).toMatchObject({
        role: "worker",
        roleDefinitionId: "business.shop-clerk.v1",
      });
      expect(() =>
        store.hire("lumbridge-store", {
          workerAgentId: "bad-clerk",
          role: "manager",
          roleDefinitionId: "business.shop-clerk.v1",
          title: "Bad clerk",
          wageGp: 25,
        }),
      ).toThrow("does not match");
      expect(() =>
        store.hire("lumbridge-store", {
          workerAgentId: "unsafe-clerk",
          role: "worker",
          roleDefinitionId: "business.shop-clerk.v1",
          title: "Unsafe clerk",
          wageGp: 25,
          requiredSkill: { id: "admin.unbounded", version: "1.0.0" },
        }),
      ).toThrow("not allowed");
      expect(() =>
        store.hire("lumbridge-store", {
          workerAgentId: "draft-clerk",
          role: "worker",
          roleDefinitionId: "business.shop-clerk.v1",
          title: "Draft clerk",
          wageGp: 25,
          requiredSkill: { id: "procedure.shop.buy-item", version: "0.1.0" },
        }),
      ).toThrow("not allowed");
    } finally {
      store.close();
    }
  });

  test("additively migrates legacy manager and worker employment rows", async () => {
    const path = await databasePath("business-role-migration");
    const legacy = new Database(path, { create: true, strict: true });
    legacy.run(`CREATE TABLE business (
            business_id TEXT PRIMARY KEY, name TEXT NOT NULL, summary TEXT NOT NULL,
            owner_agent_id TEXT NOT NULL, property_id TEXT, status TEXT NOT NULL,
            revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    legacy.run(`CREATE TABLE business_employment (
            employment_id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES business(business_id),
            worker_agent_id TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('manager', 'worker')),
            title TEXT NOT NULL, wage_gp INTEGER NOT NULL, required_skill_id TEXT, required_skill_version TEXT,
            status TEXT NOT NULL, revision INTEGER NOT NULL, started_at TEXT NOT NULL,
            ended_at TEXT, updated_at TEXT NOT NULL)`);
    legacy.run(`INSERT INTO business VALUES
            ('legacy-shop','Legacy Shop','Existing data.','owner',NULL,'active',1,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')`);
    legacy.run(`INSERT INTO business_employment VALUES
            ('11111111-1111-4111-8111-111111111111','legacy-shop','manager-agent','manager','Manager',0,NULL,NULL,
            'active',1,'2026-01-01T00:00:00.000Z',NULL,'2026-01-01T00:00:00.000Z'),
            ('22222222-2222-4222-8222-222222222222','legacy-shop','worker-agent','worker','Worker',0,NULL,NULL,
            'active',1,'2026-01-01T00:00:00.000Z',NULL,'2026-01-01T00:00:00.000Z')`);
    legacy.close();

    const migrated = new BusinessManagerStore(path);
    try {
      expect(migrated.get("legacy-shop")?.employments).toMatchObject([
        { role: "manager", roleDefinitionId: "business.manager.v1" },
        { role: "worker", roleDefinitionId: "business.worker.v1" },
      ]);
    } finally {
      migrated.close();
    }
  });
});
