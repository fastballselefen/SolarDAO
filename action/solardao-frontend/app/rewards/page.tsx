"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ethers } from "ethers";
import abi from "../../abi/SolarDAOABI.json";
import { SolarDAOAddresses } from "../../abi/SolarDAOAddresses";
import { createFhevmInstance } from "../../fhevm/internal/fhevm";
import { FhevmDecryptionSignature } from "../../fhevm/FhevmDecryptionSignature";
import { GenericStringInMemoryStorage } from "../../fhevm/GenericStringStorage";

type ClaimRow = { tx: string; amount: string };

export default function RewardsPage() {
  const [provider, setProvider] = useState<ethers.Eip1193Provider | undefined>(undefined);
  const [signer, setSigner] = useState<ethers.JsonRpcSigner | undefined>(undefined);
  const [account, setAccount] = useState<string | undefined>(undefined);
  const [chainId, setChainId] = useState<number | undefined>(undefined);
  const [pending, setPending] = useState<string>("0");
  const [rows, setRows] = useState<ClaimRow[]>([]);
  const [status, setStatus] = useState<string>("");
  const [fhevm, setFhevm] = useState<any | undefined>(undefined);
  const [decPending, setDecPending] = useState<string>("-");
  const [revealed, setRevealed] = useState<boolean>(false);
  const _sigStore = useMemo(() => new GenericStringInMemoryStorage(), []);

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

  const contract = useMemo(() => {
    if (!signer || !chainId) return undefined;
    const net = chainId === 31337 ? 'localhost' : 'sepolia';
    const addr = (SolarDAOAddresses as any)[net]?.address;
    if (!addr) return undefined;
    return new ethers.Contract(addr, abi as any, signer);
  }, [signer, chainId]);

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

  useEffect(() => {
    if (!readonlyContract || !account) return;
    const run = async () => {
      try {
        const [myWh, acc, info] = await Promise.all([
          readonlyContract.userTotalWh(account),
          readonlyContract.accRewardPerWh(),
          readonlyContract.getMyInfo(),
        ]);
        const debt = info[1];
        const p = (BigInt(myWh) * BigInt(acc)) / BigInt(1e18) - BigInt(debt);
        setPending(ethers.formatEther(p > 0 ? p : 0));

        const filter = readonlyContract.filters.RewardClaimed(account);
        const logs = await readonlyContract.queryFilter(filter, 0, 'latest');
        const list: ClaimRow[] = logs.map((l: any) => ({ tx: l.transactionHash, amount: ethers.formatEther(l.args[1]) }));
        setRows(list.reverse());
      } catch {}
    };
    run();
  }, [readonlyContract, account]);

  async function claim() {
    if (!contract) return;
    setStatus('领取中...');
    const tx = await contract.claimReward();
    await tx.wait();
    setStatus('✅ 已领取');
    try { await refreshDecrypted(); } catch {}
    setTimeout(() => setStatus(''), 2500);
  }

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
      const myClear = res[myHandle];
      const [acc, info] = await Promise.all([
        contract.accRewardPerWh(),
        contract.getMyInfo(),
      ]);
      const debt = info[1];
      const pending = (BigInt(myClear) * BigInt(acc)) / BigInt(1e18) - BigInt(debt);
      const pos = pending > 0n ? pending : 0n;
      setDecPending(ethers.formatEther(pos));
      setRevealed(true);
      setStatus('✅ 解密成功');
      setTimeout(() => setStatus(''), 1500);
    } catch (e) {
      setStatus('❌ 解密失败');
    }
  }

  async function refreshDecrypted() {
    if (!fhevm || !contract || !signer) return;
    try {
      const sig = await FhevmDecryptionSignature.loadOrSign(
        fhevm,
        [contract.target as `0x${string}`],
        signer,
        _sigStore
      );
      if (!sig) return;
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
      const myClear = res[myHandle];
      const [acc, info] = await Promise.all([
        contract.accRewardPerWh(),
        contract.getMyInfo(),
      ]);
      const debt = info[1];
      const pending = (BigInt(myClear) * BigInt(acc)) / BigInt(1e18) - BigInt(debt);
      const pos = pending > 0n ? pending : 0n;
      setDecPending(ethers.formatEther(pos));
      setRevealed(true);
    } catch {}
  }

  useEffect(() => {
    if (!fhevm || !contract || !signer) return;
    refreshDecrypted();
  }, [fhevm, contract, signer]);

  return (
    <main className="container">
      <nav className="navbar">
        <div className="logo">🎁 收益中心</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link className="btn btn-secondary" href="/">首页</Link>
          <Link className="btn btn-secondary" href="/leaderboard">排行榜</Link>
          <Link className="btn btn-secondary" href="/charts">数据图表</Link>
          <Link className="btn btn-secondary" href="/rewards">收益中心</Link>
        </div>
        <div className="nav-info">
          <span style={{ color: '#94a3b8' }}>Chain: {chainId || '—'}</span>
          <button className="btn btn-primary" onClick={decryptReveal} disabled={!fhevm || !account} style={{ marginLeft: 8 }}>🔐 解密显示</button>
        </div>
      </nav>

      <div className="dashboard">
        <div className="card">
          <div className="card-label">当前可领取</div>
          <div className="card-value">{revealed ? parseFloat(decPending === '-' ? '0' : decPending).toFixed(6) : '-'}</div>
          <div className="card-subtitle">ETH</div>
        </div>
      </div>

      <div className="action-panel">
        <h2 className="section-title">操作</h2>
        <div className="btn-group">
          <button className="btn btn-primary" onClick={claim} disabled={!contract}>领取收益</button>
        </div>
        {status && <div className="status-message">{status}</div>}
      </div>

      <div className="action-panel" style={{ marginTop: 24 }}>
        <h2 className="section-title">领取历史</h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: '#94a3b8', textAlign: 'left' }}>
                <th style={{ padding: '12px' }}>Tx Hash</th>
                <th style={{ padding: '12px' }}>Amount (ETH)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.tx} style={{ borderTop: '1px solid rgba(148,163,184,0.15)' }}>
                  <td style={{ padding: '12px' }}>{r.tx.slice(0, 10)}...</td>
                  <td style={{ padding: '12px' }}>{revealed ? r.amount : '-'}</td>
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


