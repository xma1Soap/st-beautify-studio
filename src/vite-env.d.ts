/// <reference types="vite/client" />

declare module 'virtual:frame-libs' {
  /** jQuery, lodash, zod and YAML as one script that sets them as globals */
  const code: string;
  export default code;
}
