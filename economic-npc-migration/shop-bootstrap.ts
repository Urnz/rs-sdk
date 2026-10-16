import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  businessGenesisInventoryDigest,
  type GenesisAssetAllocation,
  type WorldGenesisProfileId,
} from "../world-genesis/index.js";
import { resolveEconomicNpcMigration } from "./catalog.js";
import type { EconomicNpcMigrationCatalog } from "./types.js";

const ID = /^[a-z0-9][a-z0-9._:-]{0,119}$/;
const SYMBOL = /^[a-z0-9][a-z0-9_]{0,79}$/;
const ALLOWED_PROFILES = new Set<WorldGenesisProfileId>([
  "seeded-economy",
  "mature-society",
  "historical-burn-in",
]);

export interface ShopGenesisStockDefinition {
  allocationId: string;
  itemId: number;
  expectedSymbol: string;
  count: number;
}

export interface ShopGenesisBootstrapDefinition {
  bootstrapId: string;
  migrationId: string;
  allowedProfileIds: WorldGenesisProfileId[];
  businessAllocationId: string;
  openingCapitalGp: number;
  stock: ShopGenesisStockDefinition[];
}

export interface ShopGenesisBootstrapCatalog {
  schemaVersion: 1;
  activation: "genesis-only";
  bootstraps: ShopGenesisBootstrapDefinition[];
  digest: string;
}

export interface CompiledShopGenesisBootstrap {
  bootstrapId: string;
  migrationId: string;
  profileId: WorldGenesisProfileId;
  replenishmentPolicy: "verified-procurement-only";
  allocations: GenesisAssetAllocation[];
  allocationDigest: string;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]),
  );
}

function hash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

function exact(
  value: Record<string, unknown>,
  keys: string[],
  field: string,
): void {
  if (Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) {
    throw new Error(`${field} is invalid`);
  }
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== "string" || !ID.test(value))
    throw new Error(`${field} is invalid`);
  return value;
}

function positive(value: unknown, field: string): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 1 ||
    Number(value) > 2_147_483_647
  ) {
    throw new Error(`${field} is invalid`);
  }
  return Number(value);
}

export function shopGenesisBootstrapCatalogDigest(
  value: Omit<ShopGenesisBootstrapCatalog, "digest">,
): string {
  return hash(value);
}

export function validateShopGenesisBootstrapCatalog(
  value: unknown,
): ShopGenesisBootstrapCatalog {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Shop genesis bootstrap catalog is invalid");
  }
  const input = value as Record<string, unknown>;
  exact(
    input,
    ["schemaVersion", "activation", "bootstraps"],
    "Shop genesis bootstrap catalog",
  );
  if (
    input.schemaVersion !== 1 ||
    input.activation !== "genesis-only" ||
    !Array.isArray(input.bootstraps) ||
    input.bootstraps.length < 1 ||
    input.bootstraps.length > 1_000
  ) {
    throw new Error("Shop genesis bootstrap catalog is invalid");
  }

  const bootstraps = input.bootstraps.map(
    (value, index): ShopGenesisBootstrapDefinition => {
      const field = `bootstraps[${index}]`;
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(`${field} is invalid`);
      const bootstrap = value as Record<string, unknown>;
      exact(
        bootstrap,
        [
          "bootstrapId",
          "migrationId",
          "allowedProfileIds",
          "businessAllocationId",
          "openingCapitalGp",
          "stock",
        ],
        field,
      );
      if (
        !Array.isArray(bootstrap.allowedProfileIds) ||
        bootstrap.allowedProfileIds.length < 1 ||
        bootstrap.allowedProfileIds.some(
          (profile) => !ALLOWED_PROFILES.has(profile as WorldGenesisProfileId),
        ) ||
        new Set(bootstrap.allowedProfileIds).size !==
          bootstrap.allowedProfileIds.length ||
        !Array.isArray(bootstrap.stock) ||
        bootstrap.stock.length < 1 ||
        bootstrap.stock.length > 1_000
      ) {
        throw new Error(`${field} is invalid`);
      }
      const stock = bootstrap.stock.map(
        (value, stockIndex): ShopGenesisStockDefinition => {
          const stockField = `${field}.stock[${stockIndex}]`;
          if (!value || typeof value !== "object" || Array.isArray(value))
            throw new Error(`${stockField} is invalid`);
          const item = value as Record<string, unknown>;
          exact(
            item,
            ["allocationId", "itemId", "expectedSymbol", "count"],
            stockField,
          );
          if (
            !Number.isSafeInteger(item.itemId) ||
            Number(item.itemId) < 0 ||
            Number(item.itemId) > 65_534 ||
            typeof item.expectedSymbol !== "string" ||
            !SYMBOL.test(item.expectedSymbol)
          ) {
            throw new Error(`${stockField} is invalid`);
          }
          return {
            allocationId: identifier(
              item.allocationId,
              `${stockField}.allocationId`,
            ),
            itemId: Number(item.itemId),
            expectedSymbol: item.expectedSymbol,
            count: positive(item.count, `${stockField}.count`),
          };
        },
      );
      if (
        new Set(stock.map((item) => item.allocationId)).size !== stock.length ||
        new Set(stock.map((item) => item.itemId)).size !== stock.length ||
        new Set(stock.map((item) => item.expectedSymbol)).size !== stock.length
      ) {
        throw new Error(`${field} stock bindings must be unique`);
      }
      return {
        bootstrapId: identifier(bootstrap.bootstrapId, `${field}.bootstrapId`),
        migrationId: identifier(bootstrap.migrationId, `${field}.migrationId`),
        allowedProfileIds:
          bootstrap.allowedProfileIds as WorldGenesisProfileId[],
        businessAllocationId: identifier(
          bootstrap.businessAllocationId,
          `${field}.businessAllocationId`,
        ),
        openingCapitalGp: positive(
          bootstrap.openingCapitalGp,
          `${field}.openingCapitalGp`,
        ),
        stock,
      };
    },
  );
  if (
    new Set(bootstraps.map((item) => item.bootstrapId)).size !==
      bootstraps.length ||
    new Set(bootstraps.map((item) => item.migrationId)).size !==
      bootstraps.length
  ) {
    throw new Error("Shop genesis bootstrap bindings must be unique");
  }
  const definition = {
    schemaVersion: 1 as const,
    activation: "genesis-only" as const,
    bootstraps,
  };
  return {
    ...definition,
    digest: shopGenesisBootstrapCatalogDigest(definition),
  };
}

