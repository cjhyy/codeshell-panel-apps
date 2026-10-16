export const PRODUCTION_SERVER_URL = 'https://api.html2figma.com';
export const LOCAL_SERVER_URLS = [
  'http://localhost:3000',
  'http://localhost:3001',
] as const;

export const IS_DEVELOPMENT = import.meta.env.MODE === 'development';

export const DEFAULT_SERVER_URL = IS_DEVELOPMENT
  ? LOCAL_SERVER_URLS[0]
  : PRODUCTION_SERVER_URL;

export const AVAILABLE_SERVER_URLS = IS_DEVELOPMENT
  ? [PRODUCTION_SERVER_URL, ...LOCAL_SERVER_URLS]
  : [PRODUCTION_SERVER_URL];

export function normalizeServerUrl(value?: string): string {
  const normalized = value?.replace(/\/$/, '');
  return AVAILABLE_SERVER_URLS.includes(normalized as typeof AVAILABLE_SERVER_URLS[number])
    ? normalized!
    : DEFAULT_SERVER_URL;
}
