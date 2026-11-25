// The core's module as the build inlines it: its bytes in base64.
declare module '*.wasm' {
  const encoded: string;

  export default encoded;
}
