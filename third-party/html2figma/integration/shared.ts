// Preserve the upstream helpers without its global log buffer or console output.
export * from "../upstream/packages/shared/css-utils";
export * from "../upstream/packages/shared/utils";
export * from "../upstream/packages/shared/design-node";
export * from "../upstream/packages/shared/figma-types";
export { LogModule } from "../upstream/packages/shared/logger-modules";

const silent = Object.freeze({
  info() {},
  warn() {},
  error() {},
  debug() {},
});
export function createLogger(..._arguments: unknown[]) {
  return silent;
}
