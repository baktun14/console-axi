import jsyaml from "js-yaml";

/**
 * Serialize an SDL object to YAML. Templates build a plain object (with keys in
 * SDL's conventional order); js-yaml preserves insertion order and quotes values
 * that would otherwise change type — notably `version: "2.0"`, which must stay a
 * string rather than becoming the float 2.0.
 */
export function toYaml(doc: Record<string, unknown>): string {
  return jsyaml.dump(doc, { lineWidth: -1, noRefs: true, quotingType: '"' });
}
