// Log module enum definitions
// Contains all available module names

/**
 * Log module enum — defines all available module names for type-safe logging.
 */
export enum LogModule {
  // ===== Figma Creators =====
  FRAME_CREATOR = 'FrameCreator',
  RECTANGLE_CREATOR = 'RectangleCreator',
  TEXT_CREATOR = 'TextCreator',
  IMAGE_CREATOR = 'ImageCreator',
  GROUP_CREATOR = 'GroupCreator',

  // ===== Figma Services =====
  FIGMA_SERVICE = 'FigmaService',
  FIGMA_CREATOR = 'FigmaCreator',

  // ===== Core Components =====
  NODE_TRAVERSER = 'NodeTraverser',
  FORM_PROCESSOR = 'FormProcessor',

  // ===== Utilities =====
  STYLE_PROCESSOR = 'StyleProcessor',
  LAYOUT_PROCESSOR = 'LayoutProcessor',

  // ===== Plugin =====
  PLUGIN_CODE = 'PluginCode',

  // ===== Extension =====
  EXT_IMAGES = 'ExtImages',
  EXT_BACKGROUND = 'ExtBackground',
  EXT_CONTENT = 'ExtContent',

  // ===== Special =====
  ALL = '*' // Enable all modules
}

/**
 * Module group definitions — groups related modules for batch management.
 */
export const MODULE_GROUPS: Record<string, LogModule[]> = {
  // Figma creators
  FIGMA_CREATORS: [
    LogModule.FRAME_CREATOR,
    LogModule.RECTANGLE_CREATOR,
    LogModule.TEXT_CREATOR,
    LogModule.IMAGE_CREATOR,
    LogModule.GROUP_CREATOR
  ],

  // Core services
  CORE_SERVICES: [
    LogModule.FIGMA_SERVICE,
    LogModule.FIGMA_CREATOR,
    LogModule.NODE_TRAVERSER
  ],

  // Utilities
  UTILITIES: [
    LogModule.STYLE_PROCESSOR,
    LogModule.LAYOUT_PROCESSOR
  ],

  // Extension
  EXTENSION: [
    LogModule.EXT_IMAGES,
    LogModule.EXT_BACKGROUND,
    LogModule.EXT_CONTENT
  ]
};

/**
 * Get all available modules.
 */
export function getAllModules(): LogModule[] {
  return Object.values(LogModule).filter(module => module !== LogModule.ALL);
}

/**
 * Get all modules in a group.
 */
export function getModulesInGroup(groupName: keyof typeof MODULE_GROUPS): LogModule[] {
  return MODULE_GROUPS[groupName];
}

/**
 * Check if a module name is valid.
 */
export function isValidModule(module: string): module is LogModule {
  return Object.values(LogModule).includes(module as LogModule);
}

/**
 * Look up a LogModule by name string.
 */
export function getLogModule(moduleName: string): LogModule | null {
  if (isValidModule(moduleName)) {
    return moduleName as LogModule;
  }
  return null;
}

/**
 * Get a human-readable display name for a module.
 */
export function getModuleDisplayName(module: LogModule): string {
  return module.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

/**
 * Categorized module list (for UI display).
 */
export const CATEGORIZED_MODULES: Record<string, LogModule[]> = {
  'Figma Creators': MODULE_GROUPS.FIGMA_CREATORS,
  'Core Services': MODULE_GROUPS.CORE_SERVICES,
  'Utilities': MODULE_GROUPS.UTILITIES,
  'Extension': MODULE_GROUPS.EXTENSION
};

// Type definitions
export type ModuleGroupName = keyof typeof MODULE_GROUPS;
export type CategorizedModuleName = keyof typeof CATEGORIZED_MODULES;
