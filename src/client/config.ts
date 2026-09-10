// This is a public backend address, never a credential. Empty preserves local proxying.
const configuredOrigin = (import.meta.env.VITE_API_ORIGIN ?? '').trim();
export const apiOrigin = configuredOrigin ? new URL(configuredOrigin).origin : '';
export const backendUrl = (path: string) => `${apiOrigin}${path}`;
export const backendAbsoluteUrl = (path: string) => `${apiOrigin || location.origin}${path}`;
