/** User-supplied knobs for `sdl init`. Every field is optional; each template applies its own defaults. */
export interface InitOptions {
  name?: string;
  image?: string;
  port?: number;
  as?: number;
  cpu?: string;
  memory?: string;
  storage?: string;
  count?: number;
  /** Max price per block, in uact. */
  price?: number;
  env?: string[];
  gpu?: number;
  gpuModel?: string;
}

export interface SdlTemplate {
  name: string;
  description: string;
  /** Flags that meaningfully affect this template, shown by `sdl templates`. */
  params: string[];
  /** Build a plain SDL object (keys in SDL's conventional order) from the options. */
  build(options: InitOptions): Record<string, unknown>;
}
