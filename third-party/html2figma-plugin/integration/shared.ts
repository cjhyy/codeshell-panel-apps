// Use upstream value helpers/types, but collect creator failures instead of global logs.
export * from "../../html2figma/upstream/packages/shared/utils";
export * from "../../html2figma/upstream/packages/shared/css-utils";
export * from "../../html2figma/upstream/packages/shared/design-node";
export * from "../../html2figma/upstream/packages/shared/figma-types";
export { LogModule } from "../../html2figma/upstream/packages/shared/logger-modules";
export const creatorErrors: string[] = [];
const logger = {
  info() {},
  debug() {},
  warn() {},
  error(...args: unknown[]) {
    creatorErrors.push(
      args
        .map((v) => (v instanceof Error ? v.message : typeof v === "string" ? v : ""))
        .filter(Boolean)
        .join(" ")
        .slice(0, 400),
    );
  },
};
export function createLogger(..._args: unknown[]) {
  return logger;
}
