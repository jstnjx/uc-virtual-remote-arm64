/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_PROXY: string;
  readonly VITE_API_HOST: string;
  // Vite env values are always strings at runtime: parse with Number() at use.
  readonly VITE_API_MAX_TIMEOUT: string | undefined; // ms
  readonly VITE_API_MAX_IMPORT_INTEGRATION_TIMEOUT: string | undefined; // ms
  /** @deprecated misspelled legacy name of VITE_API_MAX_IMPORT_INTEGRATION_TIMEOUT */
  readonly VITE_API_MAX_IMPORT_INTEGRATON_TIMEOUT: string | undefined; // ms
  readonly VITE_API_MAX_IMPORT_IR_CODE_TIMEOUT: string | undefined; // ms
  readonly VITE_API_MAX_RESOURCE_UPLOAD_TIMEOUT: string | undefined; // ms
  readonly VITE_API_MAX_BACKUP_TIMEOUT: string | undefined; // ms
  readonly VITE_LANGUAGES: string | null;
  readonly VITE_WOWLAN: string | null;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
