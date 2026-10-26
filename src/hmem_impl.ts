// The H-MEM implementation PriceSignal runs on: the Meterless reference engine
// (vendored by `npm run setup`) re-exported unchanged. The conformance suite is
// pointed at this file (`npm run conformance`), so what passes conformance is
// exactly what the agent uses.
export * from "../vendor/hmem/src/index.ts";
