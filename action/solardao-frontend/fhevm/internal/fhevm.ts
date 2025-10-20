import { JsonRpcProvider, Eip1193Provider } from "ethers";
import { RelayerSDKLoader } from "./RelayerSDKLoader";

type PublicKey = { id: string; data: string } | undefined;
type PublicParams = { [bits: string]: string } | null;

declare global {
  interface Window { relayerSDK: any; }
}

async function getChainId(p: Eip1193Provider | string) {
  if (typeof p === 'string') {
    const rpc = new JsonRpcProvider(p);
    return Number((await rpc.getNetwork()).chainId);
  }
  const idHex = await p.request({ method: 'eth_chainId' });
  return parseInt(String(idHex), 16);
}

async function getWeb3Client(rpcUrl: string) {
  const rpc = new JsonRpcProvider(rpcUrl);
  return rpc.send('web3_clientVersion', []);
}

async function tryFetchFHEVMHardhatNodeRelayerMetadata(rpcUrl: string): Promise<{
  ACLAddress: `0x${string}`; InputVerifierAddress: `0x${string}`; KMSVerifierAddress: `0x${string}`;
} | undefined> {
  const version = await getWeb3Client(rpcUrl).catch(() => undefined);
  if (!version || typeof version !== 'string' || !version.toLowerCase().includes('hardhat')) return undefined;
  const rpc = new JsonRpcProvider(rpcUrl);
  try {
    const meta = await rpc.send('fhevm_relayer_metadata', []);
    if (meta && typeof meta === 'object' && meta.ACLAddress && meta.InputVerifierAddress && meta.KMSVerifierAddress) return meta;
  } catch {}
  return undefined;
}

export async function createFhevmInstance(options: {
  provider: Eip1193Provider | string;
  mockChains?: Record<number, string>;
}) {
  const { provider, mockChains } = options;
  const chainId = await getChainId(provider);
  const mapping = { 31337: 'http://localhost:8545', ...(mockChains ?? {}) } as Record<number, string>;
  const rpcUrl = mapping[chainId];
  if (rpcUrl) {
    const meta = await tryFetchFHEVMHardhatNodeRelayerMetadata(rpcUrl);
    if (meta) {
      const { createMockInstance } = await import('./mock/fhevmMock');
      return createMockInstance(rpcUrl, chainId, meta);
    }
  }

  const loader = new RelayerSDKLoader();
  await loader.load();
  if (!window.relayerSDK.__initialized__) {
    const ok = await window.relayerSDK.initSDK();
    if (!ok) throw new Error('relayerSDK.initSDK failed');
    window.relayerSDK.__initialized__ = true;
  }

  const aclAddress = window.relayerSDK.SepoliaConfig.aclContractAddress;
  const instance = await window.relayerSDK.createInstance({
    ...window.relayerSDK.SepoliaConfig,
    network: provider,
    publicKey: undefined as PublicKey,
    publicParams: null as PublicParams,
  });
  return instance;
}



