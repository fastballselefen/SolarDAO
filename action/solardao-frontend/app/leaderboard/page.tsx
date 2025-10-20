"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ethers } from "ethers";
import abi from "../../abi/SolarDAOABI.json";
import { SolarDAOAddresses } from "../../abi/SolarDAOAddresses";
import { createFhevmInstance } from "../../fhevm/internal/fhevm";
import { FhevmDecryptionSignature } from "../../fhevm/FhevmDecryptionSignature";
import { GenericStringInMemoryStorage } from "../../fhevm/GenericStringStorage";

type Row = { address: string; totalWh: bigint };

export default function LeaderboardPage() {
  const [provider, setProvider] = useState<ethers.Eip1193Provider | undefined>(undefined);
  const [signer, setSigner] = useState<ethers.JsonRpcSigner | undefined>(undefined);
  const [account, setAccount] = useState<string | undefined>(undefined);
  const [chainId, setChainId] = useState<number | undefined>(undefined);
  const [fhevm, setFhevm] = useState<any | undefined>(undefined);
  const [status, setStatus] = useState<string>("");
  const [revealed, setRevealed] = useState<boolean>(false);
  const _sigStore = useMemo(() => new GenericStringInMemoryStorage(), []);
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    const mm = (window as any).ethereum;
    if (!mm) return;
    setProvider(mm);
    mm.request({ method: 'eth_chainId' }).then((id: string) => setChainId(parseInt(id, 16)));
    mm.request({ method: 'eth_accounts' }).then((accs: string[]) => accs?.[0] && setAccount(accs[0]));
    mm.on('accountsChanged', (accs: string[]) => setAccount(accs?.[0]));
    mm.on('chainChanged', (id: string) => setChainId(parseInt(id, 16)));
  }, []);

  useEffect(() => {
    if (!provider) { setSigner(undefined); return; }
    const bp = new ethers.BrowserProvider(provider);
    bp.getSigner().then(setSigner).catch(() => setSigner(undefined));
  }, [provider]);

  useEffect(() => {
    if (!provider || !chainId) { setFhevm(undefined); return; }
    let mounted = true;
    createFhevmInstance({ provider, mockChains: { 31337: 'http://localhost:8545' } })
      .then((inst) => { if (mounted) setFhevm(inst); })
      .catch(() => { if (mounted) setFhevm(undefined); });
    return () => { mounted = false; };
  }, [provider, chainId]);

  const readonlyContract = useMemo(() => {
    if (!chainId) return undefined;
    const net = chainId === 31337 ? 'localhost' : 'sepolia';
    const addr = (SolarDAOAddresses as any)[net]?.address;
    if (!addr) return undefined;
    const rpcUrl = chainId === 31337 ? 'http://localhost:8545' : undefined;
    if (!rpcUrl) return undefined;
    const rp = new ethers.JsonRpcProvider(rpcUrl);
    return new ethers.Contract(addr, abi as any, rp);
  }, [chainId]);

  const contract = useMemo(() => {
    if (!signer || !chainId) return undefined;
    const net = chainId === 31337 ? 'localhost' : 'sepolia';
    const addr = (SolarDAOAddresses as any)[net]?.address;
    if (!addr) return undefined;
    return new ethers.Contract(addr, abi as any, signer);
  }, [signer, chainId]);

  useEffect(() => {
    if (!readonlyContract) return;
    const run = async () => {
      const filter = readonlyContract.filters.GenerationRecorded();
      const logs = await readonlyContract.queryFilter(filter, 0, 'latest');
      const map = new Map<string, bigint>();
      for (const log of logs) {
        const user: string = (log.args as any)[0];
        const amount: bigint = BigInt((log.args as any)[1]);
        map.set(user, (map.get(user) ?? 0n) + amount);
      }
      const list: Row[] = Array.from(map.entries()).map(([address, totalWh]) => ({ address, totalWh }));
      list.sort((a, b) => (b.totalWh > a.totalWh ? 1 : -1));
      setRows(list.slice(0, 10));
    };
    run();
  }, [readonlyContract]);

  async function decryptReveal() {
    if (!fhevm || !contract || !signer) return;
    try {
      setStatus('🔐 解密授权签名中...');
      const sig = await FhevmDecryptionSignature.loadOrSign(
        fhevm,
        [contract.target as `0x${string}`],
        signer,
        _sigStore
      );
      if (!sig) { setStatus('❌ 无法创建解密签名'); return; }
      setStatus('🔐 解密中...');
      // 解密本人密文以完成授权动作（排行榜数据仍来自聚合事件）
      const myHandle = await contract.getMyEncTotal();
      const res = await fhevm.userDecrypt(
        [{ handle: myHandle, contractAddress: contract.target as `0x${string}` }],
        sig.privateKey,
        sig.publicKey,
        sig.signature,
        sig.contractAddresses,
        sig.userAddress,
        sig.startTimestamp,
        sig.durationDays
      );
      if (res[myHandle] !== undefined) {
        setRevealed(true);
        setStatus('✅ 已解密，排行榜数据已显示');
        setTimeout(() => setStatus(''), 1500);
      } else {
        setStatus('❌ 解密失败');
      }
    } catch (e) {
      setStatus('❌ 解密失败');
    }
  }

  return (
    <main className="container">
      <nav className="navbar">
        <div className="logo">🏆 发电排行榜</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link className="btn btn-secondary" href="/">首页</Link>
          <Link className="btn btn-secondary" href="/leaderboard">排行榜</Link>
          <Link className="btn btn-secondary" href="/charts">数据图表</Link>
          <Link className="btn btn-secondary" href="/rewards">收益中心</Link>
        </div>
        <div className="nav-info">
          <span style={{ color: '#94a3b8' }}>Chain: {chainId || '—'}</span>
          <button className="btn btn-primary" onClick={decryptReveal} disabled={!contract || !fhevm} style={{ marginLeft: 8 }}>🔐 解密显示排行榜</button>
        </div>
      </nav>

      <div className="action-panel">
        <h2 className="section-title">TOP 10</h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: '#94a3b8', textAlign: 'left' }}>
                <th style={{ padding: '12px' }}>名次</th>
                <th style={{ padding: '12px' }}>地址</th>
                <th style={{ padding: '12px' }}>总发电量 (Wh)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.address} style={{ borderTop: '1px solid rgba(148,163,184,0.15)' }}>
                  <td style={{ padding: '12px' }}>{i + 1}</td>
                  <td style={{ padding: '12px' }}>{r.address.slice(0, 6)}...{r.address.slice(-4)}</td>
                  <td style={{ padding: '12px' }}>{revealed ? r.totalWh.toString() : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {status && <div className="status-message">{status}</div>}
    </main>
  );
}


