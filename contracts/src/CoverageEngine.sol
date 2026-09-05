// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FacilityRegistry } from "./FacilityRegistry.sol";
import { CredentialRegistry } from "./CredentialRegistry.sol";

/// @title CoverageEngine
/// @notice Computes deterministic eligible FX coverage from current signed assertions.
contract CoverageEngine {
    enum ExposureReason {
        ELIGIBLE,
        MISSING,
        ZERO_VALUE,
        ISSUER_NOT_APPROVED,
        PAIR_MISMATCH,
        NOT_YET_OBSERVED,
        EXPIRED,
        STALE,
        REVOKED,
        ISSUER_AUTHORIZATION_STALE
    }

    enum HedgeReason {
        ELIGIBLE,
        MISSING,
        ISSUER_NOT_APPROVED,
        SAME_AS_EXPOSURE_ISSUER,
        PAIR_MISMATCH,
        NOT_ACTIVE,
        NOT_YET_OBSERVED,
        EXPIRED,
        STALE,
        MATURITY_MISMATCH,
        REVOKED,
        ISSUER_AUTHORIZATION_STALE
    }

    enum ResultReason {
        NONE,
        MISSING_EXPOSURE,
        INVALID_EXPOSURE,
        BELOW_THRESHOLD
    }

    struct CoverageResult {
        bool assessed;
        bool compliant;
        uint128 outstandingValue;
        uint256 grossEligible;
        uint256 countedEligible;
        uint16 coverageBps;
        uint16 requiredCoverageBps;
        uint8 eligibleHedgeCount;
        uint8 totalHedgeCount;
        ExposureReason exposureReason;
        ResultReason resultReason;
    }

    FacilityRegistry public immutable facilityRegistry;
    CredentialRegistry public immutable credentialRegistry;

    constructor(FacilityRegistry facilityRegistry_, CredentialRegistry credentialRegistry_) {
        facilityRegistry = facilityRegistry_;
        credentialRegistry = credentialRegistry_;
    }

    function evaluate(bytes32 facilityId) public view returns (CoverageResult memory result) {
        FacilityRegistry.FacilityPolicy memory policy = facilityRegistry.getFacility(facilityId);
        CredentialRegistry.StoredExposure memory exposure =
            credentialRegistry.currentExposure(facilityId);

        result.requiredCoverageBps = policy.minCoverageBps;
        result.outstandingValue = exposure.credential.outstandingValue;
        result.exposureReason = _exposureReason(policy, exposure);

        if (result.exposureReason != ExposureReason.ELIGIBLE) {
            result.resultReason = result.exposureReason == ExposureReason.MISSING
                ? ResultReason.MISSING_EXPOSURE
                : ResultReason.INVALID_EXPOSURE;
            return result;
        }

        result.assessed = true;
        bytes32[] memory tradeIds = credentialRegistry.hedgeTradeIds(facilityId);
        result.totalHedgeCount = uint8(tradeIds.length);

        for (uint256 i = 0; i < tradeIds.length; ++i) {
            CredentialRegistry.StoredHedge memory hedge =
                credentialRegistry.currentHedge(facilityId, tradeIds[i]);
            (HedgeReason reason, uint256 adjustedNotional) =
                _hedgeReasonAndValue(policy, exposure, hedge);
            if (reason == HedgeReason.ELIGIBLE) {
                result.grossEligible += adjustedNotional;
                result.eligibleHedgeCount++;
            }
        }

        result.countedEligible = result.grossEligible > result.outstandingValue
            ? result.outstandingValue
            : result.grossEligible;
        result.coverageBps = uint16(result.countedEligible * 10_000 / result.outstandingValue);
        result.compliant = result.coverageBps >= policy.minCoverageBps;
        result.resultReason = result.compliant ? ResultReason.NONE : ResultReason.BELOW_THRESHOLD;
    }

    function exposureEligibility(bytes32 facilityId) external view returns (ExposureReason) {
        FacilityRegistry.FacilityPolicy memory policy = facilityRegistry.getFacility(facilityId);
        return _exposureReason(policy, credentialRegistry.currentExposure(facilityId));
    }

    function hedgeEligibility(bytes32 facilityId, bytes32 tradeIdCommitment)
        external
        view
        returns (HedgeReason reason, uint256 adjustedNotional)
    {
        FacilityRegistry.FacilityPolicy memory policy = facilityRegistry.getFacility(facilityId);
        CredentialRegistry.StoredExposure memory exposure =
            credentialRegistry.currentExposure(facilityId);
        CredentialRegistry.StoredHedge memory hedge =
            credentialRegistry.currentHedge(facilityId, tradeIdCommitment);
        return _hedgeReasonAndValue(policy, exposure, hedge);
    }

    function _exposureReason(
        FacilityRegistry.FacilityPolicy memory policy,
        CredentialRegistry.StoredExposure memory exposure
    ) internal view returns (ExposureReason) {
        CredentialRegistry.ExposureCredential memory credential = exposure.credential;
        if (exposure.digest == bytes32(0)) return ExposureReason.MISSING;
        if (credential.outstandingValue == 0) return ExposureReason.ZERO_VALUE;
        if (!facilityRegistry.isExposureIssuer(credential.facilityId, exposure.issuer)) {
            return ExposureReason.ISSUER_NOT_APPROVED;
        }
        if (
            exposure.issuerEpoch
                != facilityRegistry.exposureIssuerEpoch(credential.facilityId, exposure.issuer)
        ) return ExposureReason.ISSUER_AUTHORIZATION_STALE;
        if (
            credential.facilityId != policy.facilityId
                || credential.exposureCurrency != policy.exposureCurrency
                || credential.settlementCurrency != policy.settlementCurrency
        ) return ExposureReason.PAIR_MISMATCH;
        if (credential.observedAt > block.timestamp) return ExposureReason.NOT_YET_OBSERVED;
        if (credential.validUntil < block.timestamp) return ExposureReason.EXPIRED;
        if (block.timestamp - credential.observedAt > policy.credentialMaxAge) {
            return ExposureReason.STALE;
        }
        if (credentialRegistry.revokedDigests(exposure.digest)) return ExposureReason.REVOKED;
        return ExposureReason.ELIGIBLE;
    }

    function _hedgeReasonAndValue(
        FacilityRegistry.FacilityPolicy memory policy,
        CredentialRegistry.StoredExposure memory exposure,
        CredentialRegistry.StoredHedge memory hedge
    ) internal view returns (HedgeReason reason, uint256 adjustedNotional) {
        CredentialRegistry.HedgeCredential memory credential = hedge.credential;
        if (hedge.digest == bytes32(0)) return (HedgeReason.MISSING, 0);
        if (!facilityRegistry.isHedgeIssuer(credential.facilityId, hedge.issuer)) {
            return (HedgeReason.ISSUER_NOT_APPROVED, 0);
        }
        if (
            hedge.issuerEpoch
                != facilityRegistry.hedgeIssuerEpoch(credential.facilityId, hedge.issuer)
        ) return (HedgeReason.ISSUER_AUTHORIZATION_STALE, 0);
        if (hedge.issuer == exposure.issuer) {
            return (HedgeReason.SAME_AS_EXPOSURE_ISSUER, 0);
        }
        if (
            credential.facilityId != policy.facilityId
                || credential.baseCurrency != policy.settlementCurrency
                || credential.quoteCurrency != policy.exposureCurrency
        ) return (HedgeReason.PAIR_MISMATCH, 0);
        if (credential.status != CredentialRegistry.HedgeStatus.ACTIVE) {
            return (HedgeReason.NOT_ACTIVE, 0);
        }
        if (credential.observedAt > block.timestamp) return (HedgeReason.NOT_YET_OBSERVED, 0);
        if (credential.validUntil < block.timestamp) return (HedgeReason.EXPIRED, 0);
        if (block.timestamp - credential.observedAt > policy.credentialMaxAge) {
            return (HedgeReason.STALE, 0);
        }
        if (
            uint256(credential.maturity) + policy.maturityTolerance
                < exposure.credential.exposureMaturity
        ) return (HedgeReason.MATURITY_MISMATCH, 0);
        if (credentialRegistry.revokedDigests(hedge.digest)) return (HedgeReason.REVOKED, 0);

        adjustedNotional =
            uint256(credential.remainingNotional) * (10_000 - policy.defaultHaircutBps) / 10_000;
        return (HedgeReason.ELIGIBLE, adjustedNotional);
    }
}
