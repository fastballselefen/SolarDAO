"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FhevmDecryptionSignature } from "../fhevm/FhevmDecryptionSignature";
import { GenericStringInMemoryStorage } from "../fhevm/GenericStringStorage";
import { ethers } from "ethers";
import { createFhevmInstance } from "../fhevm/internal/fhevm";
import abi from "../abi/SolarDAOABI.json";
import { SolarDAOAddresses } from "../abi/SolarDAOAddresses";

export default function Home() {
  const [provider, setProvider] = useState<ethers.Eip1193Provider | undefined>(undefined);
  const [signer, setSigner] = useState<ethers.JsonRpcSigner | undefined>(undefined);
  const [account, setAccount] = useState<string | undefined>(undefined);
  const [chainId, setChainId] = useState<number | undefined>(undefined);
  const [fhevm, setFhevm] = useState<any | undefined>(undefined);
  const [fhevmStatus, setFhevmStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [amount, setAmount] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [myTotalWh, setMyTotalWh] = useState<string>("0");
  const [myPending, setMyPending] = useState<string>("0");
  const [totalRevenue, setTotalRevenue] = useState<string>("0");
  const [totalGenWh, setTotalGenWh] = useState<string>("0");
  const [decMyWh, setDecMyWh] = useState<string>("-");
  const [decGlobalWh, setDecGlobalWh] = useState<string>("-");
  const [decTotalRevenue, setDecTotalRevenue] = useState<string>("-");
  const [decPending, setDecPending] = useState<string>("-");
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
    if (!provider || !chainId) { setFhevm(undefined); setFhevmStatus("idle"); return; }
    let mounted = true;
    setFhevmStatus("loading");
    createFhevmInstance({ provider, mockChains: { 31337: 'http://localhost:8545' } })
      .then((inst) => { if (mounted) { setFhevm(inst); setFhevmStatus("ready"); } })
      .catch((e) => { if (mounted) { setStatus(String(e)); setFhevmStatus("error"); } });
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
    const fetch = async () => {
      try {
        const [myWh, totalRev, totalGen] = await Promise.all([
          readonlyContract.userTotalWh(account),
          readonlyContract.totalRevenue(),
          readonlyContract.totalGenerationWh(),
        ]);
        setTotalRevenue(ethers.formatEther(totalRev));
        setTotalGenWh(totalGen.toString());
        const [, debt] = await readonlyContract.getMyInfo();
        const acc = await readonlyContract.accRewardPerWh();
        const pending = (BigInt(myWh) * BigInt(acc)) / BigInt(1e18) - BigInt(debt);
        setMyPending(ethers.formatEther(pending > 0 ? pending : 0));
      } catch {}
    };
    fetch();
    const timer = setInterval(fetch, 5000);
    return () => clearInterval(timer);
  }, [readonlyContract, account]);

  async function connect() {
    const mm = (window as any).ethereum;
    if (!mm) return;
    await mm.request({ method: 'eth_requestAccounts' });
  }

  async function record() {
    if (!fhevm || !contract || !account || !amount) return;
    const value = Math.max(0, Math.floor(Number(amount)));
    setStatus('加密中...');
    const input = fhevm.createEncryptedInput(contract.target as `0x${string}`, account);
    input.add64(BigInt(value));
    const enc = await input.encrypt();
    setStatus('发送交易...');
    const tx = await contract.recordGeneration(enc.handles[0], enc.inputProof, value);
    setStatus('等待确认...');
    await tx.wait();
    setStatus(`✅ 记录成功: ${value} Wh`);
    setAmount('');
    setTimeout(() => setStatus(''), 3000);
  }

  async function addRevenue() {
    if (!contract) return;
    setStatus('发送交易...');
    const tx = await contract.addRevenue({ value: ethers.parseEther('0.001') });
    await tx.wait();
    setStatus('✅ 收益已添加 0.001 ETH');
    try { await refreshDecrypted(); } catch {}
    setTimeout(() => setStatus(''), 3000);
  }

  async function claim() {
    if (!contract) return;
    setStatus('领取中...');
    const tx = await contract.claimReward();
    await tx.wait();
    setStatus('✅ 收益已领取');
    try { await refreshDecrypted(); } catch {}
    setTimeout(() => setStatus(''), 3000);
  }

  async function decryptMyTotal() {
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
      const globalHandle = await contract.getEncTotalGeneration();
      const res = await fhevm.userDecrypt(
        [
          { handle: myHandle, contractAddress: contract.target as `0x${string}` },
          { handle: globalHandle, contractAddress: contract.target as `0x${string}` }
        ],
        sig.privateKey,
        sig.publicKey,
        sig.signature,
        sig.contractAddresses,
        sig.userAddress,
        sig.startTimestamp,
        sig.durationDays
      );
      const myClear = res[myHandle];
      const globalClear = res[globalHandle];
      setDecMyWh(String(myClear));
      setDecGlobalWh(String(globalClear));

      // 计算可领取收益（基于已解密的 myClear）
      const [acc, info, rev] = await Promise.all([
        contract.accRewardPerWh(),
        contract.getMyInfo(),
        contract.totalRevenue()
      ]);
      const debt = info[1];
      const pending = (BigInt(myClear) * BigInt(acc)) / BigInt(1e18) - BigInt(debt);
      const pos = pending > 0n ? pending : 0n;
      setDecPending(ethers.formatEther(pos));
      setDecTotalRevenue(ethers.formatEther(rev));
      setStatus('✅ 解密成功');
      setTimeout(() => setStatus(''), 2000);
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
      const globalHandle = await contract.getEncTotalGeneration();
      const res = await fhevm.userDecrypt(
        [
          { handle: myHandle, contractAddress: contract.target as `0x${string}` },
          { handle: globalHandle, contractAddress: contract.target as `0x${string}` }
        ],
        sig.privateKey,
        sig.publicKey,
        sig.signature,
        sig.contractAddresses,
        sig.userAddress,
        sig.startTimestamp,
        sig.durationDays
      );
      const myClear = res[myHandle];
      const globalClear = res[globalHandle];
      setDecMyWh(String(myClear));
      setDecGlobalWh(String(globalClear));
      const [acc, info, rev] = await Promise.all([
        contract.accRewardPerWh(),
        contract.getMyInfo(),
        contract.totalRevenue()
      ]);
      const debt = info[1];
      const pending = (BigInt(myClear) * BigInt(acc)) / BigInt(1e18) - BigInt(debt);
      const pos = pending > 0n ? pending : 0n;
      setDecPending(ethers.formatEther(pos));
      setDecTotalRevenue(ethers.formatEther(rev));
    } catch {}
  }

  useEffect(() => {
    if (!fhevm || !contract || !signer) return;
    refreshDecrypted();
  }, [fhevm, contract, signer]);

  const getFhevmStatusBadge = () => {
    switch (fhevmStatus) {
      case "loading": return <span className="status-badge status-loading pulse">🔄 FHEVM 加载中</span>;
      case "ready": return <span className="status-badge status-ready">✅ FHEVM 已就绪</span>;
      case "error": return <span className="status-badge status-error">❌ FHEVM 错误</span>;
      default: return <span className="status-badge">⏸ FHEVM 未初始化</span>;
    }
  };

  return (
    <main className="container">
      <nav className="navbar">
        <div className="logo">
          ☀️ SolarDAO
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link className="btn btn-secondary" href="/">首页</Link>
          <Link className="btn btn-secondary" href="/leaderboard">排行榜</Link>
          <Link className="btn btn-secondary" href="/charts">数据图表</Link>
          <Link className="btn btn-secondary" href="/rewards">收益中心</Link>
        </div>
        <div className="nav-info">
          {getFhevmStatusBadge()}
          <span style={{ color: '#94a3b8' }}>Chain: {chainId || '—'}</span>
          {account ? (
            <button className="btn btn-secondary">{account.slice(0, 6)}...{account.slice(-4)}</button>
          ) : (
            <button className="btn btn-primary" onClick={connect}>连接钱包</button>
          )}
        </div>
      </nav>

      <div className="dashboard">
        <div className="card">
          <div className="card-icon">☀️</div>
          <div className="card-label">我的累计发电</div>
          <div className="card-value">{decMyWh}</div>
          <div className="card-subtitle">Wh</div>
          <div style={{ marginTop: 8 }}>
            <button className="btn btn-secondary" onClick={decryptMyTotal} disabled={!contract || !fhevm}>🔐 解密查看</button>
          </div>
        </div>
        <div className="card">
          <div className="card-icon">💰</div>
          <div className="card-label">可领取收益</div>
          <div className="card-value">{decPending === '-' ? '-' : parseFloat(decPending).toFixed(4)}</div>
          <div className="card-subtitle">ETH</div>
        </div>
        <div className="card">
          <div className="card-icon">📊</div>
          <div className="card-label">全局总发电</div>
          <div className="card-value">{decGlobalWh}</div>
          <div className="card-subtitle">Wh</div>
        </div>
        <div className="card">
          <div className="card-icon">🏦</div>
          <div className="card-label">总收益池</div>
          <div className="card-value">{decTotalRevenue === '-' ? '-' : parseFloat(decTotalRevenue).toFixed(4)}</div>
          <div className="card-subtitle">ETH</div>
        </div>
      </div>

      <div className="action-panel">
        <h2 className="section-title">⚡️ 操作面板</h2>
        <div className="input-group">
          <label className="input-label">今日发电量 (Wh)</label>
          <input 
            className="input-field"
            type="number" 
            value={amount} 
            onChange={(e) => setAmount(e.target.value)} 
            placeholder="输入发电量 (例如: 5000)"
          />
        </div>
        <div className="btn-group">
          <button className="btn btn-primary" onClick={record} disabled={!contract || !fhevm || !amount}>
            📝 提交发电量
          </button>
          <button className="btn btn-secondary" onClick={addRevenue} disabled={!contract}>
            💵 添加收益 0.001 ETH
          </button>
          <button className="btn btn-primary" onClick={claim} disabled={!contract}>
            🎁 领取收益
          </button>
        </div>
        {status && <div className="status-message">{status}</div>}
      </div>
    </main>
  );
}
