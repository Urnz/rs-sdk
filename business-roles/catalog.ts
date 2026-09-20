import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type LegacyEmploymentRole = "manager" | "worker";
export type BusinessPermissionDomain =
  "inventory" | "storage" | "treasury" | "pricing" | "contracts";
export type BusinessPermission =
  | "inspect"
  | "receive"
  | "issue"
  | "deposit"
  | "withdraw"
  | "assign"
  | "reserve"
  | "pay"
  | "fund"
  | "propose"
  | "approve"
  | "accept"
  | "settle";

export interface BusinessRoleSkillReference {
  id: string;
  version: string;
}
export interface BusinessRoleDefinition {
  roleDefinitionId: string;
  name: string;
  legacyProjection: LegacyEmploymentRole;
  skillPolicy: {
    mode: "employment-required-only" | "allowlist";
    verifiedSkills: BusinessRoleSkillReference[];
  };
  permissions: Record<BusinessPermissionDomain, BusinessPermission[]>;
  hiringPolicy: {
    mayHire: boolean;
    mayDismiss: boolean;
    mayDelegate: boolean;
    assignableRoleDefinitionIds: string[];
  };
}

export interface BusinessRoleCatalog {
  schemaVersion: 1;
  roles: BusinessRoleDefinition[];
  digest: string;
  verifiedSkillKeys: string[];
}

const ID = /^[a-z0-9][a-z0-9.-]{1,119}$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i;
const DOMAINS: BusinessPermissionDomain[] = [
  "inventory",
  "storage",
  "treasury",
  "pricing",
  "contracts",
];
const PERMISSIONS: Record<BusinessPermissionDomain, Set<BusinessPermission>> = {
  inventory: new Set(["inspect", "receive", "issue"]),
  storage: new Set(["inspect", "deposit", "withdraw", "assign"]),
  treasury: new Set(["inspect", "reserve", "pay", "fund"]),
  pricing: new Set(["inspect", "propose", "approve"]),
  contracts: new Set(["inspect", "propose", "accept", "settle"]),
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]),
  );
}

function digest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

function exact(
  value: Record<string, unknown>,
  keys: string[],
  field: string,
): void {
  if (Object.keys(value).sort().join(",") !== [...keys].sort().join(","))
    throw new Error(`${field} is invalid`);
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== "string" || !ID.test(value))
    throw new Error(`${field} is invalid`);
  return value;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} is invalid`);
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 120)
    throw new Error(`${field} is invalid`);
  return normalized;
}

function permissionMap(
  value: unknown,
  field: string,
): Record<BusinessPermissionDomain, BusinessPermission[]> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${field} is invalid`);
  const input = value as Record<string, unknown>;
  exact(input, DOMAINS, field);
  return Object.fromEntries(
    DOMAINS.map((domain) => {
      const entries = input[domain];
      if (
        !Array.isArray(entries) ||
        entries.length > PERMISSIONS[domain].size ||
        entries.some(
          (entry) => !PERMISSIONS[domain].has(entry as BusinessPermission),
        ) ||
        new Set(entries).size !== entries.length
      )
        throw new Error(`${field}.${domain} is invalid`);
      return [domain, entries as BusinessPermission[]];
    }),
  ) as Record<BusinessPermissionDomain, BusinessPermission[]>;
}

export function businessRoleCatalogDigest(
  value: Pick<BusinessRoleCatalog, "schemaVersion" | "roles">,
): string {
  return digest({ schemaVersion: value.schemaVersion, roles: value.roles });
}

