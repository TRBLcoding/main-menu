import PocketBase from 'pocketbase';

// // Point this to your PocketBase server URL (localhost during dev, or your HA IP)
// export const pb = new PocketBase(import.meta.env.VITE_POCKETBASE_URL || 'http://127.0.0.1:8090'); //17191

// Passing '/' automatically uses the current host and port
export const pb = new PocketBase('/');