/**
 * Public schema-registry entry point for agent tools.
 *
 * Keeping runner imports pointed at this module lets tool definitions and
 * validation move out of the large tools implementation incrementally without
 * changing callers.
 */
export {
  HANDOFF_NOTES_TOOL_DEFAULT,
  HANDOFF_NOTES_TOOL_MAX,
  TOOL_INPUT_SCHEMAS,
  validateToolInput,
} from "./tool-input-validation.ts";

/** Add JSON Schema's strict unknown-property guard to a tool input schema. */
export function strictInputSchema<
  T extends {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  },
>(schema: T): T & { additionalProperties: false } {
  return { ...schema, additionalProperties: false };
}
