/**
 * Build the Console web deep-link to a deployment's detail page, e.g.
 * `https://console.akash.network/deployments/<dseq>`. The web app resolves the
 * network from the user's session, so no network segment is needed in the URL.
 */
export function consoleDeploymentUrl(webUrl: string, dseq: string): string {
  return `${webUrl.replace(/\/+$/, "")}/deployments/${dseq}`;
}
