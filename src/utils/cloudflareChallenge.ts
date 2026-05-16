const CF_MARKERS = [
    'cf-browser-verification',
    'DDoS protection by Cloudflare',
    'Checking your browser',
    'challenge-platform',
    '_cf_chl',
    'cf-mitigated',
];

export function isCloudflareChallenge(status: number, responseText: string): boolean {
    if (status !== 403) return false;
    return CF_MARKERS.some(marker => responseText.includes(marker));
}
