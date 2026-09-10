// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FacilityRegistry } from "../src/FacilityRegistry.sol";
import { CredentialRegistry } from "../src/CredentialRegistry.sol";
import { CoverageEngine } from "../src/CoverageEngine.sol";
import { CovenantVault } from "../src/CovenantVault.sol";
import { ICoverageGate } from "../src/ICoverageGate.sol";
import { MockUSDC } from "../src/mocks/MockUSDC.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
    function chainId(uint256 newChainId) external;
    function expectRevert() external;
    function expectRevert(bytes calldata revertData) external;
}

/// @notice Dependency-free Foundry tests for PROTOTYPE-SPEC.md rows T-01 through T-18.
contract ContractCoreTest {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant UNIT = 1e6;
    uint256 internal constant EXPOSURE_KEY = 0xE11E;
    uint256 internal constant HEDGE_KEY = 0xA11CE;
    uint256 internal constant OPERATOR_KEY = 0xB0B;
    uint64 internal constant START = 1_800_000_000;
    uint32 internal constant MAX_AGE = 1 days;
    uint32 internal constant CURE_PERIOD = 2 days;
    uint32 internal constant MAX_WAIVER = 12 hours;

    bytes32 internal constant FACILITY_ID = keccak256("fictional-coffee-facility");
    bytes32 internal constant TRADE_ONE = keccak256("mock-provider-trade-001");
    bytes32 internal constant TRADE_TWO = keccak256("mock-provider-trade-002");
    bytes3 internal constant USD = "USD";
    bytes3 internal constant COP = "COP";

    FacilityRegistry internal facilities;
    CredentialRegistry internal credentials;
    CoverageEngine internal engine;
    CovenantVault internal vault;
    MockUSDC internal token;

    address internal exposureIssuer;
    address internal hedgeIssuer;
    address internal operator;

    function setUp() public {
        vm.warp(START);
        exposureIssuer = vm.addr(EXPOSURE_KEY);
        hedgeIssuer = vm.addr(HEDGE_KEY);
        operator = vm.addr(OPERATOR_KEY);

        token = new MockUSDC();
        facilities = new FacilityRegistry();
        facilities.createFacility(
            FacilityRegistry.FacilityPolicy({
                facilityId: FACILITY_ID,
                settlementCurrency: USD,
                exposureCurrency: COP,
                minCoverageBps: 8_000,
                credentialMaxAge: MAX_AGE,
                maturityTolerance: 1 days,
                defaultHaircutBps: 0,
                reserveAmount: uint128(1_000_000 * UNIT),
                curePeriod: CURE_PERIOD,
                maxWaiverDuration: MAX_WAIVER,
                maxActiveHedges: 8,
                settlementAsset: address(token),
                admin: address(this),
                operator: operator,
                frozen: false
            })
        );
        facilities.setExposureIssuer(FACILITY_ID, exposureIssuer, true);
        facilities.setHedgeIssuer(FACILITY_ID, hedgeIssuer, true);
        facilities.freezeFacility(FACILITY_ID);

        credentials = new CredentialRegistry(facilities);
        engine = new CoverageEngine(facilities, credentials);
        vault = new CovenantVault(FACILITY_ID, facilities, engine);

        token.mint(address(this), 10_000_000 * UNIT);
        token.approve(address(vault), type(uint256).max);
        vault.deposit(10_000_000 * UNIT);
        vm.prank(operator);
        token.approve(address(vault), type(uint256).max);
    }

    function test_T01_CompliantCoveragePermitsDraw() public {
        _seedCompliant();
        CoverageEngine.CoverageResult memory result = engine.evaluate(FACILITY_ID);
        assertTrue(result.compliant);
        assertEq(result.coverageBps, 9_000);

        vm.prank(operator);
        vault.draw(500_000 * UNIT);
        assertEq(vault.principal(), 500_000 * UNIT);
        assertEq(uint256(vault.covenantState()), uint256(CovenantVault.CovenantState.COMPLIANT));
    }

    function test_T02_HedgeExpiryBlocksDrawAndStartsCureWithoutMovingReserve() public {
        _submitExposure(5_000_000 * UNIT, 1, START, START + 2 days, START + 30 days);
        _submitHedge(
            TRADE_ONE,
            4_500_000 * UNIT,
            1,
            CredentialRegistry.HedgeStatus.ACTIVE,
            START,
            START + 1 hours,
            START + 30 days
        );
        vault.syncCovenant();
        uint256 balanceBefore = token.balanceOf(address(vault));

        vm.warp(START + 1 hours + 1);
        vm.prank(operator);
        vm.expectRevert();
        vault.draw(1);
        vault.syncCovenant();

        assertEq(uint256(vault.covenantState()), uint256(CovenantVault.CovenantState.CURE));
        assertEq(token.balanceOf(address(vault)), balanceBefore);
    }

    function test_T03_CancellationUpdateContributesZero() public {
        _seedCompliant();
        _submitHedge(
            TRADE_ONE,
            4_500_000 * UNIT,
            2,
            CredentialRegistry.HedgeStatus.CANCELLED,
            START,
            START + 1 days,
            START + 30 days
        );
        CoverageEngine.CoverageResult memory result = engine.evaluate(FACILITY_ID);
        assertFalse(result.compliant);
        assertEq(result.grossEligible, 0);
        assertEq(credentials.hedgeTradeIds(FACILITY_ID).length, 0);
        (CoverageEngine.HedgeReason reason,) = engine.hedgeEligibility(FACILITY_ID, TRADE_ONE);
        assertEq(uint256(reason), uint256(CoverageEngine.HedgeReason.NOT_ACTIVE));
    }

    function test_T04_ExposureGrowthUsesFreshEvaluationAndBlocksDraw() public {
        _seedCompliant();
        vault.syncCovenant();
        _submitExposure(6_000_000 * UNIT, 2, START, START + 1 days, START + 30 days);

        vm.prank(operator);
        vm.expectRevert();
        vault.draw(1);
        CoverageEngine.CoverageResult memory result = engine.evaluate(FACILITY_ID);
        assertEq(result.coverageBps, 7_500);
    }

    function test_T05_StaleSequenceRevertsAndTradeCannotBeCountedTwice() public {
        _seedCompliant();
        CredentialRegistry.HedgeCredential memory stale = _hedgeCredential(
            TRADE_ONE,
            4_500_000 * UNIT,
            1,
            CredentialRegistry.HedgeStatus.ACTIVE,
            START,
            START + 1 days,
            START + 30 days
        );
        bytes memory staleSignature = _signHedge(stale, HEDGE_KEY);
        vm.expectRevert();
        credentials.submitHedge(stale, staleSignature);
        bytes32[] memory ids = credentials.hedgeTradeIds(FACILITY_ID);
        assertEq(ids.length, 1);
        assertEq(engine.evaluate(FACILITY_ID).grossEligible, 4_500_000 * UNIT);
    }

    function test_T06_StaleObservationIsIneligible() public {
        _seedCompliantWithValidity(START + 3 days);
        vm.warp(START + MAX_AGE + 1);
        _submitExposure(
            5_000_000 * UNIT,
            2,
            uint64(block.timestamp),
            uint64(block.timestamp + 1 days),
            uint64(block.timestamp + 30 days)
        );
        (CoverageEngine.HedgeReason reason,) = engine.hedgeEligibility(FACILITY_ID, TRADE_ONE);
        assertEq(uint256(reason), uint256(CoverageEngine.HedgeReason.STALE));
        assertFalse(engine.evaluate(FACILITY_ID).compliant);
    }

    function test_T07_RevokedHedgeIssuerInvalidatesCurrentCredential() public {
        _seedCompliant();
        facilities.setHedgeIssuer(FACILITY_ID, hedgeIssuer, false);
        (CoverageEngine.HedgeReason reason,) = engine.hedgeEligibility(FACILITY_ID, TRADE_ONE);
        assertEq(uint256(reason), uint256(CoverageEngine.HedgeReason.ISSUER_NOT_APPROVED));
        assertFalse(engine.evaluate(FACILITY_ID).compliant);
    }

    function test_ReauthorizingHedgeIssuerRequiresFreshCredential() public {
        _seedCompliant();
        facilities.setHedgeIssuer(FACILITY_ID, hedgeIssuer, false);
        facilities.setHedgeIssuer(FACILITY_ID, hedgeIssuer, true);

        (CoverageEngine.HedgeReason staleReason,) = engine.hedgeEligibility(FACILITY_ID, TRADE_ONE);
        assertEq(
            uint256(staleReason), uint256(CoverageEngine.HedgeReason.ISSUER_AUTHORIZATION_STALE)
        );
        assertFalse(engine.evaluate(FACILITY_ID).compliant);

        _submitHedge(
            TRADE_ONE,
            4_500_000 * UNIT,
            2,
            CredentialRegistry.HedgeStatus.ACTIVE,
            START,
            START + 1 days,
            START + 30 days
        );
        assertTrue(engine.evaluate(FACILITY_ID).compliant);
    }

    function test_ReauthorizingExposureIssuerRequiresFreshCredential() public {
        _seedCompliant();
        facilities.setExposureIssuer(FACILITY_ID, exposureIssuer, false);
        facilities.setExposureIssuer(FACILITY_ID, exposureIssuer, true);

        assertEq(
            uint256(engine.exposureEligibility(FACILITY_ID)),
            uint256(CoverageEngine.ExposureReason.ISSUER_AUTHORIZATION_STALE)
        );
        assertFalse(engine.evaluate(FACILITY_ID).compliant);

        _submitExposure(5_000_000 * UNIT, 2, START, START + 1 days, START + 30 days);
        assertTrue(engine.evaluate(FACILITY_ID).compliant);
    }

    function test_T08_EarlyMaturityIsRejected() public {
        _submitExposure(5_000_000 * UNIT, 1, START, START + 1 days, START + 30 days);
        _submitHedge(
            TRADE_ONE,
            4_500_000 * UNIT,
            1,
            CredentialRegistry.HedgeStatus.ACTIVE,
            START,
            START + 1 days,
            START + 20 days
        );
        (CoverageEngine.HedgeReason reason,) = engine.hedgeEligibility(FACILITY_ID, TRADE_ONE);
        assertEq(uint256(reason), uint256(CoverageEngine.HedgeReason.MATURITY_MISMATCH));
    }

    function test_T09_PartialSettlementLowersCoverageExactlyOnce() public {
        _seedCompliant();
        _submitHedge(
            TRADE_ONE,
            3_500_000 * UNIT,
            2,
            CredentialRegistry.HedgeStatus.ACTIVE,
            START,
            START + 1 days,
            START + 30 days
        );
        CoverageEngine.CoverageResult memory result = engine.evaluate(FACILITY_ID);
        assertEq(result.coverageBps, 7_000);
        assertEq(result.grossEligible, 3_500_000 * UNIT);
        assertEq(credentials.hedgeTradeIds(FACILITY_ID).length, 1);
    }

    function test_T10_ExposureAmortizationRaisesCoverageWithoutHedgeUpdate() public {
        _seedCompliant();
        _submitExposure(4_000_000 * UNIT, 2, START, START + 1 days, START + 30 days);
        CoverageEngine.CoverageResult memory result = engine.evaluate(FACILITY_ID);
        assertEq(result.grossEligible, 4_500_000 * UNIT);
        assertEq(result.countedEligible, 4_000_000 * UNIT);
        assertEq(result.coverageBps, 10_000);
    }

    function test_T11_OverHedgeShowsGrossButCapsCountedCoverage() public {
        _submitExposure(5_000_000 * UNIT, 1, START, START + 1 days, START + 30 days);
        _submitHedge(
            TRADE_ONE,
            6_000_000 * UNIT,
            1,
            CredentialRegistry.HedgeStatus.ACTIVE,
            START,
            START + 1 days,
            START + 30 days
        );
        CoverageEngine.CoverageResult memory result = engine.evaluate(FACILITY_ID);
        assertEq(result.grossEligible, 6_000_000 * UNIT);
        assertEq(result.countedEligible, 5_000_000 * UNIT);
        assertEq(result.coverageBps, 10_000);
    }

    function test_T12_DisputedHedgeContributesZero() public {
        _seedCompliant();
        _submitHedge(
            TRADE_ONE,
            4_500_000 * UNIT,
            2,
            CredentialRegistry.HedgeStatus.DISPUTED,
            START,
            START + 1 days,
            START + 30 days
        );
        assertEq(engine.evaluate(FACILITY_ID).grossEligible, 0);
    }

    function test_T13_FreshHedgeRestoresDuringCure() public {
        _seedCompliant();
        _submitExposure(6_000_000 * UNIT, 2, START, START + 1 days, START + 30 days);
        vault.syncCovenant();
        assertEq(uint256(vault.covenantState()), uint256(CovenantVault.CovenantState.CURE));

        _submitHedge(
            TRADE_TWO,
            1_000_000 * UNIT,
            1,
            CredentialRegistry.HedgeStatus.ACTIVE,
            START,
            START + 1 days,
            START + 30 days
        );
        vault.restoreCompliance();
        assertEq(uint256(vault.covenantState()), uint256(CovenantVault.CovenantState.COMPLIANT));
    }

    function test_T14_CureDeadlineCreatesBreachWithoutLiquidationOrReserveTransfer() public {
        _seedCompliant();
        _submitExposure(6_000_000 * UNIT, 2, START, START + 1 days, START + 30 days);
        uint256 balanceBefore = token.balanceOf(address(vault));
        vault.syncCovenant();
        vm.warp(vault.cureDeadline() + 1);
        vault.syncCovenant();
        assertEq(uint256(vault.covenantState()), uint256(CovenantVault.CovenantState.BREACH));
        assertEq(token.balanceOf(address(vault)), balanceBefore);
    }

    function test_T15_AdminOnlyBoundedWaiverExpiresAndStopsDraws() public {
        vault.syncCovenant();
        vm.prank(operator);
        vm.expectRevert();
        vault.createWaiver(1 hours, keccak256("mock signer outage"));

        vault.createWaiver(1 hours, keccak256("mock signer outage"));
        vm.prank(operator);
        vault.draw(100_000 * UNIT);
        uint64 end = vault.waiverEndsAt();

        vm.warp(end + 1);
        vm.prank(operator);
        vm.expectRevert();
        vault.draw(1);
    }

    function test_T16_RepaymentWorksDuringBreach() public {
        _seedCompliant();
        vm.prank(operator);
        vault.draw(500_000 * UNIT);
        _submitExposure(6_000_000 * UNIT, 2, START, START + 10 days, START + 30 days);
        vault.syncCovenant();
        vm.warp(vault.cureDeadline() + 1);
        vault.syncCovenant();

        vm.prank(operator);
        vault.repay(200_000 * UNIT);
        assertEq(vault.principal(), 300_000 * UNIT);
        assertEq(uint256(vault.covenantState()), uint256(CovenantVault.CovenantState.BREACH));
    }

    function test_T17_SameIssuerCannotHoldBothRoles() public {
        vm.expectRevert();
        facilities.setHedgeIssuer(FACILITY_ID, exposureIssuer, true);
    }

    function test_T18_DomainFacilityAndPayloadReplayProtections() public {
        CredentialRegistry.ExposureCredential memory exposure =
            _exposure(5_000_000 * UNIT, 1, START, START + 1 days, START + 30 days);

        bytes memory signature = _signExposure(exposure, EXPOSURE_KEY);
        exposure.outstandingValue = uint128(6_000_000 * UNIT);
        vm.expectRevert();
        credentials.submitExposure(exposure, signature);

        CredentialRegistry secondRegistry = new CredentialRegistry(facilities);
        exposure.outstandingValue = uint128(5_000_000 * UNIT);
        bytes memory crossRegistrySignature = _signExposure(exposure, EXPOSURE_KEY);
        vm.expectRevert();
        secondRegistry.submitExposure(exposure, crossRegistrySignature);

        uint256 originalChainId = block.chainid;
        vm.chainId(84_532);
        bytes memory wrongChainSignature = _signExposure(exposure, EXPOSURE_KEY);
        vm.chainId(originalChainId);
        vm.expectRevert();
        credentials.submitExposure(exposure, wrongChainSignature);

        exposure.facilityId = keccak256("wrong-facility");
        bytes memory wrongFacilitySignature = _signExposure(exposure, EXPOSURE_KEY);
        vm.expectRevert();
        credentials.submitExposure(exposure, wrongFacilitySignature);
    }

    function test_CredentialRevocationIsIssuerOrAdminControlledAndImmediatelyEffective() public {
        _seedCompliant();
        vm.prank(operator);
        vm.expectRevert();
        credentials.revokeHedge(FACILITY_ID, TRADE_ONE);

        vm.prank(hedgeIssuer);
        credentials.revokeHedge(FACILITY_ID, TRADE_ONE);
        (CoverageEngine.HedgeReason reason,) = engine.hedgeEligibility(FACILITY_ID, TRADE_ONE);
        assertEq(uint256(reason), uint256(CoverageEngine.HedgeReason.REVOKED));
        assertFalse(engine.evaluate(FACILITY_ID).compliant);
    }

    function test_DrawCannotConsumeConfiguredReserve() public {
        _seedCompliant();
        vm.prank(operator);
        vm.expectRevert();
        vault.draw(9_000_001 * UNIT);
        assertEq(token.balanceOf(address(vault)), 10_000_000 * UNIT);
    }

    function test_ActiveHedgeCapReleasesSlotAfterCancellation() public {
        for (uint256 i = 0; i < 8; ++i) {
            _submitHedge(
                keccak256(abi.encode("mock active trade", i)),
                1_000 * UNIT,
                1,
                CredentialRegistry.HedgeStatus.ACTIVE,
                START,
                START + 1 days,
                START + 30 days
            );
        }
        bytes32 ninthTrade = keccak256("mock active trade nine");
        CredentialRegistry.HedgeCredential memory ninth = _hedgeCredential(
            ninthTrade,
            1_000 * UNIT,
            1,
            CredentialRegistry.HedgeStatus.ACTIVE,
            START,
            START + 1 days,
            START + 30 days
        );
        bytes memory ninthSignature = _signHedge(ninth, HEDGE_KEY);
        vm.expectRevert();
        credentials.submitHedge(ninth, ninthSignature);

        bytes32 firstTrade = keccak256(abi.encode("mock active trade", uint256(0)));
        _submitHedge(
            firstTrade,
            0,
            2,
            CredentialRegistry.HedgeStatus.CANCELLED,
            START,
            START + 1 days,
            START + 30 days
        );
        credentials.submitHedge(ninth, ninthSignature);
        assertEq(credentials.hedgeTradeIds(FACILITY_ID).length, 8);
    }

    function test_AdminCanRevokeActiveWaiverBackToFreshEvaluation() public {
        vault.syncCovenant();
        vault.createWaiver(1 hours, keccak256("mock outage"));
        assertTrue(vault.activeWaiver());
        vault.revokeWaiver();
        assertFalse(vault.activeWaiver());
        assertEq(uint256(vault.covenantState()), uint256(CovenantVault.CovenantState.CURE));
    }

    function test_CoreArc_T01_T04_T13_T16() public {
        _seedCompliant();
        vm.prank(operator);
        vault.draw(500_000 * UNIT);

        _submitExposure(6_000_000 * UNIT, 2, START, START + 10 days, START + 30 days);
        vm.prank(operator);
        vm.expectRevert();
        vault.draw(1);
        vault.syncCovenant();

        _submitHedge(
            TRADE_TWO,
            1_000_000 * UNIT,
            1,
            CredentialRegistry.HedgeStatus.ACTIVE,
            START,
            START + 10 days,
            START + 30 days
        );
        vault.restoreCompliance();
        vm.prank(operator);
        vault.draw(100_000 * UNIT);

        _submitHedge(
            TRADE_ONE,
            0,
            2,
            CredentialRegistry.HedgeStatus.CANCELLED,
            START,
            START + 10 days,
            START + 30 days
        );
        vault.syncCovenant();
        vm.warp(vault.cureDeadline() + 1);
        vault.syncCovenant();
        vm.prank(operator);
        vault.repay(100_000 * UNIT);
        assertEq(uint256(vault.covenantState()), uint256(CovenantVault.CovenantState.BREACH));
        assertEq(vault.principal(), 500_000 * UNIT);
    }

    // Exact revert data is A-3 / A-9 acceptance evidence, so these pin it rather than
    // accepting any revert.
    function test_DrawRefusedInCureRevertsDrawNotAllowedCure() public {
        _seedCompliant();
        vault.syncCovenant();
        _submitExposure(6_000_000 * UNIT, 2, START, START + 1 days, START + 30 days);

        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(
                CovenantVault.DrawNotAllowed.selector, CovenantVault.CovenantState.CURE
            )
        );
        vault.draw(1);

        // The coverage refusal takes precedence over the reserve test.
        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(
                CovenantVault.DrawNotAllowed.selector, CovenantVault.CovenantState.CURE
            )
        );
        vault.draw(9_000_001 * UNIT);
    }

    function test_DrawReserveViolationReportsBalanceRequestAndReserve() public {
        _seedCompliant();
        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(
                CovenantVault.ReserveViolation.selector,
                10_000_000 * UNIT,
                9_000_001 * UNIT,
                1_000_000 * UNIT
            )
        );
        vault.draw(9_000_001 * UNIT);

        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(
                CovenantVault.ReserveViolation.selector,
                10_000_000 * UNIT,
                10_000_001 * UNIT,
                1_000_000 * UNIT
            )
        );
        vault.draw(10_000_001 * UNIT);
    }

    function test_ActiveWaiverDoesNotReleaseReserve() public {
        vault.syncCovenant();
        vault.createWaiver(1 hours, keccak256("mock signer outage"));
        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(
                CovenantVault.ReserveViolation.selector,
                10_000_000 * UNIT,
                9_000_001 * UNIT,
                1_000_000 * UNIT
            )
        );
        vault.draw(9_000_001 * UNIT);
    }

    function test_GateRulesCoverageAndReserveForCallingHost() public {
        _seedCompliant();
        _assertAssess(9_000_000 * UNIT, true, CoverageEngine.ResultReason.NONE);
        _assertAssess(9_000_001 * UNIT, false, CoverageEngine.ResultReason.RESERVE_VIOLATION);
        _assertAssess(10_000_001 * UNIT, false, CoverageEngine.ResultReason.RESERVE_VIOLATION);
    }

    function test_GateReEvaluatesRatherThanReadingHostState() public {
        _seedCompliant();
        vault.syncCovenant();
        _submitExposure(6_000_000 * UNIT, 2, START, START + 1 days, START + 30 days);

        assertEq(uint256(vault.covenantState()), uint256(CovenantVault.CovenantState.COMPLIANT));
        _assertAssess(1, false, CoverageEngine.ResultReason.BELOW_THRESHOLD);
        _assertAssess(9_000_001 * UNIT, false, CoverageEngine.ResultReason.BELOW_THRESHOLD);
    }

    function test_GatePermitsUnderActiveWaiverWhileReportingNonCompliance() public {
        _assertAssess(1, false, CoverageEngine.ResultReason.MISSING_EXPOSURE);

        vault.syncCovenant();
        vault.createWaiver(1 hours, keccak256("mock signer outage"));
        _assertAssess(1, true, CoverageEngine.ResultReason.MISSING_EXPOSURE);
        _assertAssess(9_000_001 * UNIT, false, CoverageEngine.ResultReason.RESERVE_VIOLATION);

        vm.warp(vault.waiverEndsAt() + 1);
        _assertAssess(1, false, CoverageEngine.ResultReason.MISSING_EXPOSURE);
    }

    /// @dev Calls as the vault, because `assess` rules for the calling host.
    function _assertAssess(
        uint256 amount,
        bool expectedAllowed,
        CoverageEngine.ResultReason expectedReason
    ) internal {
        vm.prank(address(vault));
        (bool allowed, CoverageEngine.ResultReason reason) =
            ICoverageGate(address(engine)).assess(FACILITY_ID, amount);
        assertTrue(allowed == expectedAllowed);
        assertEq(uint256(reason), uint256(expectedReason));
    }

    function _seedCompliant() internal {
        _seedCompliantWithValidity(START + 1 days);
    }

    function _seedCompliantWithValidity(uint64 validUntil) internal {
        _submitExposure(5_000_000 * UNIT, 1, START, validUntil, START + 30 days);
        _submitHedge(
            TRADE_ONE,
            4_500_000 * UNIT,
            1,
            CredentialRegistry.HedgeStatus.ACTIVE,
            START,
            validUntil,
            START + 30 days
        );
    }

    function _submitExposure(
        uint256 amount,
        uint64 sequence,
        uint64 observedAt,
        uint64 validUntil,
        uint64 maturity
    ) internal {
        CredentialRegistry.ExposureCredential memory credential =
            _exposure(amount, sequence, observedAt, validUntil, maturity);
        credentials.submitExposure(credential, _signExposure(credential, EXPOSURE_KEY));
    }

    function _submitHedge(
        bytes32 tradeId,
        uint256 amount,
        uint64 sequence,
        CredentialRegistry.HedgeStatus status,
        uint64 observedAt,
        uint64 validUntil,
        uint64 maturity
    ) internal {
        CredentialRegistry.HedgeCredential memory credential = _hedgeCredential(
            tradeId, amount, sequence, status, observedAt, validUntil, maturity
        );
        credentials.submitHedge(credential, _signHedge(credential, HEDGE_KEY));
    }

    function _hedgeCredential(
        bytes32 tradeId,
        uint256 amount,
        uint64 sequence,
        CredentialRegistry.HedgeStatus status,
        uint64 observedAt,
        uint64 validUntil,
        uint64 maturity
    ) internal pure returns (CredentialRegistry.HedgeCredential memory) {
        return CredentialRegistry.HedgeCredential({
            facilityId: FACILITY_ID,
            tradeIdCommitment: tradeId,
            baseCurrency: USD,
            quoteCurrency: COP,
            remainingNotional: uint128(amount),
            maturity: maturity,
            status: status,
            observedAt: observedAt,
            validUntil: validUntil,
            sequence: sequence,
            sourceCommitment: keccak256(abi.encode("fictional mock hedge", tradeId, sequence))
        });
    }

    function _exposure(
        uint256 amount,
        uint64 sequence,
        uint64 observedAt,
        uint64 validUntil,
        uint64 maturity
    ) internal pure returns (CredentialRegistry.ExposureCredential memory) {
        return CredentialRegistry.ExposureCredential({
                facilityId: FACILITY_ID,
                exposureCurrency: COP,
                settlementCurrency: USD,
                outstandingValue: uint128(amount),
                exposureMaturity: maturity,
                observedAt: observedAt,
                validUntil: validUntil,
                sequence: sequence,
                sourceCommitment: keccak256(abi.encode("fictional mock exposure", sequence))
            });
    }

    function _signExposure(
        CredentialRegistry.ExposureCredential memory credential,
        uint256 privateKey
    ) internal returns (bytes memory) {
        bytes32 digest = credentials.hashExposureCredential(credential);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signHedge(CredentialRegistry.HedgeCredential memory credential, uint256 privateKey)
        internal
        returns (bytes memory)
    {
        bytes32 digest = credentials.hashHedgeCredential(credential);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function assertTrue(bool value) internal pure {
        require(value, "assertTrue failed");
    }

    function assertFalse(bool value) internal pure {
        require(!value, "assertFalse failed");
    }

    function assertEq(uint256 left, uint256 right) internal pure {
        require(left == right, "assertEq(uint256) failed");
    }
}
