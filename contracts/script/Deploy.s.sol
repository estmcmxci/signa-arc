// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FacilityRegistry } from "../src/FacilityRegistry.sol";
import { CredentialRegistry } from "../src/CredentialRegistry.sol";
import { CoverageEngine } from "../src/CoverageEngine.sol";
import { CovenantVault } from "../src/CovenantVault.sol";
import { MockUSDC } from "../src/mocks/MockUSDC.sol";

interface VmDeploy {
    function envAddress(string calldata name) external view returns (address value);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @notice Base Sepolia deployment for the fictional USD/COP demonstration facility.
/// @dev Uses Foundry's keystore-backed --account flow; no private key is read by this script.
contract Deploy {
    VmDeploy private constant VM =
        VmDeploy(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    uint256 private constant UNIT = 1e6;

    bytes32 public constant FACILITY_ID = keccak256("fictional-coffee-facility");
    bytes3 private constant USD = "USD";
    bytes3 private constant COP = "COP";

    error WrongChain(uint256 actualChainId);

    event DeploymentReady(
        uint256 indexed chainId,
        bytes32 indexed facilityId,
        address mockSettlementAsset,
        address facilityRegistry,
        address credentialRegistry,
        address coverageEngine,
        address covenantVault
    );

    function run()
        external
        returns (
            MockUSDC token,
            FacilityRegistry facilities,
            CredentialRegistry credentials,
            CoverageEngine engine,
            CovenantVault vault
        )
    {
        if (block.chainid != BASE_SEPOLIA_CHAIN_ID) {
            revert WrongChain(block.chainid);
        }

        address admin = VM.envAddress("FACILITY_ADMIN");
        address operator = VM.envAddress("ORIGINATOR_OPERATOR");
        address exposureIssuer = VM.envAddress("EXPOSURE_ISSUER");
        address hedgeIssuer = VM.envAddress("HEDGE_ISSUER");

        VM.startBroadcast();
        token = new MockUSDC();
        facilities = new FacilityRegistry();
        facilities.createFacility(
            FacilityRegistry.FacilityPolicy({
                facilityId: FACILITY_ID,
                settlementCurrency: USD,
                exposureCurrency: COP,
                minCoverageBps: 8_000,
                credentialMaxAge: 1 days,
                maturityTolerance: 1 days,
                defaultHaircutBps: 0,
                reserveAmount: uint128(1_000_000 * UNIT),
                // Intentionally short for a public testnet lifecycle demonstration.
                curePeriod: 10 minutes,
                maxWaiverDuration: 12 hours,
                maxActiveHedges: 8,
                settlementAsset: address(token),
                admin: admin,
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

        token.mint(admin, 10_000_000 * UNIT);
        token.approve(address(vault), type(uint256).max);
        vault.deposit(10_000_000 * UNIT);
        VM.stopBroadcast();

        emit DeploymentReady(
            block.chainid,
            FACILITY_ID,
            address(token),
            address(facilities),
            address(credentials),
            address(engine),
            address(vault)
        );
    }
}
