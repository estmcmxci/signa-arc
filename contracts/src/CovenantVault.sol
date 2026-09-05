// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FacilityRegistry } from "./FacilityRegistry.sol";
import { CoverageEngine } from "./CoverageEngine.sol";

interface IERC20Settlement {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title CovenantVault
/// @notice Test settlement vault whose new draws depend on fresh FX coverage evaluation.
/// @dev No breach path transfers reserves, liquidates a borrower, or executes a hedge.
contract CovenantVault {
    enum CovenantState {
        UNASSESSED,
        COMPLIANT,
        CURE,
        BREACH,
        WAIVED
    }

    error NotOperator(address caller);
    error NotAdmin(address caller);
    error DrawNotAllowed(CovenantState state);
    error ReserveViolation(uint256 balance, uint256 requested, uint256 reserve);
    error InvalidAmount();
    error TokenTransferFailed();
    error InvalidWaiver();
    error NoActiveWaiver();
    error Reentrancy();

    event Deposited(bytes32 indexed facilityId, address indexed from, uint256 amount);
    event Drawn(
        bytes32 indexed facilityId, address indexed operator, uint256 amount, uint256 principal
    );
    event Repaid(
        bytes32 indexed facilityId, address indexed operator, uint256 amount, uint256 principal
    );
    event CovenantSynchronized(
        bytes32 indexed facilityId,
        CovenantState indexed previousState,
        CovenantState indexed newState,
        uint16 coverageBps,
        uint16 requiredCoverageBps,
        uint128 outstandingValue,
        uint256 grossEligible,
        uint256 countedEligible,
        CoverageEngine.ResultReason reason,
        uint64 cureDeadline
    );
    event WaiverCreated(
        bytes32 indexed facilityId, bytes32 indexed reasonCommitment, uint64 startsAt, uint64 endsAt
    );
    event WaiverRevoked(bytes32 indexed facilityId, bytes32 indexed reasonCommitment);

    bytes32 public immutable facilityId;
    FacilityRegistry public immutable facilityRegistry;
    CoverageEngine public immutable coverageEngine;
    IERC20Settlement public immutable settlementAsset;

    CovenantState public covenantState;
    CovenantState public stateBeforeWaiver;
    uint256 public principal;
    uint64 public cureDeadline;
    uint64 public waiverEndsAt;
    bytes32 public waiverReasonCommitment;

    uint256 private _locked = 1;

    constructor(
        bytes32 facilityId_,
        FacilityRegistry facilityRegistry_,
        CoverageEngine coverageEngine_
    ) {
        FacilityRegistry.FacilityPolicy memory policy = facilityRegistry_.getFacility(facilityId_);
        if (!policy.frozen) revert DrawNotAllowed(CovenantState.UNASSESSED);
        facilityId = facilityId_;
        facilityRegistry = facilityRegistry_;
        coverageEngine = coverageEngine_;
        settlementAsset = IERC20Settlement(policy.settlementAsset);
    }

    modifier onlyOperator() {
        if (msg.sender != _policy().operator) revert NotOperator(msg.sender);
        _;
    }

    modifier onlyAdmin() {
        if (msg.sender != _policy().admin) revert NotAdmin(msg.sender);
        _;
    }

    modifier nonReentrant() {
        if (_locked != 1) revert Reentrancy();
        _locked = 2;
        _;
        _locked = 1;
    }

    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (!settlementAsset.transferFrom(msg.sender, address(this), amount)) {
            revert TokenTransferFailed();
        }
        emit Deposited(facilityId, msg.sender, amount);
    }

    function draw(uint256 amount) external onlyOperator nonReentrant {
        if (amount == 0) revert InvalidAmount();
        _syncCovenant();
        if (covenantState != CovenantState.COMPLIANT && !_activeWaiver()) {
            revert DrawNotAllowed(covenantState);
        }

        FacilityRegistry.FacilityPolicy memory policy = _policy();
        uint256 balance = settlementAsset.balanceOf(address(this));
        if (amount > balance || balance - amount < policy.reserveAmount) {
            revert ReserveViolation(balance, amount, policy.reserveAmount);
        }

        principal += amount;
        if (!settlementAsset.transfer(policy.operator, amount)) revert TokenTransferFailed();
        emit Drawn(facilityId, policy.operator, amount, principal);
    }

