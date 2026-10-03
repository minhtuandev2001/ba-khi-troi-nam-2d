/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** `off` turns the developer-tools guard off for every user (it is on by default, dev server included). */
  readonly VITE_DEVTOOLS_GUARD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
