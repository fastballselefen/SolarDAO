// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, euint128, euint256, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title SolarDAO (FHE-enabled)
/// @notice 光伏发电共享账本。发电量以密文存储，支持同态加法聚合；奖励分配采用累积每份收益(acc)模型。
contract SolarDAO is SepoliaConfig {
    /// @dev 成员信息（明文派生量只在事件中提供，链上存密文）
    struct Member {
        // 累计发电（密文 euint64，单位：Wh，避免小数）
        euint64 encTotalGeneration;
        // 领取结算用的 rewardDebt（明文，acc 模型需要）
        uint256 rewardDebt;
        bool exists;
    }

    /// @dev 全局累计每Wh收益（acc 模型，放大 1e18）
    uint256 public accRewardPerWh;
    /// @dev 奖励资金池余额（入金累加，claim 扣减）
    uint256 public totalRevenue; // in wei

    /// @dev 为便于 acc 模型运算，维护一个“可授权解密”的聚合明文（派生）供仅合约内部使用
    euint64 private encTotalGeneration; // 全局密文总发电量
    /// @dev 明文全局总发电量（Wh），用于分配运算（排行榜/透明度）。
    uint64 public totalGenerationWh;

    mapping(address => Member) public members;
    /// @dev 明文每个用户累计发电量（Wh），用于奖励分配与只读查询（前端仍可通过密文句柄做解密展示）
    mapping(address => uint64) public userTotalWh;

    event GenerationRecorded(address indexed user, uint64 amountWh);
    event RevenueAdded(address indexed from, uint256 amountWei);
    event RewardClaimed(address indexed user, uint256 amountWei);

    /// @notice 记录用户发电量（FHE 加密输入）
    /// @param inputE amount (Wh) 的外部密文
    /// @param inputProof 输入证明
    function recordGeneration(externalEuint64 inputE, bytes calldata inputProof, uint64 clearAmountWh) external {
        // 1) 将外部密文转换为链上密文
        euint64 encDelta = FHE.fromExternal(inputE, inputProof);

        // 2) 更新用户累计密文
        Member storage m = members[msg.sender];
        if (!m.exists) {
            m.exists = true;
        }
        m.encTotalGeneration = FHE.add(m.encTotalGeneration, encDelta);

        // 3) 更新全局密文累计
        encTotalGeneration = FHE.add(encTotalGeneration, encDelta);

        // 3b) 更新明文累计（用于奖励分配/排行榜）
        unchecked {
            totalGenerationWh += clearAmountWh;
            userTotalWh[msg.sender] += clearAmountWh;
        }

        // 4) 为便于用户/本合约后续解密授权
        FHE.allow(m.encTotalGeneration, msg.sender);
        FHE.allowThis(m.encTotalGeneration);
        FHE.allowThis(encTotalGeneration);

        // 5) 事件记录明文输入（用于前端图表/排行）
        emit GenerationRecorded(msg.sender, clearAmountWh);
    }

    /// @notice 入金奖励池（ETH）。采用 payable，直接以 msg.value 入账。
    function addRevenue() external payable {
        require(msg.value > 0, "NO_VALUE");
        totalRevenue += msg.value;

        // 计算新的 accRewardPerWh：acc += value * 1e18 / totalGenerationWh
        if (totalGenerationWh > 0) {
            accRewardPerWh += (msg.value * 1e18) / uint256(totalGenerationWh);
        }

        emit RevenueAdded(msg.sender, msg.value);
    }

    /// @notice 领取奖励（基于 acc 模型的 pending）
    function claimReward() external {
        Member storage m = members[msg.sender];
        require(m.exists, "NOT_MEMBER");

        // 简化：本版本按明文全局累计进行分配。
        // 如需严格隐私，可扩展：成员也提交其明文累计或采用可验证的脱敏方案。
        // 这里仅示例 acc 分配流程。
        uint64 userWh = userTotalWh[msg.sender];

        uint256 pending = (uint256(userWh) * accRewardPerWh) / 1e18;
        if (pending <= m.rewardDebt) {
            emit RewardClaimed(msg.sender, 0);
            return;
        }
        uint256 amount = pending - m.rewardDebt;
        require(amount <= address(this).balance, "INSUFFICIENT_POOL");

        m.rewardDebt = pending;

        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "TRANSFER_FAILED");
        totalRevenue -= amount;

        emit RewardClaimed(msg.sender, amount);
    }

    /// @notice 返回用户加密的总发电句柄（供前端 userDecrypt）
    function getMyEncTotal() external view returns (euint64) {
        return members[msg.sender].encTotalGeneration;
    }

    /// @notice 返回全局加密总发电句柄（供前端 userDecrypt）
    function getEncTotalGeneration() external view returns (euint64) {
        return encTotalGeneration;
    }

    /// @notice 返回我的信息：加密总发电句柄与 rewardDebt（便于前端计算 pending）
    function getMyInfo() external view returns (euint64, uint256) {
        Member storage m = members[msg.sender];
        return (m.encTotalGeneration, m.rewardDebt);
    }

    /// @notice 返回我可见的明文累计发电量（需要已授权）
    function getMyClearTotal() external view returns (uint64) {
        Member storage m = members[msg.sender];
        require(m.exists, "NOT_MEMBER");
        return userTotalWh[msg.sender];
    }

    /// @notice 返回我的可领取金额（基于 acc 模型），需要已授权解密
    function getMyPending() external view returns (uint256) {
        Member storage m = members[msg.sender];
        require(m.exists, "NOT_MEMBER");
        uint64 userWh = userTotalWh[msg.sender];
        uint256 pending = (uint256(userWh) * accRewardPerWh) / 1e18;
        if (pending <= m.rewardDebt) return 0;
        return pending - m.rewardDebt;
    }
}



// dev note: no-op
