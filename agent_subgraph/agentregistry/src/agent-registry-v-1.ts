import {
  AgentAppealed as AgentAppealedEvent,
  AgentRegistered as AgentRegisteredEvent,
  AgentRestored as AgentRestoredEvent,
  AgentSlashed as AgentSlashedEvent,
  AgentUnregistered as AgentUnregisteredEvent,
  MisbehaviorReported as MisbehaviorReportedEvent,
  RoleAdminChanged as RoleAdminChangedEvent,
  RoleGranted as RoleGrantedEvent,
  RoleRevoked as RoleRevokedEvent,
  ServiceUpdated as ServiceUpdatedEvent,
  StakeUpdated as StakeUpdatedEvent,
  TreasuryUpdated as TreasuryUpdatedEvent
} from "../generated/AgentRegistry_v1/AgentRegistry_v1"
import {
  AgentAppealed,
  AgentRegistered,
  AgentRestored,
  AgentSlashed,
  AgentUnregistered,
  MisbehaviorReported,
  RoleAdminChanged,
  RoleGranted,
  RoleRevoked,
  ServiceUpdated,
  StakeUpdated,
  TreasuryUpdated,
  Agent,
  RoleMember
} from "../generated/schema"
import { BigInt, Bytes, crypto, ByteArray } from "@graphprotocol/graph-ts"

// ==========================================================
// 常量与辅助函数
// ==========================================================

// 已知角色哈希 → 可读标签的映射
// DEFAULT_ADMIN_ROLE = 0x00...00 (OpenZeppelin 约定)
// GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE")
let ZERO_BYTES32 = Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000000")
let GOVERNANCE_ROLE_HASH = Bytes.fromUint8Array(crypto.keccak256(ByteArray.fromUTF8("GOVERNANCE_ROLE")))

/**
 * 将 bytes32 角色哈希转换为人类可读的字符串标签
 * 方便 Sidecar 直接按名称查询角色
 */
function getRoleLabel(role: Bytes): string {
  if (role.equals(ZERO_BYTES32)) return "DEFAULT_ADMIN"
  if (role.equals(GOVERNANCE_ROLE_HASH)) return "GOVERNANCE"
  // 未知角色：返回哈希前 10 个字符，便于调试识别
  return "UNKNOWN_" + role.toHexString().slice(0, 10)
}

// ==========================================================
// Agent 生命周期处理函数
// ==========================================================

/**
 * 处理申诉事件
 * 仅记录 immutable 事件日志，不改变 Agent 状态（申诉本身不代表成功）
 */
