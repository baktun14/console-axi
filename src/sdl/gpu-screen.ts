import type { ApiClient } from "../api/client.js";
import { screenSupply } from "./screen.js";
import { synthesizeSdl } from "./synthesize.js";

/**
 * Real-time count of providers that would currently bid for a single unit of a
 * GPU model, via the bid-screening endpoint. Advisory (custom bid scripts mean
 * a match is not a guaranteed bid), but reflects live supply unlike the
 * ~15-min-delayed /v1/gpu-prices snapshot. The `gpu` template only models nvidia
 * vendors, so this is meaningful for nvidia models.
 */
export async function screenGpuModel(client: ApiClient, model: string): Promise<number> {
  const sdl = synthesizeSdl({ gpu: 1, gpuModel: model });
  const providers = await screenSupply(client, sdl);
  return providers.length;
}
