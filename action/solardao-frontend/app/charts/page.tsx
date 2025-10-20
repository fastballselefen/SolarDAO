"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ethers } from "ethers";
import abi from "../../abi/SolarDAOABI.json";
import { SolarDAOAddresses } from "../../abi/SolarDAOAddresses";
import { Line, Pie } from "react-chartjs-2";
import { createFhevmInstance } from "../../fhevm/internal/fhevm";
import { FhevmDecryptionSignature } from "../../fhevm/FhevmDecryptionSignature";
import { GenericStringInMemoryStorage } from "../../fhevm/GenericStringStorage";
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  ArcElement,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(LineElement, PointElement, CategoryScale, LinearScale, ArcElement, Tooltip, Legend);

export default function ChartsPage() {
  const [provider, setProvider] = useState<ethers.Eip1193Provider | undefined>(undefined);
  const [signer, setSigner] = useState<ethers.JsonRpcSigner | undefined>(undefined);
  const [account, setAccount] = useState<string | undefined>(undefined);
  const [chainId, setChainId] = useState<number | undefined>(undefined);
  const [daily, setDaily] = useState<{ date: string; value: number }[]>([]);
  const [share, setShare] = useState<{ label: string; value: number }[]>([]);
  const [fhevm, setFhevm] = useState<any | undefined>(undefined);
  const [status, setStatus] = useState<string>("");
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
    if (!readonlyContract || !revealed) return;
    const run = async () => {
      const logs = await readonlyContract.queryFilter(readonlyContract.filters.GenerationRecorded(), 0, 'latest');

      // 我的日发电曲线
      const mine = logs.filter((l: any) => (l.args as any)[0]?.toLowerCase() === (account || '').toLowerCase());
      const dailyMap = new Map<string, number>();
      for (const log of mine) {
        const block = await log.getBlock();
        const d = new Date(Number(block.timestamp) * 1000);
        const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
        const v = Number((log.args as any)[1]);
        dailyMap.set(key, (dailyMap.get(key) || 0) + v);
      }
      const dailyData = Array.from(dailyMap.entries())
        .map(([date, value]) => ({ date, value }))
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      setDaily(dailyData);

      // 发电占比饼图（前 5 + 其他）
      const totals = new Map<string, number>();
      for (const log of logs) {
        const u = (log.args as any)[0];
        const v = Number((log.args as any)[1]);
        totals.set(u, (totals.get(u) || 0) + v);
      }
      const list = Array.from(totals.entries()).map(([label, value]) => ({ label, value }));
      list.sort((a, b) => b.value - a.value);
      const top5 = list.slice(0, 5);
      const others = list.slice(5).reduce((s, x) => s + x.value, 0);
      if (others > 0) top5.push({ label: 'Others', value: others });
      setShare(top5);
    };
    run();
  }, [readonlyContract, account, revealed]);

  async function decryptReveal() {
    if (!fhevm || !signer) return;
    try {
      setStatus('🔐 解密授权签名中...');
      // 需要一个合约地址参与签名，使用当前网络的 SolarDAO 地址
      if (!chainId) return;
      const net = chainId === 31337 ? 'localhost' : 'sepolia';
      const addr = (SolarDAOAddresses as any)[net]?.address as `0x${string}` | undefined;
      if (!addr) return;
      const sig = await FhevmDecryptionSignature.loadOrSign(
        fhevm,
        [addr],
        signer,
        _sigStore
      );
      if (!sig) { setStatus('❌ 无法创建解密签名'); return; }
      setRevealed(true);
      setStatus('✅ 解密授权成功，已显示图表');
      setTimeout(() => setStatus(''), 1500);
    } catch (e) {
      setStatus('❌ 解密失败');
    }
  }

  return (
    <main className="container">
      <nav className="navbar">
        <div className="logo">📈 数据图表</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link className="btn btn-secondary" href="/">首页</Link>
          <Link className="btn btn-secondary" href="/leaderboard">排行榜</Link>
          <Link className="btn btn-secondary" href="/charts">数据图表</Link>
          <Link className="btn btn-secondary" href="/rewards">收益中心</Link>
        </div>
        <div className="nav-info">
          <span style={{ color: '#94a3b8' }}>Chain: {chainId || '—'}</span>
          <button className="btn btn-primary" onClick={decryptReveal} disabled={!fhevm || !account} style={{ marginLeft: 8 }}>🔐 解密显示图表</button>
        </div>
      </nav>

      <div className="dashboard">
        <div className="card" style={{ gridColumn: 'span 2' }}>
          <div className="card-label">日发电量趋势（Wh）</div>
          {revealed ? (
            <Line data={{
              labels: daily.map(d => d.date),
              datasets: [{
                label: '我的发电量',
                data: daily.map(d => d.value),
                borderColor: '#10b981',
                backgroundColor: 'rgba(16,185,129,0.25)'
              }]
            }} options={{ plugins: { legend: { labels: { color: '#cbd5e1' } } }, scales: { x: { ticks: { color: '#94a3b8' } }, y: { ticks: { color: '#94a3b8' } } } }} />
          ) : (
            <div style={{ color: '#94a3b8', padding: 12 }}>🔐 点击右上角“解密显示图表”后可见</div>
          )}
        </div>

        <div className="card">
          <div className="card-label">发电占比（Top5）</div>
          {revealed ? (
            <Pie data={{
              labels: share.map(s => s.label.slice(0, 6) + '...' + s.label.slice(-4)),
              datasets: [{
                data: share.map(s => s.value),
                backgroundColor: ['#10b981', '#34d399', '#06b6d4', '#60a5fa', '#f59e0b', '#64748b']
              }]
            }} options={{ plugins: { legend: { labels: { color: '#cbd5e1' } } } }} />
          ) : (
            <div style={{ color: '#94a3b8', padding: 12 }}>🔐 点击右上角“解密显示图表”后可见</div>
          )}
        </div>
      </div>
      {status && <div className="status-message">{status}</div>}
    </main>
  );
}