export function loadShopGenesisBootstrapCatalog(
  path: string,
): ShopGenesisBootstrapCatalog {
  return validateShopGenesisBootstrapCatalog(
    JSON.parse(readFileSync(path, "utf8")) as unknown,
  );
}

export function verifyShopGenesisItemSymbols(
  catalog: ShopGenesisBootstrapCatalog,
  symbolTable: string,
): void {
  const { digest, ...definition } = catalog;
  if (digest !== shopGenesisBootstrapCatalogDigest(definition)) {
    throw new Error("Shop genesis bootstrap catalog digest mismatch");
  }
  const symbols = new Map<number, string>();
  for (const line of symbolTable.split(/\r?\n/)) {
    const [id, symbol, extra] = line.split("\t");
    if (extra === undefined && /^\d+$/.test(id ?? "") && symbol)
      symbols.set(Number(id), symbol);
  }
  for (const bootstrap of catalog.bootstraps)
    for (const item of bootstrap.stock) {
      if (symbols.get(item.itemId) !== item.expectedSymbol) {
        throw new Error(
          `Shop genesis item binding changed: ${item.itemId}/${item.expectedSymbol}`,
        );
      }
    }
}

export function compileShopGenesisBootstrap(
  catalog: ShopGenesisBootstrapCatalog,
  migrations: EconomicNpcMigrationCatalog,
  bootstrapId: string,
  profileId: WorldGenesisProfileId,
): CompiledShopGenesisBootstrap {
  const { digest, ...definition } = catalog;
  if (digest !== shopGenesisBootstrapCatalogDigest(definition)) {
    throw new Error("Shop genesis bootstrap catalog digest mismatch");
  }
  const bootstrap = catalog.bootstraps.find(
    (item) => item.bootstrapId === bootstrapId,
  );
  if (!bootstrap)
    throw new Error(`Shop genesis bootstrap ${bootstrapId} is not configured`);
  if (!bootstrap.allowedProfileIds.includes(profileId)) {
    throw new Error(
      `Shop genesis bootstrap ${bootstrapId} is not allowed for profile ${profileId}`,
    );
  }
  const migration = resolveEconomicNpcMigration(
    migrations,
    bootstrap.migrationId,
  );
  if (
    migration.serviceKind !== "shop" ||
    migration.target.treasuryActorId !== migration.target.businessId
  ) {
    throw new Error(
      "Shop genesis bootstrap requires one exact Business treasury target",
    );
  }
  const stock: GenesisAssetAllocation[] = bootstrap.stock.map((item) => ({
    allocationId: item.allocationId,
    kind: "item",
    owner: { kind: "business", id: migration.target.businessId },
    container: "business-stock",
    itemId: item.itemId,
    count: item.count,
    slot: null,
  }));
  const allocations: GenesisAssetAllocation[] = [
    {
      allocationId: bootstrap.businessAllocationId,
      kind: "business",
      owner: { kind: "player", id: migration.target.ownerAgentId },
      businessId: migration.target.businessId,
      openingCapitalGp: bootstrap.openingCapitalGp,
      openingInventoryDigest: businessGenesisInventoryDigest(
        stock,
        migration.target.businessId,
      ),
    },
    ...stock,
  ];
  return {
    bootstrapId: bootstrap.bootstrapId,
    migrationId: bootstrap.migrationId,
    profileId,
    replenishmentPolicy: "verified-procurement-only",
    allocations,
    allocationDigest: hash(allocations),
  };
}
