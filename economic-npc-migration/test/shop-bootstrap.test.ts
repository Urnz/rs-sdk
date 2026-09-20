import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BusinessManagerStore } from "../../server/gateway/admin/business-manager.js";
import { InstitutionTreasuryStore } from "../../server/gateway/admin/institution-treasury.js";
import {
  compileShopGenesisBootstrap,
  loadEconomicNpcMigrationCatalog,
  loadShopGenesisBootstrapCatalog,
  validateShopGenesisBootstrapCatalog,
  verifyShopGenesisItemSymbols,
} from "../index.js";

const configPath = join(import.meta.dir, "..", "..", "config");
const load = () =>
  loadShopGenesisBootstrapCatalog(
    join(configPath, "shop-genesis-bootstraps.json"),
  );
const migrations = () =>
  loadEconomicNpcMigrationCatalog(
    join(configPath, "economic-npc-migrations.json"),
  );

describe("finite shop genesis bootstrap", () => {
  test("compiles the configured Lumbridge shop into Business-owned stock and treasury capital", () => {
    const catalog = load();
    verifyShopGenesisItemSymbols(
      catalog,
      readFileSync(
        join(
          import.meta.dir,
          "..",
          "..",
          "server",
          "engine",
          "data",
          "symbols",
          "obj.sym",
        ),
        "utf8",
      ),
    );
    const plan = compileShopGenesisBootstrap(
      catalog,
      migrations(),
      "lumbridge-general-store-seed-v1",
      "seeded-economy",
    );

    expect(plan).toMatchObject({
      migrationId: "lumbridge-general-store-v1",
      profileId: "seeded-economy",
      replenishmentPolicy: "verified-procurement-only",
    });
    expect(plan.allocations[0]).toMatchObject({
      kind: "business",
      owner: { kind: "player", id: "lumbridge-shopkeeper-owner" },
      businessId: "lumbridge-general-store",
      openingCapitalGp: 1_000,
    });
    expect(plan.allocations.slice(1)).toHaveLength(8);
    expect(
      plan.allocations
        .slice(1)
        .every(
          (allocation) =>
            allocation.kind === "item" &&
            allocation.owner.kind === "business" &&
            allocation.owner.id === "lumbridge-general-store" &&
            allocation.container === "business-stock",
        ),
    ).toBeTrue();
  });

  test("uses the existing single-use genesis receipts without replaying inventory or money", async () => {
    const directory = await mkdtemp(join(tmpdir(), "shop-genesis-"));
    const businesses = new BusinessManagerStore(
      join(directory, "businesses.sqlite"),
    );
    const treasuries = new InstitutionTreasuryStore(
      join(directory, "treasuries.sqlite"),
    );
    try {
      const plan = compileShopGenesisBootstrap(
        load(),
        migrations(),
        "lumbridge-general-store-seed-v1",
        "mature-society",
      );
      const business = plan.allocations[0]!;
      if (business.kind !== "business")
        throw new Error("Expected business allocation");
      const created = businesses.createGenesis(business.allocationId, {
        businessId: business.businessId,
        name: "Lumbridge General Store",
        summary: "Finite genesis shop.",
        ownerAgentId: business.owner.id,
      });
      const capitalId = `${business.allocationId}:capital`;
      const capital = treasuries.creditGenesis(
        "business",
        business.businessId,
        capitalId,
        business.openingCapitalGp,
      );
      for (const allocation of plan.allocations.slice(1)) {
        if (allocation.kind !== "item")
          throw new Error("Expected item allocation");
        businesses.creditGenesisInventory(
          allocation.allocationId,
          business.businessId,
          allocation.itemId,
          allocation.count,
        );
      }

      expect(
        businesses.createGenesis(business.allocationId, {
          businessId: business.businessId,
          name: "Replay ignored",
          summary: "Replay ignored.",
          ownerAgentId: business.owner.id,
        }),
      ).toEqual(created);
      expect(
        treasuries.creditGenesis(
          "business",
          business.businessId,
          capitalId,
          business.openingCapitalGp,
        ),
      ).toEqual(capital);
      for (const allocation of plan.allocations.slice(1)) {
        if (allocation.kind !== "item")
          throw new Error("Expected item allocation");
        businesses.creditGenesisInventory(
          allocation.allocationId,
          business.businessId,
          allocation.itemId,
          allocation.count,
        );
      }
      expect(treasuries.get("business", business.businessId)).toMatchObject({
        balanceGp: 1_000,
      });
      expect(
        businesses
          .listInventory(business.businessId)
          .reduce((sum, item) => sum + item.count, 0),
      ).toBe(23);

      const firstStock = plan.allocations[1]!;
      if (firstStock.kind !== "item")
        throw new Error("Expected item allocation");
      businesses.resetGenesisInventory(firstStock.allocationId);
      expect(() =>
        businesses.creditGenesisInventory(
          firstStock.allocationId,
          business.businessId,
          firstStock.itemId,
          firstStock.count,
        ),
      ).toThrow("already reset");
    } finally {
      businesses.close();
      treasuries.close();
    }
  });

  test("rejects runtime-like refill configuration, unsafe profiles and changed bindings", () => {
    const catalog = load(),
      bootstrap = catalog.bootstraps[0]!;
    expect(() =>
      validateShopGenesisBootstrapCatalog({
        schemaVersion: 1,
        activation: "runtime",
        bootstraps: [bootstrap],
      }),
    ).toThrow("invalid");
    expect(() =>
      validateShopGenesisBootstrapCatalog({
        schemaVersion: 1,
        activation: "genesis-only",
        bootstraps: [
          {
            ...bootstrap,
            stock: [
              ...bootstrap.stock,
              { ...bootstrap.stock[0], allocationId: "duplicate-item" },
            ],
          },
        ],
      }),
    ).toThrow("unique");
    expect(() =>
      compileShopGenesisBootstrap(
        catalog,
        migrations(),
        bootstrap.bootstrapId,
        "blank-slate",
      ),
    ).toThrow("not allowed");
    expect(() =>
      compileShopGenesisBootstrap(
        { ...catalog, digest: "0".repeat(64) },
        migrations(),
        bootstrap.bootstrapId,
        "seeded-economy",
      ),
    ).toThrow("digest mismatch");
    expect(() =>
      verifyShopGenesisItemSymbols(catalog, "1931\twrong_symbol\n"),
    ).toThrow("binding changed");
  });
});
