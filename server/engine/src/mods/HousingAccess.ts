let verify: (propertyId: string, username: string) => boolean = () => false;
export function registerHousingTenantAccess(port: typeof verify): void { verify = port; }
export function housingTenantAccess(propertyId: string, username: string): boolean { try { return verify(propertyId, username); } catch { return false; } }