export function validateBusinessRoleCatalog(
  value: unknown,
): BusinessRoleCatalog {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Business role catalog is invalid");
  const input = value as Record<string, unknown>;
  exact(input, ["schemaVersion", "roles"], "Business role catalog");
  if (
    input.schemaVersion !== 1 ||
    !Array.isArray(input.roles) ||
    input.roles.length < 2 ||
    input.roles.length > 1_000
  ) {
    throw new Error("Business role catalog is invalid");
  }
  const roles = input.roles.map((value, index): BusinessRoleDefinition => {
    const field = `roles[${index}]`;
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error(`${field} is invalid`);
    const role = value as Record<string, unknown>;
    exact(
      role,
      [
        "roleDefinitionId",
        "name",
        "legacyProjection",
        "skillPolicy",
        "permissions",
        "hiringPolicy",
      ],
      field,
    );
    if (
      !["manager", "worker"].includes(String(role.legacyProjection)) ||
      !role.skillPolicy ||
      typeof role.skillPolicy !== "object" ||
      Array.isArray(role.skillPolicy) ||
      !role.hiringPolicy ||
      typeof role.hiringPolicy !== "object" ||
      Array.isArray(role.hiringPolicy)
    ) {
      throw new Error(`${field} is invalid`);
    }
    const skillPolicy = role.skillPolicy as Record<string, unknown>;
    exact(skillPolicy, ["mode", "verifiedSkills"], `${field}.skillPolicy`);
    if (
      !["employment-required-only", "allowlist"].includes(
        String(skillPolicy.mode),
      ) ||
      !Array.isArray(skillPolicy.verifiedSkills) ||
      skillPolicy.verifiedSkills.length > 100
    ) {
      throw new Error(`${field}.skillPolicy is invalid`);
    }
    const verifiedSkills = skillPolicy.verifiedSkills.map(
      (value, skillIndex): BusinessRoleSkillReference => {
        const skillField = `${field}.skillPolicy.verifiedSkills[${skillIndex}]`;
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw new Error(`${skillField} is invalid`);
        const skill = value as Record<string, unknown>;
        exact(skill, ["id", "version"], skillField);
        return {
          id: identifier(skill.id, `${skillField}.id`),
          version:
            typeof skill.version === "string" && VERSION.test(skill.version)
              ? skill.version
              : (() => {
                  throw new Error(`${skillField}.version is invalid`);
                })(),
        };
      },
    );
    if (
      new Set(verifiedSkills.map((skill) => `${skill.id}@${skill.version}`))
        .size !== verifiedSkills.length ||
      (skillPolicy.mode === "employment-required-only" &&
        verifiedSkills.length !== 0)
    ) {
      throw new Error(`${field}.skillPolicy is invalid`);
    }
    const hiring = role.hiringPolicy as Record<string, unknown>;
    exact(
      hiring,
      ["mayHire", "mayDismiss", "mayDelegate", "assignableRoleDefinitionIds"],
      `${field}.hiringPolicy`,
    );
    if (
      typeof hiring.mayHire !== "boolean" ||
      typeof hiring.mayDismiss !== "boolean" ||
      typeof hiring.mayDelegate !== "boolean" ||
      !Array.isArray(hiring.assignableRoleDefinitionIds) ||
      hiring.assignableRoleDefinitionIds.length > 100 ||
      hiring.assignableRoleDefinitionIds.some(
        (id) => typeof id !== "string" || !ID.test(id),
      ) ||
      new Set(hiring.assignableRoleDefinitionIds).size !==
        hiring.assignableRoleDefinitionIds.length ||
      (!hiring.mayHire && hiring.assignableRoleDefinitionIds.length !== 0)
    ) {
      throw new Error(`${field}.hiringPolicy is invalid`);
    }
    return {
      roleDefinitionId: identifier(
        role.roleDefinitionId,
        `${field}.roleDefinitionId`,
      ),
      name: text(role.name, `${field}.name`),
      legacyProjection: role.legacyProjection as LegacyEmploymentRole,
      skillPolicy: {
        mode: skillPolicy.mode as BusinessRoleDefinition["skillPolicy"]["mode"],
        verifiedSkills,
      },
      permissions: permissionMap(role.permissions, `${field}.permissions`),
      hiringPolicy: {
        mayHire: hiring.mayHire,
        mayDismiss: hiring.mayDismiss,
        mayDelegate: hiring.mayDelegate,
        assignableRoleDefinitionIds:
          hiring.assignableRoleDefinitionIds as string[],
      },
    };
  });
  if (
    new Set(roles.map((role) => role.roleDefinitionId)).size !== roles.length
  ) {
    throw new Error("Business role definition ids must be unique");
  }
  const known = new Set(roles.map((role) => role.roleDefinitionId));
  for (const role of roles)
    for (const assignable of role.hiringPolicy.assignableRoleDefinitionIds) {
      if (!known.has(assignable))
        throw new Error(
          `Business role ${role.roleDefinitionId} references an unknown role`,
        );
    }
  for (const legacy of ["manager", "worker"] as const)
    if (roles.filter((role) => role.legacyProjection === legacy).length < 1) {
      throw new Error(
        `Business role catalog requires a ${legacy} compatibility role`,
      );
    }
  const definition = {
    schemaVersion: 1 as const,
    roles,
    verifiedSkillKeys: [],
  };
  return { ...definition, digest: businessRoleCatalogDigest(definition) };
}