export function handleAgentAppealed(event: AgentAppealedEvent): void {
  let entity = new AgentAppealed(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.agentAddress = event.params.agentAddress
  entity.evidenceCid = event.params.evidenceCid
  entity.timestamp = event.params.timestamp

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

/**
 * 处理注册事件
 * 1. 记录 immutable 事件日志
 * 2. 创建 Agent 聚合实体，初始化 DID、InitScore、StakeAmount 等核心状态
 */
export function handleAgentRegistered(event: AgentRegisteredEvent): void {
  let entity = new AgentRegistered(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.agentAddress = event.params.agentAddress
  entity.did = event.params.did
  entity.cid = event.params.cid
  entity.initScore = event.params.initScore
  entity.stakeAmount = event.params.stakeAmount

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()

  // 创建或更新 Agent 聚合实体（mutable）
  let agent = new Agent(event.params.agentAddress.toHexString())
  agent.did = event.params.did
  agent.cid = event.params.cid
  agent.initScore = event.params.initScore
  agent.stakeAmount = event.params.stakeAmount
  agent.accumulatedPenalty = BigInt.fromI32(0)
  agent.lastMisconductTimestamp = BigInt.fromI32(0)
  agent.slashed = false
  agent.isRegistered = true
  agent.lastUpdatedBlock = event.block.number
  agent.save()
}

/**
 * 处理恢复事件 (治理动作)
 * 1. 记录 immutable 事件日志
 * 2. 更新 Agent 聚合实体：重置罚分、解除 slashed 状态(可选)、更新违规时间戳
 */
export function handleAgentRestored(event: AgentRestoredEvent): void {
  let entity = new AgentRestored(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.agentAddress = event.params.agentAddress
  entity.slashed = event.params.slashed
  entity.newTotalPenalty = event.params.newTotalPenalty
  entity.newlastMisconductTimestamp = event.params.newlastMisconductTimestamp
  entity.reason = event.params.reason

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()

  let agent = Agent.load(event.params.agentAddress.toHexString())
  if (agent == null) {
    return
  }
  agent.slashed = event.params.slashed
  agent.accumulatedPenalty = event.params.newTotalPenalty
  agent.lastMisconductTimestamp = event.params.newlastMisconductTimestamp
  agent.lastUpdatedBlock = event.block.number
  agent.save()
}

/**
 * 处理罚没事件 (治理动作)
 * 1. 记录 immutable 事件日志
 * 2. 更新 Agent 聚合实体：增加累计罚分、扣除质押金、设置 slashed 状态
 */
export function handleAgentSlashed(event: AgentSlashedEvent): void {
  let entity = new AgentSlashed(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.agentAddress = event.params.agentAddress
  entity.slashed = event.params.slashed
  entity.penaltyScore = event.params.penaltyScore
  entity.newTotalPenalty = event.params.newTotalPenalty
  entity.slashedEthAmount = event.params.slashedEthAmount
  entity.reason = event.params.reason

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
  let agent = Agent.load(event.params.agentAddress.toHexString())
  if (agent == null) {
    return
  }
  agent.slashed = event.params.slashed
  agent.accumulatedPenalty = event.params.newTotalPenalty
  agent.stakeAmount = agent.stakeAmount.minus(event.params.slashedEthAmount)
  agent.lastMisconductTimestamp = event.block.timestamp
  agent.lastUpdatedBlock = event.block.number
  agent.save()
}

/**
 * 处理注销事件
 * 更新 Agent 聚合实体：标记为已注销 (isRegistered=false)，但保留历史数据
 */
export function handleAgentUnregistered(event: AgentUnregisteredEvent): void {
  let entity = new AgentUnregistered(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.agentAddress = event.params.agentAddress
  entity.did = event.params.did

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()

  let agent = Agent.load(event.params.agentAddress.toHexString())
  if (agent == null) {
    return
  }
  agent.isRegistered = false
  agent.stakeAmount = BigInt.fromI32(0)
  agent.lastUpdatedBlock = event.block.number
  agent.save()
}

/**
 * 处理违规举报
 * 仅记录证据 CID，具体的罚没由 Governance 决定
 */
export function handleMisbehaviorReported(
  event: MisbehaviorReportedEvent
): void {
  let entity = new MisbehaviorReported(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.reporter = event.params.reporter
  entity.targetAgent = event.params.targetAgent
  entity.evidenceCid = event.params.evidenceCid
  entity.timestamp = event.params.timestamp

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

// ==========================================================
// 角色与权限管理 (AccessControl)
// ==========================================================

/**
 * 处理角色管理员变更 (Meta-Governance)
 * 此事件仅在调用 `_setRoleAdmin` 时触发。
 * 作用是改变“谁有权管理某个角色”，而不是改变“谁持有某个角色”。
 * 实际运行中极少触发，仅作日志记录备查。
 */
export function handleRoleAdminChanged(event: RoleAdminChangedEvent): void {
  let entity = new RoleAdminChanged(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.role = event.params.role
  entity.previousAdminRole = event.params.previousAdminRole
  entity.newAdminRole = event.params.newAdminRole

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

/**
 * 处理角色授予 (Grant Role)
 * 1. 记录 immutable 事件日志
 * 2. 更新或创建 RoleMember 聚合实体，标记 isActive=true
 * 3. 兼容 EOA / Multi-sig / DAO 等任意地址类型
 */
export function handleRoleGranted(event: RoleGrantedEvent): void {
  let entity = new RoleGranted(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.role = event.params.role
  entity.account = event.params.account
  entity.sender = event.params.sender

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()

  // 更新 RoleMember 聚合实体（兼容 EOA / Multi-sig / DAO Governor）
  // ID = roleBytesHexString + "-" + accountHexString
  let memberId = event.params.role.toHexString() + "-" + event.params.account.toHexString()
  let member = RoleMember.load(memberId)
  if (member == null) {
    member = new RoleMember(memberId)
    member.role = event.params.role
    member.roleLabel = getRoleLabel(event.params.role)
    member.account = event.params.account
    member.grantedAtBlock = event.block.number
    member.grantedAtTimestamp = event.block.timestamp
  }
  member.isActive = true
  member.lastUpdatedBlock = event.block.number
  member.save()
}

/**
 * 处理角色撤销 (Revoke Role)
 * 1. 记录 immutable 事件日志
 * 2. 更新 RoleMember 聚合实体，标记 isActive=false (保留历史记录，不删除)
 */
export function handleRoleRevoked(event: RoleRevokedEvent): void {
  let entity = new RoleRevoked(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.role = event.params.role
  entity.account = event.params.account
  entity.sender = event.params.sender

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()

  // 更新 RoleMember 聚合实体
  let memberId = event.params.role.toHexString() + "-" + event.params.account.toHexString()
  let member = RoleMember.load(memberId)
  if (member == null) {
    return
  }
  member.isActive = false
  member.lastUpdatedBlock = event.block.number
  member.save()
}

// ==========================================================
// 业务状态更新处理函数
// ==========================================================

/**
 * 处理服务元数据更新
 * 更新 Agent 实体的 CID 字段
 */
export function handleServiceUpdated(event: ServiceUpdatedEvent): void {
  let entity = new ServiceUpdated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.agentAddress = event.params.agentAddress
  entity.newCid = event.params.newCid

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()

  let agent = Agent.load(event.params.agentAddress.toHexString())
  if (agent == null) {
    return
  }
  agent.cid = event.params.newCid
  agent.lastUpdatedBlock = event.block.number
  agent.save()
}

/**
 * 处理质押变更
 * 更新 Agent 实体的质押金额和初始信誉分 (initScore)
 */
export function handleStakeUpdated(event: StakeUpdatedEvent): void {
  let entity = new StakeUpdated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.agentAddress = event.params.agentAddress
  entity.oldStake = event.params.oldStake
  entity.newStake = event.params.newStake
  entity.oldInitScore = event.params.oldInitScore
  entity.newInitScore = event.params.newInitScore

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()

  let agent = Agent.load(event.params.agentAddress.toHexString())
  if (agent == null) {
    return
  }
  agent.stakeAmount = event.params.newStake
  agent.initScore = event.params.newInitScore
  agent.lastUpdatedBlock = event.block.number
  agent.save()
}

/**
 * 处理金库地址更新
 * 仅记录事件日志
 */
export function handleTreasuryUpdated(event: TreasuryUpdatedEvent): void {
  let entity = new TreasuryUpdated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.oldTreasury = event.params.oldTreasury
  entity.newTreasury = event.params.newTreasury

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}
