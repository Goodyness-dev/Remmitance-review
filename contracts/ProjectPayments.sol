// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IQoreKeyStatus {
    function pqcKeyStatus(address signer) external view returns (bool, uint8, bytes memory, bool);
}

interface IQoreVerify {
    function pqcVerify(bytes calldata key, bytes calldata signature, bytes calldata message) external view returns (bool);
}

/// One funded project. The contract authorizes instructions; the payment provider settles them.
contract ProjectPayments {
    struct Change {
        bytes32 destination;
        bytes32 evidence;
        bool confirmed;
    }

    enum PaymentState { Open, Claimed, Settled, Cancelled }

    struct Milestone {
        uint128 amount;
        uint64 dueAt;
        PaymentState state;
        bytes32 certificate;
        bytes32 instruction;
        uint64 version;
        uint64 expiry;
        bytes32 receipt;
    }

    bytes32 public immutable project;
    uint128 public immutable budget;
    address public immutable preparer;
    address public immutable contractor;
    address public immutable reviewer;
    address public immutable certifier;
    address public immutable gateway;
    address public immutable reconciler;
    bytes32 public destination;
    uint64 public version = 1;
    uint64 public approvalEpoch = 1;
    uint256 public actionNonce;
    uint128 public allocated;
    uint256 public outstanding;
    bool public closed;
    Change public change;

    mapping(bytes32 => Milestone) public milestones;
    mapping(bytes32 => bool) public usedReceipts;
    mapping(bytes32 => uint64) public authorizationEpoch;
    mapping(uint64 => bytes32) public destinationAtVersion;

    error Forbidden();
    error InvalidState();
    error InvalidSignature();

    event MilestoneScheduled(bytes32 indexed id, uint128 amount, uint64 dueAt);
    event WorkCertified(bytes32 indexed id, bytes32 evidence);
    event ChangeRequested(bytes32 indexed candidate, bytes32 evidence, uint64 version);
    event ChangeConfirmed(bytes32 indexed candidate, uint64 version);
    event ChangeDecided(bytes32 indexed candidate, bool approved, uint64 version, bytes32 evidence);
    event Authorized(bytes32 indexed id, bytes32 instruction, uint64 version, uint64 expiry);
    event Claimed(bytes32 indexed id, bytes32 instruction);
    event Settled(bytes32 indexed id, bytes32 receipt);
    event Cancelled(bytes32 indexed id, bytes32 evidence);
    event Closed();

    constructor(bytes32 projectId, uint128 limit, bytes32 initialDestination, address[6] memory roles) {
        if (projectId == 0 || limit == 0 || initialDestination == 0) revert InvalidState();
        for (uint256 i; i < roles.length; ++i) {
            if (roles[i] == address(0)) revert Forbidden();
            for (uint256 j; j < i; ++j) {
                if (roles[i] == roles[j]) revert Forbidden();
            }
        }
        project = projectId;
        budget = limit;
        destination = initialDestination;
        destinationAtVersion[1] = initialDestination;
        preparer = roles[0];
        contractor = roles[1];
        reviewer = roles[2];
        certifier = roles[3];
        gateway = roles[4];
        reconciler = roles[5];
    }

    modifier onlyOpen(address role) {
        if (msg.sender != role) revert Forbidden();
        if (closed) revert InvalidState();
        _;
    }

    function schedule(bytes32 id, uint128 amount, uint64 dueAt) external onlyOpen(preparer) {
        if (id == 0 || amount == 0 || dueAt == 0 || milestones[id].amount != 0 || amount > budget - allocated) {
            revert InvalidState();
        }
        allocated += amount;
        ++outstanding;
        milestones[id].amount = amount;
        milestones[id].dueAt = dueAt;
        emit MilestoneScheduled(id, amount, dueAt);
    }

    function certify(bytes32 id, bytes32 evidence) external onlyOpen(certifier) {
        Milestone storage milestone = _openMilestone(id);
        if (evidence == 0 || milestone.certificate != 0) revert InvalidState();
        milestone.certificate = evidence;
        emit WorkCertified(id, evidence);
    }

    function requestChange(bytes32 candidate, bytes32 evidence) external onlyOpen(preparer) {
        if (candidate == 0 || candidate == destination || evidence == 0 || change.destination != 0) revert InvalidState();
        change = Change(candidate, evidence, false);
        ++approvalEpoch;
        emit ChangeRequested(candidate, evidence, version);
    }

    function confirmChange(uint64 deadline, bytes calldata signature) external {
        _verify(contractor, confirmationDigest(deadline), deadline, signature);
        change.confirmed = true;
        emit ChangeConfirmed(change.destination, version);
    }

    function decideChange(bool approved, bytes32 evidence, uint64 deadline, bytes calldata signature) external {
        bytes32 candidate = change.destination;
        _verify(reviewer, decisionDigest(approved, evidence, deadline), deadline, signature);
        if (approved) {
            destination = candidate;
            ++version;
            destinationAtVersion[version] = candidate;
        }
        delete change;
        emit ChangeDecided(candidate, approved, version, evidence);
    }

    function authorize(bytes32 id, bytes32 instruction, uint64 expiry, bytes calldata signature) external {
        _verify(reviewer, authorizationDigest(id, instruction, expiry), expiry, signature);
        Milestone storage milestone = _openMilestone(id);
        milestone.instruction = instruction;
        milestone.version = version;
        milestone.expiry = expiry;
        authorizationEpoch[id] = approvalEpoch;
        emit Authorized(id, instruction, version, expiry);
    }

    function claim(bytes32 id, bytes32 instruction) external onlyOpen(gateway) {
        Milestone storage milestone = _openMilestone(id);
        if (change.destination != 0 || instruction != milestone.instruction || milestone.version != version
            || authorizationEpoch[id] != approvalEpoch || block.timestamp >= milestone.expiry) revert InvalidState();
        milestone.state = PaymentState.Claimed;
        emit Claimed(id, instruction);
    }

    function settle(bytes32 id, bytes32 receiptCommitment, bytes32 providerReferenceCommitment) external onlyOpen(reconciler) {
        Milestone storage milestone = milestones[id];
        if (milestone.state != PaymentState.Claimed || receiptCommitment == 0
            || providerReferenceCommitment == 0 || usedReceipts[providerReferenceCommitment]) revert InvalidState();
        usedReceipts[providerReferenceCommitment] = true;
        milestone.receipt = receiptCommitment;
        milestone.state = PaymentState.Settled;
        --outstanding;
        emit Settled(id, receiptCommitment);
    }

    function cancel(bytes32 id, bytes32 evidence, uint64 deadline, bytes calldata signature) external {
        Milestone storage milestone = _openMilestone(id);
        if (closed || evidence == 0) revert InvalidState();
        _verify(reviewer, signingDigest(keccak256("CANCEL_MILESTONE"), id, evidence, reviewer, deadline), deadline, signature);
        milestone.state = PaymentState.Cancelled;
        --outstanding;
        emit Cancelled(id, evidence);
    }

    function close() external onlyOpen(reconciler) {
        if (allocated == 0 || outstanding != 0 || change.destination != 0) revert InvalidState();
        closed = true;
        emit Closed();
    }

    function confirmationDigest(uint64 deadline) public view returns (bytes32) {
        if (closed || change.destination == 0 || change.confirmed) revert InvalidState();
        return signingDigest(keccak256("CONFIRM_CHANGE"), change.destination, change.evidence, contractor, deadline);
    }

    function decisionDigest(bool approved, bytes32 evidence, uint64 deadline) public view returns (bytes32) {
        bytes32 candidate = change.destination;
        if (closed || candidate == 0 || evidence == 0 || (approved && !change.confirmed)) revert InvalidState();
        bytes32 details = keccak256(abi.encode(change.evidence, evidence, approved));
        return signingDigest(keccak256("DECIDE_CHANGE"), candidate, details, reviewer, deadline);
    }

    function authorizationDigest(bytes32 id, bytes32 instruction, uint64 expiry) public view returns (bytes32) {
        Milestone storage milestone = _openMilestone(id);
        if (closed || change.destination != 0 || milestone.certificate == 0 || instruction == 0) revert InvalidState();
        bytes32 details = keccak256(abi.encode(instruction, milestone.amount, destination, milestone.certificate));
        return signingDigest(keccak256("AUTHORIZE_PAYMENT"), id, details, reviewer, expiry);
    }

    function signingDigest(bytes32 action, bytes32 subject, bytes32 details, address signer, uint64 deadline)
        public view returns (bytes32)
    {
        return keccak256(abi.encode(
            keccak256("REMITTANCE_REVIEW_NGN_V1"), block.chainid, address(this), project, action, subject,
            details, signer, version, approvalEpoch, actionNonce, deadline
        ));
    }

    function _openMilestone(bytes32 id) private view returns (Milestone storage milestone) {
        milestone = milestones[id];
        if (milestone.amount == 0 || milestone.state != PaymentState.Open) revert InvalidState();
    }

    function _verify(address signer, bytes32 digest, uint64 deadline, bytes calldata signature) private {
        if (block.timestamp >= deadline || signature.length != 4627) revert InvalidSignature();
        bytes memory message = abi.encodePacked("qorechain-msg-v1|qorechain-diana|", digest);
        bytes memory key = _registeredKey(signer);
        (bool ok, bytes memory result) = address(0x0a01).staticcall(
            abi.encodeCall(IQoreVerify.pqcVerify, (key, signature, message))
        );
        if (!ok || result.length != 32 || !abi.decode(result, (bool))) revert InvalidSignature();
        ++actionNonce;
    }

    function _registeredKey(address signer) private view returns (bytes memory key) {
        (bool keyRead, bytes memory keyData) = address(0x0a02).staticcall(
            abi.encodeCall(IQoreKeyStatus.pqcKeyStatus, (signer))
        );
        if (!keyRead || keyData.length < 160) revert InvalidSignature();
        (bool registered, uint8 algorithm, bytes memory publicKey, bool proven) =
            abi.decode(keyData, (bool, uint8, bytes, bool));
        key = publicKey;
        if (!registered || algorithm != 1 || !proven || key.length != 2592) revert InvalidSignature();
    }
}
