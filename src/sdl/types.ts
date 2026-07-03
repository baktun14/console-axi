/**
 * Narrow structural types for the parts of an SDL the CLI reads directly
 * (linting, summaries, resource derivation). This is intentionally partial —
 * chain-sdk's `validateSDL` owns full-schema validation; these types only cover
 * the fields we touch, and every field is optional because we run over
 * not-yet-validated input.
 */

export interface SdlExposeTo {
  global?: boolean;
  service?: string;
  ip?: string;
}

export interface SdlExpose {
  port?: number;
  as?: number;
  proto?: string;
  to?: SdlExposeTo[];
  http_options?: Record<string, unknown>;
}

export interface SdlService {
  image?: string;
  command?: string[];
  args?: string[];
  env?: string[];
  expose?: SdlExpose[];
  dependencies?: Array<{ service?: string }>;
  params?: { storage?: Record<string, { mount?: string; readOnly?: boolean }> };
}

export interface SdlStorageVolume {
  name?: string;
  size?: string;
  attributes?: { persistent?: boolean; class?: string };
}

export interface SdlGpu {
  units?: number;
  attributes?: { vendor?: Record<string, Array<{ model?: string; ram?: string; interface?: string }>> };
}

export interface SdlComputeResources {
  cpu?: { units?: number | string };
  memory?: { size?: string };
  storage?: { size?: string } | SdlStorageVolume[];
  gpu?: SdlGpu;
}

export interface SdlPlacement {
  attributes?: Record<string, string>;
  signedBy?: { anyOf?: string[]; allOf?: string[] };
  pricing?: Record<string, { denom?: string; amount?: number | string }>;
}

export interface SdlDeploymentTarget {
  profile?: string;
  count?: number;
}

export interface SdlDoc {
  version?: string;
  services?: Record<string, SdlService>;
  profiles?: {
    compute?: Record<string, { resources?: SdlComputeResources }>;
    placement?: Record<string, SdlPlacement>;
  };
  deployment?: Record<string, Record<string, SdlDeploymentTarget>>;
  endpoints?: Record<string, { kind?: string }>;
}

/** A single validation problem, addressed by a JSON-ish path with an optional fix hint. */
export interface SdlIssue {
  path: string;
  message: string;
  hint?: string;
}

export interface SdlValidation {
  valid: boolean;
  errors: SdlIssue[];
  /** The parsed document, present whenever the YAML itself parsed (even if invalid). */
  parsed?: SdlDoc;
}