    function repay(uint256 amount) external onlyOperator nonReentrant {
        if (amount == 0 || amount > principal) revert InvalidAmount();
        if (!settlementAsset.transferFrom(msg.sender, address(this), amount)) {
            revert TokenTransferFailed();
        }
        principal -= amount;
        emit Repaid(facilityId, msg.sender, amount, principal);
    }

    function syncCovenant()
        external
        returns (CoverageEngine.CoverageResult memory result, CovenantState state)
    {
        result = _syncCovenant();
        state = covenantState;
    }

    function restoreCompliance() external returns (CoverageEngine.CoverageResult memory result) {
        result = _syncCovenant();
        if (!result.compliant) revert DrawNotAllowed(covenantState);
    }

    function createWaiver(uint32 duration, bytes32 reasonCommitment) external onlyAdmin {
        if (
            duration == 0 || duration > _policy().maxWaiverDuration
                || reasonCommitment == bytes32(0)
        ) {
            revert InvalidWaiver();
        }
        _syncCovenant();
        if (covenantState == CovenantState.COMPLIANT || covenantState == CovenantState.WAIVED) {
            revert InvalidWaiver();
        }

        stateBeforeWaiver = covenantState;
        covenantState = CovenantState.WAIVED;
        waiverReasonCommitment = reasonCommitment;
        waiverEndsAt = uint64(block.timestamp + duration);
        emit WaiverCreated(facilityId, reasonCommitment, uint64(block.timestamp), waiverEndsAt);
    }

    function revokeWaiver() external onlyAdmin {
        if (!_activeWaiver()) revert NoActiveWaiver();
        bytes32 reason = waiverReasonCommitment;
        covenantState = stateBeforeWaiver;
        waiverEndsAt = 0;
        waiverReasonCommitment = bytes32(0);
        emit WaiverRevoked(facilityId, reason);
        _syncCovenant();
    }

    function availableToDraw() external view returns (uint256) {
        uint256 balance = settlementAsset.balanceOf(address(this));
        uint256 reserve = _policy().reserveAmount;
        return balance > reserve ? balance - reserve : 0;
    }

    function activeWaiver() external view returns (bool) {
        return _activeWaiver();
    }

    function _syncCovenant() internal returns (CoverageEngine.CoverageResult memory result) {
        result = coverageEngine.evaluate(facilityId);
        CovenantState previous = covenantState;

        if (_activeWaiver()) {
            _emitSync(previous, result);
            return result;
        }

        CovenantState evaluationBase = previous;
        if (previous == CovenantState.WAIVED) {
            evaluationBase = stateBeforeWaiver;
            waiverEndsAt = 0;
            waiverReasonCommitment = bytes32(0);
        }

        if (result.compliant) {
            covenantState = CovenantState.COMPLIANT;
            cureDeadline = 0;
        } else if (evaluationBase == CovenantState.BREACH) {
            covenantState = CovenantState.BREACH;
        } else if (
            evaluationBase == CovenantState.CURE && cureDeadline != 0
                && block.timestamp > cureDeadline
        ) {
            covenantState = CovenantState.BREACH;
        } else {
            covenantState = CovenantState.CURE;
            if (evaluationBase != CovenantState.CURE || cureDeadline == 0) {
                cureDeadline = uint64(block.timestamp + _policy().curePeriod);
            }
        }

        _emitSync(previous, result);
    }

    function _emitSync(CovenantState previous, CoverageEngine.CoverageResult memory result)
        internal
    {
        emit CovenantSynchronized(
            facilityId,
            previous,
            covenantState,
            result.coverageBps,
            result.requiredCoverageBps,
            result.outstandingValue,
            result.grossEligible,
            result.countedEligible,
            result.resultReason,
            cureDeadline
        );
    }

    function _activeWaiver() internal view returns (bool) {
        return covenantState == CovenantState.WAIVED && block.timestamp <= waiverEndsAt;
    }

    function _policy() internal view returns (FacilityRegistry.FacilityPolicy memory) {
        return facilityRegistry.getFacility(facilityId);
    }
}

