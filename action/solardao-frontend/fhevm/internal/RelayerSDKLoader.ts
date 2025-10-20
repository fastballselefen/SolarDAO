export const SDK_CDN_URL = "https://cdn.zama.ai/relayer-sdk-js/0.2.0/relayer-sdk-js.umd.cjs";

export function isRelayerLoaded(w: any): w is any {
  return typeof w !== 'undefined' && w && 'relayerSDK' in w;
}

export class RelayerSDKLoader {
  public async load() {
    if (typeof window === 'undefined') throw new Error('Not in browser');
    if (isRelayerLoaded(window)) return;
    await new Promise<void>((resolve, reject) => {
      const existing = document.querySelector(`script[src="${SDK_CDN_URL}"]`);
      if (existing) {
        if (isRelayerLoaded(window)) resolve(); else reject(new Error('Relayer SDK not ready'));
        return;
      }
      const s = document.createElement('script');
      s.src = SDK_CDN_URL;
      s.async = true;
      s.onload = () => isRelayerLoaded(window) ? resolve() : reject(new Error('Relayer SDK invalid'));
      s.onerror = () => reject(new Error(`Failed to load ${SDK_CDN_URL}`));
      document.head.appendChild(s);
    });
  }
}