export function loadBusinessRoleCatalog(path: string): BusinessRoleCatalog {
  return validateBusinessRoleCatalog(
    JSON.parse(readFileSync(path, "utf8")) as unknown,
  );
}

export function loadDefaultBusinessRoleCatalog(): BusinessRoleCatalog {
  const catalog = loadBusinessRoleCatalog(
    join(import.meta.dir, "..", "config", "business-role-definitions.json"),
  );
  const skillCatalogPath = join(
    import.meta.dir,
    "..",
    "agent-skills",
    "catalog",
  );
  const verifiedSkillKeys = readdirSync(skillCatalogPath)
    .filter((file) => file.endsWith(".skill.json"))
    .map(
      (file) =>
        JSON.parse(
          readFileSync(join(skillCatalogPath, file), "utf8"),
        ) as Record<string, unknown>,
    )
    .filter(
      (skill) =>
        skill.status === "verified" &&
        typeof skill.id === "string" &&
        typeof skill.version === "string",
    )
    .map((skill) => `${skill.id as string}@${skill.version as string}`);
  const known = new Set(verifiedSkillKeys);
  for (const role of catalog.roles)
    for (const skill of role.skillPolicy.verifiedSkills) {
      if (!known.has(`${skill.id}@${skill.version}`)) {
        throw new Error(
          `Business role ${role.roleDefinitionId} references a skill that is not verified`,
        );
      }
    }
  return { ...catalog, verifiedSkillKeys: [...known].sort() };
}

export function businessRoleCatalogHasVerifiedSkill(
  catalog: BusinessRoleCatalog,
  skill: BusinessRoleSkillReference,
): boolean {
  return catalog.verifiedSkillKeys.includes(`${skill.id}@${skill.version}`);
}

export function resolveBusinessRole(
  catalog: BusinessRoleCatalog,
  roleDefinitionId: string,
): BusinessRoleDefinition {
  const { digest: supplied, schemaVersion, roles } = catalog;
  const definition = { schemaVersion, roles };
  if (supplied !== businessRoleCatalogDigest(definition))
    throw new Error("Business role catalog digest mismatch");
  const role = catalog.roles.find(
    (role) => role.roleDefinitionId === roleDefinitionId,
  );
  if (!role)
    throw new Error(`Business role ${roleDefinitionId} does not exist`);
  return role;
}

export function resolveLegacyBusinessRole(
  catalog: BusinessRoleCatalog,
  legacyRole: LegacyEmploymentRole,
): BusinessRoleDefinition {
  const role = catalog.roles.find(
    (role) =>
      role.legacyProjection === legacyRole &&
      role.roleDefinitionId === `business.${legacyRole}.v1`,
  );
  if (!role)
    throw new Error(
      `Business role catalog lacks the canonical ${legacyRole} migration role`,
    );
  return resolveBusinessRole(catalog, role.roleDefinitionId);
}

export function businessRoleAllowsSkill(
  role: BusinessRoleDefinition,
  skill: BusinessRoleSkillReference,
  employmentRequiredSkill: BusinessRoleSkillReference | null,
): boolean {
  const key = (value: BusinessRoleSkillReference) =>
    `${value.id}@${value.version}`;
  if (role.skillPolicy.mode === "employment-required-only") {
    return (
      employmentRequiredSkill !== null &&
      key(skill) === key(employmentRequiredSkill)
    );
  }
  return role.skillPolicy.verifiedSkills.some(
    (allowed) => key(allowed) === key(skill),
  );
}

export function businessRoleHasPermission(
  role: BusinessRoleDefinition,
  domain: BusinessPermissionDomain,
  permission: BusinessPermission,
): boolean {
  return role.permissions[domain].includes(permission);
}

export function businessRoleMayAssignRole(
  role: BusinessRoleDefinition,
  roleDefinitionId: string,
): boolean {
  return (
    role.hiringPolicy.mayHire &&
    role.hiringPolicy.assignableRoleDefinitionIds.includes(roleDefinitionId)
  );
}
