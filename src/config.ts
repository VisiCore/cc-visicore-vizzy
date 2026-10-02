// The Vizzy server. Fixed when the app is packaged: config/proxies.yml must name the same host.
export const VIZZY_SERVER = 'https://3-16-140-226.sslip.io';

// Where the licence key is kept in the app's KV store. Encrypted there, so it can be written from
// Settings and used by Cribl's proxy, and never read back by the browser.
export const LICENCE_KV_KEY = 'vizzy_licence_key';
