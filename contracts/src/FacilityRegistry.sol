// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title FacilityRegistry
/// @notice Stores frozen FX coverage policy and role-specific credential issuers.
/// @dev This prototype is deliberately non-upgradeable. A changed economic policy needs a new facility.
contract FacilityRegistry {
    uint16 public constant MAX_BPS = 10_000;
    uint8 public constant MAX_HEDGES = 8;

    struct FacilityPolicy {
        bytes32 facilityId;
        bytes3 settlementCurrency;
        bytes3 exposureCurrency;
        uint16 minCoverageBps;
        uint32 credentialMaxAge;
        uint32 maturityTolerance;
        uint16 defaultHaircutBps;
        uint128 reserveAmount;
        uint32 curePeriod;
        uint32 maxWaiverDuration;
        uint8 maxActiveHedges;
        address settlementAsset;
        address admin;
        address operator;
        bool frozen;
    }

    error FacilityAlreadyExists(bytes32 facilityId);
    error FacilityNotFound(bytes32 facilityId);
    error InvalidPolicy();
    error NotFacilityAdmin(bytes32 facilityId, address caller);
    error IssuerRoleConflict(bytes32 facilityId, address issuer);
    error MissingIssuerRole(bytes32 facilityId);
    error FacilityAlreadyFrozen(bytes32 facilityId);

    event FacilityCreated(
        bytes32 indexed facilityId, address indexed admin, address indexed operator
    );
    event FacilityFrozen(bytes32 indexed facilityId);
    event ExposureIssuerAuthorizationChanged(
        bytes32 indexed facilityId,
        address indexed issuer,
        bool authorized,
        uint64 authorizationEpoch
    );
    event HedgeIssuerAuthorizationChanged(
        bytes32 indexed facilityId,
        address indexed issuer,
        bool authorized,
        uint64 authorizationEpoch
    );

    mapping(bytes32 facilityId => FacilityPolicy policy) private _policies;
    mapping(bytes32 facilityId => bool exists) private _exists;
    mapping(bytes32 facilityId => mapping(address issuer => bool authorized)) private
        _exposureIssuers;
    mapping(bytes32 facilityId => mapping(address issuer => bool authorized)) private _hedgeIssuers;
    mapping(bytes32 facilityId => mapping(address issuer => uint64 epoch)) public
        exposureIssuerEpoch;
    mapping(bytes32 facilityId => mapping(address issuer => uint64 epoch)) public hedgeIssuerEpoch;
    mapping(bytes32 facilityId => uint256 count) private _exposureIssuerCount;
    mapping(bytes32 facilityId => uint256 count) private _hedgeIssuerCount;

    modifier onlyAdmin(bytes32 facilityId) {
        _requireFacility(facilityId);
        if (msg.sender != _policies[facilityId].admin) {
            revert NotFacilityAdmin(facilityId, msg.sender);
        }
        _;
    }

    function createFacility(FacilityPolicy calldata policy) external {
        if (_exists[policy.facilityId]) revert FacilityAlreadyExists(policy.facilityId);
        if (
            policy.facilityId == bytes32(0) || policy.settlementCurrency == bytes3(0)
                || policy.exposureCurrency == bytes3(0)
                || policy.settlementCurrency == policy.exposureCurrency
                || policy.minCoverageBps > MAX_BPS || policy.defaultHaircutBps > MAX_BPS
                || policy.credentialMaxAge == 0 || policy.curePeriod == 0
                || policy.maxWaiverDuration == 0 || policy.maxActiveHedges == 0
                || policy.maxActiveHedges > MAX_HEDGES || policy.settlementAsset == address(0)
                || policy.admin == address(0) || policy.operator == address(0)
                || policy.admin == policy.operator || policy.frozen || msg.sender != policy.admin
        ) revert InvalidPolicy();

        _exists[policy.facilityId] = true;
        _policies[policy.facilityId] = policy;
        emit FacilityCreated(policy.facilityId, policy.admin, policy.operator);
    }

    function freezeFacility(bytes32 facilityId) external onlyAdmin(facilityId) {
        FacilityPolicy storage policy = _policies[facilityId];
        if (policy.frozen) revert FacilityAlreadyFrozen(facilityId);
        if (_exposureIssuerCount[facilityId] == 0 || _hedgeIssuerCount[facilityId] == 0) {
            revert MissingIssuerRole(facilityId);
        }
        policy.frozen = true;
        emit FacilityFrozen(facilityId);
    }

    function setExposureIssuer(bytes32 facilityId, address issuer, bool authorized)
        external
        onlyAdmin(facilityId)
    {
        if (issuer == address(0)) revert InvalidPolicy();
        if (authorized && _hedgeIssuers[facilityId][issuer]) {
            revert IssuerRoleConflict(facilityId, issuer);
        }
        bool previous = _exposureIssuers[facilityId][issuer];
        if (previous == authorized) return;
        _exposureIssuers[facilityId][issuer] = authorized;
        if (authorized) {
            _exposureIssuerCount[facilityId]++;
        } else {
            _exposureIssuerCount[facilityId]--;
            exposureIssuerEpoch[facilityId][issuer]++;
        }
        emit ExposureIssuerAuthorizationChanged(
            facilityId, issuer, authorized, exposureIssuerEpoch[facilityId][issuer]
        );
    }

    function setHedgeIssuer(bytes32 facilityId, address issuer, bool authorized)
        external
        onlyAdmin(facilityId)
    {
        if (issuer == address(0)) revert InvalidPolicy();
        if (authorized && _exposureIssuers[facilityId][issuer]) {
            revert IssuerRoleConflict(facilityId, issuer);
        }
        bool previous = _hedgeIssuers[facilityId][issuer];
        if (previous == authorized) return;
        _hedgeIssuers[facilityId][issuer] = authorized;
        if (authorized) {
            _hedgeIssuerCount[facilityId]++;
        } else {
            _hedgeIssuerCount[facilityId]--;
            hedgeIssuerEpoch[facilityId][issuer]++;
        }
        emit HedgeIssuerAuthorizationChanged(
            facilityId, issuer, authorized, hedgeIssuerEpoch[facilityId][issuer]
        );
    }

    function getFacility(bytes32 facilityId) external view returns (FacilityPolicy memory) {
        _requireFacility(facilityId);
        return _policies[facilityId];
    }

    function facilityExists(bytes32 facilityId) external view returns (bool) {
        return _exists[facilityId];
    }

    function isExposureIssuer(bytes32 facilityId, address issuer) external view returns (bool) {
        return _exposureIssuers[facilityId][issuer];
    }

    function isHedgeIssuer(bytes32 facilityId, address issuer) external view returns (bool) {
        return _hedgeIssuers[facilityId][issuer];
    }

    function _requireFacility(bytes32 facilityId) internal view {
        if (!_exists[facilityId]) revert FacilityNotFound(facilityId);
    }
}
