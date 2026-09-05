// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FacilityRegistry } from "./FacilityRegistry.sol";

/// @title CredentialRegistry
/// @notice Verifies and records the latest independently signed exposure and hedge assertions.
/// @dev A signature proves only who asserted the typed fields. It does not prove the legal hedge.
contract CredentialRegistry {
    string public constant EIP712_NAME = "FXCoverageCredentials";
    string public constant EIP712_VERSION = "1";

    bytes32 public constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 public constant EXPOSURE_TYPEHASH = keccak256(
        "ExposureCredential(bytes32 facilityId,bytes3 exposureCurrency,bytes3 settlementCurrency,uint128 outstandingValue,uint64 exposureMaturity,uint64 observedAt,uint64 validUntil,uint64 sequence,bytes32 sourceCommitment)"
    );
    bytes32 public constant HEDGE_TYPEHASH = keccak256(
        "HedgeCredential(bytes32 facilityId,bytes32 tradeIdCommitment,bytes3 baseCurrency,bytes3 quoteCurrency,uint128 remainingNotional,uint64 maturity,uint8 status,uint64 observedAt,uint64 validUntil,uint64 sequence,bytes32 sourceCommitment)"
    );

    uint256 private constant _SECP256K1N_HALF =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    enum HedgeStatus {
        ACTIVE,
        CANCELLED,
        SETTLED,
        DISPUTED
    }

    struct ExposureCredential {
        bytes32 facilityId;
        bytes3 exposureCurrency;
        bytes3 settlementCurrency;
        uint128 outstandingValue;
        uint64 exposureMaturity;
        uint64 observedAt;
        uint64 validUntil;
        uint64 sequence;
        bytes32 sourceCommitment;
    }

    struct HedgeCredential {
        bytes32 facilityId;
        bytes32 tradeIdCommitment;
        bytes3 baseCurrency;
        bytes3 quoteCurrency;
        uint128 remainingNotional;
        uint64 maturity;
        HedgeStatus status;
        uint64 observedAt;
        uint64 validUntil;
        uint64 sequence;
        bytes32 sourceCommitment;
    }

    struct StoredExposure {
        ExposureCredential credential;
        address issuer;
        bytes32 digest;
        uint64 acceptedAt;
        uint64 issuerEpoch;
    }

    struct StoredHedge {
        HedgeCredential credential;
        address issuer;
        bytes32 digest;
        uint64 acceptedAt;
        uint64 issuerEpoch;
    }

    error FacilityNotFrozen(bytes32 facilityId);
    error InvalidCredential();
    error InvalidSignature();
    error UnauthorizedIssuer(bytes32 facilityId, address issuer);
    error StaleSequence(uint64 supplied, uint64 current);
    error TooManyHedges(bytes32 facilityId);
    error NotCredentialController(bytes32 digest, address caller);
    error AlreadyRevoked(bytes32 digest);

    event ExposureCredentialAccepted(
        bytes32 indexed facilityId,
        address indexed issuer,
        bytes32 indexed digest,
        uint64 sequence,
        uint128 outstandingValue,
        uint64 acceptedAt
    );
    event HedgeCredentialAccepted(
        bytes32 indexed facilityId,
        bytes32 indexed tradeIdCommitment,
        address indexed issuer,
        bytes32 digest,
        uint64 sequence,
        HedgeStatus status,
        uint128 remainingNotional,
        uint64 acceptedAt
    );
    event CredentialRevoked(
        bytes32 indexed facilityId, bytes32 indexed digest, address indexed revokedBy
    );

    FacilityRegistry public immutable facilityRegistry;

    mapping(bytes32 facilityId => StoredExposure assertion) private _exposures;
    mapping(bytes32 facilityId => mapping(bytes32 tradeId => StoredHedge assertion)) private
        _hedges;
    mapping(bytes32 facilityId => bytes32[] tradeIds) private _activeTradeIds;
    mapping(bytes32 facilityId => mapping(bytes32 tradeId => uint256 oneBasedIndex)) private
        _activeTradeIndex;
    mapping(bytes32 digest => bool revoked) public revokedDigests;

    constructor(FacilityRegistry facilityRegistry_) {
        facilityRegistry = facilityRegistry_;
    }

    function submitExposure(ExposureCredential calldata credential, bytes calldata signature)
        external
        returns (bytes32 digest, address issuer)
    {
        FacilityRegistry.FacilityPolicy memory policy =
            facilityRegistry.getFacility(credential.facilityId);
        if (!policy.frozen) revert FacilityNotFrozen(credential.facilityId);
        if (
            credential.outstandingValue == 0
                || credential.exposureCurrency != policy.exposureCurrency
                || credential.settlementCurrency != policy.settlementCurrency
                || credential.validUntil < credential.observedAt
                || credential.exposureMaturity < credential.observedAt
        ) revert InvalidCredential();

        digest = hashExposureCredential(credential);
        issuer = _recover(digest, signature);
        if (!facilityRegistry.isExposureIssuer(credential.facilityId, issuer)) {
            revert UnauthorizedIssuer(credential.facilityId, issuer);
        }

        StoredExposure storage current = _exposures[credential.facilityId];
        if (credential.sequence <= current.credential.sequence) {
            revert StaleSequence(credential.sequence, current.credential.sequence);
        }

        _exposures[credential.facilityId] = StoredExposure({
            credential: credential,
            issuer: issuer,
            digest: digest,
            acceptedAt: uint64(block.timestamp),
            issuerEpoch: facilityRegistry.exposureIssuerEpoch(credential.facilityId, issuer)
        });
        emit ExposureCredentialAccepted(
            credential.facilityId,
            issuer,
            digest,
            credential.sequence,
            credential.outstandingValue,
            uint64(block.timestamp)
        );
    }

    function submitHedge(HedgeCredential calldata credential, bytes calldata signature)
        external
        returns (bytes32 digest, address issuer)
    {
        FacilityRegistry.FacilityPolicy memory policy =
            facilityRegistry.getFacility(credential.facilityId);
        if (!policy.frozen) revert FacilityNotFrozen(credential.facilityId);
        if (
            credential.tradeIdCommitment == bytes32(0)
                || credential.baseCurrency != policy.settlementCurrency
                || credential.quoteCurrency != policy.exposureCurrency
                || credential.validUntil < credential.observedAt
                || credential.maturity < credential.observedAt
        ) revert InvalidCredential();

        digest = hashHedgeCredential(credential);
        issuer = _recover(digest, signature);
        if (!facilityRegistry.isHedgeIssuer(credential.facilityId, issuer)) {
            revert UnauthorizedIssuer(credential.facilityId, issuer);
        }

        StoredHedge storage current = _hedges[credential.facilityId][credential.tradeIdCommitment];
        if (credential.sequence <= current.credential.sequence) {
            revert StaleSequence(credential.sequence, current.credential.sequence);
        }

        bool currentlyActive =
            _activeTradeIndex[credential.facilityId][credential.tradeIdCommitment] != 0;
        bool becomingActive = credential.status == HedgeStatus.ACTIVE;
        if (current.digest == bytes32(0) && !becomingActive) revert InvalidCredential();

        if (becomingActive && !currentlyActive) {
            if (_activeTradeIds[credential.facilityId].length >= policy.maxActiveHedges) {
                revert TooManyHedges(credential.facilityId);
            }
            _activeTradeIds[credential.facilityId].push(credential.tradeIdCommitment);
            _activeTradeIndex[credential.facilityId][credential.tradeIdCommitment] =
            _activeTradeIds[credential.facilityId].length;
        } else if (!becomingActive && currentlyActive) {
            _removeActiveTrade(credential.facilityId, credential.tradeIdCommitment);
        }

        _hedges[credential.facilityId][credential.tradeIdCommitment] = StoredHedge({
            credential: credential,
            issuer: issuer,
            digest: digest,
            acceptedAt: uint64(block.timestamp),
            issuerEpoch: facilityRegistry.hedgeIssuerEpoch(credential.facilityId, issuer)
        });
        emit HedgeCredentialAccepted(
            credential.facilityId,
            credential.tradeIdCommitment,
            issuer,
            digest,
            credential.sequence,
            credential.status,
            credential.remainingNotional,
            uint64(block.timestamp)
        );
    }

    function revokeExposure(bytes32 facilityId) external {
        StoredExposure memory current = _exposures[facilityId];
        _revoke(facilityId, current.digest, current.issuer);
    }

    function revokeHedge(bytes32 facilityId, bytes32 tradeIdCommitment) external {
        StoredHedge memory current = _hedges[facilityId][tradeIdCommitment];
        _revoke(facilityId, current.digest, current.issuer);
    }

    function currentExposure(bytes32 facilityId) external view returns (StoredExposure memory) {
        return _exposures[facilityId];
    }

    function currentHedge(bytes32 facilityId, bytes32 tradeIdCommitment)
        external
        view
        returns (StoredHedge memory)
    {
        return _hedges[facilityId][tradeIdCommitment];
    }

    function hedgeTradeIds(bytes32 facilityId) external view returns (bytes32[] memory) {
        return _activeTradeIds[facilityId];
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes(EIP712_NAME)),
                keccak256(bytes(EIP712_VERSION)),
                block.chainid,
                address(this)
            )
        );
    }

    function hashExposureCredential(ExposureCredential calldata credential)
        public
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                EXPOSURE_TYPEHASH,
                credential.facilityId,
                credential.exposureCurrency,
                credential.settlementCurrency,
                credential.outstandingValue,
                credential.exposureMaturity,
                credential.observedAt,
                credential.validUntil,
                credential.sequence,
                credential.sourceCommitment
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function hashHedgeCredential(HedgeCredential calldata credential)
        public
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                HEDGE_TYPEHASH,
                credential.facilityId,
                credential.tradeIdCommitment,
                credential.baseCurrency,
                credential.quoteCurrency,
                credential.remainingNotional,
                credential.maturity,
                credential.status,
                credential.observedAt,
                credential.validUntil,
                credential.sequence,
                credential.sourceCommitment
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function _revoke(bytes32 facilityId, bytes32 digest, address issuer) internal {
        if (digest == bytes32(0)) revert InvalidCredential();
        FacilityRegistry.FacilityPolicy memory policy = facilityRegistry.getFacility(facilityId);
        if (msg.sender != issuer && msg.sender != policy.admin) {
            revert NotCredentialController(digest, msg.sender);
        }
        if (revokedDigests[digest]) revert AlreadyRevoked(digest);
        revokedDigests[digest] = true;
        emit CredentialRevoked(facilityId, digest, msg.sender);
    }

    function _removeActiveTrade(bytes32 facilityId, bytes32 tradeIdCommitment) internal {
        uint256 index = _activeTradeIndex[facilityId][tradeIdCommitment] - 1;
        uint256 lastIndex = _activeTradeIds[facilityId].length - 1;
        if (index != lastIndex) {
            bytes32 movedTradeId = _activeTradeIds[facilityId][lastIndex];
            _activeTradeIds[facilityId][index] = movedTradeId;
            _activeTradeIndex[facilityId][movedTradeId] = index + 1;
        }
        _activeTradeIds[facilityId].pop();
        delete _activeTradeIndex[facilityId][tradeIdCommitment];
    }

    function _recover(bytes32 digest, bytes calldata signature)
        internal
        pure
        returns (address signer)
    {
        if (signature.length != 65) revert InvalidSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) revert InvalidSignature();
        if (uint256(s) > _SECP256K1N_HALF) revert InvalidSignature();
        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
    }
}
